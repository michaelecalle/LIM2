// src/hooks/useTrainDist.ts
//
// Moteur de position pour la FT horizontale : calcule la "distance depuis l'origine"
// (en km) à partir du mode GPS ou horaire, avec les mêmes mécanismes que FT.tsx :
//   – GPS  : pk → U (coordonnée monotone ADIF→LFP→RFN) → interpolation dans points[]
//   – Horaire : heure d'horloge + base de recalage → interpolation temporelle
//   – Stand-by initial + manuel + sortie
//   – Gel de position en tunnel (tunnelZoneAt)
//   – Résurrection de la base horaire au départ
//
// Consommateur : FTHorizontal.tsx, qui convertit dist → scrollLeft = dist * pxPerKm.
// FT.tsx garde son propre moteur DOM-based (non refactorisé ici pour éviter tout risque).

import { useCallback, useEffect, useRef, useState } from "react";
import { tunnelZoneAt, tunnelZoneAtStrict } from "../data/tunnelZones";
import { logTestEvent } from "../lib/testLogger";
import { empiricalPkAtElapsed, isInEmpiricalZone } from "../data/empiricalCurve";

// ─── Types publics ────────────────────────────────────────────────────────────

export type TDPoint = {
  dist: number;                        // km depuis l'origine (>= 0)
  pkInternal: number | null;           // PK continu brut (pour GPS)
  network: "ADIF" | "LFP" | "RFN" | null;
  hora: string;                        // heure de DÉPART "HH:MM" ou ""
  arr?: string | null;                 // heure d'ARRIVÉE (gare commerciale) "HH:MM" ou null
};

export type GpsStateUi = "RED" | "ORANGE" | "GREEN" | "ARRET";
export type ReferenceMode = "GPS" | "HORAIRE";

export type TrainDistResult = {
  dist: number | null;                 // position courante (km)
  referenceMode: ReferenceMode;        // GPS ou HORAIRE
  gpsState: GpsStateUi;
  autoScrollEnabled: boolean;
  standbyPointIndex: number | null;    // index dans points[], ou null
  barColor: "green" | "red";          // vert = GPS, rouge = horaire / standby
  setStandbyByIndex: (index: number | null) => void;
};

// ─── Coordonnée unifiée (monotone le long du trajet ADIF→LFP→RFN) ────────────
//   ADIF décroît de 805 → 752.4 (Cerbère). LFP décroît de 44.4 → 0. RFN décroît de 473.3 → ?
const A_LFP_ADIF = 752.4;  // PK ADIF à la jonction ADIF/LFP
const A_LFP_LFP  = 44.4;   // PK LFP  à la jonction ADIF/LFP
const A_RFN_LFP  = 0.0;    // PK LFP  à la jonction LFP/RFN
const A_RFN_RFN  = 476.2;  // PK RFN  à la jonction LFP/RFN (origine de la chaîne PK RFN)

function guessNet(pk: number): "ADIF" | "LFP" | "RFN" {
  return pk >= 600 ? "ADIF" : pk >= 200 ? "RFN" : "LFP";
}

