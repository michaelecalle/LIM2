// src/App.tsx
// DEV ONLY — Sniffer des events écoutés via window.addEventListener
;(() => {
  const w = window as any;
  if (w.__limgptSnifferInstalled) return;
  w.__limgptSnifferInstalled = true;

  const original = window.addEventListener.bind(window);
  const seen = new Map<string, number>();

  window.addEventListener = ((type: any, listener: any, options?: any) => {
    const t = String(type);
    seen.set(t, (seen.get(t) ?? 0) + 1);

    // Expose dans window pour lecture facile
    w.__limgptListeners = Object.fromEntries(seen.entries());

    // Log console utile (filtre sur custom events)
    if (t.includes(":")) console.log("[listener]", t);

    return original(type, listener as any, options);
  }) as any;

  console.log("[limgpt] addEventListener sniffer installed");
})();

// DEV ONLY — Sniffer des events dispatchés
;(() => {
  const w = window as any;
  if (w.__limgptDispatchSnifferInstalled) return;
  w.__limgptDispatchSnifferInstalled = true;

  const original = window.dispatchEvent.bind(window);
  const seen = new Map<string, number>();

  window.dispatchEvent = ((evt: Event) => {
    const t = (evt as any)?.type ? String((evt as any).type) : "unknown";
    seen.set(t, (seen.get(t) ?? 0) + 1);
    w.__limgptDispatched = Object.fromEntries(seen.entries());

    if (t.includes(":")) console.log("[dispatch]", t, (evt as any).detail ?? "");
    return original(evt);
  }) as any;

  console.log("[limgpt] dispatchEvent sniffer installed");
})();


import "./lib/ltvParser"

import "./lib/redPdfParser"
import "./lib/limParser"
import "./lib/ftParser"
import React from "react"
import FTFrance from "./components/LIM/FTFrance"

import TitleBar from "./components/LIM/TitleBar"
import Infos from "./components/LIM/Infos"
import LTV from "./components/LIM/LTV"
import FT from "./components/LIM/FT"
import FTHorizontal from "./components/LIM/FTHorizontal"
import ReplayOverlay from "./components/Replay/ReplayOverlay"
import { APP_VERSION } from "./components/version"

/**
 * App.tsx — version propre de l'écran LIM.
 *
 * BUT :
 * - Afficher une seule FT (celle gérée par components/LIM/FT.tsx,
 *   celle avec les lignes intermédiaires, vitesses, fusion des lignes rouges).
 * - Réafficher LTV.
 * - SUPPRIMER l'ancien rendu FT de preview.
 * - Garder les 3 modes (bleu / vert / rouge).
 */

type NextStop = { name: string; pk: string; dep: string; arr: string | null; deltaMin: number } | null;

