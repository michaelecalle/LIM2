import React, { useEffect, useMemo, useRef, useState } from "react";
import { getFtLignePair, getFtLigneImpair, getTrainOrigine, getTrainDestination } from "../../data/ligneFT.normalized.adapter";
import type { FTEntry } from "../../data/ligneFT";

// ============================================================================
// BLOC HORAIRE (#28) — barre temporelle synchronisée avec FTHorizontal.
// Même échelle PK (pxPerKm), même MARGIN_LEFT/RIGHT, scroll verrouillé sur
// FTHorizontal via l'event lim:fth-hscroll. La scrollbar est masquée ici.
// ============================================================================

// Constantes alignées avec FTHorizontal (doivent rester cohérentes)
const MARGIN_LEFT  = 44;
const MARGIN_RIGHT = 28;
const H      = 70;
const LINE_Y = 42;
const DOT_R  = 5;
const PX_PER_KM_DEFAULT = 60;

// PK affiché selon le réseau : pk_rfn (RFN), pk_lfp (LFP), pk_adif (ADIF), sinon pk.
function displayPk(e: FTEntry): string {
  const net = ((e as any).network ?? "").trim();
  if (net === "RFN") return String((e as any).pk_rfn ?? e.pk ?? "");
  if (net === "LFP") return String((e as any).pk_lfp ?? e.pk ?? "");
  if (net === "ADIF") return String((e as any).pk_adif ?? e.pk ?? "");
  return String(e.pk ?? "");
}

