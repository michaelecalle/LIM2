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
import { tunnelZoneAt } from "../data/tunnelZones";

// ─── Types publics ────────────────────────────────────────────────────────────

export type TDPoint = {
  dist: number;                        // km depuis l'origine (>= 0)
  pkInternal: number | null;           // PK continu brut (pour GPS)
  network: "ADIF" | "LFP" | "RFN" | null;
  hora: string;                        // "HH:MM" ou ""
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
  const m = /^(\d{1,2}):(\d{2})/.exec((s ?? "").trim());
  return m ? +m[1] * 60 + +m[2] : null;
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
  const lastGpsPkRef            = useRef<number | null>(null);
  const lastGpsSKmRef           = useRef<number | null>(null);
  const lastFrozenDistRef       = useRef<number | null>(null);  // gel tunnel
  const autoScrollBaseRef       = useRef<{
    firstHoraMin: number;   // heure de référence (minutes) de la base
    realMinFloat: number;   // heure d'horloge au moment du Play
  } | null>(null);

  // Sync refs → states
  useEffect(() => { gpsStateRef.current = gpsState; }, [gpsState]);
  useEffect(() => { autoScrollEnabledRef.current = autoScrollEnabled; }, [autoScrollEnabled]);

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

      // ① Stand-by initial : premier Play → on se fige sur le premier point
      if (enabled && standby && !initialStandbyDoneRef.current && points.length > 0) {
        initialStandbyDoneRef.current = true;
        standbyIndexRef.current       = 0;
        setStandbyPointIndex(0);
        autoScrollEnabledRef.current  = true;
        setAutoScrollEnabled(true);
        setDist(points[0].dist);
        return;
      }

      // ② Reprise depuis stand-by { enabled: true, standby: false }
      if (enabled && !standby) {
        const lockedIdx = standbyIndexRef.current;
        // On cherche le point de référence : soit la ligne verrouillée, soit le premier point horaire
        const refPt = lockedIdx != null
          ? points[lockedIdx]
          : points.find(p => parseMin(p.hora) != null);
        if (refPt) {
          const horaMin = parseMin(refPt.hora);
          if (horaMin != null) {
            autoScrollBaseRef.current = { firstHoraMin: horaMin, realMinFloat: nowMinFloat() };
          }
        } else {
          // Pas de point horaire : base = heure courante (train à l'heure)
          autoScrollBaseRef.current = { firstHoraMin: nowMinFloat(), realMinFloat: nowMinFloat() };
        }
        standbyIndexRef.current = null;
        setStandbyPointIndex(null);
      }

      // ③ Pause
      if (!enabled) {
        autoScrollBaseRef.current = null;
        standbyIndexRef.current   = null;
        setStandbyPointIndex(null);
        setDist(null);
      }

      autoScrollEnabledRef.current = enabled;
      setAutoScrollEnabled(enabled);
    };

    window.addEventListener("ft:auto-scroll-change", h as EventListener);
    return () => window.removeEventListener("ft:auto-scroll-change", h as EventListener);
  }, [points]);

  // ── Écoute : sync delta depuis FT.tsx (source de vérité du recalage) ────
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const fhm = d?.firstHoraMin;
      const rmf = d?.realMinFloat;
      if (typeof fhm === "number" && isFinite(fhm) && typeof rmf === "number" && isFinite(rmf)) {
        autoScrollBaseRef.current = { firstHoraMin: fhm, realMinFloat: rmf };
      }
    };
    window.addEventListener("ft:delta:base-sync", h as EventListener);
    return () => window.removeEventListener("ft:delta:base-sync", h as EventListener);
  }, []);

  // ── Tick 250 ms : calcul de la position ──────────────────────────────────
  useEffect(() => {
    if (!active) return;

    const id = window.setInterval(() => {
      if (!autoScrollEnabledRef.current) return;
      if (standbyIndexRef.current !== null) return;  // figé en stand-by

      const gs   = gpsStateRef.current;
      // Garde-fou tunnel : bloquer le GPS tant que le dernier s_km est dans une zone tunnel
      const inTunnel = tunnelZoneAt(lastGpsSKmRef.current) != null;
      const mode: ReferenceMode =
        (gs === "GREEN" || gs === "ARRET") && !inTunnel ? "GPS" : "HORAIRE";

      // ─── Mode GPS ──────────────────────────────────────────────────────
      if (mode === "GPS") {
        const pk  = lastGpsPkRef.current;
        const skm = lastGpsSKmRef.current;
        if (pk == null) return;

        // Gel en tunnel (on garde la dernière dist connue)
        if (tunnelZoneAt(skm)) {
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

      const effectiveMin = base.firstHoraMin + (nowMinFloat() - base.realMinFloat);

      const horaPts = points
        .map(p => ({ key: parseMin(p.hora), dist: p.dist }))
        .filter((x): x is { key: number; dist: number } => x.key != null);
      horaPts.sort((a, b) => a.key - b.key);

      const r = interpDist(horaPts, effectiveMin);
      if (r != null) setDist(r);
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