function addDeltaToHora(hora: string, deltaMin: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return hora;
  let total = Number(m[1]) * 60 + Number(m[2]) + deltaMin;
  total = ((total % 1440) + 1440) % 1440;
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

export default function App() {
  const [pdfMode, setPdfMode] = React.useState<"blue" | "green" | "red">("blue")
  const [foldInfosLtv, setFoldInfosLtv] = React.useState(false)
  const [nextStop, setNextStop] = React.useState<NextStop>(null)

  // #28 — mode de défilement de la fiche train : "vertical" (FT.tsx, défaut) ou
  // "horizontal" (FTHorizontal.tsx, expérimental). Basculé via Paramètres.
  const [ftScrollMode, setFtScrollMode] = React.useState<"vertical" | "horizontal">(() => {
    try { return localStorage.getItem("lim:ft-scroll-mode") === "horizontal" ? "horizontal" : "vertical" } catch { return "vertical" }
  })
  React.useEffect(() => {
    const h = (e: Event) => {
      const m = (e as CustomEvent).detail?.mode
      if (m === "vertical" || m === "horizontal") setFtScrollMode(m)
    }
    window.addEventListener("lim:ft-scroll-mode", h as EventListener)
    return () => window.removeEventListener("lim:ft-scroll-mode", h as EventListener)
  }, [])

  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return false

    const storedTheme = window.localStorage.getItem("theme")
    if (storedTheme === "dark") return true
    if (storedTheme === "light") return false

    const html = document.documentElement
    return (
      html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark"
    )
  })

  // ✅ Toast "mise à jour" (déclenché si APP_VERSION change)
  const [updateToastOpen, setUpdateToastOpen] = React.useState(false)
  const [updatePrevVersion, setUpdatePrevVersion] = React.useState<string | null>(
    null
  )

  React.useEffect(() => {
    try {
      const KEY = "lim:lastVersionSeen"
      const last = localStorage.getItem(KEY)

      if (last && last !== APP_VERSION) {
        setUpdatePrevVersion(last)
        setUpdateToastOpen(true)
        window.setTimeout(() => setUpdateToastOpen(false), 8000)
      }

      localStorage.setItem(KEY, APP_VERSION)
    } catch {
      // non bloquant
    }
  }, [])

  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null)
  const [rawPdfFile, setRawPdfFile] = React.useState<File | null>(null)
  const [pdfPageImages, setPdfPageImages] = React.useState<string[]>([])

  // ============================================================
  // FT VIEW MODE + OVERLAY FT FRANCE (opaque)
  // ============================================================
  type FtViewMode = "AUTO" | "ES" | "FR"
  const [ftViewMode, setFtViewMode] = React.useState<FtViewMode>("ES")
  const [trainNumber, setTrainNumber] = React.useState<number | null>(null)
  const lastTrainNumberRef = React.useRef<number | null>(null)

  // ============================================================
  // Heures Figueres (publiées par la FT Espagne via event)
  // ============================================================
  const [figueresDepartureHhmm, setFigueresDepartureHhmm] = React.useState<
    string | null
  >(null)
  const [figueresArrivalHhmm, setFigueresArrivalHhmm] = React.useState<
    string | null
  >(null)
  // ============================================================
  // FT France : état de référence + état GPS (reçus via events)
  // ============================================================
  type ReferenceMode = "HORAIRE" | "GPS"
  type GpsStateUi = "RED" | "ORANGE" | "GREEN"

  const [ftReferenceMode, setFtReferenceMode] =
    React.useState<ReferenceMode>("HORAIRE")
  const [gpsStateUi, setGpsStateUi] = React.useState<GpsStateUi>("RED")
  const [gpsPkForUi, setGpsPkForUi] = React.useState<number | null>(null)

  React.useEffect(() => {
    const onRef = (e: Event) => {
      const ce = e as CustomEvent
      const mode = (ce as any)?.detail?.mode
      if (mode === "HORAIRE" || mode === "GPS") setFtReferenceMode(mode)
    }

    const onGpsState = (e: Event) => {
      const ce = e as CustomEvent<any>
      const s = ce?.detail?.state as GpsStateUi | undefined
      const pk = ce?.detail?.pk

      if (s === "RED" || s === "ORANGE" || s === "GREEN") {
        setGpsStateUi(s)
        setGpsPkForUi(typeof pk === "number" && Number.isFinite(pk) ? pk : null)
      }
    }

    window.addEventListener("lim:reference-mode", onRef as EventListener)
    window.addEventListener("lim:gps-state", onGpsState as EventListener)

    return () => {
      window.removeEventListener("lim:reference-mode", onRef as EventListener)
      window.removeEventListener("lim:gps-state", onGpsState as EventListener)
    }
  }, [])

  React.useEffect(() => {
    const onFigueres = (e: Event) => {
      const ce = e as CustomEvent
      const depRaw = ce?.detail?.departureHhmm
      const arrRaw = ce?.detail?.arrivalHhmm

      const dep =
        typeof depRaw === "string" && depRaw.trim() ? depRaw.trim() : null
      const arr =
        typeof arrRaw === "string" && arrRaw.trim() ? arrRaw.trim() : null

      setFigueresDepartureHhmm(dep)
      setFigueresArrivalHhmm(arr)
    }

    window.addEventListener("ft:figueres-hhmm", onFigueres as EventListener)
    return () =>
      window.removeEventListener(
        "ft:figueres-hhmm",
        onFigueres as EventListener
      )
  }, [])

  // Critère "FT France disponible" (déjà en place : whitelist par n° de train)
  const FT_FR_WHITELIST = React.useMemo(
    () => new Set<number>([9712, 9714, 9707, 9709, 9705, 9710]),
    []
  )

  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce?.detail?.mode
      if (mode === "AUTO" || mode === "ES" || mode === "FR") setFtViewMode(mode)
    }
    window.addEventListener("ft:view-mode-change", handler as EventListener)
    return () =>
      window.removeEventListener(
        "ft:view-mode-change",
        handler as EventListener
      )
  }, [])

  React.useEffect(() => {
    const readTrain = (e: Event) => {
      const ce = e as CustomEvent

      const raw =
        ce?.detail?.trainNumber ??
        ce?.detail?.train ??
        ce?.detail?.tren ??
        ce?.detail?.trenPadded

      const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)

      console.log("[TRAIN_EVT]", (e as any)?.type, { raw, n })

      if (Number.isNaN(n)) return

      // ✅ Dédupe : si on reçoit 10 fois le même train, on n'applique qu'une fois
      if (lastTrainNumberRef.current === n) return
      lastTrainNumberRef.current = n

      setTrainNumber(n)
    }

    window.addEventListener("lim:train", readTrain as EventListener)
    window.addEventListener("lim:train-change", readTrain as EventListener)
    return () => {
      window.removeEventListener("lim:train", readTrain as EventListener)
      window.removeEventListener("lim:train-change", readTrain as EventListener)
    }
  }, [])

  const showFtFranceOverlay =
    ftViewMode === "FR" &&
    trainNumber !== null &&
    FT_FR_WHITELIST.has(trainNumber)

  // ============================================================
  // Mesure zone LTV/FT pour overlay "fixed" (iPad PWA safe)
  // ============================================================
  const ftAreaRef = React.useRef<HTMLDivElement | null>(null)
  const [ftAreaRect, setFtAreaRect] = React.useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  React.useLayoutEffect(() => {
    if (!showFtFranceOverlay) return

    const measure = () => {
      const el = ftAreaRef.current
      if (!el) return

      const r = el.getBoundingClientRect()

      // DIAG : on trace la source de vérité de la taille/position
      console.log("[FTFR][measure]", {
        pdfMode,
        foldInfosLtv,
        showFtFranceOverlay,
        ftArea: {
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      })

      setFtAreaRect({ top: r.top, left: r.left, width: r.width })
    }


    // ✅ mesure immédiate
    measure()

    // ✅ double RAF : sécurise les changements de layout (pliage/dépliage, fonts, etc.)
    const raf1 = window.requestAnimationFrame(() => {
      measure()
      window.requestAnimationFrame(measure)
    })

    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)

    const vv = window.visualViewport
    vv?.addEventListener("resize", measure)
    vv?.addEventListener("scroll", measure)

    return () => {
      window.cancelAnimationFrame(raf1)
      window.removeEventListener("resize", measure)
      window.removeEventListener("orientationchange", measure)
      vv?.removeEventListener("resize", measure)
      vv?.removeEventListener("scroll", measure)
    }
    // ✅ IMPORTANT : re-mesure quand on plie/déplie et quand on revient en vert
  }, [showFtFranceOverlay, foldInfosLtv, pdfMode])

  // ✅ Sécurité (ceinture & bretelles) :
  // si train non éligible FT France => forcer ADIF (ES), même si un event UI tente FR/AUTO
  React.useEffect(() => {
    if (trainNumber === null) return

    const isEligible = FT_FR_WHITELIST.has(trainNumber)

    if (!isEligible && ftViewMode !== "ES") {
      setFtViewMode("ES")
      console.log("[App] FT view forced to ES (train not eligible)", {
        trainNumber,
        previous: ftViewMode,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainNumber])

  // ============================================================
  // REPLAY BOOTSTRAP (sans UI) — expose un player dans la console
  // ============================================================
  React.useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const mod = await import("./lib/replay/replayPlayer")
        const ReplayPlayer = mod.ReplayPlayer

        const player = new ReplayPlayer({
          logger: (msg: string, data?: any) => console.log(msg, data ?? ""),
          forceSimulation: true,
        })

        // Exposition console (dev)
        ;(window as any).__limgptReplay = {
          player,

          // helpers pratiques
          loadUrl: async (url: string) => {
            await player.loadFromUrl(url)
            console.log("[replay] loaded", {
              status: player.getStatus(),
              durationMs: player.getDurationMs(),
              cursor: player.getCursor(),
            })
          },

          loadText: async (text: string) => {
            await player.loadFromText(text)
            console.log("[replay] loaded from text", {
              status: player.getStatus(),
              durationMs: player.getDurationMs(),
            })
          },

          skipImportPdf: () => player.setSkipImportPdfEvents(true),

          play: () => player.play(),
          pause: () => player.pause(),
          stop: () => player.stop(),
          seek: (tMs: number) => player.seek(tMs),

          setInteractive: (on: boolean) => player.setInteractive(on),
          setInteractivePrompt: (fn: (desc: string) => Promise<boolean>) => player.setInteractivePrompt(fn),

          status: () => player.getStatus(),
          cursor: () => player.getCursor(),
          durationMs: () => player.getDurationMs(),
          startIso: () => player.getStartIso?.() ?? null,
          nowIso: () => player.getNowIso?.() ?? null,

          error: () => player.getError?.() ?? null,
        }

        if (!cancelled) {
          console.log("[replay] bootstrap OK → window.__limgptReplay")
        }
      } catch (err) {
        console.warn("[replay] bootstrap failed", err)
      }
    })()

    return () => {
      cancelled = true
      // on ne stoppe pas forcément le player ici ; dev-only
    }
  }, [])

  // réception du PDF
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const file = ce.detail?.file as File | undefined
      if (file) {
        setRawPdfFile(file)
        console.log("[App] PDF brut reçu =", file)
        console.log("[APP_IMPORT_STATE]", {
          ftViewMode,
          trainNumber,
          showFtFranceOverlay,
        })

        // ✅ À chaque import PDF, on repart par défaut sur la FT Espagne (ADIF)
        setFtViewMode("ES")

        // URL pour l'iframe (mode rouge sans images)
        const url = URL.createObjectURL(file)
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return url
        })

        // on réémet le même fichier pour le parser rouge (images)
        window.dispatchEvent(
          new CustomEvent("lim:pdf-raw", {
            detail: { file },
          })
        )

        // on réémet aussi pour le parser FT (sinon le tableau ne se remplit pas)
        window.dispatchEvent(
          new CustomEvent("ft:import-pdf", {
            detail: { file },
          })
        )
      }
    }
    window.addEventListener("lim:import-pdf", handler as EventListener)
    return () => {
      window.removeEventListener("lim:import-pdf", handler as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fallback pdfUrl pour le mode secours quand seul lim:pdf-raw est dispatché (mode 2026)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent).detail?.file as File | undefined
      if (file) {
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return URL.createObjectURL(file)
        })
      }
    }
    window.addEventListener("lim:pdf-raw", handler as EventListener)
    return () => window.removeEventListener("lim:pdf-raw", handler as EventListener)
  }, [])

  // changement de mode (blue/green/red)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce.detail?.mode as "blue" | "green" | "red" | undefined
      if (mode) {
        console.log("[App] mode reçu =", mode)
        setPdfMode(mode)
      }
    }
    window.addEventListener("lim:pdf-mode-change", handler as EventListener)
    return () => {
      window.removeEventListener("lim:pdf-mode-change", handler as EventListener)
    }
  }, [])

  // images de pages (parser rouge)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const images = ce.detail?.images as string[] | undefined
      if (Array.isArray(images)) {
        console.log("[App] images de pages reçues =", images)
        setPdfPageImages(images)
      }
    }
    window.addEventListener("lim:pdf-page-images", handler as EventListener)
    return () => {
      window.removeEventListener("lim:pdf-page-images", handler as EventListener)
    }
  }, [])

  // thème
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const dark = !!ce.detail?.dark
      setIsDark(dark)
    }
    window.addEventListener("lim:theme-change", handler as EventListener)
    return () => {
      window.removeEventListener("lim:theme-change", handler as EventListener)
    }
  }, [])

  // pliage INFOS/LTV (événement envoyé par TitleBar)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const folded = !!ce.detail?.folded
      setFoldInfosLtv(folded)
    }
    window.addEventListener(
      "lim:infos-ltv-fold-change",
      handler as EventListener
    )
    return () => {
      window.removeEventListener(
        "lim:infos-ltv-fold-change",
        handler as EventListener
      )
    }
  }, [])

  // Prochaine arrêt : données temps réel envoyées par FT.tsx
  React.useEffect(() => {
    const h = (e: Event) => setNextStop((e as CustomEvent<NextStop>).detail ?? null)
    window.addEventListener("lim:next-stop", h as EventListener)
    return () => window.removeEventListener("lim:next-stop", h as EventListener)
  }, [])

  return (
    <main className="p-2 sm:p-4 min-h-[100dvh] flex flex-col">
      {/* conteneur principal */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Bandeau titre */}
        <TitleBar />
        <ReplayOverlay />

        {/* ✅ Toast mise à jour */}
        {updateToastOpen && (
          <div className="fixed top-3 right-3 z-[99999]">
            <div className={`rounded-xl shadow-lg border px-4 py-3 text-sm${isDark ? ' dark bg-zinc-900 border-zinc-700 text-zinc-100' : ' bg-white border-zinc-200 text-zinc-900'}`}>
              <div className="font-semibold">✅ LIM a été mise à jour</div>
              <div className="mt-1 text-xs opacity-70">
                {updatePrevVersion ? (
                  <>
                    {updatePrevVersion} → {APP_VERSION}
                  </>
                ) : (
                  APP_VERSION
                )}
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setUpdateToastOpen(false)
                    window.dispatchEvent(new CustomEvent("lim:about-open"))
                  }}
                  className="text-xs font-semibold underline opacity-80 hover:opacity-100"
                >
                  Voir le changelog
                </button>

                <button
                  type="button"
                  onClick={() => setUpdateToastOpen(false)}
                  className="text-xs font-semibold px-2 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/70"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODE BLEU : rendu dédié */}
        {pdfMode === "blue" && (
          <div className="mt-3 flex-1 min-h-0">
            <div
              className="h-full flex flex-col items-center justify-center rounded-2xl select-none"
              style={{
                backgroundColor: isDark ? "#09090b" : "#f4f4f5",
                color: isDark ? "#f4f4f5" : "#18181b",
                border: isDark ? "1px solid #27272a" : "1px solid #e4e4e7",
              }}
            >
              <div
                className="text-[300px] leading-none font-semibold tracking-tight"
                style={{
                  color: isDark ? "rgba(244,244,245,0.10)" : "rgba(24,24,27,0.08)",
                }}
              >
                LIM
              </div>

              <div
                className="mt-4 max-w-5xl px-10 text-center text-[28px] leading-tight font-medium italic"
                style={{
                  color: isDark ? "#f4f4f5" : "#18181b",
                }}
              >
                Cette application constitue un outil d’assistance et de confort de
                consultation.
                <br />
                Elle ne remplace pas les documents, procédures, règles métier ou
                références réglementaires applicables,
                <br />
                qui restent les seules références de base pour l’exploitation.
              </div>

              <div
                className="mt-8 text-center text-[26px] leading-tight font-semibold italic"
                style={{
                  color: isDark ? "#fca5a5" : "#b91c1c",
                }}
              >
                Pour un meilleur confort d’utilisation, passez en mode guidé
              </div>

              <button
                type="button"
                className="mt-3 text-center text-[16px] leading-tight italic underline underline-offset-4 transition-opacity hover:opacity-100 opacity-70"
                style={{
                  color: isDark ? "#d4d4d8" : "#52525b",
                }}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("lim:manual-open-page", {
                      detail: {
                        page: 5,
                        tocId: "prerequis-ipad",
                        source: "startup-screen",
                      },
                    })
                  )
                }}
              >
                Procédure conseillée avant la première utilisation
              </button>

              <div
                className="mt-10 text-7xl italic tracking-wide"
                style={{
                  color: isDark ? "rgba(244,244,245,0.14)" : "rgba(24,24,27,0.10)",
                }}
              >
                Version {APP_VERSION}
              </div>
            </div>
          </div>
        )}

        {/* MODE ROUGE : rendu dédié */}
        {pdfMode === "red" && (
          <div className="mt-3 flex-1 min-h-0">
            <div
              className={
                isDark
                  ? "h-full rounded-2xl bg-black/80 overflow-auto"
                  : "h-full rounded-2xl bg-zinc-100 overflow-auto"
              }
            >
              {pdfPageImages.length > 0 ? (
                <div className="flex flex-col gap-4 p-4">
                  {pdfPageImages.map((src, idx) => (
                    <img
                      key={idx}
                      src={src}
                      alt={`Page PDF ${idx + 1}`}
                      className="w-full h-auto rounded-lg shadow"
                      style={
                        isDark
                          ? {
                              filter: "invert(1) hue-rotate(180deg)",
                              backgroundColor: "black",
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  className="w-full h-full rounded-2xl"
                  title="PDF importé"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                  Aucun PDF chargé. Importez un PDF puis passez en mode secours.
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODE VERT : on le REND TOUJOURS mais on le CACHE si pas vert */}
        <div
          className={
            pdfMode === "green"
              ? "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col"
              : "mt-3 mx-auto max-w-7xl flex-1 min-h-0 flex flex-col hidden"
          }
        >
          {/* Bloc infos : toujours gardé quel que soit le mode de pliage */}
          <div className="mt-0">
            <Infos />
          </div>

          {/* Zone LTV + FT (TOUJOURS rendue) */}
          <div
            ref={ftAreaRef}
            className={
              (foldInfosLtv ? "mt-0 " : "mt-3 ") +
              "flex-1 min-h-0 relative flex flex-col"
            }
          >
{/* Bloc LTV (TOUJOURS rendu — masqué visuellement si plié) */}
<div
  className={
    foldInfosLtv
      ? "block h-0 overflow-hidden pointer-events-none"
      : "block"
  }
>
  <LTV />
</div>

            {/* Bloc "prochaine arrêt" — affiché en mode plié (vertical ou horizontal), à la place du LTV */}
            {foldInfosLtv && (
              <div className={
                "mt-1 min-w-0 h-[70px] flex flex-col items-center justify-center gap-0.5 select-none px-4 rounded-xl border " +
                (isDark
                  ? "bg-zinc-800/60 border-zinc-700/50 text-zinc-100"
                  : "bg-zinc-50 border-zinc-200 text-zinc-900")
              }>
                {nextStop ? (
                  <>
                    <div className={"text-[10px] font-semibold uppercase tracking-widest " + (isDark ? "text-zinc-400" : "text-zinc-400")}>
                      Prochain arrêt
                    </div>
                    <div className="text-[15px] font-bold text-center leading-snug">
                      <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                        {nextStop.name}
                      </span>
                      {nextStop.pk && (
                        <span className={"ml-1.5 text-[12px] font-normal opacity-60"}>
                          {nextStop.pk}
                        </span>
                      )}
                    </div>
                    <div className={"text-[12px] font-medium text-center leading-none tabular-nums " + (isDark ? "text-zinc-300" : "text-zinc-600")}>
                      {nextStop.arr && (
                        <>
                          Arr.&nbsp;<strong>{nextStop.arr}</strong>
                          {nextStop.deltaMin !== 0 && (
                            <span className={isDark ? " text-orange-400" : " text-orange-500"}>
                              &nbsp;(est.&nbsp;{addDeltaToHora(nextStop.arr, nextStop.deltaMin)})
                            </span>
                          )}
                          {nextStop.dep && <span className="mx-2 opacity-40">·</span>}
                        </>
                      )}
                      {nextStop.dep && <>Dép.&nbsp;<strong>{nextStop.dep}</strong></>}
                    </div>
                  </>
                ) : (
                  <div className={"text-[12px] opacity-30 " + (isDark ? "text-zinc-300" : "text-zinc-600")}>
                    —
                  </div>
                )}

              </div>
            )}

            {/* Bloc FT (toujours visible) */}
            <div
              className={
                (foldInfosLtv
                  ? "mt-0 flex-1 min-h-0"
                  : "mt-3 flex-1 min-h-0") + " min-w-0"
              }
            >
              {/* #28 : on garde les DEUX montés et on bascule par display →
                  aucune perte d'état (train, GPS, scroll) au changement de mode. */}
              <div className="h-full" style={{ display: ftScrollMode === "horizontal" ? "none" : "block" }}>
                <FT />
              </div>
              <div className="h-full min-w-0" style={{ position: "relative", display: ftScrollMode === "horizontal" ? "block" : "none" }}>
                <FTHorizontal />
              </div>
            </div>

            {/* Overlay FT France (opaque) — fixé au viewport, top aligné sur la zone LTV/FT */}
            {showFtFranceOverlay && ftAreaRect && (
              <div
                className={
                  // ✅ IMPORTANT : flex + min-h-0 pour que FTFrance puisse prendre toute la hauteur
                  "z-50 rounded-2xl border shadow-lg pointer-events-auto overflow-hidden flex flex-col " +
                  (isDark
                    ? "bg-zinc-950 border-zinc-800"
                    : "bg-white border-zinc-200")
                }
                style={{
                  position: "fixed",
                  top: ftAreaRect.top,
                  left: ftAreaRect.left,
                  width: ftAreaRect.width,
                  bottom: 0,
                }}
              >
                <div
                  className={
                    // ✅ IMPORTANT : flex-1 + min-h-0 => hauteur dispo réelle
                    "h-full w-full p-3 flex flex-col min-h-0 " +
                    (isDark ? "bg-zinc-950" : "bg-white")
                  }
                >
                  <div className="flex-1 min-h-0">
                    <FTFrance
                      trainNumber={trainNumber}
                      figueresDepartureHhmm={figueresDepartureHhmm}
                      figueresArrivalHhmm={figueresArrivalHhmm}
                      referenceMode={ftReferenceMode}
                      gpsStateUi={gpsStateUi}
                      gpsPk={gpsPkForUi}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>{" "}
          {/* fin Zone LTV + FT */}
        </div>{" "}
        {/* fin MODE VERT */}
      </div>{" "}
      {/* fin conteneur principal */}
    </main>
  )
}
