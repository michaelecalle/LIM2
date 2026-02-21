// src/components/LIM/FT.tsx
import React, { useState, useEffect, useMemo } from "react";
import {
  FT_LIGNE_PAIR,
  FT_LIGNE_IMPAIR,
  CSV_ZONES,
  type FTEntry,
  type CsvSens,
} from "../../data/ligneFT";
import { logTestEvent } from "../../lib/testLogger";
import FTTableLayout from "./FTTableLayout";
import { extractSpeedTimeline, computeSeedSpeed } from "./FTSpeedTimeline";

import { renderDependenciaCell } from "./FTRenderHelpers";
import { computeCsvHighlightByIndex } from "./FTCsvHighlight";
import { useScrollViewport } from "./useScrollViewport";
import { buildFtRows } from "./FTBuildRows";
import { useTrainPositionIndicator } from "./useTrainPositionIndicator";

type GpsPosition = {
  lat: number;
  lon: number;
  accuracy?: number;
  pk?: number | null;
  s_km?: number | null;
  distance_m?: number | null;
  onLine?: boolean;
  timestamp?: number;
};

type ReferenceMode = "HORAIRE" | "GPS";

type FTProps = {
  variant?: "classic" | "modern";
};

export default function FT({ variant = "classic" }: FTProps) {
  // ligne "active" quand on est en mode horaire (play)
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);

  // source de référence pour la ligne active : horaire ou GPS
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("HORAIRE");

  // ligne actuellement sélectionnée pour le recalage manuel
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // mode test (active les overlays de debug FT)
  const [testModeEnabled, setTestModeEnabled] = useState(false);

  // État GPS pour l'UI (couleur de l'indicateur de position)
  type GpsStateUi = "RED" | "ORANGE" | "GREEN";
  const [gpsStateUi, setGpsStateUi] = useState<GpsStateUi>("RED");

  // -- écoute du bouton play/pause (auto-scroll) venant du TitleBar
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const autoScrollEnabledRef = React.useRef(false);
  const referenceModeRef = React.useRef<ReferenceMode>("HORAIRE");

  // ✅✅✅ IMPORTANT : ref GPS DOIT exister avant toute utilisation
  const lastGpsPositionRef = React.useRef<GpsPosition | null>(null);

  // ✅ Extraction scroll/viewport
  const {
    visibleRows,
    setVisibleRows, // dispo si tu en as besoin ailleurs (sinon on pourra le retirer)
    scrollContainerRef,
    setContainerRef,
    isManualScrollRef,
    manualScrollTimeoutRef,
    lastAutoScrollTopRef,
    isProgrammaticScrollRef,
    handleScroll,
  } = useScrollViewport({
    autoScrollEnabled,
    autoScrollEnabledRef,
    referenceModeRef,
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const s = ce?.detail?.state as GpsStateUi | undefined;

      if (s === "RED" || s === "ORANGE" || s === "GREEN") {
        setGpsStateUi(s);

        // ✅ Règle demandée :
        // - GREEN => GPS
        // - ORANGE/RED => HORAIRE
        const nextMode: ReferenceMode = s === "GREEN" ? "GPS" : "HORAIRE";

        if (referenceModeRef.current !== nextMode) {
          referenceModeRef.current = nextMode;
          setReferenceMode(nextMode);
        }
      }
    };

    window.addEventListener("lim:gps-state", handler as EventListener);
    return () => {
      window.removeEventListener("lim:gps-state", handler as EventListener);
    };
  }, []);

  //
  // ===== 1. NUMÉRO DE TRAIN ET PORTION DE PARCOURS ===================
  //
  // trainNumber = numéro du train (sans les zéros initiaux), reçu via lim:train / lim:train-change
  // routeStart / routeEnd = gares extrémités du parcours réel (ex "Barcelona Sants" → "Can Tunis AV")
  //
  const [trainNumber, setTrainNumber] = useState<number | null>(null);

  // ===== FT VIEW MODE (alternance ES/FR, sans fusion) =====
  type FtViewMode = "AUTO" | "ES" | "FR";
  const [ftViewMode, setFtViewMode] = useState<FtViewMode>("AUTO");

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const mode = (ce as any)?.detail?.mode;
      if (mode === "AUTO" || mode === "ES" || mode === "FR") {
        setFtViewMode(mode);
      }
    };
    window.addEventListener("ft:view-mode-change", handler as EventListener);
    return () => {
      window.removeEventListener("ft:view-mode-change", handler as EventListener);
    };
  }, []);

  // Liste blanche : seuls ces trains peuvent afficher FT France (à terme)
  const FT_FR_WHITELIST = useMemo(
    () => new Set<number>([9712, 9714, 9707, 9709, 9705, 9710]),
    []
  );

  // Pour cette étape : AUTO = ES par défaut (l’auto GPS viendra ensuite)
  const effectiveFtView: "ES" | "FR" = useMemo(() => {
    if (ftViewMode === "ES") return "ES";
    if (ftViewMode === "FR") {
      return trainNumber !== null && FT_FR_WHITELIST.has(trainNumber) ? "FR" : "ES";
    }
    // AUTO
    return "ES";
  }, [ftViewMode, trainNumber, FT_FR_WHITELIST]);

  const [routeStart, setRouteStart] = useState<string>("");
  const [routeEnd, setRouteEnd] = useState<string>("");

  // 🕐 Heures détectées (reçues via ft:heures)
  const [heuresDetectees, setHeuresDetectees] = useState<string[]>([]);

  // 🅲 Codes "Com" détectés (reçus via ft:codesC)
  const [codesCFlat, setCodesCFlat] = useState<string[]>([]);

  // 🅲 Codes "Com" résolus par heure (via ft:codesC:resolved)
  const [codesCParHeure, setCodesCParHeure] = useState<Record<string, string[]>>(
    {}
  );

  // 🔁 Valeurs CONC résolues par heure (via ft:conc:resolved)
  const [concParHeure, setConcParHeure] = useState<Record<string, string[]>>({});
  const rcPrintedSegmentsRef = React.useRef<Set<number>>(new Set());
  const vPrintedSegmentsRef = React.useRef<Set<number>>(new Set());
  const arrivalEventsRef = React.useRef<{ arrivalMin: number; rowIndex: number }[]>([]);

  // -- écoute du numéro de train
  useEffect(() => {
    function handleIncomingTrain(e: any, sourceName: string) {
      if (!e?.detail) return;
      const raw = e.detail.trainNumber;
      const n = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (!isNaN(n)) {
        console.log("[FT] Reçu event " + sourceName + ", trainNumber=", n);
        setTrainNumber(n);
      } else {
        console.warn(
          "[FT] Event " + sourceName + " reçu mais trainNumber illisible:",
          e.detail
        );
      }
    }

    function handlerTrainChange(e: any) {
      handleIncomingTrain(e, "lim:train-change");
    }

    function handlerTrain(e: any) {
      handleIncomingTrain(e, "lim:train");
    }

    window.addEventListener("lim:train-change", handlerTrainChange as EventListener);
    window.addEventListener("lim:train", handlerTrain as EventListener);

    return () => {
      window.removeEventListener("lim:train-change", handlerTrainChange as EventListener);
      window.removeEventListener("lim:train", handlerTrain as EventListener);
    };
  }, []);

  // -- écoute des infos LIM complètes pour récupérer origenDestino (origine → destination)
  useEffect(() => {
    function handlerLimParsed(e: any) {
      const d = e?.detail || {};
      const odRaw = d.origenDestino ?? d.relation ?? "";
      if (typeof odRaw === "string" && odRaw.trim().length > 0) {
        const parts = odRaw
          .split(/\s+[-–]\s+/)
          .map((s: string) => s.trim())
          .filter(Boolean);

        if (parts.length >= 2) {
          const start = parts[0];
          const end = parts.slice(1).join(" - ");
          console.log("[FT] lim:parsed origenDestino=", odRaw, "=>", start, "→", end);
          setRouteStart(start);
          setRouteEnd(end);
        } else {
          console.warn("[FT] origenDestino non découpable:", odRaw);
        }
      }
    }

    window.addEventListener("lim:parsed", handlerLimParsed as EventListener);
    return () => {
      window.removeEventListener("lim:parsed", handlerLimParsed as EventListener);
    };
  }, []);

  // -- écoute des heures détectées par ftParser (ft:heures)
  useEffect(() => {
    function handlerFtHeures(e: any) {
      const d = e?.detail || {};
      const byPage = Array.isArray(d.byPage) ? d.byPage : [];
      const heures: string[] = byPage.flatMap((p: any) =>
        Array.isArray(p?.heures) ? p.heures : []
      );

      setHeuresDetectees(heures);

      // ✅ DEBUG SAFE (ne dépend de rien d'autre que l'event)
      const perPageCounts = byPage.map((p: any) => ({
        page: p?.page ?? null,
        count: Array.isArray(p?.heures) ? p.heures.length : 0,
        sample: Array.isArray(p?.heures) ? p.heures.slice(0, 6) : [],
      }));

      console.log("[FT][heures] ft:heures reçu", {
        total: heures.length,
        sample: heures.slice(0, 20),
        perPage: perPageCounts,
      });

      logTestEvent("ft:heures:debug", {
        total: heures.length,
        sample: heures.slice(0, 20),
        perPage: perPageCounts,
      });
    }

    window.addEventListener("ft:heures", handlerFtHeures as EventListener);
    return () => {
      window.removeEventListener("ft:heures", handlerFtHeures as EventListener);
    };
  }, []);

  // -- écoute des codes C (ft:codesC) — MAJ d'état + logs
  useEffect(() => {
    function handlerFtCodesC(e: any) {
      const detail = e?.detail ?? {};
      const flat: string[] = Array.isArray((detail as any).flat) ? (detail as any).flat : [];
      const byPage: any[] = Array.isArray((detail as any).byPage) ? (detail as any).byPage : [];

      setCodesCFlat(flat);

      const perPageCounts = byPage.map((p: any) => ({
        page: p?.page,
        count: Array.isArray(p?.values) ? p.values.length : 0,
        sample: Array.isArray(p?.values) ? p.values.slice(0, 6) : [],
      }));
      console.log("[FT] Reçu ft:codesC — total=", flat.length, {
        perPage: perPageCounts,
        flatSample: flat.slice(0, 20),
      });
    }

    window.addEventListener("ft:codesC", handlerFtCodesC as EventListener);
    return () => {
      window.removeEventListener("ft:codesC", handlerFtCodesC as EventListener);
    };
  }, []);

  // -- écoute des codes C résolus avec leur heure (ft:codesC:resolved)
  useEffect(() => {
    function handlerFtCodesCResolved(e: any) {
      const d = e?.detail ?? {};
      const items = Array.isArray(d.items) ? d.items : [];
      const map: Record<string, string[]> = {};

      for (const it of items) {
        const heure = (it.heure ?? "").trim();
        const com = (it.com ?? "").trim();
        if (!heure || !com) continue;
        if (!map[heure]) map[heure] = [];
        map[heure].push(com);
      }

      setCodesCParHeure(map);
      console.log("[FT] Reçu ft:codesC:resolved => codesCParHeure =", map);
    }

    window.addEventListener("ft:codesC:resolved", handlerFtCodesCResolved as EventListener);
    return () => {
      window.removeEventListener("ft:codesC:resolved", handlerFtCodesCResolved as EventListener);
    };
  }, []);

  // -- écoute des valeurs CONC résolues avec leur heure (ft:conc:resolved)
  useEffect(() => {
    function handlerFtConcResolved(e: any) {
      const d = e?.detail ?? {};
      const items = Array.isArray(d.items) ? d.items : [];
      const map: Record<string, string[]> = {};

      for (const it of items) {
        const heure = (it.heure ?? "").trim();
        const conc = (it.conc ?? "").trim();
        if (!heure || !conc) continue;
        if (!map[heure]) map[heure] = [];
        map[heure].push(conc);
      }

      setConcParHeure(map);
      console.log("[FT] Reçu ft:conc:resolved => concParHeure =", map);
    }

    window.addEventListener("ft:conc:resolved", handlerFtConcResolved as EventListener);
    return () => {
      window.removeEventListener("ft:conc:resolved", handlerFtConcResolved as EventListener);
    };
  }, []);

  // =========================
  // Direction attendue (source: TitleBar)
  // UP => PK croissants, DOWN => PK décroissants
  // =========================
  type ExpectedDir = "UP" | "DOWN";

  const expectedDirRef = React.useRef<ExpectedDir | null>(null);
  const expectedDirTrainRef = React.useRef<string | null>(null);
  const expectedDirSourceRef = React.useRef<string | null>(null);

  // stats cohérence GPS (fenêtre glissante)
  const dirLastPkRef = React.useRef<number | null>(null);
  const dirWindowRef = React.useRef<{ startTs: number; sample: number; mismatch: number }>({
    startTs: 0,
    sample: 0,
    mismatch: 0,
  });
  const dirLastMismatchEmitAtRef = React.useRef<number>(0);

  useEffect(() => {
    referenceModeRef.current = referenceMode;
  }, [referenceMode]);

  useEffect(() => {
    autoScrollEnabledRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  useEffect(() => {
    console.log("[FT][mode] referenceMode changé =>", referenceMode);

    logTestEvent("ft:reference-mode", {
      mode: referenceMode,
    });

    window.dispatchEvent(
      new CustomEvent("lim:reference-mode", {
        detail: { mode: referenceMode },
      })
    );
  }, [referenceMode]);

  // écoute du mode test (ON/OFF)
  useEffect(() => {
    function handleTestMode(e: any) {
      const enabled = !!e?.detail?.enabled;
      setTestModeEnabled(enabled);
    }

    window.addEventListener("lim:test-mode", handleTestMode as EventListener);
    return () => {
      window.removeEventListener("lim:test-mode", handleTestMode as EventListener);
    };
  }, []);

  // écoute du sens attendu (venant de TitleBar)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce?.detail ?? {};
      const dir = d?.expectedDir as string | undefined;

      if (dir !== "UP" && dir !== "DOWN") return;

      expectedDirRef.current = dir;
      expectedDirTrainRef.current = typeof d?.train === "string" ? d.train : null;
      expectedDirSourceRef.current = typeof d?.source === "string" ? d.source : null;

      // reset stats (on repart propre à chaque changement de sens)
      dirLastPkRef.current = null;
      dirWindowRef.current = { startTs: 0, sample: 0, mismatch: 0 };
      dirLastMismatchEmitAtRef.current = 0;

      logTestEvent("direction:expected:set", {
        expectedDir: dir,
        train: expectedDirTrainRef.current,
        source: expectedDirSourceRef.current,
      });
    };

    window.addEventListener("lim:expected-direction", handler as EventListener);
    window.addEventListener("ft:expected-direction", handler as EventListener);
    return () => {
      window.removeEventListener("lim:expected-direction", handler as EventListener);
      window.removeEventListener("ft:expected-direction", handler as EventListener);
    };
  }, []);

  const autoScrollBaseRef = React.useRef<{
    realMinInt: number; // minutes entières — pour updateFromClock (ligne active)
    realMinFloat: number; // minutes + secondes — pour interpolation continue (barre rouge)
    firstHoraMin: number;
    fixedDelay: number; // minutes (arrondi, pour l'affichage actuel)
    deltaSec: number; // secondes (signé, exact au moment du Play)
  } | null>(null);

  // Ligne cible pour un recalage manuel (mode Standby)
  const recalibrateFromRowRef = React.useRef<number | null>(null);
  // Dernière ligne FT utilisée comme “point d’ancrage” GPS
  const lastAnchoredRowRef = React.useRef<number | null>(null);
  // Premier démarrage déjà “consommé” ?
  const initialStandbyDoneRef = React.useRef(false);
  // Index de la première ligne principale non-noteOnly (tenu à jour plus bas)
  const firstNonNoteIndexRef = React.useRef<number | null>(null);

  // Lorsque le mode de référence repasse en GPS, on nettoie toute sélection Standby / recalage manuel
  useEffect(() => {
    if (referenceMode !== "GPS") return;

    if (selectedRowIndex !== null) {
      setSelectedRowIndex(null);
    }
    recalibrateFromRowRef.current = null;
  }, [referenceMode, selectedRowIndex]);

  const { trainPosYpx, getFallbackTrainTopPx } = useTrainPositionIndicator({
    scrollContainerRef,
    activeRowIndex: typeof activeRowIndex === "number" ? activeRowIndex : 0,
    gpsStateUi,
    referenceModeRef,
    autoScrollEnabledRef,
    autoScrollBaseRef,
    lastGpsPositionRef,
    // ES par défaut (pk col 3, hora col 6) : pas besoin de surcharger ici
  });

  // ===== GPS quality (fresh + freeze) =====
  type GpsState = "RED" | "ORANGE" | "GREEN";

  const gpsStateRef = React.useRef<GpsState>("RED");

  // 🔊 Emission continue vers TitleBar (évite PK "bloqué" quand l'état reste GREEN)
  const lastGpsStateEmitPkRef = React.useRef<number | null>(null);
  const lastGpsStateEmitAtRef = React.useRef<number>(0);
  const GPS_STATE_EMIT_MIN_INTERVAL_MS = 800; // throttle (ms)

  // Pour détecter une position "fraîche"
  const lastGpsSampleAtRef = React.useRef<number>(0);

  // Pour détecter un PK figé
  const lastPkRef = React.useRef<number | null>(null);
  const lastPkChangeAtRef = React.useRef<number>(0);

  // ===== Watchdog GPS : re-évalue l'état même s'il n'y a plus d'events gps:position =====
  useEffect(() => {
    const WATCHDOG_INTERVAL_MS = 1000;

    const tick = () => {
      const last = lastGpsPositionRef.current;
      if (!last) return;

      const nowTs = Date.now();

      const sampleTs =
        lastGpsSampleAtRef.current > 0
          ? lastGpsSampleAtRef.current
          : typeof (last as any).timestamp === "number"
          ? (last as any).timestamp
          : 0;

      if (!sampleTs) return;

      const hasGpsFix =
        typeof (last as any).lat === "number" && typeof (last as any).lon === "number";

      const onLine = !!(last as any).onLine;

      const ageSec = Math.max(0, (nowTs - sampleTs) / 1000);
      const isStale = ageSec > GPS_FRESH_SEC;

      const pkRaw = (last as any).pk as number | null | undefined;
      const pkFinite = typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

      const pkFreezeElapsedMs =
        hasGpsFix && onLine && pkFinite != null && lastPkChangeAtRef.current > 0
          ? nowTs - lastPkChangeAtRef.current
          : 0;

      const pkFrozenOrange = pkFreezeElapsedMs >= GPS_FREEZE_WINDOW_MS;
      const pkFrozenRed = pkFreezeElapsedMs >= GPS_FREEZE_TO_RED_MS;

      const pkIncoherentNow = pkJumpGuardActiveRef.current === true;

      const reasonCodes: string[] = [];
      if (!hasGpsFix) reasonCodes.push("no_fix");
      if (hasGpsFix && !onLine) reasonCodes.push("off_line");
      if (hasGpsFix && onLine && isStale) reasonCodes.push("stale_fix");
      if (pkIncoherentNow) reasonCodes.push("pk_jump_guard");
      if (pkFrozenRed) reasonCodes.push("pk_frozen_red");
      else if (pkFrozenOrange) reasonCodes.push("pk_frozen_orange");
      reasonCodes.push("watchdog");

      let nextState: GpsState = "RED";
      if (!hasGpsFix) {
        nextState = "RED";
      } else if (pkIncoherentNow) {
        nextState = "RED";
      } else if (pkFrozenRed) {
        nextState = "RED";
      } else if (!onLine || isStale || pkFrozenOrange) {
        nextState = "ORANGE";
      } else {
        nextState = "GREEN";
      }

      if (nextState === "ORANGE") {
        if (orangeToRedStartedAtRef.current == null) {
          orangeToRedStartedAtRef.current = nowTs;
          logTestEvent("gps:orange-to-red:start", {
            startedAt: nowTs,
            timeoutMs: ORANGE_TIMEOUT_MS,
            reasonCodes,
            source: "watchdog",
          });
        } else {
          const startedAt = orangeToRedStartedAtRef.current;
          const elapsedMs = Math.max(0, nowTs - startedAt);

          if (elapsedMs >= ORANGE_TIMEOUT_MS) {
            nextState = "RED";
            reasonCodes.push("orange_timeout");

            logTestEvent("gps:orange-to-red:fire", {
              startedAt,
              nowTs,
              elapsedMs,
              timeoutMs: ORANGE_TIMEOUT_MS,
              reasonCodes,
              source: "watchdog",
            });

            orangeToRedStartedAtRef.current = null;
          }
        }
      } else {
        if (orangeToRedStartedAtRef.current != null) {
          const startedAt = orangeToRedStartedAtRef.current;
          const elapsedMs = Math.max(0, nowTs - startedAt);

          logTestEvent("gps:orange-to-red:stop", {
            startedAt,
            nowTs,
            elapsedMs,
            timeoutMs: ORANGE_TIMEOUT_MS,
            newState: nextState,
            source: "watchdog",
          });

          orangeToRedStartedAtRef.current = null;
        }
      }

      const emitGpsState = (forced: boolean) => {
        const pkForUi = nextState === "GREEN" ? pkFinite : null;

        const lastEmitAt = lastGpsStateEmitAtRef.current;
        const lastEmitPk = lastGpsStateEmitPkRef.current;

        const pkChanged =
          pkForUi != null && (lastEmitPk == null || Math.abs(pkForUi - lastEmitPk) >= 0.05);

        const timeOk = nowTs - lastEmitAt >= GPS_STATE_EMIT_MIN_INTERVAL_MS;

        if (!forced && !pkChanged && !timeOk) return;

        lastGpsStateEmitAtRef.current = nowTs;
        lastGpsStateEmitPkRef.current = pkForUi;

        window.dispatchEvent(
          new CustomEvent("lim:gps-state", {
            detail: {
              state: nextState,
              reasonCodes,
              pk: pkForUi,
              pkRaw: pkRaw ?? null,
              hasFix: hasGpsFix,
              onLine,
              isStale,
              ageSec,
            },
          })
        );
      };

      const prevState = gpsStateRef.current;

      if (prevState !== nextState) {
        gpsStateRef.current = nextState;

        emitGpsState(true);

        logTestEvent("gps:state-change:watchdog", {
          prevState,
          nextState,
          reasonCodes,
          ageSec,
          pk: pkFinite,
          pkRaw: pkRaw ?? null,
          onLine,
          hasFix: hasGpsFix,
          isStale,
          gpsFreshSec: GPS_FRESH_SEC,
          gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
          gpsFreezeToRedMs: GPS_FREEZE_TO_RED_MS,
          gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
          orangeTimeoutMs: ORANGE_TIMEOUT_MS,
        });
      } else {
        if (nextState === "GREEN") {
          emitGpsState(false);
        }
      }

      const stateNow = gpsStateRef.current;
      const currentMode = referenceModeRef.current;

      const nextMode: ReferenceMode = stateNow === "GREEN" ? "GPS" : "HORAIRE";

      if (currentMode !== nextMode) {
        referenceModeRef.current = nextMode;
        setReferenceMode(nextMode);

        logTestEvent("gps:mode-change:watchdog", {
          prevMode: currentMode,
          nextMode,
          reason: "gps_state_watchdog",
          state: stateNow,
          reasonCodes,
          ageSec,
          pkRaw: pkRaw ?? null,
          pkUsed: pkFinite,
          onLine,
          hasFix: hasGpsFix,
          isStale,
        });
      }
    };

    const id = window.setInterval(tick, WATCHDOG_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, []);

  // Réglages (ajustables)
  const GPS_FRESH_SEC = 8; // si l'échantillon est plus vieux -> pas "green"
  const GPS_FREEZE_WINDOW_MS = 10_000; // PK inchangé trop longtemps -> ORANGE
  const GPS_FREEZE_PK_DELTA_KM = 0.02; // 0.02 km = 20 m

  const ORANGE_TIMEOUT_MS = 20_000; // 20s après ORANGE
  const GPS_FREEZE_TO_RED_MS = GPS_FREEZE_WINDOW_MS + ORANGE_TIMEOUT_MS;

  const STATION_PROX_KM = 1.0;

  const gpsHealthyRef = React.useRef<boolean>(false);

  const lastCoherentPkRef = React.useRef<number | null>(null);
  const lastCoherentTsRef = React.useRef<number>(0);

  const pkJumpGuardActiveRef = React.useRef<boolean>(false);
  const pkJumpGuardBasePkRef = React.useRef<number | null>(null);
  const pkJumpGuardBaseTsRef = React.useRef<number>(0);

  const GPS_JUMP_BASE_TOLERANCE_KM = 0.8;
  const GPS_JUMP_MAX_SPEED_KMH = 420;
  const GPS_JUMP_MIN_ELAPSED_SEC = 1.0;

  const DIR_MIN_DELTA_KM = 0.02;
  const DIR_WINDOW_MS = 15_000;
  const DIR_MIN_SAMPLES = 6;
  const DIR_MISMATCH_MIN_RATIO = 0.8;
  const DIR_MISMATCH_COOLDOWN_MS = 30_000;

  const orangeTimeoutRef = React.useRef<number | null>(null);
  const orangeTimeoutStartedAtRef = React.useRef<number | null>(null);

  const orangeToRedTimerRef = React.useRef<number | null>(null);
  const orangeToRedStartedAtRef = React.useRef<number | null>(null);

  useEffect(() => {
    function handlerAutoScroll(e: any) {
      const detail = e?.detail ?? {};
      const enabled = !!detail.enabled;
      const standby = !!detail.standby;

      if (enabled && standby && !initialStandbyDoneRef.current) {
        const idx = firstNonNoteIndexRef.current;
        if (typeof idx === "number" && idx >= 0) {
          initialStandbyDoneRef.current = true;

          console.log("[FT] Premier Play reçu, passage en Standby initial sur la ligne", idx);

          setSelectedRowIndex(idx);
          recalibrateFromRowRef.current = idx;

          setAutoScrollEnabled(false);

          window.dispatchEvent(
            new CustomEvent("lim:hourly-mode", {
              detail: { enabled: false, standby: true },
            })
          );

          return;
        }
      }

      console.log("[FT] ft:auto-scroll-change reçu, enabled =", enabled, "/ standby =", standby);

      setAutoScrollEnabled(enabled);

      window.dispatchEvent(
        new CustomEvent("lim:hourly-mode", {
          detail: { enabled, standby },
        })
      );
    }

    window.addEventListener("ft:auto-scroll-change", handlerAutoScroll as EventListener);

    return () => {
      window.removeEventListener("ft:auto-scroll-change", handlerAutoScroll as EventListener);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce?.detail ?? {};

      const raw = d.rowIndex;
      const rowIndex = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);

      if (!Number.isFinite(rowIndex)) return;

      setSelectedRowIndex(rowIndex);
      recalibrateFromRowRef.current = rowIndex;
    };

    window.addEventListener("ft:standby:set", handler as EventListener);
    return () => {
      window.removeEventListener("ft:standby:set", handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) {
      autoScrollBaseRef.current = null;

      isManualScrollRef.current = false;
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
        manualScrollTimeoutRef.current = null;
      }
      return;
    }

    const toMinutes = (s: string) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return NaN;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const minutesToHHMM = (mins: number) => {
      const total = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
      const hh = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
      const mm = (total % 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };

        // ✅ Table minutes (indexée par data-ft-row) reconstruite depuis le DOM.
    //    Objectif : avoir une source horaire continue pour l'autoscroll, sans dépendre d'une variable globale.
    const horaTheoMinutesByIndex: Array<number | null> = [];

    const mainRows = document.querySelectorAll<HTMLTableRowElement>(
      "table.ft-table tbody tr.ft-row-main"
    );

    mainRows.forEach((tr) => {
      const dataIndexAttr = tr.getAttribute("data-ft-row");
      const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : NaN;
      if (!Number.isFinite(dataIndex)) return;

      // On récupère l'heure visible dans la cellule Hora (départ/arrivée/théo…)
      const tdHora = tr.querySelector<HTMLTableCellElement>("td.ft-hora-cell");
      const txt = (tdHora?.textContent ?? "").trim();

      // Cherche un hh:mm dans le texte (peu importe le span interne)
      const m = /(\d{1,2}):(\d{2})/.exec(txt);
      if (!m) return;

      const mins = toMinutes(`${m[1]}:${m[2]}`);
      if (!Number.isFinite(mins)) return;

      horaTheoMinutesByIndex[dataIndex] = mins;
    });

    const computeFixedDelay = (now: Date, ftMinutes: number) => {
      const nowTotalSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

      const ftTotalSec = ftMinutes * 60;

      const deltaSec = nowTotalSec - ftTotalSec;
      const fixedDelayMin = Math.round(deltaSec / 60);

      return { fixedDelayMin, deltaSec };
    };

    const captureBaseFromFirstRow = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowMinFloat = nowMin + now.getSeconds() / 60;

      let firstHoraMin: number | null = null;
      for (let i = 0; i < horaTheoMinutesByIndex.length; i++) {
        const m = horaTheoMinutesByIndex[i];
        if (typeof m === "number" && Number.isFinite(m)) {
          firstHoraMin = m;
          break;
        }
      }

      if (firstHoraMin == null) return null;

      const { fixedDelayMin: fixedDelay, deltaSec } = computeFixedDelay(now, firstHoraMin);
      return { realMinInt: nowMin, realMinFloat: nowMinFloat, firstHoraMin, fixedDelay, deltaSec };
    };

    const captureBaseFromRowIndex = (rowIndex: number) => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowMinFloat = nowMin + now.getSeconds() / 60;

      const rowMin = horaTheoMinutesByIndex[rowIndex];
      if (typeof rowMin !== "number" || !Number.isFinite(rowMin)) return null;

      const { fixedDelayMin: fixedDelay, deltaSec } = computeFixedDelay(now, rowMin);
      return { realMinInt: nowMin, realMinFloat: nowMinFloat, firstHoraMin: rowMin, fixedDelay, deltaSec };
    };

    const forcedIndex = recalibrateFromRowRef.current;
    if (forcedIndex != null) {
      autoScrollBaseRef.current = captureBaseFromRowIndex(forcedIndex);
      recalibrateFromRowRef.current = null;
    } else {
      autoScrollBaseRef.current = captureBaseFromFirstRow();
    }

    if (scrollContainerRef.current) {
      lastAutoScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    if (autoScrollBaseRef.current) {
      const fixed = autoScrollBaseRef.current.fixedDelay;
      const deltaSec = autoScrollBaseRef.current.deltaSec;
      const text = fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;

      window.dispatchEvent(
        new CustomEvent("lim:schedule-delta", {
          detail: {
            text,
            isLargeDelay: Math.abs(fixed) >= 5,
            deltaSec,
          },
        })
      );
    }

    const updateFromClock = (forcedHHMM?: string) => {
      if (forcedHHMM && /^\d{1,2}:\d{2}$/.test(forcedHHMM)) {
        const mainRows = document.querySelectorAll<HTMLTableRowElement>(
          "table.ft-table tbody tr.ft-row-main"
        );
        if (!mainRows.length) return;

        const targetMin = toMinutes(forcedHHMM);
        if (Number.isNaN(targetMin)) return;

        let exactDataIndex: number | null = null;
        let lastPastDataIndex: number | null = null;
        let firstValidDataIndex: number | null = null;

        for (let i = 0; i < mainRows.length; i++) {
          const tr = mainRows[i];
          const dataIndexAttr = tr.getAttribute("data-ft-row");
          const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : NaN;
          if (!Number.isFinite(dataIndex)) continue;

          const rowMin = horaTheoMinutesByIndex[dataIndex];
          if (typeof rowMin !== "number" || !Number.isFinite(rowMin)) continue;

          if (firstValidDataIndex == null) firstValidDataIndex = dataIndex;

          if (rowMin === targetMin && exactDataIndex == null) {
            exactDataIndex = dataIndex;
          }
          if (rowMin <= targetMin) {
            lastPastDataIndex = dataIndex;
          }
        }

        const picked = exactDataIndex ?? lastPastDataIndex ?? firstValidDataIndex ?? 0;

        setActiveRowIndex(picked);
        return;
      }

      const base = autoScrollBaseRef.current;
      if (!base) return;

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const elapsed = nowMin - base.realMinInt;

      const effectiveMin = base.firstHoraMin + elapsed;
      const effectiveHHMM = minutesToHHMM(effectiveMin);

      console.log(
        `[FT][auto] heure réelle = ${minutesToHHMM(nowMin)} | première heure FT = ${minutesToHHMM(
          base.firstHoraMin
        )} | diff (minutes depuis activation) = ${elapsed} | heure EFFECTIVE utilisée pour le '>' = ${effectiveHHMM}`
      );

      logTestEvent("ft:delta:tick", {
        nowHHMM: minutesToHHMM(nowMin),
        baseFirstHoraHHMM: minutesToHHMM(base.firstHoraMin),
        elapsedMinutes: elapsed,
        effectiveHHMM,
        fixedDelay: base.fixedDelay ?? null,
      });

      if (referenceModeRef.current === "HORAIRE") {
        const arrivalList = arrivalEventsRef.current || [];
        if (Array.isArray(arrivalList) && arrivalList.length > 0) {
          const matchingArrival = arrivalList.find((ev) => ev.arrivalMin === effectiveMin);

          if (matchingArrival) {
            console.log(
              "[FT][auto] Arrêt automatique sur arrivée calculée, rowIndex =",
              matchingArrival.rowIndex,
              "arrivalMin =",
              matchingArrival.arrivalMin
            );

            logTestEvent("ft:auto:arrival-stop", {
              rowIndex: matchingArrival.rowIndex,
              arrivalMin: matchingArrival.arrivalMin,
              effectiveHHMM,
            });

            setActiveRowIndex(matchingArrival.rowIndex);

            setSelectedRowIndex(matchingArrival.rowIndex);
            recalibrateFromRowRef.current = matchingArrival.rowIndex;

            const container = scrollContainerRef.current;
            if (container) {
              const activeRow = document.querySelector<HTMLTableRowElement>(
                `tr.ft-row-main[data-ft-row="${matchingArrival.rowIndex}"]`
              );
              const refLine = document.querySelector<HTMLDivElement>(".ft-active-line");

              if (activeRow && refLine) {
                const rowRect = activeRow.getBoundingClientRect();
                const refRect = refLine.getBoundingClientRect();

                const rowCenterY = rowRect.top + rowRect.height / 2;
                const refCenterY = refRect.top + refRect.height / 2;
                const delta = rowCenterY - refCenterY;

                if (delta !== 0) {
                  const currentScrollTop = container.scrollTop;
                  let targetScrollTop = currentScrollTop + delta;

                  const maxScrollTop = container.scrollHeight - container.clientHeight;
                  if (maxScrollTop >= 0) {
                    if (targetScrollTop < 0) targetScrollTop = 0;
                    if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop;

                    isProgrammaticScrollRef.current = true;
                    container.scrollTo({
                      top: targetScrollTop,
                      behavior: "auto",
                    });
                    lastAutoScrollTopRef.current = targetScrollTop;
                  }
                }
              }
            }

            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", {
                detail: { enabled: false },
              })
            );

            window.dispatchEvent(
              new CustomEvent("lim:hourly-mode", {
                detail: { enabled: false, standby: true },
              })
            );

            return;
          }
        }
      }

      const mainRows = document.querySelectorAll<HTMLTableRowElement>(
        "table.ft-table tbody tr.ft-row-main"
      );
      if (!mainRows.length) return;

      let exactDataIndex: number | null = null;
      let lastPastDataIndex: number | null = null;
      let firstValidDataIndex: number | null = null;

      for (let i = 0; i < mainRows.length; i++) {
        const tr = mainRows[i];
        const dataIndexAttr = tr.getAttribute("data-ft-row");
        const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : NaN;
        if (!Number.isFinite(dataIndex)) continue;

        const rowMin = horaTheoMinutesByIndex[dataIndex];
        if (typeof rowMin !== "number" || !Number.isFinite(rowMin)) continue;

        if (firstValidDataIndex == null) firstValidDataIndex = dataIndex;

        if (rowMin === effectiveMin && exactDataIndex == null) {
          exactDataIndex = dataIndex;
        }
        if (rowMin <= effectiveMin) {
          lastPastDataIndex = dataIndex;
        }
      }

      let dataIndex = exactDataIndex ?? lastPastDataIndex ?? firstValidDataIndex ?? 0;

      if (referenceModeRef.current === "HORAIRE" && elapsed === 0 && firstValidDataIndex != null) {
        dataIndex = firstValidDataIndex;
      }

      if (referenceModeRef.current === "HORAIRE") {
        if (elapsed === 0) {
          isManualScrollRef.current = true;
          window.setTimeout(() => {
            isManualScrollRef.current = false;
          }, 600);
        }

        setActiveRowIndex(dataIndex);
      }

      const fixed = base.fixedDelay ?? 0;
      const text = fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;
      window.dispatchEvent(
        new CustomEvent("lim:schedule-delta", {
          detail: {
            text,
            isLargeDelay: Math.abs(fixed) >= 5,
          },
        })
      );
    };

    updateFromClock();

    const timer = setInterval(() => {
      updateFromClock();
    }, 60_000);

    const handleForceTime = (e: Event) => {
      const ce = e as CustomEvent;
      const time = (ce as any)?.detail?.time as string | undefined;
      if (time) {
        console.log("[FT] heure forcée =", time);
        updateFromClock(time);
      }
    };
    window.addEventListener("ft:force-time", handleForceTime as EventListener);

    return () => {
      clearInterval(timer);
      window.removeEventListener("ft:force-time", handleForceTime as EventListener);
    };
  }, [autoScrollEnabled]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (activeRowIndex == null) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const activeRow = document.querySelector<HTMLTableRowElement>(
      `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
    );
    const refLine = document.querySelector<HTMLDivElement>(".ft-active-line");

    if (!activeRow || !refLine) return;

    const rowRect = activeRow.getBoundingClientRect();
    const refRect = refLine.getBoundingClientRect();

    const rowCenterY = rowRect.top + rowRect.height / 2;
    const refCenterY = refRect.top + refRect.height / 2;

    const delta = rowCenterY - refCenterY;

    if (delta === 0) return;

    if (isManualScrollRef.current) {
      return;
    }

    const currentScrollTop = container.scrollTop;
    let targetScrollTop = currentScrollTop + delta;

    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (maxScrollTop < 0) return;

    if (targetScrollTop < 0) targetScrollTop = 0;
    if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop;

    if (targetScrollTop === currentScrollTop) return;

    isProgrammaticScrollRef.current = true;
    container.scrollTo({
      top: targetScrollTop,
      behavior: "auto",
    });
    lastAutoScrollTopRef.current = targetScrollTop;
  }, [autoScrollEnabled, activeRowIndex, referenceMode]);

  //
  // ===== 2. LOGIQUE MÉTIER DE SENS ===================================
  //

  const isOdd = useMemo(() => {
    if (trainNumber === null) return null;
    return trainNumber % 2 !== 0;
  }, [trainNumber]);
  const currentCsvSens: CsvSens | null = useMemo(() => {
    if (isOdd === null) return null;
    return isOdd ? "IMPAIR" : "PAIR";
  }, [isOdd]);

  useEffect(() => {
    if (trainNumber === null || isOdd === null || currentCsvSens === null) return;

    const direction: "FR_ES" | "ES_FR" = isOdd ? "ES_FR" : "FR_ES";

    const hasFranceFt = FT_FR_WHITELIST.has(trainNumber);

    window.dispatchEvent(
      new CustomEvent("ft:train-context-change", {
        detail: { trainNumber, direction, hasFranceFt, csvSens: currentCsvSens },
      })
    );
  }, [trainNumber, isOdd, currentCsvSens, FT_FR_WHITELIST]);

  //
  // ===== 3. SÉLECTION + ORIENTATION + TRONQUAGE DU PARCOURS ===========
  //
  const rawEntries = useMemo(() => {
    if (isOdd === null) {
      console.log("[FT] Pas encore de trainNumber -> aucune ligne affichée");
      return [];
    }

    let picked: FTEntry[];
    let oriented: FTEntry[];

    if (isOdd) {
      picked = FT_LIGNE_PAIR;
      oriented = picked;
      console.log(
        "[FT] Sens choisi: IMPAIR (Espagne→France, PK croissants) / Jeu de données = FT_LIGNE_PAIR"
      );
    } else {
      picked = FT_LIGNE_IMPAIR;
      oriented = [...picked].reverse();
      console.log(
        "[FT] Sens choisi: PAIR (France→Espagne, PK décroissants) / Jeu de données = FT_LIGNE_IMPAIR inversé"
      );
    }

    function normName(s: string) {
      return s
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[-–]/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function fuzzyMatch(aNorm: string, bNorm: string) {
      if (!aNorm || !bNorm) return false;
      return (
        aNorm === bNorm ||
        aNorm.startsWith(bNorm) ||
        bNorm.startsWith(aNorm) ||
        aNorm.includes(bNorm) ||
        bNorm.includes(aNorm)
      );
    }

    let firstIdx = 0;
    let lastIdx = oriented.length - 1;

    if (routeStart && routeEnd) {
      const nStartWanted = normName(routeStart);
      const nEndWanted = normName(routeEnd);

      const startCandidates: number[] = [];
      const endCandidates: number[] = [];

      for (let i = 0; i < oriented.length; i++) {
        const e = oriented[i];
        if (e.isNoteOnly) continue;

        const depRaw = e.dependencia || "";
        if (!depRaw.trim()) {
          continue;
        }

        const nDep = normName(depRaw);

        if (fuzzyMatch(nDep, nStartWanted)) {
          startCandidates.push(i);
        }
        if (fuzzyMatch(nDep, nEndWanted)) {
          endCandidates.push(i);
        }
      }

      if (startCandidates.length > 0 && endCandidates.length > 0) {
        const sIdx = Math.min(...startCandidates);
        const eIdx = Math.max(...endCandidates);

        firstIdx = Math.min(sIdx, eIdx);
        lastIdx = Math.max(sIdx, eIdx);
      } else {
        console.warn(
          "[FT] Impossible de caler exactement la portion demandée.",
          "routeStart=",
          routeStart,
          "routeEnd=",
          routeEnd,
          "=> fallback: affichage de la totalité"
        );
      }
    }

    const visibleEntries = oriented.slice(firstIdx, lastIdx + 1);

    const snapshot = visibleEntries
      .filter((e) => !e.isNoteOnly)
      .slice(0, 5)
      .map((e) => ({
        pk: e.pk,
        dependencia: e.dependencia,
        vmax: e.vmax,
      }));

    const firstEntry = visibleEntries[0] || {};
    const lastEntry = visibleEntries[visibleEntries.length - 1] || {};

    console.log(
      "[FT] Portion affichée:",
      routeStart,
      "→",
      routeEnd,
      "| index",
      firstIdx,
      "→",
      lastIdx,
      "| lignes visibles:",
      visibleEntries.length
    );

    console.log("[FT] Début portion:", {
      dependencia: (firstEntry as any).dependencia,
      pk: (firstEntry as any).pk,
      vmax: (firstEntry as any).vmax,
      isNoteOnly: (firstEntry as any).isNoteOnly,
    });

    console.log("[FT] Fin portion:", {
      dependencia: (lastEntry as any).dependencia,
      pk: (lastEntry as any).pk,
      vmax: (lastEntry as any).vmax,
      isNoteOnly: (lastEntry as any).isNoteOnly,
    });

    if (routeEnd === "Barcelona Sants") {
      const lastLineIs621_0 = (lastEntry as any).pk === "621.0";
      console.log(`Dernière ligne détectée, 621.0 : ${lastLineIs621_0 ? "Oui" : "Non"}`);
    }

    console.log("[FT] Aperçu (5 premières lignes après tronquage):", snapshot);

    return visibleEntries;
  }, [isOdd, trainNumber, routeStart, routeEnd]);

  function findRowIndexFromPk(targetPk: number | null): number | null {
    if (targetPk == null || !Number.isFinite(targetPk)) return null;

    let firstPkNum: number | null = null;
    let lastPkNum: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;
      const pkNum = Number(e.pk);
      if (!Number.isFinite(pkNum)) continue;
      firstPkNum = pkNum;
      break;
    }

    for (let i = rawEntries.length - 1; i >= 0; i--) {
      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;
      const pkNum = Number(e.pk);
      if (!Number.isFinite(pkNum)) continue;
      lastPkNum = pkNum;
      break;
    }

    const ascending = firstPkNum != null && lastPkNum != null ? firstPkNum <= lastPkNum : true;

    let candidateIndex: number | null = null;

    if (ascending) {
      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;
        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;
        if (pkNum <= targetPk) {
          candidateIndex = i;
        }
      }
    } else {
      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;
        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;
        if (pkNum >= targetPk) {
          candidateIndex = i;
        }
      }
    }

    if (candidateIndex == null) {
      let bestIndex: number | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;

        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;

        const delta = Math.abs(pkNum - targetPk);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = i;
        }
      }

      candidateIndex = bestIndex;
    }

    return candidateIndex;
  }

  function resolveHoraForRowIndex(rowIndex: number): string {
    const entry = rawEntries[rowIndex];
    if (!entry) return "";

    const directHora = (entry as any).hora ?? "";
    if (typeof directHora === "string" && directHora.trim().length > 0) {
      return directHora.trim();
    }

    const eligibleIndices: number[] = [];

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (e.isNoteOnly) continue;

      const s = (e.pk ?? "").toString().trim();
      const d = (e.dependencia ?? "").toString().trim();

      if (s.length > 0 && d.length > 0) {
        eligibleIndices.push(i);
      }
    }

    const pos = eligibleIndices.indexOf(rowIndex);
    if (pos === -1) return "";
    if (pos >= heuresDetectees.length) return "";

    const mappedHora = heuresDetectees[pos];
    return typeof mappedHora === "string" ? mappedHora.trim() : "";
  }

  // -- écoute des positions GPS projetées (évènement gps:position)
  useEffect(() => {
    const findNearestCommercialStopRowIndex = (
      targetPk: number,
      maxDeltaKm: number
    ): { rowIndex: number; deltaKm: number } | null => {
      const stops = arrivalEventsRef.current || [];
      if (!Array.isArray(stops) || stops.length === 0) return null;

      let bestRow: number | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (const s of stops) {
        const rowIndex = (s as any)?.rowIndex;
        if (typeof rowIndex !== "number") continue;

        const entry = rawEntries[rowIndex];
        const pkStr = entry?.pk;
        const pkNum =
          typeof pkStr === "string" || typeof pkStr === "number" ? Number(pkStr) : NaN;
        if (!Number.isFinite(pkNum)) continue;

        const d = Math.abs(pkNum - targetPk);
        if (d < bestDelta) {
          bestDelta = d;
          bestRow = rowIndex;
        }
      }

      if (bestRow == null) return null;
      if (bestDelta > maxDeltaKm) return null;

      return { rowIndex: bestRow, deltaKm: bestDelta };
    };

    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const detail = ce.detail || {};

      lastGpsPositionRef.current = detail as GpsPosition;

      console.log("[FT][gps] position reçue =", detail);
      console.log("[FT][gps] rawEntries.length =", rawEntries.length);

      const pkRaw = (detail as any).pk as number | null | undefined;
      let pk: number | null = typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

      const acceptedMode = (detail as any)?.pkDecision?.acceptedMode ?? null;
      const isRelock = acceptedMode === "relock";

      const nowTs = Date.now();

      const hasGpsFix =
        typeof (detail as any).lat === "number" && typeof (detail as any).lon === "number";

      const onLine = !!(detail as any).onLine;

      const sampleTs = typeof (detail as any).timestamp === "number" ? (detail as any).timestamp : nowTs;

      lastGpsSampleAtRef.current = sampleTs;

      const ageSec = Math.max(0, (nowTs - sampleTs) / 1000);
      const isStale = ageSec > GPS_FRESH_SEC;

      const speedKmPerSec = GPS_JUMP_MAX_SPEED_KMH / 3600;

      const lastCoherentPk = lastCoherentPkRef.current;
      const lastCoherentTs = lastCoherentTsRef.current;

      let pkJumpSuspect = false;

      if (
        !isRelock &&
        hasGpsFix &&
        onLine &&
        !isStale &&
        pk != null &&
        lastCoherentPk != null &&
        lastCoherentTs > 0
      ) {
        const dtSecRaw = Math.max(0, (sampleTs - lastCoherentTs) / 1000);
        const dtSec = Math.max(dtSecRaw, GPS_JUMP_MIN_ELAPSED_SEC);

        const maxDeltaKm = GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSec;
        const dPk = Math.abs(pk - lastCoherentPk);

        if (dPk > maxDeltaKm) {
          pkJumpSuspect = true;
        }
      }

      if (pkJumpSuspect && !pkJumpGuardActiveRef.current && lastCoherentPk != null) {
        pkJumpGuardActiveRef.current = true;
        pkJumpGuardBasePkRef.current = lastCoherentPk;
        pkJumpGuardBaseTsRef.current = sampleTs;

        const dtSecSinceLast =
          lastCoherentTs > 0 ? Math.max(0, (sampleTs - lastCoherentTs) / 1000) : null;

        const maxDeltaKmSinceLast =
          dtSecSinceLast != null
            ? GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSecSinceLast
            : null;

        const dPkSinceLast = pk != null && lastCoherentPk != null ? Math.abs(pk - lastCoherentPk) : null;

        logTestEvent("gps:pk-jump-guard:enter", {
          lat: typeof (detail as any).lat === "number" ? (detail as any).lat : null,
          lon: typeof (detail as any).lon === "number" ? (detail as any).lon : null,
          accuracyM: typeof (detail as any).accuracy === "number" ? (detail as any).accuracy : null,
          distanceRibbonM: typeof (detail as any).distance_m === "number" ? (detail as any).distance_m : null,
          s_km: typeof (detail as any).s_km === "number" ? (detail as any).s_km : null,

          sampleTs,
          nowTs,
          ageSec,
          isStale,

          pkRaw: pkRaw ?? null,
          pkCandidate: pk,
          pkLastCoherent: lastCoherentPk,

          dtSecSinceLast,
          dPkSinceLast,
          maxDeltaKmSinceLast,
          minElapsedSec: GPS_JUMP_MIN_ELAPSED_SEC,

          onLine,
          hasGpsFix,
          referenceMode: referenceModeRef.current,
          autoScrollEnabled: autoScrollEnabledRef.current,

          baseToleranceKm: GPS_JUMP_BASE_TOLERANCE_KM,
          maxSpeedKmh: GPS_JUMP_MAX_SPEED_KMH,
        });
      }

      if (pkJumpGuardActiveRef.current) {
        const basePk = pkJumpGuardBasePkRef.current;
        const baseTs = pkJumpGuardBaseTsRef.current;

        if (pk != null && basePk != null && baseTs > 0) {
          const dtSecFromBase = Math.max(0, (sampleTs - baseTs) / 1000);
          const recoverMaxDeltaKm = GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSecFromBase;

          const dBase = Math.abs(pk - basePk);

          if (dBase <= recoverMaxDeltaKm) {
            pkJumpGuardActiveRef.current = false;
            pkJumpGuardBasePkRef.current = null;
            pkJumpGuardBaseTsRef.current = 0;

            lastCoherentPkRef.current = pk;
            lastCoherentTsRef.current = sampleTs;

            logTestEvent("gps:pk-jump-guard:exit", {
              pkRaw: pkRaw ?? null,
              pkAccepted: pk,
              basePk,
              dtSecFromBase,
              recoverMaxDeltaKm,
              ageSec,
              onLine,
              hasGpsFix,
            });
          } else {
            logTestEvent("gps:pk-jump-guard:reject", {
              pkRaw: pkRaw ?? null,
              pkRejected: typeof pk === "number" && Number.isFinite(pk) ? pk : null,

              basePk,
              baseTs,
              dtSecFromBase,
              recoverMaxDeltaKm,
              dBase,

              sampleTs,
              nowTs,
              ageSec,
              onLine,
              hasGpsFix,
              isStale,
              gpsState: gpsStateRef.current,
              referenceMode: referenceModeRef.current,
            });

            pk = null;
          }
        } else {
          pk = null;
        }
      }

      if (!pkJumpGuardActiveRef.current && hasGpsFix && onLine && !isStale && pk != null) {
        lastCoherentPkRef.current = pk;
        lastCoherentTsRef.current = sampleTs;
      }

      const prevGpsState = gpsStateRef.current;

      // ... (ton code GPS continue inchangé jusqu’au recalage horaire)

      // --- Suite : projection PK -> ligne FT + recalage horaire (inchangé dans l'esprit) ---
      if (pk != null) {
        const idx = findRowIndexFromPk(pk);
        if (idx != null) {
          const entry = rawEntries[idx];

          const currentRefMode = referenceModeRef.current;

          if (hasGpsFix && onLine && currentRefMode === "GPS") {
            setActiveRowIndex(idx);

            const lastIdx = lastAnchoredRowRef.current;
            const isNewAnchor = lastIdx == null || lastIdx !== idx;

            if (!isNewAnchor) {
              return;
            }

            lastAnchoredRowRef.current = idx;

            const departHoraText = resolveHoraForRowIndex(idx);
            const departMinutes = parseHoraToMinutes(departHoraText);

            let usedMinutes: number | null = departMinutes;
            let usedHoraText: string = departHoraText;
            let usedSource: "DEPART" | "ARRIVEE" = "DEPART";

            let arrivalMinutes: number | null = null;
            const arrivalList = arrivalEventsRef.current || [];
            const arrivalMatch = arrivalList.find((ev) => ev.rowIndex === idx);
            if (arrivalMatch && Number.isFinite(arrivalMatch.arrivalMin)) {
              arrivalMinutes = arrivalMatch.arrivalMin;
            }

            if (referenceModeRef.current === "GPS" && arrivalMinutes != null) {
              usedMinutes = arrivalMinutes;
              usedHoraText = formatMinutesToHora(arrivalMinutes);
              usedSource = "ARRIVEE";
            }

            if (usedMinutes != null) {
              recalibrateFromRowRef.current = idx;

              const now = new Date();
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              const nowTotalSec = nowMinutes * 60 + now.getSeconds();

              const usedTotalSec = usedMinutes * 60;
              const deltaSec = nowTotalSec - usedTotalSec;

              const fixedDelay = Math.round(deltaSec / 60);

              // ✅✅✅ CORRECTION : respecter le type (realMinInt/realMinFloat + deltaSec)
              autoScrollBaseRef.current = {
                realMinInt: nowMinutes,
                realMinFloat: nowMinutes + now.getSeconds() / 60,
                firstHoraMin: usedMinutes,
                fixedDelay,
                deltaSec,
              };

              const text =
                fixedDelay === 0 ? "0 min" : fixedDelay > 0 ? `+ ${fixedDelay} min` : `- ${-fixedDelay} min`;

              window.dispatchEvent(
                new CustomEvent("lim:schedule-delta", {
                  detail: {
                    text,
                    isLargeDelay: Math.abs(fixedDelay) >= 5,
                  },
                })
              );

              const nowHHMM =
                now.getHours().toString().padStart(2, "0") +
                ":" +
                now.getMinutes().toString().padStart(2, "0");

              console.log(
                "[FT][gps] Recalage horaire via GPS — source=",
                usedSource,
                "| used=",
                usedHoraText,
                "(",
                usedMinutes,
                "min ) / now=",
                nowHHMM,
                " => delta=",
                fixedDelay,
                "min (ligne index=",
                idx,
                ")"
              );

              logTestEvent("ft:delta:gps-recalage", {
                rowIndex: idx,
                nowHHMM,
                fixedDelay,
                pk: entry?.pk ?? null,
                dependencia: entry?.dependencia ?? null,

                usedSource,
                usedHora: usedHoraText,
                usedMinutes,

                departHora: departHoraText || null,
                departMinutes: departMinutes ?? null,
                arrivalMinutes,
              });
            }
          }
        }
      }
    };

    window.addEventListener("gps:position", handler as EventListener);
    return () => {
      window.removeEventListener("gps:position", handler as EventListener);
      if (orangeTimeoutRef.current !== null) {
        window.clearTimeout(orangeTimeoutRef.current);
        orangeTimeoutRef.current = null;
      }
      orangeTimeoutStartedAtRef.current = null;
    };
  }, [rawEntries, referenceMode, heuresDetectees]);

  const firstVisiblePk = useMemo(() => {
    const e = rawEntries.find((e) => !e.isNoteOnly && e.pk);
    return e?.pk ?? null;
  }, [rawEntries]);

  const seedSpeed = useMemo(
    () => computeSeedSpeed(firstVisiblePk, isOdd, FT_LIGNE_PAIR, FT_LIGNE_IMPAIR),
    [firstVisiblePk, isOdd]
  );

  const { speedMap, breakpointsArr } = useMemo(
    () => extractSpeedTimeline(rawEntries, seedSpeed),
    [rawEntries, seedSpeed]
  );

  const breakpointsSet = useMemo(() => new Set<string>(breakpointsArr), [breakpointsArr]);

  const firstPk = useMemo(() => {
    const e = rawEntries.find((e) => !e.isNoteOnly && e.pk);
    return e?.pk ?? null;
  }, [rawEntries]);

  const lastPk = useMemo(() => {
    for (let i = rawEntries.length - 1; i >= 0; i--) {
      const e = rawEntries[i];
      if (!e.isNoteOnly && e.pk) {
        return e.pk;
      }
    }
    return null;
  }, [rawEntries]);

  function isEligible(e: FTEntry): boolean {
    if ((e as any).isNoteOnly) return false;
    const s = (e.pk ?? "").toString().trim();
    const d = (e.dependencia ?? "").toString().trim();
    return s.length > 0 && d.length > 0;
  }

  const firstNonNoteIndex = useMemo(() => {
    for (let i = 0; i < rawEntries.length; i++) {
      if (!rawEntries[i]?.isNoteOnly) return i;
    }
    return -1;
  }, [rawEntries]);

  const lastNonNoteIndex = useMemo(() => {
    for (let i = rawEntries.length - 1; i >= 0; i--) {
      if (!rawEntries[i]?.isNoteOnly) return i;
    }
    return -1;
  }, [rawEntries]);

  function parseHoraToMinutes(h?: string | null): number | null {
    if (!h) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(h).trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  function formatMinutesToHora(totalMinutes: number): string {
    const minutesInDay = 24 * 60;
    let t = totalMinutes % minutesInDay;
    if (t < 0) t += minutesInDay;
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------------
  // Table horaire “théo” par index FT (source : heuresDetectees)
  // -> sert à l’affichage des heures + à l’autoscroll horaire
  // ------------------------------------------------------------------

  const horaTheoMinutesByIndex = useMemo(() => {
    const out = new Array<number | null>(rawEntries.length).fill(null);

    // indices “éligibles” = mêmes règles que ton resolveHoraForRowIndex()
    const eligibleIndices: number[] = [];
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if ((e as any)?.isNoteOnly) continue;

      const s = (e.pk ?? "").toString().trim();
      const d = (e.dependencia ?? "").toString().trim();
      if (s.length > 0 && d.length > 0) eligibleIndices.push(i);
    }

    // Mapping 1:1 : eligibleIndices[pos] <-> heuresDetectees[pos]
    const n = Math.min(eligibleIndices.length, heuresDetectees.length);
    for (let pos = 0; pos < n; pos++) {
      const idx = eligibleIndices[pos];
      const h = typeof heuresDetectees[pos] === "string" ? heuresDetectees[pos].trim() : "";
      const m = parseHoraToMinutes(h);
      out[idx] = m;
    }

    return out;
  }, [rawEntries, heuresDetectees]);

  const horaTheoSecondsByIndex = useMemo(() => {
    const out = new Array<number | null>(rawEntries.length).fill(null);

    const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

    const getPkNum = (idx: number): number | null => {
      const pkStr = (rawEntries[idx] as any)?.pk;
      const pkNum =
        typeof pkStr === "string" || typeof pkStr === "number" ? Number(pkStr) : NaN;
      return Number.isFinite(pkNum) ? pkNum : null;
    };

    const getVmaxForIndex = (idx: number): number | null => {
      const e = rawEntries[idx] as any;

      // 1) vmax direct dans l’entrée (si numérique)
      if (typeof e?.vmax === "number" && Number.isFinite(e.vmax) && e.vmax > 0) {
        return e.vmax;
      }

      // 2) vmax en string
      if (typeof e?.vmax === "string") {
        const v = Number(e.vmax.replace(",", "."));
        if (Number.isFinite(v) && v > 0) return v;
      }

      // 3) fallback via speedMap (indexé par pk)
      const pk = e?.pk;
      if (pk != null) {
        const s = (speedMap as any)?.[String(pk)];
        const v = typeof s?.v === "number" ? s.v : null;
        if (v != null && Number.isFinite(v) && v > 0) return v;
      }

      return null;
    };

    // --------
    // 1) Ancres horaires (départ) = même logique que ton horaTheoMinutesByIndex
    // --------
    const eligibleIndices: number[] = [];
    for (let i = 0; i < rawEntries.length; i++) {
      const e: any = rawEntries[i];
      if (e?.isNoteOnly) continue;

      const s = (e?.pk ?? "").toString().trim();
      const d = (e?.dependencia ?? "").toString().trim();
      if (s.length > 0 && d.length > 0) eligibleIndices.push(i);
    }

    const anchors: Array<{ idx: number; min: number }> = [];

    const n = Math.min(eligibleIndices.length, heuresDetectees.length);
    for (let pos = 0; pos < n; pos++) {
      const idx = eligibleIndices[pos];
      const h = typeof heuresDetectees[pos] === "string" ? heuresDetectees[pos].trim() : "";
      const m = parseHoraToMinutes(h);
      if (typeof m === "number" && Number.isFinite(m)) {
        anchors.push({ idx, min: m });
        out[idx] = m * 60; // ancre = exact
      }
    }

    if (anchors.length < 2) {
      return out;
    }

    // --------
    // 2) Interpolation pondérée par (dKm / vmax)
    // --------
    const minutesInDay = 24 * 60;

    for (let a = 0; a < anchors.length - 1; a++) {
      const A = anchors[a];
      const B = anchors[a + 1];

      const i0 = A.idx;
      const i1 = B.idx;
      if (i1 <= i0) continue;

      const A_min = A.min;
      let B_min = B.min;

      // wrap minuit si nécessaire (ex: 23:58 -> 00:02)
      if (B_min < A_min) B_min += minutesInDay;

      const deltaSec = (B_min - A_min) * 60;
      if (!(deltaSec > 0)) continue;

      type Seg = { idx: number; w: number; x: number };
      const segs: Seg[] = [];

      // on échantillonne les segments entre i0..i1 à partir des PK
      for (let i = i0; i < i1; i++) {
        const pkA = getPkNum(i);
        const pkB = getPkNum(i + 1);
        if (pkA == null || pkB == null) continue;

        const dKm = Math.abs(pkB - pkA);
        if (!(dKm > 0)) continue;

        const v = getVmaxForIndex(i) ?? getVmaxForIndex(i + 1);
        if (v == null) continue;

        // poids ~ temps = distance / vitesse
        const w = dKm / v;
        segs.push({ idx: i, w, x: 0 });
      }

      if (segs.length === 0) continue;

      const W = segs.reduce((acc, s) => acc + s.w, 0);
      if (!(W > 0)) continue;

      // cumul pondéré 0..1
      let cum = 0;
      for (let k = 0; k < segs.length; k++) {
        cum += segs[k].w;
        segs[k].x = clamp(cum / W, 0, 1);
      }

      // assigne à chaque “idx” (entre i0 et i1) un temps interpolé
      // On remplit uniquement si pas déjà ancré.
      const baseSec = A_min * 60;

      for (let i = i0 + 1; i < i1; i++) {
        if (out[i] != null) continue;

        // trouver la position x correspondante :
        // on repère le segment dont idx <= i < idx+1 puis on prend son x
        let x = null as number | null;
        for (let k = 0; k < segs.length; k++) {
          if (segs[k].idx >= i) {
            x = segs[k].x;
            break;
          }
        }
        if (x == null) x = segs[segs.length - 1].x;

        const sec = baseSec + x * deltaSec;
        out[i] = sec;
      }
    }

    return out;
  }, [rawEntries, heuresDetectees, speedMap, parseHoraToMinutes]);

  const { rows, arrivalEvents } = buildFtRows({
    rawEntries,
    isEligible,

    visibleRows,
    selectedRowIndex,
    setSelectedRowIndex,
    recalibrateFromRowRef,
    autoScrollEnabled,
    referenceModeRef,

    currentCsvSens,
    CSV_ZONES,

    heuresDetectees,
    codesCParHeure,

    firstNonNoteIndex,
    lastNonNoteIndex,
    parseHoraToMinutes,
    formatMinutesToHora,

    breakpointsSet,
    firstPk,
    lastPk,
    speedMap,

    testModeEnabled,
    horaTheoSecondsByIndex,
  });

  arrivalEventsRef.current = arrivalEvents;

  //
  // ===== 7. RENDU FINAL ==============================================
  //

  const handleBodyClick = () => {
    // clic hors ligne => on désélectionne (standby manuel)
    if (selectedRowIndex !== null) setSelectedRowIndex(null);

    // on supprime une éventuelle base "forcée" de recalage
    recalibrateFromRowRef.current = null;
  };

  return (
    <FTTableLayout
      variant={variant}
      effectiveFtView={effectiveFtView}
      referenceMode={referenceMode}
      gpsStateUi={gpsStateUi}
      trainPosYpx={trainPosYpx}
      activeRowIndex={typeof activeRowIndex === "number" ? activeRowIndex : 0}
      getFallbackTrainTopPx={getFallbackTrainTopPx}
      onScroll={handleScroll}
      onContainerRef={setContainerRef}
      onBodyClick={handleBodyClick}
      rows={rows}
    />
  );
}
