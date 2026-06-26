import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import tgv2n2Url from "../../assets/tgv2n2-profile.png";
import { getFtLignePair, getFtLigneImpair, getTrainOrigine, getTrainDestination } from "../../data/ligneFT.normalized.adapter";
import type { FTEntry } from "../../data/ligneFT";
import { useTrainDist } from "../../hooks/useTrainDist";
import type { TDPoint } from "../../hooks/useTrainDist";

// ============================================================================
// FT HORIZONTALE (#28) — graphique espace-vitesse + scroll automatique.
// Reproduit TOUS les mécanismes de FT.tsx (GPS, horaire, stand-by, ressort,
// tunnel, replay) adaptés à l'axe horizontal : scrollLeft = dist * pxPerKm.
// ============================================================================

const PX_PER_KM     = 60;
const V_MAX_AXIS    = 300;
const CHART_H       = 230;
const MARGIN        = { top: 16, right: 28, bottom: 88, left: 44 };
const PIN_X_FRACTION = 0.15;
const DOT_R         = 5;
const SCROLL_EASE   = 0.12;   // lissage rAF (même valeur que FT_SCROLL_EASE)
const RUBBER_BAND_MS = 5000;  // délai avant ressort (ms)

// ─── Helpers PK ──────────────────────────────────────────────────────────────

