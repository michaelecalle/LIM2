// src/components/Replay/ReplayOverlay.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { unzipSync } from "fflate";

type Pos = { x: number; y: number };

const POS_KEY = "limgpt:replayOverlayPos";
const SPEED_STEPS = [1, 2, 4, 8, 16, 32, 64] as const;
const ZIP_FILENAME_REGEX = /^(\d+) du (\d{4}-\d{2}-\d{2}) - (\d{2})h(\d{2})\.zip$/i;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function readPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return { x: 12, y: 72 };
    const obj = JSON.parse(raw);
    const x = Number(obj?.x);
    const y = Number(obj?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 12, y: 72 };
    return { x, y };
  } catch {
    return { x: 12, y: 72 };
  }
}

function writePos(p: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {}
}

function fmtRelHMS(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const GH_TOKEN = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined;
const GH_OWNER = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? "michaelecalle";
const GH_REPO = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? "lim-logs";

type GhFile = { name: string; size: number; sha: string };

export default function ReplayOverlay() {
  /* ── Visibilité : ouverte via le bouton Replay dans les paramètres ── */
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const handler = () => setIsVisible(true);
    window.addEventListener("replay:show", handler);
    return () => window.removeEventListener("replay:show", handler);
  }, []);

  /* ── Position draggable ── */
  const [pos, setPos] = useState<Pos>(() => readPos());
  const posRef = useRef<Pos>(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  /* ── Tick (rafraîchissement 400 ms — toujours actif) ── */
  const [tick, setTick] = useState(0);
  /* ── Interpolation entre événements ── */
  const interpBaseRef = useRef<{ tMs: number; wallMs: number } | null>(null);
  const lastObservedTMsRef = useRef<number>(-1);
  const speedRef = useRef<number>(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      const api = (window as any).__limgptReplay;
      const s: string = api?.status?.() ?? "";
      if (s === "playing") {
        const cur = (() => { try { return api?.cursor?.() ?? null; } catch { return null; } })();
        if (cur != null && cur.tMs !== lastObservedTMsRef.current) {
          interpBaseRef.current = { tMs: cur.tMs, wallMs: Date.now() };
          lastObservedTMsRef.current = cur.tMs;
        }
      } else {
        interpBaseRef.current = null;
      }
      setTick((t) => t + 1);
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  /* ── playerApi ── */
  const playerApi = useMemo(() => {
    return (window as any).__limgptReplay as
      | {
          loadUrl?: (u: string) => Promise<void>;
          play?: () => void;
          pause?: () => void;
          stop?: () => void;
          seek?: (tMs: number) => void;
          speed?: (x: number) => void;
          status?: () => string;
          cursor?: () => { idx: number; tMs: number };
          durationMs?: () => number;
          startIso?: () => string | null;
          nowIso?: () => string | null;
          error?: () => unknown;
        }
      | undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* ── Drag ── */
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const startDrag = (clientX: number, clientY: number) => {
    draggingRef.current = true;
    const rect = overlayRef.current?.getBoundingClientRect();
    dragOffsetRef.current = {
      dx: rect ? clientX - rect.left : 0,
      dy: rect ? clientY - rect.top : 0,
    };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current) return;
    const { dx, dy } = dragOffsetRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = overlayRef.current?.offsetWidth ?? 480;
    const h = overlayRef.current?.offsetHeight ?? 140;
    const next = {
      x: clamp(clientX - dx, 0, Math.max(0, vw - w)),
      y: clamp(clientY - dy, 0, Math.max(0, vh - h)),
    };
    setPos(next);
    posRef.current = next;
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    activePointerIdRef.current = null;
    writePos(posRef.current);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    activePointerIdRef.current = e.pointerId;
    startDrag(e.clientX, e.clientY);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    e.preventDefault();
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    if (activePointerIdRef.current == null) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    moveDrag(e.clientX, e.clientY);
  };

  const onWindowPointerUp = (e: PointerEvent) => {
    if (activePointerIdRef.current == null) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
    endDrag();
  };

  /* ── Picker ── */
  /* ── Chargement ZIP ── */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [localOffsetMs, setLocalOffsetMs] = useState(0);

  /* ── Chargement depuis GitHub ── */
  const [ghOpen, setGhOpen] = useState(false);
  const [ghFiles, setGhFiles] = useState<GhFile[] | null>(null);
  const [ghListLoading, setGhListLoading] = useState(false);
  const [ghListError, setGhListError] = useState<string | null>(null);
  const [ghDeletePending, setGhDeletePending] = useState<GhFile | null>(null);
  const [ghDeleting, setGhDeleting] = useState(false);

  const fetchGhFiles = async () => {
    if (!GH_TOKEN) return;
    setGhListLoading(true);
    setGhListError(null);
    setGhFiles(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/`,
        { headers: { Authorization: `Bearer ${GH_TOKEN}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any[] = await res.json();
      const zips = data
        .filter((f) => f.type === "file" && f.name.toLowerCase().endsWith(".zip"))
        .sort((a, b) => b.name.localeCompare(a.name)); // plus récent en premier
      setGhFiles(zips.map((f) => ({ name: f.name, size: f.size, sha: f.sha })));
    } catch (err: any) {
      setGhListError(err?.message ?? "Erreur de chargement");
    } finally {
      setGhListLoading(false);
    }
  };

  const handleGhOpen = () => {
    setGhOpen(true);
    if (ghFiles === null && !ghListLoading) void fetchGhFiles();
  };

  const handleGhDelete = async (file: GhFile) => {
    if (!GH_TOKEN) return;
    setGhDeleting(true);
    setGhListError(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(file.name)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${GH_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `delete: ${file.name}`,
            sha: file.sha,
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGhFiles((prev) => prev ? prev.filter((f) => f.sha !== file.sha) : null);
      setGhDeletePending(null);
    } catch (err: any) {
      setGhListError(err?.message ?? "Erreur de suppression");
    } finally {
      setGhDeleting(false);
    }
  };

  const handleGhSelect = async (filename: string) => {
    if (!GH_TOKEN) return;
    setGhOpen(false);
    setLoadBusy(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(filename)}`,
        {
          headers: {
            Authorization: `Bearer ${GH_TOKEN}`,
            Accept: "application/vnd.github.raw",
          },
        }
      );
      if (!res.ok) throw new Error(`Téléchargement échoué : HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "application/zip" });
      await handleZipLoad(file);
    } catch (err: any) {
      setLoadError(err?.message ?? String(err));
      setLoadBusy(false);
    }
  };

  const handleZipLoad = async (file: File) => {
    setLoadBusy(true);
    setLoadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const entries = unzipSync(new Uint8Array(buffer));

      const logKey = Object.keys(entries).find((k) => k.toLowerCase().endsWith(".log"));
      const pdfKey = Object.keys(entries).find((k) => k.toLowerCase().endsWith(".pdf"));

      if (!logKey) throw new Error("Aucun fichier .log trouvé dans ce ZIP.");

      const logText = new TextDecoder().decode(entries[logKey]);
      const api = (window as any).__limgptReplay;
      if (!api?.loadText) throw new Error("Le player replay n'est pas encore initialisé.");
      await api.loadText(logText);
      // Le PDF vient du ZIP → on saute les événements import:pdf du log
      // pour éviter le deadlock sur les barriers lim:parsed / ft:conc:resolved
      api.skipImportPdf?.();

      // Calcul du décalage GMT → heure locale à partir du nom du ZIP
      // On compare les H:M bruts du filename (heure locale) avec les H:M UTC du startIso
      // pour éviter l'ambiguïté de new Date("…T07:06:00") qui serait interprété localement
      const zipMatch = file.name.match(ZIP_FILENAME_REGEX);
      if (zipMatch) {
        const [, , , hh, mm] = zipMatch;
        const gmtStartIso = api?.startIso?.() ?? null;
        if (gmtStartIso) {
          const gmtDate = new Date(gmtStartIso);
          if (Number.isFinite(gmtDate.getTime())) {
            const localHH = parseInt(hh, 10);
            const localMM = parseInt(mm, 10);
            const gmtHH = gmtDate.getUTCHours();
            const gmtMM = gmtDate.getUTCMinutes();
            let diffMs = ((localHH - gmtHH) * 60 + (localMM - gmtMM)) * 60_000;
            if (diffMs > 12 * 3_600_000) diffMs -= 24 * 3_600_000;
            if (diffMs < -12 * 3_600_000) diffMs += 24 * 3_600_000;
            setLocalOffsetMs(diffMs);
          }
        }
      }

      if (pdfKey) {
        // Barrière : attendre ft:conc:resolved avant de terminer le chargement,
        // pour garantir que la FT a ses lignes dans le DOM quand l'utilisateur appuie sur Play.
        const pdfReady = new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            window.removeEventListener("ft:conc:resolved", onReady);
            clearTimeout(timer);
            resolve();
          };
          const onReady = () => finish();
          const timer = window.setTimeout(finish, 15_000);
          window.addEventListener("ft:conc:resolved", onReady);
        });
        const pdfFile = new File([entries[pdfKey]], pdfKey, { type: "application/pdf" });
        window.dispatchEvent(new CustomEvent("lim:import-pdf", { detail: { file: pdfFile } }));
        await pdfReady;
      } else {
        const match = file.name.match(ZIP_FILENAME_REGEX);
        const trainNumber = match ? match[1] : "";
        window.dispatchEvent(new CustomEvent("replay:start-manual", { detail: { trainNumber } }));
      }

      window.dispatchEvent(new CustomEvent("lim:pdf-mode-change", { detail: { mode: "green", source: "replay" } }));
      setLoadedName(file.name);
      setTick((v) => v + 1);
    } catch (err: any) {
      setLoadError(err?.message ? String(err.message) : String(err));
    } finally {
      setLoadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ── Vitesse ── */
  const [speedIdx, setSpeedIdx] = useState(0);
  useEffect(() => { speedRef.current = SPEED_STEPS[speedIdx]; }, [speedIdx]);

  const handleSpeedCycle = () => {
    const next = (speedIdx + 1) % SPEED_STEPS.length;
    setSpeedIdx(next);
    playerApi?.speed?.(SPEED_STEPS[next]);
  };

  /* ── Scrubbing barre de progression ── */
  const [isScrubbing, setIsScrubbing] = useState(false);

  /* ── Données courantes ── */
  const dur = playerApi?.durationMs?.() ?? 0;
  const startIso = playerApi?.startIso?.() ?? null;
  const cursorData = (() => {
    try { return playerApi?.cursor?.() ?? null; } catch { return null; }
  })();
  const currentMs = cursorData?.tMs ?? 0;
  const status = playerApi?.status?.() ?? "";
  const isPlaying = status === "playing";
  const hasData = dur > 0;

  /* ── Temps affiché : interpolé entre les événements quand en lecture ── */
  const displayMs = (() => {
    if (isPlaying && interpBaseRef.current && dur > 0) {
      const elapsed = Date.now() - interpBaseRef.current.wallMs;
      const interp = interpBaseRef.current.tMs + elapsed * speedRef.current;
      return Math.min(Math.max(0, interp), dur);
    }
    return currentMs;
  })();

  if (!isVisible) return null;

  const fmtAbs = (ms: number): string => {
    if (!startIso) return fmtRelHMS(ms);
    const base = Date.parse(startIso);
    if (!Number.isFinite(base)) return fmtRelHMS(ms);
    return new Date(base + ms + localOffsetMs).toISOString().slice(11, 19);
  };

  const knobPct = hasData ? clamp((displayMs / dur) * 100, 0, 100) : 0;

  const handleProgressScrub = (clientX: number, el: HTMLElement) => {
    if (!hasData) return;
    const rect = el.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const tMs = Math.round((rect.width > 0 ? x / rect.width : 0) * dur);
    playerApi?.seek?.(tMs);
    setTick((v) => v + 1);
  };

  /* ── Tooltip de temps : évite le débordement gauche/droite ── */
  const tooltipTransform =
    knobPct < 12
      ? "translateX(0)"
      : knobPct > 88
        ? "translateX(-100%)"
        : "translateX(-50%)";

  /* ── Style bouton commun ── */
  const btnBase: React.CSSProperties = {
    fontWeight: 700,
    borderRadius: 10,
    border: "1.5px solid currentColor",
    background: "transparent",
    cursor: "pointer",
    lineHeight: 1,
    userSelect: "none",
  };

  /* ── Render ── */
  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        left: 12,
        top: pos.y,
        zIndex: 99999,
        width: "calc(100vw - 24px)",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          borderRadius: 14,
          border: "2px solid rgba(0,0,0,0.80)",
          background: "rgba(255,255,255,0.96)",
          boxShadow: "0 10px 26px rgba(0,0,0,0.30)",
          overflow: "hidden",
        }}
        className="dark:border-white/70 dark:bg-zinc-900/95"
      >
        {/* ─── Barre de titre (draggable) ─── */}
        <div
          onPointerDown={onPointerDown}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 12px",
            cursor: "grab",
            userSelect: "none",
            touchAction: "none",
            borderBottom: "1px solid rgba(0,0,0,0.12)",
          }}
          className="dark:border-white/15"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", opacity: 0.9 }}>
              REPLAY
            </span>
            {status !== "" && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: "1px solid currentColor",
                  opacity: 0.6,
                }}
              >
                {status}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              disabled={loadBusy}
              style={{ ...btnBase, fontSize: 11, padding: "4px 10px", opacity: loadBusy ? 0.5 : 1, cursor: loadBusy ? "not-allowed" : "pointer" }}
            >
              {loadBusy ? "⏳" : "📂 Local"}
            </button>

            {GH_TOKEN && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleGhOpen(); }}
                disabled={loadBusy}
                style={{ ...btnBase, fontSize: 11, padding: "4px 10px", opacity: loadBusy ? 0.5 : 1, cursor: loadBusy ? "not-allowed" : "pointer" }}
              >
                ☁️ En ligne
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const p = { x: 12, y: 72 };
                setPos(p);
                writePos(p);
              }}
              style={{ ...btnBase, fontSize: 11, padding: "4px 8px", opacity: 0.45 }}
              title="Réinitialiser la position de la fenêtre"
            >
              ⤢
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
              style={{ ...btnBase, fontSize: 13, padding: "4px 8px", opacity: 0.55 }}
              title="Fermer la barre replay"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ─── Contenu ─── */}
        <div style={{ padding: "14px 14px 12px" }}>

          {/* ── Panneau fichiers en ligne ── */}
          {ghOpen && GH_TOKEN && (
            <div
              style={{
                marginBottom: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                borderRadius: 10,
                overflow: "hidden",
              }}
              className="dark:border-white/20"
            >
              {/* En-tête panneau */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  background: "rgba(0,0,0,0.05)",
                  borderBottom: "1px solid rgba(0,0,0,0.10)",
                }}
                className="dark:bg-white/8 dark:border-white/15"
              >
                <span style={{ fontSize: 11, fontWeight: 700 }}>☁️ Fichiers en ligne</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => void fetchGhFiles()}
                    disabled={ghListLoading}
                    style={{ fontSize: 11, opacity: ghListLoading ? 0.4 : 0.7, background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}
                    title="Actualiser la liste"
                  >
                    🔄
                  </button>
                  <button
                    type="button"
                    onClick={() => setGhOpen(false)}
                    style={{ fontSize: 12, opacity: 0.55, background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}
                    title="Fermer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Corps */}
              <div style={{ padding: "6px 4px", maxHeight: 160, overflowY: "auto" }}>
                {ghListLoading && (
                  <div style={{ fontSize: 11, opacity: 0.6, padding: "4px 8px" }}>Chargement…</div>
                )}
                {ghListError && (
                  <div style={{ fontSize: 11, color: "#ef4444", padding: "4px 8px" }}>⚠ {ghListError}</div>
                )}
                {!ghListLoading && ghFiles?.length === 0 && (
                  <div style={{ fontSize: 11, opacity: 0.55, padding: "4px 8px", fontStyle: "italic" }}>
                    Aucun fichier disponible.
                  </div>
                )}
                {ghFiles?.map((f) => (
                  <div
                    key={f.name}
                    style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 6 }}
                    className={ghDeletePending?.sha === f.sha ? "bg-red-50 dark:bg-red-950/30" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => void handleGhSelect(f.name)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        padding: "5px 10px",
                        fontSize: 11,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        borderRadius: 6,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      📦 {f.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGhDeletePending(ghDeletePending?.sha === f.sha ? null : f)}
                      title="Supprimer ce fichier"
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 12,
                        color: "#ef4444",
                        opacity: 0.7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 4,
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}

                {/* Barre de confirmation de suppression */}
                {ghDeletePending && (
                  <div
                    style={{
                      margin: "6px 6px 2px",
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6, wordBreak: "break-all" }}>
                      Supprimer «&nbsp;{ghDeletePending.name}&nbsp;» ?
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        disabled={ghDeleting}
                        onClick={() => void handleGhDelete(ghDeletePending)}
                        style={{
                          padding: "3px 12px",
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 6,
                          border: "none",
                          background: "#ef4444",
                          color: "#fff",
                          cursor: ghDeleting ? "not-allowed" : "pointer",
                          opacity: ghDeleting ? 0.6 : 1,
                        }}
                      >
                        {ghDeleting ? "⏳" : "Supprimer"}
                      </button>
                      <button
                        type="button"
                        disabled={ghDeleting}
                        onClick={() => setGhDeletePending(null)}
                        style={{
                          padding: "3px 10px",
                          fontSize: 11,
                          borderRadius: 6,
                          border: "1px solid currentColor",
                          background: "transparent",
                          cursor: "pointer",
                          opacity: 0.7,
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {loadError && (
            <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8, fontWeight: 600 }}>
              ⚠ {loadError}
            </div>
          )}

          {!hasData ? (
            /* ── Aucun fichier chargé : message d'invite ── */
            <div style={{ fontSize: 12, opacity: 0.55, fontStyle: "italic" }}>
              {loadedName
                ? `Chargé : ${loadedName} — en attente de démarrage de l'app.`
                : "Aucun enregistrement chargé. Cliquez sur 📂 Charger."}
            </div>
          ) : (
            <>
              {/* ── Labels temps haut (début / fin) ── */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.65,
                  marginBottom: 8,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>{fmtAbs(0)}</span>
                <span>{fmtAbs(dur)}</span>
              </div>

              {/* ── Barre de progression ── */}
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.13)",
                    position: "relative",
                    cursor: "pointer",
                    userSelect: "none",
                    touchAction: "none",
                  }}
                  className="dark:bg-white/18"
                  onPointerDown={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.setPointerCapture(e.pointerId);
                    setIsScrubbing(true);
                    handleProgressScrub(e.clientX, el);
                  }}
                  onPointerMove={(e) => {
                    if (!isScrubbing) return;
                    const el = e.currentTarget as HTMLElement;
                    handleProgressScrub(e.clientX, el);
                  }}
                  onPointerUp={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    try { el.releasePointerCapture(e.pointerId); } catch {}
                    setIsScrubbing(false);
                  }}
                  onPointerCancel={() => setIsScrubbing(false)}
                >
                  {/* Portion lue */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${knobPct}%`,
                      borderRadius: 999,
                      background: "currentColor",
                      opacity: 0.55,
                      pointerEvents: "none",
                    }}
                  />

                  {/* Curseur (knob) */}
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${knobPct}%`,
                      transform: "translate(-50%, -50%)",
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: "currentColor",
                      boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
                      pointerEvents: "none",
                    }}
                    className="dark:shadow-[0_0_0_2px_rgba(0,0,0,0.8)]"
                  />
                </div>

                {/* Heure courante sous le curseur */}
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    left: `${knobPct}%`,
                    transform: tooltipTransform,
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    background: "rgba(0,0,0,0.70)",
                    color: "#ffffff",
                    padding: "2px 7px",
                    borderRadius: 7,
                    pointerEvents: "none",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtAbs(displayMs)}
                </div>
              </div>

              {/* Espace pour le tooltip */}
              <div style={{ height: 24 }} />

              {/* ── Contrôles ── */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

                {/* Stop */}
                <button
                  type="button"
                  onClick={() => {
                    playerApi?.stop?.();
                    setSpeedIdx(0);
                    playerApi?.speed?.(1);
                    setTick((v) => v + 1);
                  }}
                  style={{ ...btnBase, fontSize: 16, padding: "6px 10px" }}
                  title="Arrêt"
                >
                  ⏹
                </button>

                {/* Play / Pause */}
                <button
                  type="button"
                  onClick={() => {
                    if (isPlaying) {
                      playerApi?.pause?.();
                    } else {
                      window.dispatchEvent(new CustomEvent("lim:infos-ltv-fold-change", { detail: { folded: true } }));
                      playerApi?.play?.();
                    }
                    setTick((v) => v + 1);
                  }}
                  style={{ ...btnBase, fontSize: 13, padding: "6px 16px", minWidth: 90 }}
                  title={isPlaying ? "Pause" : "Lecture"}
                >
                  {isPlaying ? "⏸ Pause" : "▶ Lecture"}
                </button>

                {/* Vitesse */}
                <button
                  type="button"
                  onClick={handleSpeedCycle}
                  style={{
                    ...btnBase,
                    fontSize: 13,
                    padding: "6px 12px",
                    minWidth: 64,
                    opacity: SPEED_STEPS[speedIdx] === 1 ? 0.7 : 1,
                  }}
                  title={`Vitesse actuelle : ×${SPEED_STEPS[speedIdx]} — clic pour passer au palier suivant`}
                >
                  {SPEED_STEPS[speedIdx] === 1 ? "×1" : `⏩ ×${SPEED_STEPS[speedIdx]}`}
                </button>

              </div>
            </>
          )}
        </div>

        {/* ─── Input fichier caché ─── */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleZipLoad(f);
          }}
        />
      </div>
    </div>
  );
}