// PK numérique interne (même logique qu'entryPk dans FTHorizontal)
function entryPkNum(e: FTEntry): number | null {
  if (typeof e.pk_internal === "number" && Number.isFinite(e.pk_internal)) return e.pk_internal;
  const v = parseFloat(String(e.pk ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/ /g, " ").replace(/[-–]/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
}
function parseHora(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((s ?? "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function fmtMin(m: number): string {
  const t = ((m % 1440) + 1440) % 1440;
  const hh = Math.floor(t / 60), mm = t % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

type Stop = { pk: string; dep: string; arr: string | null; yellow: boolean; dist: number };

export default function FTHorizontalSchedule() {
  const [trainNumber, setTrainNumber] = useState<number | null>(null);
  const routeStart = getTrainOrigine(trainNumber)     ?? "";
  const routeEnd   = getTrainDestination(trainNumber) ?? "";
  const [pxPerKm, setPxPerKm] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem("lim:fth-scale") ?? String(PX_PER_KM_DEFAULT)); return Number.isFinite(v) && v > 0 ? v : PX_PER_KM_DEFAULT; } catch { return PX_PER_KM_DEFAULT; }
  });

  useEffect(() => {
    const onTrain = (e: any) => {
      const raw = e?.detail?.trainNumber;
      const n = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (!isNaN(n)) setTrainNumber(n);
    };
    const onScale = (e: Event) => {
      const v = (e as CustomEvent).detail?.pxPerKm;
      if (typeof v === "number" && v > 0) setPxPerKm(v);
    };
    window.addEventListener("lim:train",        onTrain as EventListener);
    window.addEventListener("lim:train-change", onTrain as EventListener);
    window.addEventListener("lim:fth-scale",    onScale as EventListener);
    return () => {
      window.removeEventListener("lim:train",        onTrain as EventListener);
      window.removeEventListener("lim:train-change", onTrain as EventListener);
      window.removeEventListener("lim:fth-scale",    onScale as EventListener);
    };
  }, []);

  // ── Scroll sync avec FTHorizontal ──────────────────────────────────────────
  const scrollRef  = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);
  useEffect(() => {
    const onSync = (e: Event) => {
      const sl = (e as CustomEvent).detail?.scrollLeft;
      if (typeof sl !== "number" || !scrollRef.current) return;
      syncingRef.current = true;
      scrollRef.current.scrollLeft = sl;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    window.addEventListener("lim:fth-hscroll", onSync as EventListener);
    return () => window.removeEventListener("lim:fth-hscroll", onSync as EventListener);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return;
    window.dispatchEvent(new CustomEvent("lim:fth-hscroll", { detail: { scrollLeft: e.currentTarget.scrollLeft } }));
  };

  // ── Calcul des points horaires ─────────────────────────────────────────────
  const { stops, distEnd } = useMemo(() => {
    if (trainNumber === null) return { stops: [] as Stop[], distEnd: 0 };
    const isOdd = trainNumber % 2 !== 0;
    const oriented: FTEntry[] = isOdd ? getFtLignePair(trainNumber) : [...getFtLigneImpair(trainNumber)].reverse();

    // Troncature au parcours (identique à FTHorizontal / FT.tsx)
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
    const entries = oriented.slice(first, last + 1).filter((e) => !e.isNoteOnly);

    // pk0 calculé sur TOUS les points valides — même base que FTHorizontal
    const allValid = entries.filter(e => entryPkNum(e) != null);
    const pk0 = allValid.length > 0 ? entryPkNum(allValid[0])! : 0;
    // distEnd = distance du dernier point (pour que le SVG ait la même largeur que FTHorizontal)
    const distEnd = allValid.length > 0 ? Math.abs(entryPkNum(allValid[allValid.length - 1])! - pk0) : 0;

    // Seulement les points avec une heure (hora)
    const timed = entries.filter((e) => typeof e.hora === "string" && e.hora.trim() !== "");
    const out: Stop[] = timed.map((e, idx) => {
      const dep = (e.hora ?? "").trim();
      const comN = parseInt((e.com ?? "").toString(), 10);
      const hasCom = Number.isFinite(comN) && comN > 0;
      const depMin = parseHora(dep);
      const arr = hasCom && depMin != null ? fmtMin(depMin - comN) : null;
      const tecn = (((e as any).tecn ?? (e as any).tecnico ?? "") as string).trim();
      const yellow = idx === 0 || idx === timed.length - 1 || hasCom || tecn !== "";
      const pkVal = entryPkNum(e) ?? pk0;
      return { pk: displayPk(e), dep, arr, yellow, dist: Math.abs(pkVal - pk0) };
    });
    return { stops: out, distEnd };
  }, [trainNumber]);

  if (stops.length === 0) return null;

  const maxDist = Math.max(distEnd, stops[stops.length - 1].dist);
  const totalW  = MARGIN_LEFT + maxDist * pxPerKm + MARGIN_RIGHT;
  const rightW  = totalW - MARGIN_LEFT;
  const x = (dist: number) => MARGIN_LEFT + dist * pxPerKm;

  return (
    <div style={{ display: "flex", width: "100%", height: H, overflow: "hidden" }}>
      <style>{`
        .ft-hs-scroll::-webkit-scrollbar { display: none; }
        .ft-hs-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .ft-hs-line { stroke: currentColor; stroke-width: 2; opacity: 0.5; }
        .ft-hs-dot  { stroke: #333; stroke-width: 1.5; }
        .dark .ft-hs-dot { stroke: #ddd; }
        .ft-hs-arr  { font-size: 9px; font-style: italic; fill: currentColor; opacity: 0.6; text-anchor: middle; }
        .ft-hs-dep  { font-size: 11px; font-weight: 700; fill: currentColor; text-anchor: middle; }
        .ft-hs-pk   { font-size: 9px; fill: currentColor; opacity: 0.8; text-anchor: middle; }
      `}</style>

      {/* Spacer gauche — s'aligne avec le panneau axe vitesse de FTHorizontal */}
      <div style={{ flexShrink: 0, width: MARGIN_LEFT }} />

      {/* Barre horaire scrollable (scrollbar masquée, sync avec FTHorizontal) */}
      <div
        ref={scrollRef}
        className="ft-hs-scroll"
        onScroll={handleScroll}
        style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}
      >
        <svg width={rightW} height={H} viewBox={`${MARGIN_LEFT} 0 ${rightW} ${H}`}>
          <line className="ft-hs-line" x1={x(0)} y1={LINE_Y} x2={x(maxDist)} y2={LINE_Y} />
          {stops.map((s, i) => {
            const cx = x(s.dist);
            return (
              <g key={i}>
                {s.arr && <text className="ft-hs-arr" x={cx} y={14}>{s.arr}</text>}
                <text className="ft-hs-dep" x={cx} y={28}>{s.dep}</text>
                <circle className="ft-hs-dot" cx={cx} cy={LINE_Y} r={DOT_R} fill={s.yellow ? "#fde047" : "#ffffff"} />
                <text className="ft-hs-pk" x={cx} y={LINE_Y + 16}>{s.pk}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