function entryPk(e: FTEntry): number | null {
  if (typeof e.pk_internal === "number" && Number.isFinite(e.pk_internal)) return e.pk_internal;
  const v = parseFloat(String(e.pk ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function displayPk(e: FTEntry): string {
  const net = ((e as any).network ?? "").trim();
  if (net === "RFN")  return String((e as any).pk_rfn  ?? e.pk ?? "");
  if (net === "LFP")  return String((e as any).pk_lfp  ?? e.pk ?? "");
  if (net === "ADIF") return String((e as any).pk_adif ?? e.pk ?? "");
  return String(e.pk ?? "");
}

function parseHora(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((s ?? "").trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function fmtMin(m: number): string {
  const t = ((m % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}
function normName(s: string): string {
  return s.toLowerCase().replace(/ /g, " ").replace(/[-–]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
}

// ─── Type interne ─────────────────────────────────────────────────────────────

type Pt = {
  dist: number;
  v: number | null;
  dep: string;
  pk: string;
  pkInternal: number | null;
  network: "ADIF" | "LFP" | "RFN" | null;
  csv: boolean;
  hora: string;
  arr: string | null;
  yellow: boolean;
  notes: string[];  // remarques rouges associées à ce point
};

// ─── Composant ────────────────────────────────────────────────────────────────

export default function FTHorizontal() {
  // ── Train + parcours ──────────────────────────────────────────────────────
  const [trainNumber, setTrainNumber] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: any) => {
      const raw = e?.detail?.trainNumber;
      const n = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (!isNaN(n)) setTrainNumber(n);
    };
    window.addEventListener("lim:train",        h as EventListener);
    window.addEventListener("lim:train-change", h as EventListener);
    return () => {
      window.removeEventListener("lim:train",        h as EventListener);
      window.removeEventListener("lim:train-change", h as EventListener);
    };
  }, []);

  // routeStart/routeEnd dérivés du normalisé (stable en replay/démo/normal)
  // lim:parsed n'est PAS utilisé : en replay, il rejoue l'origenDestino du PDF original
  // (potentiellement partiel), ce qui tronquerait la section française à tort.
  const routeStart = getTrainOrigine(trainNumber)  ?? "";
  const routeEnd   = getTrainDestination(trainNumber) ?? "";

  // ── Mode horizontal actif ─────────────────────────────────────────────────
  const [ftScrollMode, setFtScrollMode] = useState<"vertical" | "horizontal">(() => {
    try { return localStorage.getItem("lim:ft-scroll-mode") === "horizontal" ? "horizontal" : "vertical"; }
    catch { return "vertical"; }
  });
  useEffect(() => {
    const h = (e: Event) => {
      const m = (e as CustomEvent).detail?.mode;
      if (m === "vertical" || m === "horizontal") setFtScrollMode(m);
    };
    window.addEventListener("lim:ft-scroll-mode", h as EventListener);
    return () => window.removeEventListener("lim:ft-scroll-mode", h as EventListener);
  }, []);
  const active = ftScrollMode === "horizontal";

  // ── Points de la ligne (ordre de parcours) ────────────────────────────────
  const isOdd = trainNumber === null ? null : trainNumber % 2 !== 0;
  const points: Pt[] = useMemo(() => {
    if (isOdd === null) return [];
    const oriented: FTEntry[] = isOdd
      ? getFtLignePair(trainNumber!)
      : [...getFtLigneImpair(trainNumber!)].reverse();

    let first = 0, last = oriented.length - 1;
    if (routeStart && routeEnd) {
      const ns = normName(routeStart), ne = normName(routeEnd);
      const sc: number[] = [], ec: number[] = [];
      for (let i = 0; i < oriented.length; i++) {
        const e = oriented[i];
        if (e.isNoteOnly) continue;
        const d = (e.dependencia || "").trim(); if (!d) continue;
        const nd = normName(d);
        if (fuzzyMatch(nd, ns)) sc.push(i);
        if (fuzzyMatch(nd, ne)) ec.push(i);
      }
      if (sc.length && ec.length) {
        const s = Math.min(...sc), en = Math.max(...ec);
        first = Math.min(s, en); last = Math.max(s, en);
      }
    }
    const entries = oriented.slice(first, last + 1);

    // pk0 = PK du premier point valide (non-noteOnly avec PK connu)
    const firstValid = entries.find(e => !e.isNoteOnly && entryPk(e) != null);
    if (!firstValid) return [];
    const pk0 = entryPk(firstValid)!;

    // Compte les points valides pour la logique yellow (premier / dernier)
    const validCount = entries.filter(e => !e.isNoteOnly && entryPk(e) != null).length;

    // Parcours unique : collecte des remarques rouges des isNoteOnly en attente,
    // puis association au premier point valide suivant.
    let curV: number | null = null;
    let validIdx = 0;
    let pendingNotes: string[] = [];
    const out: Pt[] = [];

    for (const e of entries) {
      // Entrée non-valide (noteOnly ou sans PK) : on collecte ses notes et on passe
      if (e.isNoteOnly || entryPk(e) == null) {
        const rowNotes: string[] = [];
        if (e.note)                 rowNotes.push(e.note);
        if (Array.isArray(e.notes)) rowNotes.push(...e.notes);
        if (rowNotes.length > 0) {
          if (!isOdd && out.length > 0) {
            // nordSud renversé (trains pairs) : la note suit sa gare dans l'array → on l'attache
            // à la gare qui vient d'être ajoutée (out[last]), pas à la suivante.
            out[out.length - 1].notes.push(...rowNotes);
          } else {
            // sudNord direct (trains impairs) ou note avant la première gare : la note
            // précède sa gare dans l'array → on accumule pour la prochaine gare.
            pendingNotes.push(...rowNotes);
          }
        }
        continue;
      }

      const pk = entryPk(e)!;
      if (typeof e.vmax === "number" && Number.isFinite(e.vmax)) curV = e.vmax;
      const hora = (e.hora ?? "").trim();
      const comN = parseInt((e.com ?? "").toString(), 10);
      const hasCom = Number.isFinite(comN) && comN > 0;
      const depMin = parseHora(hora);
      const arr  = hasCom && depMin != null ? fmtMin(depMin - comN) : null;
      const tecn = (((e as any).tecn ?? (e as any).tecnico ?? "") as string).trim();
      const net  = ((e as any).network ?? null) as string | null;

      // Notes propres à cette entrée + notes isNoteOnly en attente
      const ownNotes: string[] = [];
      if (e.note)                 ownNotes.push(e.note);
      if (Array.isArray(e.notes)) ownNotes.push(...e.notes);

      out.push({
        dist:       Math.abs(pk - pk0),
        v:          curV,
        dep:        (e.dependencia ?? "").trim(),
        pk:         displayPk(e),
        pkInternal: entryPk(e),
        network:    net === "ADIF" || net === "LFP" || net === "RFN" ? net : null,
        csv:        !!(e as any).csv,
        hora,
        arr,
        yellow:     validIdx === 0 || validIdx === validCount - 1 || hasCom || tecn !== "",
        notes:      [...pendingNotes, ...ownNotes],
      });

      pendingNotes = [];
      validIdx++;
    }
    return out;
  }, [isOdd, trainNumber]);

  // ── Tableau TDPoint pour le hook ─────────────────────────────────────────
  const tdPoints = useMemo<TDPoint[]>(() => points.map(p => ({
    dist:      p.dist,
    pkInternal: p.pkInternal,
    network:   p.network,
    hora:      p.hora,
  })), [points]);

  // ── Moteur de position (hook partagé) ─────────────────────────────────────
  const trainDist = useTrainDist(tdPoints, active);

  // ── Mesure de la boîte ───────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ w: Math.max(0, window.innerWidth - r.left - 6), h: Math.max(0, window.innerHeight - r.top - 6) });
    };
    const remeasure = () => { requestAnimationFrame(() => { measure(); window.setTimeout(measure, 120); }); };
    remeasure();
    window.addEventListener("resize", measure);
    window.addEventListener("lim:ft-scroll-mode",        remeasure as EventListener);
    window.addEventListener("lim:infos-ltv-fold-change", remeasure as EventListener);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("lim:ft-scroll-mode",        remeasure as EventListener);
      window.removeEventListener("lim:infos-ltv-fold-change", remeasure as EventListener);
    };
  }, [trainNumber]);

  // ── Échelle px/km ─────────────────────────────────────────────────────────
  const [pxPerKm, setPxPerKm] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem("lim:fth-scale") ?? String(PX_PER_KM)); return Number.isFinite(v) && v > 0 ? v : PX_PER_KM; } catch { return PX_PER_KM; }
  });
  useEffect(() => {
    const h = (e: Event) => { const v = (e as CustomEvent).detail?.pxPerKm; if (typeof v === "number" && v > 0) setPxPerKm(v); };
    window.addEventListener("lim:fth-scale", h as EventListener);
    return () => window.removeEventListener("lim:fth-scale", h as EventListener);
  }, []);

  // ── Pli/dépli ────────────────────────────────────────────────────────────
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { const f = (e as CustomEvent).detail?.folded; if (typeof f === "boolean") setFolded(f); };
    window.addEventListener("lim:infos-ltv-fold-change", h as EventListener);
    return () => window.removeEventListener("lim:infos-ltv-fold-change", h as EventListener);
  }, []);

  // ── LTV (Limitations Temporaires de Vitesse) ─────────────────────────────
  const [ltvRows, setLtvRows] = useState<Array<{ kmIni?: string; kmFin?: string; speed?: string }>>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const rows = (e as CustomEvent).detail?.rows;
      setLtvRows(Array.isArray(rows) ? rows : []);
    };
    window.addEventListener("ltv:parsed", h as EventListener);
    return () => window.removeEventListener("ltv:parsed", h as EventListener);
  }, []);

  const ltvSegments = useMemo(() => {
    if (points.length === 0 || ltvRows.length === 0) return [] as Array<{ distStart: number; distEnd: number; speed: number; pkA: number; pkB: number }>;
    const pk0 = points[0].pkInternal;
    if (pk0 == null) return [] as Array<{ distStart: number; distEnd: number; speed: number; pkA: number; pkB: number }>;
    const raw: Array<{ distStart: number; distEnd: number; speed: number; pkA: number; pkB: number }> = [];
    for (const row of ltvRows) {
      const pkA = parseFloat(String(row.kmIni ?? "").replace(",", "."));
      const pkB = parseFloat(String(row.kmFin ?? "").replace(",", "."));
      const spd = parseFloat(String(row.speed ?? ""));
      if (!Number.isFinite(pkA) || !Number.isFinite(pkB) || !Number.isFinite(spd)) continue;
      const dA = Math.abs(pkA - pk0), dB = Math.abs(pkB - pk0);
      raw.push({ distStart: Math.min(dA, dB), distEnd: Math.max(dA, dB), speed: spd, pkA, pkB });
    }
    // Dédupliquer par plage : deux LTV identiques (voies différentes) → une seule entrée.
    // En cas de vitesses différentes sur la même plage, on retient la plus restrictive.
    const dedup = new Map<string, typeof raw[0]>();
    for (const seg of raw) {
      const key = `${seg.distStart.toFixed(3)}|${seg.distEnd.toFixed(3)}`;
      const ex = dedup.get(key);
      if (!ex || seg.speed < ex.speed) dedup.set(key, seg);
    }
    return [...dedup.values()];
  }, [ltvRows, points]);

  // ── Clignotement stand-by ────────────────────────────────────────────────
  const [blinkOn, setBlinkOn] = useState(false);
  useEffect(() => {
    if (trainDist.standbyPointIndex === null) { setBlinkOn(false); return; }
    const id = window.setInterval(() => setBlinkOn(b => !b), 500);
    return () => window.clearInterval(id);
  }, [trainDist.standbyPointIndex]);

  // ── Refs scroll auto ─────────────────────────────────────────────────────
  const scrollDivRef            = useRef<HTMLDivElement | null>(null);
  const targetScrollLeftRef     = useRef(0);
  const displayScrollLeftRef    = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const isManualScrollRef       = useRef(false);
  const manualScrollTimerRef    = useRef<number | null>(null);
  const autoScrollEnabledRef    = useRef(false);

  useEffect(() => { autoScrollEnabledRef.current = trainDist.autoScrollEnabled; }, [trainDist.autoScrollEnabled]);

  // Cible de scroll : dist → scrollLeft
  useEffect(() => {
    if (trainDist.dist == null) return;
    targetScrollLeftRef.current = trainDist.dist * pxPerKm;
  }, [trainDist.dist, pxPerKm]);

  // Téléportation immédiate si pxPerKm change (pas de lerp sur changement d'échelle)
  useEffect(() => {
    if (trainDist.dist == null) return;
    const newTarget = trainDist.dist * pxPerKm;
    targetScrollLeftRef.current  = newTarget;
    displayScrollLeftRef.current = newTarget;
    const div = scrollDivRef.current;
    if (div) { isProgrammaticScrollRef.current = true; div.scrollLeft = newTarget; }
  // intentionnellement : pxPerKm seulement (pas trainDist.dist)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerKm]);

  // ── Boucle rAF — scroll épinglé ──────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    let running = true;

    const loop = () => {
      if (!running) return;
      const div = scrollDivRef.current;
      if (div && autoScrollEnabledRef.current && !isManualScrollRef.current) {
        const target = targetScrollLeftRef.current;
        const cur    = displayScrollLeftRef.current;
        const diff   = target - cur;
        // Resync immédiat si saut énorme (changement de train, seek replay…)
        if (Math.abs(diff) > div.clientWidth * 1.5) {
          displayScrollLeftRef.current = target;
        } else {
          displayScrollLeftRef.current = cur + diff * SCROLL_EASE;
        }
        const newSL = Math.max(0, Math.round(displayScrollLeftRef.current));
        if (Math.abs(newSL - div.scrollLeft) > 0.5) {
          isProgrammaticScrollRef.current = true;
          div.scrollLeft = newSL;
        }
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, []); // une seule instance, pilotée par refs

  // ── Gestion scroll manuel (rubber band) ──────────────────────────────────
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!autoScrollEnabledRef.current) return;
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    // Scroll déclenché par l'utilisateur
    isManualScrollRef.current = true;
    if (manualScrollTimerRef.current != null) clearTimeout(manualScrollTimerRef.current);
    manualScrollTimerRef.current = window.setTimeout(() => {
      manualScrollTimerRef.current = null;
      if (trainDist.standbyPointIndex !== null) return; // stand-by : pas de ressort
      isManualScrollRef.current = false;
      // Resync displayScrollLeft pour reprendre le lerp depuis la position actuelle
      const div = scrollDivRef.current;
      if (div) displayScrollLeftRef.current = div.scrollLeft;
    }, RUBBER_BAND_MS);
  }, [trainDist.standbyPointIndex]);

  // ── Stand-by : clic sur un repère horaire ────────────────────────────────
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!trainDist.autoScrollEnabled) return;
    const div  = scrollDivRef.current;
    const root = rootRef.current;
    if (!div || !root) return;

    const rootRect = root.getBoundingClientRect();
    // coordonnée X dans le système de la FT (distance depuis l'origine)
    const distClicked = (e.clientX - rootRect.left - pinXPxRef.current + div.scrollLeft) / pxPerKm;

    // Filtre Y : seulement la zone track ±35px autour de baseY
    const clickY    = e.clientY - rootRect.top;
    const baseYpx   = MARGIN.top + chartHRef.current;
    if (Math.abs(clickY - baseYpx) > 35) return;

    // Repère horaire le plus proche dans un rayon ±25px
    const thresholdKm = 25 / pxPerKm;
    let nearestIdx: number | null = null;
    let nearestDelta = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (!points[i].hora) continue;
      const delta = Math.abs(points[i].dist - distClicked);
      if (delta < nearestDelta && delta <= thresholdKm) { nearestDelta = delta; nearestIdx = i; }
    }
    if (nearestIdx === null) return;

    // Toggle stand-by
    if (trainDist.standbyPointIndex === nearestIdx) {
      // Sortie : ft:auto-scroll-change notifie useTrainDist + FT.tsx + TitleBar
      window.dispatchEvent(new CustomEvent("ft:auto-scroll-change", {
        detail: { enabled: true, standby: false },
      }));
    } else {
      trainDist.setStandbyByIndex(nearestIdx); // entrée / changement de point
    }
  }, [trainDist, pxPerKm, points]);

  // Refs pour les valeurs calculées au render (accessibles dans les callbacks)
  const pinXPxRef = useRef(MARGIN.left);
  const chartHRef = useRef(CHART_H);

  // ── Early return si pas de données ───────────────────────────────────────
  if (points.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-sm opacity-60">
        Fiche train horizontale — en attente d'un train…
      </div>
    );
  }

  // ── Calculs de rendu ─────────────────────────────────────────────────────
  const maxDist = points[points.length - 1].dist;
  const chartH  = box ? Math.max(60, box.h - MARGIN.top - MARGIN.bottom) : CHART_H;
  const totalH  = MARGIN.top + chartH + MARGIN.bottom;

  const pinXPx      = box ? Math.max(MARGIN.left + 8, box.w * PIN_X_FRACTION) : MARGIN.left;
  const paddingStart = Math.max(0, pinXPx - MARGIN.left);
  // paddingEnd : espace supplémentaire à droite pour que la dernière gare puisse
  // atteindre la barre de position (scrollLeft = maxDist × pxPerKm doit être
  // inférieur ou égal au scrollLeft maximum du div, soit rightW - clientWidth).
  const paddingEnd  = box ? Math.max(0, box.w - pinXPx - MARGIN.right) : 0;
  const totalW      = MARGIN.left + paddingStart + maxDist * pxPerKm + paddingEnd + MARGIN.right;
  const x = (dist: number) => MARGIN.left + paddingStart + dist * pxPerKm;
  // Bord droit du contenu réel (track + grid s'arrêtent ici, pas dans le padding)
  const contentRight = x(maxDist) + MARGIN.right;
  const y = (v: number)    => MARGIN.top  + (1 - v / V_MAX_AXIS) * chartH;
  const baseY = MARGIN.top + chartH;

  // Mise à jour des refs de rendu (utilisées dans les callbacks)
  pinXPxRef.current = pinXPx;
  chartHRef.current = chartH;

  // Courbe Vmax en escalier, avec intégration des limites LTV.
  // Calcule aussi les polygones de fond LTV (suivent la courbe effective → nesting correct)
  // et les rappels de vitesse aux fins de LTV.
  let speedPath = "";
  const ltvStartLabels:   Array<{ xPx: number; yPx: number; speed: number }> = [];
  const ltvRestoreLabels: Array<{ xPx: number; yPx: number; speed: number; isLtv: boolean }> = [];
  const ltvFillPaths: string[] = [];
  {
    interface SpEvt { dist: number; isLtv: boolean; ltvId?: number; isEnd?: boolean; ftV?: number; ltvV?: number; }
    const evts: SpEvt[] = [];
    for (const p of points) {
      if (p.v != null) evts.push({ dist: p.dist, isLtv: false, ftV: p.v });
    }
    for (let li = 0; li < ltvSegments.length; li++) {
      const ltv = ltvSegments[li];
      evts.push({ dist: ltv.distStart, isLtv: true, ltvId: li, isEnd: false, ltvV: ltv.speed });
      evts.push({ dist: ltv.distEnd,   isLtv: true, ltvId: li, isEnd: true });
    }
    evts.sort((a, b) => a.dist - b.dist || (a.isLtv ? 1 : -1));
    let baseV: number | null = null;
    const activeLtv = new Map<number, number>();
    const effectV = () => {
      if (baseV == null) return null;
      let v = baseV;
      for (const s of activeLtv.values()) v = Math.min(v, s);
      return v;
    };
    let prevV: number | null = null;
    // État pour le polygone de fond
    let fillActive = false;
    let fillPath = "";
    let fillPrevV: number | null = null;
    for (const evt of evts) {
      const prevLtvSize = activeLtv.size;
      const effectVBefore = effectV();
      if (!evt.isLtv) {
        baseV = evt.ftV!;
      } else if (!evt.isEnd) {
        activeLtv.set(evt.ltvId!, evt.ltvV!);
      } else {
        activeLtv.delete(evt.ltvId!);
      }
      const newV = effectV();
      const px = x(evt.dist);
      const wasLtvActive = prevLtvSize > 0;
      const nowLtvActive = activeLtv.size > 0;
      // Étiquette de début : seulement si la vitesse effective change vraiment
      if (evt.isLtv && !evt.isEnd && newV != null && newV !== effectVBefore)
        ltvStartLabels.push({ xPx: px + 2, yPx: y(newV), speed: newV });
      // Étiquette de restauration : idem
      if (evt.isLtv && evt.isEnd && newV != null && newV !== effectVBefore)
        ltvRestoreLabels.push({ xPx: px + 2, yPx: y(newV), speed: newV, isLtv: nowLtvActive });
      // ── Courbe de vitesse ──
      if (newV !== prevV) {
        if (!speedPath) {
          if (newV != null) speedPath = `M ${px} ${y(newV)}`;
        } else {
          if (prevV != null) speedPath += ` L ${px} ${y(prevV)}`;
          if (newV != null)  speedPath += ` L ${px} ${y(newV)}`;
        }
        prevV = newV;
      }
      // ── Polygone de fond LTV ──
      // Le polygone suit la courbe effective : la zone imbriquée (ex. LTV 80 dans LTV 160)
      // remonte seulement jusqu'à y(80), pas jusqu'à y(160).
      if (!wasLtvActive && nowLtvActive && newV != null) {
        fillPath = `M ${px} ${baseY} L ${px} ${y(newV)}`;
        fillPrevV = newV;
        fillActive = true;
      } else if (wasLtvActive && !nowLtvActive) {
        if (fillActive) {
          if (fillPrevV != null) fillPath += ` L ${px} ${y(fillPrevV)}`;
          fillPath += ` L ${px} ${baseY} Z`;
          ltvFillPaths.push(fillPath);
          fillActive = false;
        }
      } else if (fillActive && newV != null && newV !== fillPrevV) {
        if (fillPrevV != null) fillPath += ` L ${px} ${y(fillPrevV)}`;
        fillPath += ` L ${px} ${y(newV)}`;
        fillPrevV = newV;
      }
    }
    if (speedPath && prevV != null) speedPath += ` L ${x(maxDist)} ${y(prevV)}`;
    if (fillActive && fillPrevV != null) {
      fillPath += ` L ${x(maxDist)} ${y(fillPrevV)} L ${x(maxDist)} ${baseY} Z`;
      ltvFillPaths.push(fillPath);
    }
  }

  // Ticks LTV précalculés pour deux passes de rendu :
  // 1re passe (dans la section LTV) : lignes seulement
  // 2e passe (après les gares)      : textes PK avec fond blanc, au-dessus de tout
  const _ltvSeen = new Set<string>();
  const ltvTicks = ltvSegments
    .flatMap((ltv, li) => [
      { xPx: x(ltv.distStart), pk: ltv.pkA, li },
      { xPx: x(ltv.distEnd),   pk: ltv.pkB, li },
    ])
    .sort((a, b) => a.xPx - b.xPx)
    .filter(tk => { const k = tk.pk.toFixed(1); if (_ltvSeen.has(k)) return false; _ltvSeen.add(k); return true; });

  // Étiquettes de vitesse
  const speedLabels: { x: number; y: number; v: number; csv: boolean }[] = [];
  let lastLabelV: number | null = null;
  let isFirstSpeedZone = true;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.v == null) continue;
    if (p.v !== lastLabelV) {
      let csv = false;
      if (!isFirstSpeedZone) {
        for (let j = i; j < points.length && points[j].v === p.v; j++) {
          if (points[j].csv) { csv = true; break; }
        }
      }
      speedLabels.push({ x: x(p.dist), y: y(p.v), v: p.v, csv });
      lastLabelV = p.v;
      isFirstSpeedZone = false;
    }
  }

  const vStep = folded ? 20 : 50;
  const ticks: number[] = [];
  for (let v = 0; v <= V_MAX_AXIS; v += vStep) ticks.push(v);

  const rightW = totalW - MARGIN.left;

  // Couleur de la barre de position
  const barStroke = trainDist.barColor === "green" ? "#22c55e" : "#ef4444";

  return (
    <div
      ref={rootRef}
      className="ft-h-wrap"
      style={{
        position: "relative",
        width:  box ? box.w : "100%",
        height: box ? box.h : "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      <style>{`
        .ft-h-wrap { background: transparent; }
        .ft-h-svg text { font-family: inherit; }
        .ft-h-grid { stroke: #00000022; stroke-width: 1; }
        .dark .ft-h-grid { stroke: #ffffff22; }
        .ft-h-axis-label { font-size: 10px; fill: #6b7280; }
        .ft-h-speed { fill: none; stroke: currentColor; stroke-width: 2; stroke-dasharray: 5 4; }
        .ft-h-vbox { fill: #e5e7eb; stroke: #00000033; stroke-width: 1; }
        .ft-h-vbox-csv { fill: #ffd9a3; stroke: #00000033; stroke-width: 1; }
        .ft-h-vlabel { font-size: 11px; font-weight: 700; fill: #111; text-anchor: middle; }
        .ft-h-track { stroke: currentColor; stroke-width: 2; }
        .ft-h-kmtick { stroke: #00000033; stroke-width: 1; }
        .dark .ft-h-kmtick { stroke: #ffffff33; }
        .ft-h-tick { stroke: currentColor; stroke-width: 1.5; }
        .ft-h-pk { font-size: 10px; fill: currentColor; text-anchor: middle; }
        .ft-h-name { font-size: 11px; font-weight: 700; fill: currentColor; text-anchor: middle; }
        .ft-hs-dot { stroke: #333; stroke-width: 1.5; }
        .dark .ft-hs-dot { stroke: #ddd; }
        .ft-hs-dep { font-size: 10px; font-weight: 700; fill: currentColor; text-anchor: middle; }
        .ft-hs-arr { font-size: 8px; font-style: italic; fill: currentColor; opacity: 0.65; text-anchor: middle; }
        .ft-hs-standby { fill: #ef4444 !important; }
        .ft-h-note { font-size: 9px; fill: #ef4444; text-anchor: middle; font-style: italic; }
        .ft-h-pk, .ft-h-name, .ft-hs-dep, .ft-hs-arr, .ft-h-note
          { paint-order: stroke fill; stroke: white; stroke-width: 3; stroke-linejoin: round; }
        .dark .ft-h-pk, .dark .ft-h-name, .dark .ft-hs-dep, .dark .ft-hs-arr, .dark .ft-h-note
          { stroke: #111827; }
        .ft-h-ltv-tick { stroke: #f97316; stroke-width: 1.5; }
        .ft-h-ltv-pk { font-size: 9px; fill: #f97316; text-anchor: middle; font-weight: 700; }
        .ft-h-ltv-vbox { fill: #fff7ed; stroke: #f97316; stroke-width: 1; }
        .ft-h-ltv-vlabel { font-size: 11px; font-weight: 700; fill: #ea580c; text-anchor: middle; }
      `}</style>

      {/* ── Axe vitesse fixe ─────────────────────────────────────────────── */}
      <svg width={MARGIN.left} height={totalH} style={{ flexShrink: 0 }}>
        {ticks.map(v => (
          <text key={v} className="ft-h-axis-label" x={MARGIN.left - 6} y={y(v) + 3} textAnchor="end">{v}</text>
        ))}
      </svg>

      {/* ── Graphique scrollable ─────────────────────────────────────────── */}
      <div
        ref={scrollDivRef}
        id="ft-h-chart-scroll"
        style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}
        onScroll={handleScroll}
        onClick={handleChartClick}
      >
        <svg
          className="ft-h-svg"
          width={rightW}
          height={totalH}
          viewBox={`${MARGIN.left} 0 ${rightW} ${totalH}`}
        >
          {/* Grille vitesse */}
          {ticks.map(v => (
            <line key={v} className="ft-h-grid" x1={MARGIN.left} y1={y(v)} x2={contentRight} y2={y(v)} />
          ))}

          {/* Fond LTV orange — polygone suivant la courbe effective (nesting correct) */}
          {ltvFillPaths.map((d, i) => (
            <path key={`ltv-fill-${i}`} d={d} fill="#f97316" fillOpacity={0.1} stroke="none" />
          ))}

          {/* Courbe Vmax */}
          <path className="ft-h-speed" d={speedPath} />

          {/* Étiquettes de vitesse */}
          {speedLabels.map((s, i) => {
            const txt = String(s.v);
            const w = txt.length * 8 + 10, h = 16;
            const bx = s.x + 2, by = s.y - h - 2;
            return (
              <g key={i}>
                <rect x={bx} y={by} width={w} height={h} rx={3} className={s.csv ? "ft-h-vbox-csv" : "ft-h-vbox"} />
                <text className="ft-h-vlabel" x={bx + w / 2} y={by + h - 4}>{txt}</text>
              </g>
            );
          })}

          {/* Ligne de voie */}
          <line className="ft-h-track" x1={MARGIN.left} y1={baseY} x2={contentRight} y2={baseY} />

          {/* Graduation kilométrique */}
          {Array.from({ length: Math.floor(maxDist) + 1 }).map((_, km) => (
            <line key={km} className="ft-h-kmtick" x1={x(km)} y1={baseY - 3} x2={x(km)} y2={baseY + 3} />
          ))}

          {/* Repères LTV — 1re passe : lignes uniquement (ticks + pointillés).
              Les textes PK sont rendus après les gares pour passer au-dessus de tout. */}
          {ltvTicks.map((tk, ti) => {
            const low        = ti % 2 === 1;
            const tickBottom = low ? baseY + 38 : baseY + 5;
            const yTop       = y(ltvSegments[tk.li].speed);
            return (
              <g key={`ltv-lines-${ti}`}>
                <line x1={tk.xPx} y1={yTop} x2={tk.xPx} y2={baseY - 8}
                      stroke="#f97316" strokeWidth="1.5" strokeDasharray="3 3" />
                <line className="ft-h-ltv-tick" x1={tk.xPx} y1={baseY - 8} x2={tk.xPx} y2={tickBottom} />
              </g>
            );
          })}
          {/* Étiquettes de vitesse LTV (début + restauration) */}
          {ltvStartLabels.map((lbl, i) => {
            const txt = String(lbl.speed);
            const lw = txt.length * 8 + 10, lh = 16;
            return (
              <g key={`ltv-sl-${i}`}>
                <rect x={lbl.xPx} y={lbl.yPx - lh - 2} width={lw} height={lh} rx={3} className="ft-h-ltv-vbox" />
                <text className="ft-h-ltv-vlabel" x={lbl.xPx + lw / 2} y={lbl.yPx - 6}>{txt}</text>
              </g>
            );
          })}
          {ltvRestoreLabels.map((lbl, i) => {
            const txt = String(lbl.speed);
            const lw = txt.length * 8 + 10, lh = 16;
            return (
              <g key={`ltv-rl-${i}`}>
                <rect x={lbl.xPx} y={lbl.yPx - lh - 2} width={lw} height={lh} rx={3} className={lbl.isLtv ? "ft-h-ltv-vbox" : "ft-h-vbox"} />
                <text x={lbl.xPx + lw / 2} y={lbl.yPx - 6} className={lbl.isLtv ? "ft-h-ltv-vlabel" : "ft-h-vlabel"}>{txt}</text>
              </g>
            );
          })}

          {/* Repères PK + gares + horaires */}
          {points.map((m, i) => {
            const low       = i % 2 === 1;
            const tickBottom = low ? baseY + 38 : baseY + 5;
            const yPk       = low ? baseY + 52  : baseY + 18;
            const yName     = low ? baseY + 68  : baseY + 34;
            const hasTimed  = !!m.hora;

            // Stand-by : clignotement en rouge
            const isStandby   = trainDist.standbyPointIndex === i;
            const showRed     = isStandby && blinkOn;
            const standbyFill = showRed ? "#ef4444" : undefined;

            // Remarques rouges : empilées au-dessus de l'heure (ou du tick si pas d'heure)
            // Y de base : -10 (hora) ou -5 (tick), puis +12 px par note en remontant
            const noteBaseY = hasTimed
              ? (m.arr ? baseY - 34 : baseY - 22)  // au-dessus de arr ou hora
              : baseY - 17;                          // au-dessus du tick seul

            return (
              <g key={i}>
                <line
                  className="ft-h-tick"
                  x1={x(m.dist)} y1={baseY - 5}
                  x2={x(m.dist)} y2={tickBottom}
                  style={isStandby ? { stroke: blinkOn ? "#ef4444" : "currentColor" } : undefined}
                />
                {hasTimed && (
                  <>
                    {m.arr && (
                      <text className="ft-hs-arr" x={x(m.dist)} y={baseY - 22}
                        style={{ fill: standbyFill }}>
                        {m.arr}
                      </text>
                    )}
                    <text
                      className="ft-hs-dep"
                      x={x(m.dist)} y={baseY - 10}
                      style={{ fill: standbyFill }}
                    >
                      {m.hora}
                    </text>
                    <circle
                      className="ft-hs-dot"
                      cx={x(m.dist)} cy={baseY} r={DOT_R}
                      fill={showRed ? "#ef4444" : m.yellow ? "#fde047" : "#ffffff"}
                    />
                  </>
                )}
                {/* Remarques rouges — empilées vers le haut */}
                {m.notes.map((note, ni) => (
                  <text
                    key={ni}
                    className="ft-h-note"
                    x={x(m.dist)}
                    y={noteBaseY - ni * 12}
                  >
                    {note}
                  </text>
                ))}
                <text className="ft-h-pk"   x={x(m.dist)} y={yPk}   style={{ fill: standbyFill }}>{m.pk}</text>
                <text className="ft-h-name" x={x(m.dist)} y={yName} style={{ fill: standbyFill }}>{m.dep}</text>
              </g>
            );
          })}

          {/* Repères LTV — 2e passe : textes PK avec fond blanc.
              Rendus en dernier pour passer au-dessus des ticks de gare. */}
          {ltvTicks.map((tk, ti) => {
            const low  = ti % 2 === 1;
            const yPk  = low ? baseY + 52 : baseY + 18;
            const pkStr = tk.pk.toFixed(3);
            const pkW   = pkStr.length * 5.5 + 4;
            return (
              <g key={`ltv-pk-${ti}`}>
                <rect x={tk.xPx - pkW / 2} y={yPk - 9} width={pkW} height={11} fill="white" />
                <text className="ft-h-ltv-pk" x={tk.xPx} y={yPk}>{pkStr}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Overlay position : barre + TGV (non scrollable) ─────────────── */}
      {box && (() => {
        const barTop = MARGIN.top;
        const barBot = MARGIN.top + chartH;
        const iconX  = MARGIN.left;
        const iconW  = Math.max(0, pinXPx - MARGIN.left - 10);
        const iconH  = 26;
        const iconY  = barBot - iconH + 4;
        return (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
            <svg width={box.w} height={box.h} style={{ display: "block" }}>
              {/* Barre verticale de position (verte = GPS, rouge = horaire/standby) */}
              <line
                x1={pinXPx} y1={barTop} x2={pinXPx} y2={barBot}
                stroke={barStroke} strokeWidth="2" opacity="0.9"
              />
              {/* Pictogramme TGV 2N2 */}
              <image
                href={tgv2n2Url}
                x={iconX} y={iconY}
                width={iconW} height={iconH}
                preserveAspectRatio="xMidYMid meet"
              />
            </svg>
          </div>
        );
      })()}
    </div>
  );
}