function pkToU(pk: number, net: "ADIF" | "LFP" | "RFN"): number {
  if (net === "ADIF") return pk;
  if (net === "LFP")  return A_LFP_ADIF + (A_LFP_LFP - pk);
  return A_LFP_ADIF + (A_LFP_LFP - A_RFN_LFP) + (A_RFN_RFN - pk);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMin(s: string): number | null {
  const txt = (s ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(txt);
  if (!m) return null;
  // « + » après l'heure = +30 s (notation SNCF du format 2026, ex. « 13:06+ »).
  return +m[1] * 60 + +m[2] + (/\+/.test(txt) ? 0.5 : 0);
}

function nowMinFloat(): number {
  try {
    const iso: string | null =
      (window as any).__limgptDemo?.nowIso?.() ??
      (window as any).__limgptReplay?.nowIso?.() ??
      null;
    const d = iso ? new Date(iso) : new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }
}

// Interpolation linéaire dans un tableau trié par key → retourne dist.
function interpDist(pts: { key: number; dist: number }[], target: number): number | null {
  if (pts.length === 0) return null;
  if (target <= pts[0].key)              return pts[0].dist;
  if (target >= pts[pts.length - 1].key) return pts[pts.length - 1].dist;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (target >= a.key && target <= b.key) {
      const t = b.key === a.key ? 0 : (target - a.key) / (b.key - a.key);
      return a.dist + t * (b.dist - a.dist);
    }
  }
  return null;
}

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useTrainDist(points: TDPoint[], active: boolean): TrainDistResult {
  const [dist, setDist] = useState<number | null>(null);
  const [gpsState, setGpsState] = useState<GpsStateUi>("RED");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [standbyPointIndex, setStandbyPointIndex] = useState<number | null>(null);

  // Refs pour la boucle de tick (évite les stale closures)
  const gpsStateRef             = useRef<GpsStateUi>("RED");
  const autoScrollEnabledRef    = useRef(false);
  const standbyIndexRef         = useRef<number | null>(null);
  const initialStandbyDoneRef   = useRef(false);
  // Drapeau stand-by FIABLE : true dès qu'un stand-by est demandé (Play, arrêt auto,
  // re-stand-by manuel), même quand aucune branche ne pose standbyIndexRef. Il gèle le
  // tick SUR PLACE (sans téléporter) → la barre n'avance jamais pendant le stand-by.
  const inStandbyRef            = useRef(false);
  const lastGpsPkRef            = useRef<number | null>(null);
  const lastGpsSKmRef           = useRef<number | null>(null);
  const lastFrozenDistRef       = useRef<number | null>(null);  // gel tunnel
  const lastHoraLogAtRef        = useRef<number>(0);  // throttle log diagnostic horaire
  const empiricalAnchorRef      = useRef<{ pk: number; minFloat: number } | null>(null);  // ancrage courbe empirique
  // Offset d'ancrage du repli THEORIQUE : l'horaire fait PROGRESSER le train depuis la
  // derniere position connue au lieu de le placer en absolu (evite le saut a la bascule).
  const horaireOffsetRef        = useRef<number | null>(null);
  const autoScrollBaseRef       = useRef<{
    firstHoraMin: number;   // heure de référence (minutes) de la base
    realMinFloat: number;   // heure d'horloge au moment du Play
  } | null>(null);

  // Sync refs → states
  useEffect(() => { gpsStateRef.current = gpsState; }, [gpsState]);
  useEffect(() => { autoScrollEnabledRef.current = autoScrollEnabled; }, [autoScrollEnabled]);

  // 01/10 — point verrouillé libéré par ②b, consommé par la ② qui suit (cf. ces branches).
  const releasedLockedIdxRef = useRef<number | null>(null);
  // 01/10 — vitesse GPS récente (km/h, fixes ≤ 50 m, fenêtre ≥ 8 s) pour l'estime à vitesse
  // constante en tunnel. Dernier fix retenu pour la dériver.
  const lastGpsSpeedKmhRef = useRef<number | null>(null);
  const lastSpeedFixRef = useRef<{ t: number; s: number } | null>(null);

  // ── Écoute : état GPS (émis par FT.tsx watchdog) ──────────────────────────
  useEffect(() => {
    const h = (e: Event) => {
      const s = (e as CustomEvent).detail?.state as GpsStateUi | undefined;
      if (s && (s === "RED" || s === "ORANGE" || s === "GREEN" || s === "ARRET")) {
        gpsStateRef.current = s;
        setGpsState(s);
      }
    };
    window.addEventListener("lim:gps-state", h as EventListener);
    return () => window.removeEventListener("lim:gps-state", h as EventListener);
  }, []);

  // ── Écoute : position GPS (pk + s_km) ────────────────────────────────────
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const pk  = d?.pk;
      const skm = d?.s_km;
      if (typeof pk  === "number" && isFinite(pk))  lastGpsPkRef.current  = pk;
      if (typeof skm === "number" && isFinite(skm)) lastGpsSKmRef.current = skm;
      // 01/10 — vitesse sur fixes précis. Fenêtre ≥ 8 s : le s_km est accroché à un ruban de
      // 25 m, une fenêtre courte donnerait des paliers de 45 km/h.
      const acc = d?.accuracy;
      if (typeof skm === "number" && isFinite(skm) && typeof acc === "number" && acc <= 50) {
        const now = Date.now();
        const prev = lastSpeedFixRef.current;
        if (!prev) lastSpeedFixRef.current = { t: now, s: skm };
        else if (now - prev.t >= 8000) {
          const v = Math.abs(skm - prev.s) / ((now - prev.t) / 3600000);
          if (isFinite(v) && v <= 350) lastGpsSpeedKmhRef.current = v;
          lastSpeedFixRef.current = { t: now, s: skm };
        }
      }
    };
    window.addEventListener("gps:position", h as EventListener);
    return () => window.removeEventListener("gps:position", h as EventListener);
  }, []);

  // ── Écoute : auto-scroll (Play/Pause du TitleBar) ─────────────────────────
  useEffect(() => {
    const h = (e: Event) => {
      const d    = (e as CustomEvent).detail ?? {};
      const enabled: boolean = !!d.enabled;
      const standby: boolean = !!d.standby;
      const eventPk = typeof d.pk === "number" && isFinite(d.pk) ? d.pk : null;

      logTestEvent("utd:auto-scroll-change", {
        enabled, standby, pk: eventPk, source: d.source ?? null,
        initialDone: initialStandbyDoneRef.current,
        standbyIdx: standbyIndexRef.current,
        pointsLen: points.length,
      });

      // Drapeau stand-by posé AVANT toute branche : même un cas non couvert par ①b/①
      // (ex. re-Play après reprise, sans pk et initialDone déjà vrai) fige alors le tick.
      if (enabled && standby) inStandbyRef.current = true;

      // Le PK est le SEUL discriminant (pas l'état initialDone, fragile en seek/replay) :
      // - event AVEC pk  → stand-by automatique sur la gare de ce pk (①b)
      // - event SANS pk  → stand-by initial sur le premier point (①)

      // ①b Stand-by automatique (arrêt détecté) : figer sur la gare du pk fourni
      if (enabled && standby && eventPk != null && points.length > 0) {
        initialStandbyDoneRef.current = true;
        const targetU = pkToU(eventPk, guessNet(eventPk));
        let bestIdx = 0;
        let bestDelta = Infinity;
        for (let i = 0; i < points.length; i++) {
          if (points[i].pkInternal == null) continue;
          const delta = Math.abs(points[i].pkInternal! - targetU);
          if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
        }
        standbyIndexRef.current = bestIdx;
        setStandbyPointIndex(bestIdx);
        autoScrollEnabledRef.current = true;
        setAutoScrollEnabled(true);
        setDist(points[bestIdx].dist);
        logTestEvent("utd:branch", {
          branch: "①b-standby-auto", eventPk, targetU, bestIdx, bestDelta,
          bestPkInternal: points[bestIdx].pkInternal, dist: points[bestIdx].dist,
        });
        return;
      }

      // ① Stand-by initial : premier Play sans pk → on se fige sur le premier point
      if (enabled && standby && !initialStandbyDoneRef.current && points.length > 0) {
        initialStandbyDoneRef.current = true;
        standbyIndexRef.current       = 0;
        setStandbyPointIndex(0);
        autoScrollEnabledRef.current  = true;
        setAutoScrollEnabled(true);
        setDist(points[0].dist);
        logTestEvent("utd:branch", { branch: "①-standby-initial", idx: 0, dist: points[0].dist });
        return;
      }

      // ② Reprise depuis stand-by { enabled: true, standby: false }
      if (enabled && !standby) {
        inStandbyRef.current = false;       // départ réel : le tick peut de nouveau avancer
        empiricalAnchorRef.current = null;  // départ/reprise : la courbe empirique se ré-ancrera
        horaireOffsetRef.current = null;
        // Verrou courant, ou verrou que ②b vient de libérer dans la même pile d'événements.
        const lockedIdx = standbyIndexRef.current ?? releasedLockedIdxRef.current;
        releasedLockedIdxRef.current = null;
        const refPt = lockedIdx != null ? points[lockedIdx] : null;
        if (refPt) {
          const horaMin = parseMin(refPt.hora);
          if (horaMin != null) {
            autoScrollBaseRef.current = { firstHoraMin: horaMin, realMinFloat: nowMinFloat() };
          }
          // Ré-ancrage explicite : à la reprise on est physiquement sur la gare verrouillée.
          // Sans ça, si le GPS était périmé à l'approche, le repli horaire recalcule son offset
          // sur le dernier fix GPS (lastFrozenDist) et téléporte le train en arrière.
          lastFrozenDistRef.current = refPt.dist;
        } else if (!initialStandbyDoneRef.current || lastFrozenDistRef.current == null) {
          // Tout premier démarrage sans verrou : base = heure courante (train à l'heure).
          autoScrollBaseRef.current = { firstHoraMin: nowMinFloat(), realMinFloat: nowMinFloat() };
        }
        // ⚠️ 01/10 — PLUS JAMAIS de repli sur le « premier point horaire » en cours de
        // trajet : c'est ce repli qui a renvoyé le 9707 à Barcelone (dist 0, base 16:24)
        // à la sortie du stand-by de Gérone, puis à chaque recalage manuel. Sans verrou,
        // on ne sait pas mieux où est le train que là où il était : on garde la position
        // et la base horaire (celle de FT.tsx arrive de toute façon par ft:delta:base-sync).
        logTestEvent("utd:branch", {
          branch: "②-resume", lockedIdx, refHora: refPt?.hora ?? null,
          keptPosition: refPt == null, dist: lastFrozenDistRef.current,
        });
        standbyIndexRef.current = null;
        setStandbyPointIndex(null);
      }

      // ③ Pause
      if (!enabled) {
        inStandbyRef.current      = false;
        autoScrollBaseRef.current = null;
        standbyIndexRef.current   = null;
        setStandbyPointIndex(null);
        setDist(null);
        logTestEvent("utd:branch", { branch: "③-pause" });
      }

      autoScrollEnabledRef.current = enabled;
      setAutoScrollEnabled(enabled);
    };

    window.addEventListener("ft:auto-scroll-change", h as EventListener);
    return () => window.removeEventListener("ft:auto-scroll-change", h as EventListener);
  }, [points]);

  // ── Écoute : levée du stand-by décidée par FT.tsx ───────────────────────
  // 30/09 — `lim:hourly-mode {standby: false}` est le message d'autorité de FT.tsx
  // sur l'état du stand-by : émis au Play sous GPS vert (stand-by initial sauté),
  // au départ confirmé et à chaque passage en GPS sans verrou. Ce moteur ne
  // l'écoutait pas : au départ de Perpignan le 30/09, le TitleBar lui avait envoyé
  // `standby: true` (premier Play), FT.tsx avait sauté le sien, et rien n'a jamais
  // levé le gel d'ici — 40 min de fiche horizontale figée sur Perpignan, GPS vert,
  // jusqu'à une sortie manuelle à Gérone. On ne touche pas à la base horaire :
  // elle arrive séparément par `ft:delta:base-sync`.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (d.standby !== false) return;
      if (!inStandbyRef.current && standbyIndexRef.current === null) return; // rien à lever
      const lockedIdx = standbyIndexRef.current;
      inStandbyRef.current = false;
      empiricalAnchorRef.current = null;
      horaireOffsetRef.current = null;
      // Même ré-ancrage qu'en ② : on est physiquement sur la gare verrouillée.
      if (lockedIdx != null && points[lockedIdx]) lastFrozenDistRef.current = points[lockedIdx].dist;
      // ⚠️ 01/10 — TÉLÉPORTATION À BARCELONE (9707 du 01/10, sortie de stand-by à Gérone).
      // FT.tsx émet `lim:hourly-mode {standby:false}` AVANT que `ft:auto-scroll-change
      // {standby:false}` n'atteigne ce hook : ce bloc effaçait le verrou, puis la branche ②
      // le trouvait nul et se rabattait sur le PREMIER point horaire — Barcelone, 16:24,
      // dist 0. Cent kilomètres en arrière. On mémorise donc le point libéré pour la ②
      // qui suit dans la même pile d'événements.
      releasedLockedIdxRef.current = lockedIdx;
      standbyIndexRef.current = null;
      setStandbyPointIndex(null);
      logTestEvent("utd:branch", { branch: "②b-release-hourly-mode", lockedIdx });
    };
    window.addEventListener("lim:hourly-mode", h as EventListener);
    return () => window.removeEventListener("lim:hourly-mode", h as EventListener);
  }, [points]);

  // ── Écoute : redémarrage à chaud (bouton des paramètres, 01/10) ───────────
  // Tout l'état de position repart de zéro, le journal continue. Le Play virtuel qui suit
  // (ft:auto-scroll-change standby:true) repasse alors par le stand-by initial, que FT.tsx
  // saute aussitôt sous GPS vert (lim:hourly-mode standby:false → ②b ci-dessus).
  useEffect(() => {
    const h = () => {
      inStandbyRef.current = false;
      initialStandbyDoneRef.current = false;
      standbyIndexRef.current = null;
      releasedLockedIdxRef.current = null;
      empiricalAnchorRef.current = null;
      horaireOffsetRef.current = null;
      lastFrozenDistRef.current = null;
      autoScrollBaseRef.current = null;
      setStandbyPointIndex(null);
      setDist(null);
      logTestEvent("utd:soft-reset", {});
    };
    window.addEventListener("lim:soft-reset", h as EventListener);
    return () => window.removeEventListener("lim:soft-reset", h as EventListener);
  }, []);

  // ── Écoute : sync delta depuis FT.tsx (source de vérité du recalage) ────
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const fhm = d?.firstHoraMin;
      const rmf = d?.realMinFloat;
      if (typeof fhm === "number" && isFinite(fhm) && typeof rmf === "number" && isFinite(rmf)) {
        autoScrollBaseRef.current = { firstHoraMin: fhm, realMinFloat: rmf };
        logTestEvent("utd:base-sync", { firstHoraMin: fhm, realMinFloat: rmf });
      }
    };
    window.addEventListener("ft:delta:base-sync", h as EventListener);
    return () => window.removeEventListener("ft:delta:base-sync", h as EventListener);
  }, []);

  // ── Tick 250 ms : calcul de la position ──────────────────────────────────
  // Tourne EN PERMANENCE, meme quand la FT horizontale est masquee (#28 : les deux
  // modes restent montes, on bascule par `display`). Sinon `dist` reste fige sur la
  // valeur du stand-by initial (= l'origine) pendant tout le trajet passe en vertical,
  // et la bascule vertical -> horizontal replace le train a Barcelone.
  // `active` ne sert donc plus qu'a museler les logs de diagnostic.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!autoScrollEnabledRef.current) return;
      if (inStandbyRef.current) return;              // stand-by : barre gelée sur place
      if (standbyIndexRef.current !== null) return;  // figé en stand-by (snap sur gare)

      const gs   = gpsStateRef.current;
      // Garde-fou tunnel : bloquer le GPS tant que le dernier s_km est dans une zone tunnel
      // 01/10 — bornes STRICTES du tunnel pour le mode (la marge de 150 m faisait basculer
      // en horaire avant chaque entrée). La marge reste aux garde-fous.
      const inTunnel = tunnelZoneAtStrict(lastGpsSKmRef.current) != null;
      const mode: ReferenceMode =
        (gs === "GREEN" || gs === "ARRET") && !inTunnel ? "GPS" : "HORAIRE";

      // ─── Mode GPS ──────────────────────────────────────────────────────
      if (mode === "GPS") {
        empiricalAnchorRef.current = null;  // on quitte l'horaire : l'ancre empirique se re-posera au retour
        horaireOffsetRef.current = null;
        const pk  = lastGpsPkRef.current;
        const skm = lastGpsSKmRef.current;
        if (pk == null) return;

        // Gel en tunnel (on garde la dernière dist connue)
        if (tunnelZoneAtStrict(skm)) {
          if (lastFrozenDistRef.current != null) setDist(lastFrozenDistRef.current);
          return;
        }

        const targetU = pkToU(pk, guessNet(pk));
        const gpsPts = points
          .filter(p => p.pkInternal != null)
          .map(p => ({
            key:  p.pkInternal!,  // pkInternal est déjà la coordonnée U monotone (pkInterne)
            dist: p.dist,
          }));
        gpsPts.sort((a, b) => a.key - b.key);

        const r = interpDist(gpsPts, targetU);
        if (r != null) { lastFrozenDistRef.current = r; setDist(r); }
        return;
      }

      // ─── Mode horaire ──────────────────────────────────────────────────
      const base = autoScrollBaseRef.current;
      if (!base) return;

      // Courbe empirique (à CHAQUE tunnel) : profil de vitesse RÉEL au lieu de la VL théorique
      // irréaliste. ANCRAGE sur la position courante à l'entrée en horaire (pas en absolu) : évite
      // le saut à la bascule ET reste correct si le GPS revient puis se reperd. Hors segment mesuré
      // → empPk null → repli sur le calcul horaire théorique ci-dessous.
      const pk0 = points[0]?.pkInternal;
      const pkLast = points.length ? points[points.length - 1]?.pkInternal : null;
      if (pk0 != null && pkLast != null) {
        // 01/10 — sens de marche en U : SN = U croît avec la distance, NS = U décroît.
        const direction: "SN" | "NS" = pkLast >= pk0 ? "SN" : "NS";
        const uDir = direction === "SN" ? 1 : -1;
        if (empiricalAnchorRef.current == null) {
          // 1re entrée en horaire : ancrer sur la position courante (0 au départ, sinon dernier GPS)
          const curDist = lastFrozenDistRef.current ?? 0;
          empiricalAnchorRef.current = { pk: pk0 + uDir * curDist, minFloat: nowMinFloat() };
        }
        const anchor = empiricalAnchorRef.current;
        const elapsedSec = (nowMinFloat() - anchor.minFloat) * 60;
        const variant = { direction };
        let estPk: number | null = null;
        let estSource: "empirique" | "vitesse-constante" | null = null;
        if (isInEmpiricalZone(anchor.pk, variant)) {
          estPk = empiricalPkAtElapsed(anchor.pk, elapsedSec, variant);
          if (estPk != null) estSource = "empirique";
        }
        // 01/10 — ESTIME À VITESSE CONSTANTE, en repli de la courbe empirique et AVANT
        // l'horaire théorique. Le 01/10 dans le Perthus (9707), sans courbe, l'horaire
        // supposait 146 km/h là où le train roulait à 288 : 4,9 km de retard d'estimation
        // à la sortie. La dernière vitesse GPS tenue constante donnait 260 m.
        if (estPk == null) {
          const v = lastGpsSpeedKmhRef.current;
          if (v != null && v >= 5) {
            let u = anchor.pk + uDir * (v / 3600) * elapsedSec;
            // Jamais au-delà du prochain arrêt commercial : le train s'y arrêtera.
            const anchorDist = (anchor.pk - pk0) * uDir;
            const nextStop = points
              .filter((p) => p.arr && parseMin(p.arr) != null && p.dist > anchorDist + 0.05)
              .map((p) => p.dist)
              .sort((a, b) => a - b)[0];
            if (nextStop != null && (u - pk0) * uDir > nextStop) u = pk0 + uDir * nextStop;
            estPk = u;
            estSource = "vitesse-constante";
          }
        }
        if (estPk != null) {
          const estDist = (estPk - pk0) * uDir;
          setDist(estDist);
          const nowT = Date.now();
          if (active && nowT - lastHoraLogAtRef.current >= 5000) {
            lastHoraLogAtRef.current = nowT;
            logTestEvent("utd:tick-empirique", {
              source: estSource, direction,
              anchorPk: Math.round(anchor.pk * 1000) / 1000, elapsedSec: Math.round(elapsedSec),
              empPk: Math.round(estPk * 1000) / 1000, dist: Math.round(estDist * 100) / 100,
              vKmh: lastGpsSpeedKmhRef.current != null ? Math.round(lastGpsSpeedKmhRef.current) : null,
            });
          }
          return;
        }
      }

      const effectiveMin = base.firstHoraMin + (nowMinFloat() - base.realMinFloat);

      // Courbe temps→dist : chaque point d'arrêt commercial crée DEUX bornes à la
      // même distance — arrivée et départ — pour que la position reste figée à quai
      // entre les deux (interpolation de départ(A) → arrivée(B), plateau, départ(B) → …).
      const horaPts: { key: number; dist: number }[] = [];
      for (const p of points) {
        const depMin = parseMin(p.hora);
        const arrMin = p.arr ? parseMin(p.arr) : null;
        if (arrMin != null) horaPts.push({ key: arrMin, dist: p.dist });
        if (depMin != null) horaPts.push({ key: depMin, dist: p.dist });
      }
      horaPts.sort((a, b) => a.key - b.key);

      const rTheo = interpDist(horaPts, effectiveMin);
      if (rTheo != null) {
        // ⚓ ancrage : a la 1re entree en horaire on fige l'ecart entre la position REELLE
        // (dernier GPS connu) et ce que dit l'horaire ; ensuite l'horaire ne fait que faire
        // AVANCER le train depuis ce point. Au retour du GPS l'offset est remis a null.
        if (horaireOffsetRef.current == null) {
          const cur = lastFrozenDistRef.current;
          horaireOffsetRef.current = cur != null ? cur - rTheo : 0;
        }
        const r = rTheo + horaireOffsetRef.current;
        setDist(r);
        // Log throttlé toutes les 5s pour suivre la position horaire calculée
        const nowT = Date.now();
        if (active && nowT - lastHoraLogAtRef.current >= 5000) {
          lastHoraLogAtRef.current = nowT;
          logTestEvent("utd:tick-horaire", {
            effectiveMin: Math.round(effectiveMin * 100) / 100,
            firstHoraMin: base.firstHoraMin, dist: Math.round(r * 100) / 100,
            distTheo: Math.round(rTheo * 100) / 100,
            offset: Math.round((horaireOffsetRef.current ?? 0) * 100) / 100,
          });
        }
      }
    }, 250);

    return () => window.clearInterval(id);
  }, [active, points]);

  // ── API stand-by exposée au composant ────────────────────────────────────
  const setStandbyByIndex = useCallback((index: number | null) => {
    if (index === null) {
      // Sortie de stand-by : recalage sur le point verrouillé
      const lockedIdx = standbyIndexRef.current;
      const pt = lockedIdx != null ? points[lockedIdx] : null;
      if (pt) {
        const horaMin = parseMin(pt.hora);
        if (horaMin != null) {
          autoScrollBaseRef.current = { firstHoraMin: horaMin, realMinFloat: nowMinFloat() };
        }
      }
      standbyIndexRef.current = null;
      setStandbyPointIndex(null);
    } else {
      // Entrée en stand-by sur ce point
      standbyIndexRef.current = index;
      setStandbyPointIndex(index);
      if (points[index]) setDist(points[index].dist);
    }
  }, [points]);

  // Couleur de la barre : verte en GPS, rouge en horaire / stand-by
  const barColor: "green" | "red" =
    (gpsState === "GREEN" || gpsState === "ARRET") && autoScrollEnabled ? "green" : "red";

  const referenceMode: ReferenceMode =
    (gpsState === "GREEN" || gpsState === "ARRET") && autoScrollEnabled ? "GPS" : "HORAIRE";

  return {
    dist,
    referenceMode,
    gpsState,
    autoScrollEnabled,
    standbyPointIndex,
    barColor,
    setStandbyByIndex,
  };
}
