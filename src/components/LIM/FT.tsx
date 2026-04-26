// src/components/LIM/FT.tsx
import FTScrolling from "./FTScrolling"; // Ajouter cette ligne juste après les autres imports
import React, { useState, useEffect, useMemo } from "react";
import {
  getFtLignePair,
  getFtLigneImpair,
  CSV_ZONES,
} from "../../data/ligneFT.normalized.adapter";
import type { FTEntry, CsvSens } from "../../data/ligneFT";
import { logTestEvent } from "../../lib/testLogger";
import { getFtFranceHhmm } from "../../data/ftFranceTimes"

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
  const [visibleRows, setVisibleRows] = React.useState<{ first: number; last: number }>({
    first: 0,
    last: 0,
  });
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




  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollContainerRef.current = el;

    const scrollTop = el.scrollTop;

    const clientHeight = el.clientHeight;

    // --- Gestion scroll manuel vs scroll automatique ---
    if (autoScrollEnabled) {
      if (isProgrammaticScrollRef.current) {
        // Scroll provoqué par notre code (auto-scroll) → on ne déclenche pas le mode manuel
        isProgrammaticScrollRef.current = false;
        // On met à jour la position "officielle" de l'auto-scroll
        lastAutoScrollTopRef.current = scrollTop;
      } else {
        // Scroll manuel utilisateur pendant que le mode horaire est actif
        isManualScrollRef.current = true;

        // On relance un timer de 5s à chaque nouveau mouvement manuel
        if (manualScrollTimeoutRef.current !== null) {
          window.clearTimeout(manualScrollTimeoutRef.current);
        }

        manualScrollTimeoutRef.current = window.setTimeout(() => {
          manualScrollTimeoutRef.current = null;
          isManualScrollRef.current = false;

          const container = scrollContainerRef.current;
          if (!container) return;
          if (!autoScrollEnabledRef.current) return;

          const target = lastAutoScrollTopRef.current;
          if (target == null) return;

          // On revient à la position auto d'avant le scroll manuel
          isProgrammaticScrollRef.current = true;
          container.scrollTo({
            top: target,
            behavior: "auto",
          });
        }, 5000);
      }
    } else {
      // Mode horaire coupé → on désactive toute logique de retour auto
      isManualScrollRef.current = false;
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
        manualScrollTimeoutRef.current = null;
      }
    }

    // 1) on récupère les lignes principales
    const rowEls = el.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
    if (!rowEls.length) return;

    // 2) première ligne dont le bas est sous le haut du viewport
    let firstVisible = 0;
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i];
      const top = r.offsetTop;
      const bottom = top + r.offsetHeight;
      if (bottom >= scrollTop) {
        firstVisible = i;
        break;
      }
    }

    // 3) dernière ligne dont le haut est encore dans le viewport
    const viewportBottom = scrollTop + clientHeight;
    let lastVisible = firstVisible;
    for (let i = firstVisible; i < rowEls.length; i++) {
      const r = rowEls[i];
      const top = r.offsetTop;
      if (top <= viewportBottom) {
        lastVisible = i;
      } else {
        break;
      }
    }

    // 🔎 Debug : mapping "index dans rowEls" -> "data-ft-row"
    const firstDataAttr = rowEls[firstVisible]?.getAttribute("data-ft-row") ?? "";
    const lastDataAttr = rowEls[lastVisible]?.getAttribute("data-ft-row") ?? "";
    const firstDataRow = firstDataAttr ? parseInt(firstDataAttr, 10) : null;
    const lastDataRow = lastDataAttr ? parseInt(lastDataAttr, 10) : null;

    console.log(
      "[FT][scroll] scrollTop=",
      scrollTop,
      " / clientHeight=",
      clientHeight,
      " / rows=",
      rowEls.length
    );
    console.log("[FT][visible-rows] first=", firstVisible, "last=", lastVisible);

    // 🔎 Debug renforcé : on affiche aussi les attributs bruts pour diagnostiquer
    console.log(
      "[FT][VISIBLE_ROWS_DATA_ROW]",
      "firstVisible=",
      firstVisible,
      "lastVisible=",
      lastVisible,
      "| firstAttr=",
      firstDataAttr,
      "lastAttr=",
      lastDataAttr,
      "| firstDataRow=",
      firstDataRow,
      "lastDataRow=",
      lastDataRow
    );

    // log labo
    logTestEvent("ft:scroll:viewport", {
      scrollTop,
      clientHeight,
      rowCount: rowEls.length,
      firstVisible,
      lastVisible,

      // indices "réels" côté data
      firstDataRow,
      lastDataRow,

      autoScrollEnabled,
      referenceMode: referenceModeRef.current,
      isManualScroll: isManualScrollRef.current,
      isProgrammaticScroll: isProgrammaticScrollRef.current,
    });

    // on met à jour le state : ✅ indices "réels" (data-ft-row) si disponibles
    const nextFirst =
      typeof firstDataRow === "number" && Number.isFinite(firstDataRow)
        ? firstDataRow
        : firstVisible;

    const nextLast =
      typeof lastDataRow === "number" && Number.isFinite(lastDataRow)
        ? lastDataRow
        : lastVisible;

    setVisibleRows({ first: nextFirst, last: nextLast });
  };



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
      const mode = ce?.detail?.mode;
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
  const arrivalEventsRef = React.useRef<
    { arrivalMin: number; rowIndex: number }[]
  >([]);

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

    window.addEventListener(
      "lim:train-change",
      handlerTrainChange as EventListener
    );
    window.addEventListener("lim:train", handlerTrain as EventListener);

    return () => {
      window.removeEventListener(
        "lim:train-change",
        handlerTrainChange as EventListener
      );
      window.removeEventListener("lim:train", handlerTrain as EventListener);
    };
  }, []);

  // -- écoute des infos LIM complètes pour récupérer origenDestino (origine → destination)
  useEffect(() => {
    function handlerLimParsed(e: any) {
      const d = e?.detail || {};
      const odRaw = d.origenDestino ?? d.relation ?? "";
      if (typeof odRaw === "string" && odRaw.trim().length > 0) {
        // ex: "Barcelona Sants - Can Tunis AV"
        // ex: "Figueres-Vilafant - Limite ADIF - LFPSA"
        //
        // stratégie :
        // - split UNIQUEMENT sur les séparateurs avec espaces (" - " ou " – ")
        //   pour ne pas casser des noms comme "Figueres-Vilafant"
        // - origine = 1er segment
        // - destination = tout le reste re-joint avec " - "
        const parts = odRaw
          .split(/\s+[-–]\s+/)
          .map((s: string) => s.trim())
          .filter(Boolean);

        if (parts.length >= 2) {
          const start = parts[0];
          const end = parts.slice(1).join(" - ");
          console.log(
            "[FT] lim:parsed origenDestino=",
            odRaw,
            "=>",
            start,
            "→",
            end
          );
          setRouteStart(start);
          setRouteEnd(end);
        } else {
          console.warn("[FT] origenDestino non découpable:", odRaw);
        }
      }
    }

    window.addEventListener("lim:parsed", handlerLimParsed as EventListener);
    return () => {
      window.removeEventListener(
        "lim:parsed",
        handlerLimParsed as EventListener
      );
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

      // Log simple pour validation (aucune modif du tableau à ce stade)
      console.log("[FT] Reçu ft:heures — total=", heures.length, heures);
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
      const flat: string[] = Array.isArray((detail as any).flat)
        ? (detail as any).flat
        : [];
      const byPage: any[] = Array.isArray((detail as any).byPage)
        ? (detail as any).byPage
        : [];

      // ➜ Met à jour l'état centralisé pour un usage futur (mapping, affichage)
      setCodesCFlat(flat);

      // Logs de contrôle (on garde un aperçu par page)
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

    window.addEventListener(
      "ft:codesC:resolved",
      handlerFtCodesCResolved as EventListener
    );
    return () => {
      window.removeEventListener(
        "ft:codesC:resolved",
        handlerFtCodesCResolved as EventListener
      );
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

    window.addEventListener(
      "ft:conc:resolved",
      handlerFtConcResolved as EventListener
    );
    return () => {
      window.removeEventListener(
        "ft:conc:resolved",
        handlerFtConcResolved as EventListener
      );
    };
  }, []);

  // -- écoute du bouton play/pause (auto-scroll) venant du TitleBar
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const autoScrollEnabledRef = React.useRef(false);
  const referenceModeRef = React.useRef<ReferenceMode>("HORAIRE");

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

if (referenceMode === "GPS") {
  window.dispatchEvent(
    new CustomEvent("lim:hourly-mode", {
      detail: { enabled: autoScrollEnabledRef.current, standby: false },
    })
  );

  logTestEvent("ft:standby:visual-clear", {
    reason: "reference_mode_gps",
    autoScrollEnabled: autoScrollEnabledRef.current,
  });
}
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


  const autoScrollBaseRef =
    React.useRef<{
      realMinInt: number       // minutes entières — pour updateFromClock (ligne active)
      realMinFloat: number     // minutes + secondes — pour interpolation continue (barre rouge)
      firstHoraMin: number
      fixedDelay: number       // minutes (arrondi, pour l'affichage actuel)
      deltaSec: number         // secondes (signé, exact au moment du Play)
    } | null>(null);

  const lastDeltaRecalageRef = React.useRef<{
    rowIndex: number;
    source: "MANUAL" | "GPS";
    ts: number;
  } | null>(null);

  // Ligne cible pour un recalage manuel (mode Standby)
  const recalibrateFromRowRef = React.useRef<number | null>(null);
  // ✅ Verrou dédié : ligne qui a réellement déclenché l'entrée en standby
  const standbyLockedRowRef = React.useRef<number | null>(null);
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

  // Référence vers le conteneur scrollable de FTScrolling
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Position verticale "continue" du train (px dans le viewport scrollable)
  const [trainPosYpx, setTrainPosYpx] = useState<number | null>(null);



  // --- Continuité ORANGE -> RED (ancrage visuel) + anti-retour arrière en RED ---
  const lastTrainPosYpxRef = React.useRef<number | null>(null);
  const prevGpsStateUiRef = React.useRef<GpsStateUi>("RED");

  // Pendant RED : on applique un offset à l'horaire pour partir exactement du Y courant
  const redHoraireAnchorRef = React.useRef<{
    anchorY: number;        // Y affiché au moment de l'entrée en RED
    baseHoraireY: number;   // Y horaire calculé au même instant
    offsetY: number;        // anchorY - baseHoraireY
  } | null>(null);

  useEffect(() => {
    const TICK_MS = 250;

    const parsePkFromRow = (tr: HTMLTableRowElement): number | null => {
      // Sit Km = 3e colonne
      const td = tr.querySelector<HTMLTableCellElement>("td:nth-child(3)");
      const txt = td?.textContent?.trim() ?? "";
      const n = Number(txt.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    const rowCenterY = (container: HTMLDivElement, tr: HTMLTableRowElement): number => {
      const VISUAL_OFFSET_PX = -2;
      return tr.offsetTop + tr.offsetHeight / 2 - container.scrollTop + VISUAL_OFFSET_PX;
    };

    const clampInViewportOrKeep = (y: number, h: number): number | null => {
      // Si hors viewport, on ne force pas à 0 (on garde la dernière valeur)
      if (y < 0 || y > h) return null;
      return y;
    };

    const commitTrainPos = (yCandidate: number | null) => {
      if (yCandidate == null) return;

      const yRounded = Math.round(yCandidate);
      const gpsStateNow = gpsStateUi;

      setTrainPosYpx((prev) => {
        let next = yRounded;

        // ✅ En RED : jamais de retour arrière (monotone)
        if (gpsStateNow === "RED" && prev != null) {
          next = Math.max(prev, next);
        }

        lastTrainPosYpxRef.current = next;
        return next;
      });
    };

    const tick = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const h = container.clientHeight;

      // -------------------------
      // Détection entrée/sortie RED (ancrage)
      // -------------------------
      const gpsStateNow = gpsStateUi;
      const prevGpsState = prevGpsStateUiRef.current;

      if (prevGpsState !== gpsStateNow) {
        // Entrée en RED : on prépare l'ancrage (offset calculé au premier y horaire disponible)
        if (gpsStateNow === "RED") {
          const anchorY = lastTrainPosYpxRef.current;
          if (anchorY != null) {
            // baseHoraireY sera fixé dès qu'on calcule l'horaire (ci-dessous)
            redHoraireAnchorRef.current = {
              anchorY,
              baseHoraireY: anchorY,
              offsetY: 0,
            };
          } else {
            // pas de Y précédent connu : on initialisera dès qu'on a un y horaire
            redHoraireAnchorRef.current = null;
          }
        } else {
          // Sortie de RED : on supprime l'offset
          redHoraireAnchorRef.current = null;
        }

        prevGpsStateUiRef.current = gpsStateNow;
      }

      // =========================
// 1) GPS : interpolation PK (DOM) — basé sur un PK fictif continu (ADIF→LFP→RFN)
      // =========================
      if (referenceModeRef.current === "GPS") {
        const pkRaw = lastGpsPositionRef.current?.pk;
        const pkTrain =
          typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

        if (pkTrain != null) {
          // ========= PK -> U (coordonnée unifiée monotone le long du trajet) =========
          const ADIF_LFP_ADIF = 752.4;
          const ADIF_LFP_LFP = 44.4;

          const LFP_RFN_LFP = 0.0;
          const LFP_RFN_RFN = 473.3;

          const guessNetFromPk = (pk: number): "ADIF" | "LFP" | "RFN" => {
            if (pk >= 600) return "ADIF";
            if (pk >= 200) return "RFN";
            return "LFP";
          };

          const pkToU = (pk: number, net: "ADIF" | "LFP" | "RFN"): number => {
            if (net === "ADIF") return pk;

            const uAtAdifLfp = ADIF_LFP_ADIF;
            if (net === "LFP") {
              // LFP décroît quand on avance : U augmente avec (44.4 - pk)
              return uAtAdifLfp + (ADIF_LFP_LFP - pk);
            }

            // RFN : on repart de U au point LFP=0 (= 752.4 + 44.4)
            const uAtLfpRfn = uAtAdifLfp + (ADIF_LFP_LFP - LFP_RFN_LFP);
            return uAtLfpRfn + (LFP_RFN_RFN - pk);
          };

          const parsePk = (v: any): number | null => {
            if (v == null) return null;
            const s = String(v).trim().replace(",", ".");
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
          };

          const getRowU = (entry: any): number | null => {
            if (!entry || entry.isNoteOnly) return null;

            const net =
              ((entry as any).network as ("ADIF" | "LFP" | "RFN" | null | undefined)) ?? null;

            // ✅ Choix du bon PK selon le réseau (évite de prendre le "pk fictif" quand on est en LFP/RFN)
            let pkCandidate: number | null = null;

            if (net === "LFP") {
              pkCandidate = parsePk((entry as any).pk_lfp ?? (entry as any).pk);
            } else if (net === "RFN") {
              pkCandidate = parsePk((entry as any).pk_rfn ?? (entry as any).pk);
            } else if (net === "ADIF") {
              pkCandidate = parsePk((entry as any).pk_adif ?? (entry as any).pk);
            } else {
              // fallback : on tente les champs réseau, puis pk
              pkCandidate =
                parsePk((entry as any).pk_adif) ??
                parsePk((entry as any).pk_lfp) ??
                parsePk((entry as any).pk_rfn) ??
                parsePk((entry as any).pk);
            }

            if (pkCandidate == null) return null;

            const netRow =
              net === "ADIF" || net === "LFP" || net === "RFN"
                ? net
                : guessNetFromPk(pkCandidate);

            return pkToU(pkCandidate, netRow);
          };

          // GPS -> U
          const netGps = guessNetFromPk(pkTrain);
          const targetU = pkToU(pkTrain, netGps);

          const rows = Array.from(
            container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main")
          );

          const pts: { u: number; y: number }[] = [];

          for (const tr of rows) {
            // On prend le rowIndex réel (lié à rawEntries) au lieu du texte PK du DOM
            const idxStr = tr.getAttribute("data-ft-row");
            const idx = idxStr != null ? Number(idxStr) : NaN;
            if (!Number.isFinite(idx)) continue;

            const u = getRowU(rawEntries[idx] as any);
            if (u == null) continue;

            const VISUAL_OFFSET_PX = -2;
            const y =
              tr.offsetTop + tr.offsetHeight / 2 - container.scrollTop + VISUAL_OFFSET_PX;
            if (y < 0 || y > h) continue;

            pts.push({ u, y });
          }

          if (pts.length >= 2) {
            pts.sort((a, b) => a.u - b.u);

            // Clamp sur les bords visibles (évite le “ligne par ligne”)
            if (targetU <= pts[0].u) {
              commitTrainPos(pts[0].y);
              return;
            }
            if (targetU >= pts[pts.length - 1].u) {
              commitTrainPos(pts[pts.length - 1].y);
              return;
            }

            let a = pts[0];
            let b = pts[pts.length - 1];

            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i];
              const p1 = pts[i + 1];
              if (targetU >= p0.u && targetU <= p1.u) {
                a = p0;
                b = p1;
                break;
              }
            }

            if (b.u !== a.u) {
              let t = (targetU - a.u) / (b.u - a.u);
              if (t < 0) t = 0;
              if (t > 1) t = 1;

              const y = a.y + t * (b.y - a.y);
              commitTrainPos(y);
              return;
            } else {
              commitTrainPos(a.y);
              return;
            }
          }
        }
      }

      // =========================================
      // 2) HORAIRE : interpolation temps (DOM)
     // =========================================
      if (referenceModeRef.current === "HORAIRE" && autoScrollEnabledRef.current) {
        const base = autoScrollBaseRef.current;
        if (base) {
          // heure "effective" à la seconde (minutes float)
          const now = new Date();
          const nowMinFloat =
            now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

          const effectiveMinFloat =
            base.firstHoraMin + (nowMinFloat - (base.realMinFloat ?? base.realMinInt));

          const rows = Array.from(
            container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main")
          );

          const parseMinutesFromRow = (tr: HTMLTableRowElement): number | null => {
            // ✅ Source de vérité principale : horaire théorique interne du moteur
            const dataIndexAttr = tr.getAttribute("data-ft-row");
            const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : NaN;

            if (Number.isFinite(dataIndex)) {
              const theoMin = horaTheoMinutesByIndex[dataIndex];
              if (typeof theoMin === "number" && Number.isFinite(theoMin)) {
                return theoMin;
              }
            }

            // ✅ Fallback DOM (au cas où une ligne n'aurait pas d'heure théorique exploitable)
            const tdHora = tr.querySelector<HTMLTableCellElement>("td:nth-child(6)");

            const dep = tr.querySelector<HTMLSpanElement>(
              "td:nth-child(6) .ft-hora-depart"
            );
            const theo = tr.querySelector<HTMLSpanElement>(
              "td:nth-child(6) .ft-hora-theo"
            );

            let txt = ((dep?.textContent ?? theo?.textContent) ?? "").trim();

            if (!txt) {
              const raw = (tdHora?.textContent ?? "").trim();
              const mAny = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
              if (mAny) txt = mAny[0];
            }

            const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(txt);
            if (!m) return null;

            const hh = Number(m[1]);
            const mm = Number(m[2]);
            const ss = m[3] != null ? Number(m[3]) : 0;

            if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) {
              return null;
            }

            return hh * 60 + mm + ss / 60;
          };

          const pts: { m: number; y: number }[] = [];
          for (const tr of rows) {
            const m = parseMinutesFromRow(tr);
            if (m == null) continue;

            const VISUAL_OFFSET_PX = -2;
            const y =
              tr.offsetTop + tr.offsetHeight / 2 - container.scrollTop + VISUAL_OFFSET_PX;

            // ✅ On garde toutes les lignes DOM, même hors viewport.
            // On bornera seulement le Y final au moment du commit.
            pts.push({ m, y });
          }

          if (pts.length >= 2) {
            pts.sort((a, b) => a.m - b.m);

            // Clamp temporel sur les bornes connues
            if (effectiveMinFloat <= pts[0].m) {
              const yHoraireRaw = Math.max(0, Math.min(pts[0].y, h));

              let yFinal = yHoraireRaw;

              if (gpsStateUi === "RED") {
                const lastY = lastTrainPosYpxRef.current;

                if (redHoraireAnchorRef.current == null && lastY != null) {
                  redHoraireAnchorRef.current = {
                    anchorY: lastY,
                    baseHoraireY: yHoraireRaw,
                    offsetY: lastY - yHoraireRaw,
                  };
                }

                if (redHoraireAnchorRef.current != null) {
                  yFinal = yHoraireRaw + redHoraireAnchorRef.current.offsetY;
                }
              }

              commitTrainPos(Math.max(0, Math.min(yFinal, h)));
              return;
            }

            if (effectiveMinFloat >= pts[pts.length - 1].m) {
              const yHoraireRaw = Math.max(0, Math.min(pts[pts.length - 1].y, h));

              let yFinal = yHoraireRaw;

              if (gpsStateUi === "RED") {
                const lastY = lastTrainPosYpxRef.current;

                if (redHoraireAnchorRef.current == null && lastY != null) {
                  redHoraireAnchorRef.current = {
                    anchorY: lastY,
                    baseHoraireY: yHoraireRaw,
                    offsetY: lastY - yHoraireRaw,
                  };
                }

                if (redHoraireAnchorRef.current != null) {
                  yFinal = yHoraireRaw + redHoraireAnchorRef.current.offsetY;
                }
              }

              commitTrainPos(Math.max(0, Math.min(yFinal, h)));
              return;
            }

            let a = pts[0];
            let b = pts[pts.length - 1];

            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i];
              const p1 = pts[i + 1];
              if (effectiveMinFloat >= p0.m && effectiveMinFloat <= p1.m) {
                a = p0;
                b = p1;
                break;
              }
            }

            if (b.m !== a.m) {
              let t = (effectiveMinFloat - a.m) / (b.m - a.m);
              if (t < 0) t = 0;
              if (t > 1) t = 1;

              const yHoraireRaw = a.y + t * (b.y - a.y);

              let yFinal = yHoraireRaw;

              if (gpsStateUi === "RED") {
                const lastY = lastTrainPosYpxRef.current;

                if (redHoraireAnchorRef.current == null && lastY != null) {
                  redHoraireAnchorRef.current = {
                    anchorY: lastY,
                    baseHoraireY: yHoraireRaw,
                    offsetY: lastY - yHoraireRaw,
                  };
                }

                if (redHoraireAnchorRef.current != null) {
                  if (redHoraireAnchorRef.current.offsetY === 0 && lastY != null) {
                    redHoraireAnchorRef.current.baseHoraireY = yHoraireRaw;
                    redHoraireAnchorRef.current.offsetY =
                      redHoraireAnchorRef.current.anchorY - yHoraireRaw;
                  }

                  yFinal = yHoraireRaw + redHoraireAnchorRef.current.offsetY;
                }
              }

              commitTrainPos(Math.max(0, Math.min(yFinal, h)));
              return;
            } else {
              const yHoraireRaw = a.y;

              let yFinal = yHoraireRaw;

              if (gpsStateUi === "RED") {
                const lastY = lastTrainPosYpxRef.current;

                if (redHoraireAnchorRef.current == null && lastY != null) {
                  redHoraireAnchorRef.current = {
                    anchorY: lastY,
                    baseHoraireY: yHoraireRaw,
                    offsetY: lastY - yHoraireRaw,
                  };
                }

                if (redHoraireAnchorRef.current != null) {
                  yFinal = yHoraireRaw + redHoraireAnchorRef.current.offsetY;
                }
              }

              commitTrainPos(Math.max(0, Math.min(yFinal, h)));
              return;
            }
          }
        }
      }

      // =========================
      // 3) fallback : ligne active
      // =========================
      const tr = container.querySelector<HTMLTableRowElement>(
        `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
      );
      if (!tr) return;

      const VISUAL_OFFSET_PX = -2;
      const y = tr.offsetTop + tr.offsetHeight / 2 - container.scrollTop + VISUAL_OFFSET_PX;

      // ✅ Au lieu de geler : on borne dans le viewport
      const clamped = Math.max(0, Math.min(y, h));
      commitTrainPos(clamped);
    };

    tick();

    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [activeRowIndex, gpsStateUi]);




  

  // Dernière position GPS reçue (mémorisée pour les futurs calculs)
  const lastGpsPositionRef = React.useRef<GpsPosition | null>(null);
  // ===== DEBUG: suivre la vraie "ligne active" utilisée par le scroll =====
  useEffect(() => {
    const w = window as any;
    if (!Array.isArray(w.__ftActiveTrace)) w.__ftActiveTrace = [];

    w.__ftActiveTrace.push({
      at: Date.now(),
      activeRowIndex,
      selectedRowIndex,
      referenceMode: referenceModeRef.current,
      autoScrollEnabled: autoScrollEnabledRef.current,
      gpsStateUi,
    });

    if (w.__ftActiveTrace.length > 80) {
      w.__ftActiveTrace.splice(0, w.__ftActiveTrace.length - 80);
    }
  }, [activeRowIndex]);

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

      // timestamp de référence du dernier échantillon connu
      const sampleTs =
        lastGpsSampleAtRef.current > 0
          ? lastGpsSampleAtRef.current
          : typeof (last as any).timestamp === "number"
          ? (last as any).timestamp
          : 0;

      if (!sampleTs) return;

      const hasGpsFix =
        typeof (last as any).lat === "number" &&
        typeof (last as any).lon === "number";

      const onLine = !!(last as any).onLine;

      const ageSec = Math.max(0, (nowTs - sampleTs) / 1000);
      const isStale = ageSec > GPS_FRESH_SEC;

      const pkRaw = (last as any).pk as number | null | undefined;
      const pkFinite =
        typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

      const accuracyM =
        typeof (last as any).accuracy === "number" &&
        Number.isFinite((last as any).accuracy)
          ? (last as any).accuracy
          : null;

      const hasAcceptableAccuracy =
        accuracyM == null || accuracyM <= GPS_MAX_ACCURACY_M;

      const pkFreezeElapsedMs =
        hasGpsFix &&
        onLine &&
        pkFinite != null &&
        lastPkChangeAtRef.current > 0
          ? nowTs - lastPkChangeAtRef.current
          : 0;

      const pkFrozenOrange = pkFreezeElapsedMs >= GPS_FREEZE_WINDOW_MS;
      const pkFrozenRed = pkFreezeElapsedMs >= GPS_FREEZE_TO_RED_MS;

      // si le garde-fou "saut de PK" est actif, on reste en RED
      const pkIncoherentNow = pkJumpGuardActiveRef.current === true;

      const hasUsablePk = pkFinite != null;

      const reasonCodes: string[] = [];
      if (!hasGpsFix) reasonCodes.push("no_fix");
      if (hasGpsFix && !onLine) reasonCodes.push("off_line");
      if (hasGpsFix && onLine && isStale) reasonCodes.push("stale_fix");
      if (hasGpsFix && onLine && !isStale && !hasUsablePk) {
        reasonCodes.push("no_usable_pk");
      }
      if (hasGpsFix && onLine && !isStale && !hasAcceptableAccuracy) {
        reasonCodes.push("poor_accuracy");
      }
      if (pkIncoherentNow) reasonCodes.push("pk_jump_guard");
      if (pkFrozenRed) reasonCodes.push("pk_frozen_red");
      else if (pkFrozenOrange) reasonCodes.push("pk_frozen_orange");
      reasonCodes.push("watchdog");

      // -------------------------
      // 1) Calcul état de base
      // -------------------------
      let nextState: GpsState = "RED";

      if (!hasGpsFix) {
        nextState = "RED";
      } else if (pkFrozenRed) {
        nextState = "RED";
      } else if (
        pkIncoherentNow ||
        !onLine ||
        isStale ||
        pkFrozenOrange ||
        !hasUsablePk ||
        !hasAcceptableAccuracy
      ) {
        nextState = "ORANGE";
      } else {
        nextState = "GREEN";
      }

      // -------------------------
      // 2) ORANGE -> RED global (chrono)
      // -------------------------
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

            // reset chrono pour éviter de refire en boucle
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

      // -------------------------
      // 3) Emission vers TitleBar (throttle)
      // -------------------------
      const emitGpsState = (forced: boolean) => {
        const pkForUi = nextState === "GREEN" ? pkFinite : null;

        const lastEmitAt = lastGpsStateEmitAtRef.current;
        const lastEmitPk = lastGpsStateEmitPkRef.current;

        const pkChanged =
          pkForUi != null &&
          (lastEmitPk == null || Math.abs(pkForUi - lastEmitPk) >= 0.05);

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

      // -------------------------
      // 4) Règle HORAIRE/GPS même sans events GPS
      // -------------------------
      const stateNow = gpsStateRef.current;
      const currentMode = referenceModeRef.current;

      // ✅ Règle demandée :
      // - GREEN => GPS
      // - ORANGE/RED => HORAIRE
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
  const GPS_MAX_ACCURACY_M = 300; // précision > 300 m => ORANGE
  const GPS_FREEZE_WINDOW_MS = 10_000; // PK inchangé trop longtemps -> ORANGE
  const GPS_FREEZE_PK_DELTA_KM = 0.02; // 0.02 km = 20 m

  const ORANGE_TIMEOUT_MS = 20_000; // 20s après ORANGE
  // PK figé : ORANGE à 10s, puis RED à 30s (10s + 20s)
  const GPS_FREEZE_TO_RED_MS = GPS_FREEZE_WINDOW_MS + ORANGE_TIMEOUT_MS;

  // Si le PK figé est proche (<= 1 km) d’une gare commerciale => standby auto
  const STATION_PROX_KM = 1.0;

  // État "GPS OK" (fix + sur la ligne) pour l'hystérésis
  const gpsHealthyRef = React.useRef<boolean>(false);

  // ===== Garde-fou "saut de PK" (PK incohérent) =====
  // Dernier PK jugé "cohérent" (référence pour détecter un saut)
  const lastCoherentPkRef = React.useRef<number | null>(null);
  const lastCoherentTsRef = React.useRef<number>(0);

  // Quand un saut est détecté, on active une phase ORANGE et on ignore le PK
  // jusqu’à ce qu’on retrouve un PK cohérent par rapport au PK de référence.
  const pkJumpGuardActiveRef = React.useRef<boolean>(false);
  const pkJumpGuardBasePkRef = React.useRef<number | null>(null);
  const pkJumpGuardBaseTsRef = React.useRef<number>(0);

  // Tolérances (généreuses) pour ne bloquer que les gros sauts non physiques
  const GPS_JUMP_BASE_TOLERANCE_KM = 0.8; // tolérance fixe (km)
  const GPS_JUMP_MAX_SPEED_KMH = 420; // plafond vitesse plausible (km/h) pour tolérance dynamique
  const GPS_JUMP_MIN_ELAPSED_SEC = 1.0; // ignore la détection si delta t trop faible

  // ===== Cohérence sens attendu (train) vs sens observé GPS =====
  const DIR_MIN_DELTA_KM = 0.02; // ignore les micro-variations (<20 m)
  const DIR_WINDOW_MS = 15_000; // fenêtre glissante
  const DIR_MIN_SAMPLES = 6; // nombre minimal d'échantillons qualifiés
  const DIR_MISMATCH_MIN_RATIO = 0.8; // % d'échantillons en sens opposé pour alerter
  const DIR_MISMATCH_COOLDOWN_MS = 30_000; // anti-spam

  // Timer en cours pour le passage différé en mode HORAIRE
  const orangeTimeoutRef = React.useRef<number | null>(null);


  // Timestamp de démarrage de l’hystérésis ORANGE (pour calcul remaining/elapsed)
  const orangeTimeoutStartedAtRef = React.useRef<number | null>(null);

  // ✅ ORANGE -> RED (général) : si on reste ORANGE trop longtemps (quelque soit la cause)
const orangeToRedTimerRef = React.useRef<number | null>(null);
const orangeToRedStartedAtRef = React.useRef<number | null>(null);
  // ===== DEBUG GPS (pour throttler les logs) =====
  const gpsDebugRef = React.useRef<{
    lastLogTs: number;
    lastNet: any;
    lastAcceptedMode: any;
    lastPkRaw: number | null;
  }>({
    lastLogTs: 0,
    lastNet: null,
    lastAcceptedMode: null,
    lastPkRaw: null,
  });

  // Suivi du scroll manuel pendant que le mode horaire est actif
  const isManualScrollRef = React.useRef(false);
  const manualScrollTimeoutRef = React.useRef<number | null>(null);
  const lastAutoScrollTopRef = React.useRef<number | null>(null);
  const isProgrammaticScrollRef = React.useRef(false);
  const forceRealignOnResumeRef = React.useRef(false);

  useEffect(() => {
      // ===== GARDE-FOU "SAUT DE PK" =====
      // Objectif : si un saut énorme arrive, on ne pilote plus la FT avec ce PK.
      // On force ORANGE et on attend de retrouver une cohérence.
      const speedKmPerSec = GPS_JUMP_MAX_SPEED_KMH / 3600;

      const lastCoherentPk = lastCoherentPkRef.current;    function handlerAutoScroll(e: any) {
      const detail = e?.detail ?? {};
      const enabled = !!detail.enabled;
      const standby = !!detail.standby;

      // 🎯 Cas spécial : 1er clic sur Play -> Standby initial + sélection 1ʳᵉ ligne
      if (enabled && standby && !initialStandbyDoneRef.current) {
        const idx = firstNonNoteIndexRef.current;
        if (typeof idx === "number" && idx >= 0) {
          initialStandbyDoneRef.current = true;

          console.log(
            "[FT] Premier Play reçu, passage en Standby initial sur la ligne",
            idx
          );

          // Sélection visuelle (cadre rouge)
          setSelectedRowIndex(idx);
          // Base de recalage pour le futur démarrage réel
          recalibrateFromRowRef.current = idx;
          // ✅ On verrouille aussi explicitement la ligne de standby
          standbyLockedRowRef.current = idx;

          // Standby initial : l'autoscroll reste engagé, mais en pause sur la première ligne
setAutoScrollEnabled(true);

          // On signale à la TitleBar qu'on est en mode horaire Standby (🕑 orange)
          window.dispatchEvent(
            new CustomEvent("lim:hourly-mode", {
detail: { enabled: true, standby: true },
            })
          );

          return;
        }
      }

      // ✅ Reprise explicite depuis le bouton Play :
      // - on repart de la ligne verrouillée si elle existe
      // - on enlève le clignotement rouge
      // - on relance l'auto-scroll
      if (enabled && !standby) {
        const resumeRowIndex =
          standbyLockedRowRef.current != null &&
          Number.isFinite(standbyLockedRowRef.current)
            ? standbyLockedRowRef.current
            : recalibrateFromRowRef.current != null &&
              Number.isFinite(recalibrateFromRowRef.current)
            ? recalibrateFromRowRef.current
            : null;

        if (resumeRowIndex != null) {
          logTestEvent("ui:standby:resume", {
            rowIndex: resumeRowIndex,
            hora: resolveHoraForRowIndex(resumeRowIndex) || null,
            pk: rawEntries[resumeRowIndex]?.pk ?? null,
            dependencia: rawEntries[resumeRowIndex]?.dependencia ?? null,
            source: "ft:auto-scroll-change",
          });

          recalibrateFromRowRef.current = resumeRowIndex;
          setActiveRowIndex(resumeRowIndex);
          setSelectedRowIndex(null);
          forceRealignOnResumeRef.current = true;
          standbyLockedRowRef.current = null;
        }
      }

      console.log(
        "[FT] ft:auto-scroll-change reçu, enabled =",
        enabled,
        "/ standby =",
        standby
      );

      // 👉 Le bouton Play/Pause ne pilote QUE l'auto-scroll, pas le mode de référence
      setAutoScrollEnabled(enabled);

      // On informe la TitleBar de l'état horaire / standby
      window.dispatchEvent(
        new CustomEvent("lim:hourly-mode", {
          detail: { enabled, standby },
        })
      );
    }

    window.addEventListener(
      "ft:auto-scroll-change",
      handlerAutoScroll as EventListener
    );

    return () => {
      window.removeEventListener(
        "ft:auto-scroll-change",
        handlerAutoScroll as EventListener
      );
    };
  }, []);

    // ✅ Replay / Simulation : sélection et recalage "déterministes" sans clic DOM
  // Le player peut injecter : window.dispatchEvent(new CustomEvent("ft:standby:set", { detail: { rowIndex } }))
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const d = ce?.detail ?? {};

      const raw = d.rowIndex;
      const rowIndex =
        typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);

      if (!Number.isFinite(rowIndex)) return;

      // Sélection visuelle + base de recalage (comme un clic sur la ligne)
      setSelectedRowIndex(rowIndex);
      recalibrateFromRowRef.current = rowIndex;
    };

    window.addEventListener("ft:standby:set", handler as EventListener);
    return () => {
      window.removeEventListener("ft:standby:set", handler as EventListener);
    };
  }, []);


  // quand le mode auto-scroll (play) s'allume/s'éteint
  useEffect(() => {
    if (!autoScrollEnabled) {
      // on NE TOUCHE PLUS au delta horaire :
      // - on garde la dernière valeur affichée dans la TitleBar
      // - la base interne est simplement réinitialisée
      autoScrollBaseRef.current = null;

      // On désactive tout éventuel scroll manuel en cours
      isManualScrollRef.current = false;
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
        manualScrollTimeoutRef.current = null;
      }
      return;
    }

    // helpers
    const toMinutes = (s: string) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return NaN;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const minutesToHHMM = (mins: number) => {
      // on replie sur 24h si besoin
      const total = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
      const hh = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
      const mm = (total % 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };

    // ➜ nouvel helper : delta arrondi à la minute la plus proche
const computeFixedDelay = (now: Date, ftMinutes: number) => {
  const nowTotalSec =
    now.getHours() * 3600 +
    now.getMinutes() * 60 +
    now.getSeconds()

  const ftTotalSec = ftMinutes * 60

  const deltaSec = nowTotalSec - ftTotalSec

  // arrondi à la minute entière la plus proche (affichage actuel)
  const fixedDelayMin = Math.round(deltaSec / 60)

  return { fixedDelayMin, deltaSec }
}


    // Base "classique" : à partir de la première heure FT dispo
    // ✅ Robuste : on lit la première heure réellement affichée dans le DOM (priorité réel, sinon théorique)
    const captureBaseFromFirstRow = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowMinFloat = nowMin + now.getSeconds() / 60;

      const container = scrollContainerRef.current;
      if (!container) return null;

      const rows = Array.from(
        container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main")
      );

      const parseMinutesFromRow = (tr: HTMLTableRowElement): number | null => {
        const dep = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-depart"
        );
        const theo = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-theo"
        );

        const txt = ((dep?.textContent ?? theo?.textContent) ?? "").trim();

        // Accepte HH:MM et HH:MM:SS
        const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(txt);
        if (!m) return null;

        const hh = Number(m[1]);
        const mm = Number(m[2]);
        const ss = m[3] != null ? Number(m[3]) : 0;

        if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;

        return hh * 60 + mm + ss / 60;
      };

      let firstHoraMin: number | null = null;
      for (const tr of rows) {
        const m = parseMinutesFromRow(tr);
        if (m == null) continue;
        firstHoraMin = m;
        break;
      }

      if (firstHoraMin == null) return null;

      const { fixedDelayMin: fixedDelay, deltaSec } = computeFixedDelay(now, firstHoraMin);
      return { realMinInt: nowMin, realMinFloat: nowMinFloat, firstHoraMin, fixedDelay, deltaSec };
    };


  // Base "mode Standby" : à partir de la ligne sélectionnée
  const captureBaseFromRowIndex = (rowIndex: number) => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowMinFloat = nowMin + now.getSeconds() / 60;

    // ✅ En reprise de standby, on force la base sur la ligne qui a réellement
    // déclenché l'entrée en standby (et non sur un éventuel clic parasite de reprise)
    const lockedRowIndex =
      standbyLockedRowRef.current != null && Number.isFinite(standbyLockedRowRef.current)
        ? standbyLockedRowRef.current
        : rowIndex;

    // 1) Priorité : lire l'heure directement dans le DOM de la ligne verrouillée
    let rowMin: number | null = null;
    let rowHoraText: string | null = null;
    let rowHoraSource: "DOM_DEPART" | "DOM_THEO" | "THEO_FALLBACK" | "NONE" = "NONE";

    const container = scrollContainerRef.current;

    if (container) {
      const tr = container.querySelector<HTMLTableRowElement>(
        `tr.ft-row-main[data-ft-row="${lockedRowIndex}"]`
      );

      if (tr) {
        const dep = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-depart"
        );
        const theo = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-theo"
        );

        const depTxt = (dep?.textContent ?? "").trim();
        const theoTxt = (theo?.textContent ?? "").trim();
        const txt = (depTxt || theoTxt || "").trim();

        const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(txt);
        if (m) {
          const hh = Number(m[1]);
          const mm = Number(m[2]);
          const ss = m[3] != null ? Number(m[3]) : 0;

          if (
            Number.isFinite(hh) &&
            Number.isFinite(mm) &&
            Number.isFinite(ss)
          ) {
            rowMin = hh * 60 + mm + ss / 60;
            rowHoraText = txt;
            rowHoraSource = depTxt ? "DOM_DEPART" : "DOM_THEO";
          }
        }
      }
    }

    // 2) Fallback : horaire théorique interne sur la ligne verrouillée
    if (rowMin == null) {
      const v = horaTheoMinutesByIndex[lockedRowIndex];
      if (typeof v === "number" && Number.isFinite(v)) {
        rowMin = v;
        rowHoraText = formatMinutesToHora(Math.round(v));
        rowHoraSource = "THEO_FALLBACK";
      }
    }

    const lockedEntry = rawEntries[lockedRowIndex] as any;
    const inputEntry = rawEntries[rowIndex] as any;

    logTestEvent("ft:delta:capture-base-from-row", {
      inputRowIndex: rowIndex,
      lockedRowIndex,
      standbyLockedRowCurrent: standbyLockedRowRef.current,
      selectedRowIndexCurrent: selectedRowIndex,
      activeRowIndexCurrent: activeRowIndex,
      recalibrateFromRowCurrent: recalibrateFromRowRef.current,

      inputPk: inputEntry?.pk ?? null,
      inputPkAdif: inputEntry?.pk_adif ?? null,
      inputPkLfp: inputEntry?.pk_lfp ?? null,
      inputPkRfn: inputEntry?.pk_rfn ?? null,
      inputNetwork: inputEntry?.network ?? null,
      inputDependencia: inputEntry?.dependencia ?? null,

      lockedPk: lockedEntry?.pk ?? null,
      lockedPkAdif: lockedEntry?.pk_adif ?? null,
      lockedPkLfp: lockedEntry?.pk_lfp ?? null,
      lockedPkRfn: lockedEntry?.pk_rfn ?? null,
      lockedNetwork: lockedEntry?.network ?? null,
      lockedDependencia: lockedEntry?.dependencia ?? null,

      horaSource: rowHoraSource,
      horaText: rowHoraText,
      rowMin,
    });

    if (rowMin == null) return null;

    const { fixedDelayMin: fixedDelay, deltaSec } = computeFixedDelay(now, rowMin);

    return {
      realMinInt: nowMin,
      realMinFloat: nowMinFloat,
      firstHoraMin: rowMin,
      fixedDelay,
      deltaSec,
    };
  };

    // ✅ Choix de la base : soit ligne sélectionnée (Standby), soit première ligne
    const forcedIndex = recalibrateFromRowRef.current;
    if (forcedIndex != null) {
      autoScrollBaseRef.current = captureBaseFromRowIndex(forcedIndex);

      if (autoScrollBaseRef.current) {
        lastDeltaRecalageRef.current = {
          rowIndex: forcedIndex,
          source: "MANUAL",
          ts: Date.now(),
        };

        logTestEvent("ft:delta:recalage:mark", {
          rowIndex: forcedIndex,
          source: "MANUAL",
        });
      }

      recalibrateFromRowRef.current = null;
    } else {
      autoScrollBaseRef.current = captureBaseFromFirstRow();
    }

    // On mémorise la position de scroll actuelle comme "base"
    if (scrollContainerRef.current) {
      lastAutoScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    if (autoScrollBaseRef.current) {
      const fixed = autoScrollBaseRef.current.fixedDelay;
      const deltaSec = autoScrollBaseRef.current.deltaSec;
      const text =
        fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;

      if (effectiveFtView === "ES") {
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
    } // ✅ fermeture du if (autoScrollBaseRef.current) manquante

    const updateFromClock = (forcedHHMM?: string) => {
      // si heure forcée (console), on garde l'ancien comportement
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

        const picked =
          exactDataIndex ?? lastPastDataIndex ?? firstValidDataIndex ?? 0;

        setActiveRowIndex(picked);
        return;

      }

      const base = autoScrollBaseRef.current;
      if (!base) return;

      // heure réelle actuelle
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      const baseRealMinInt =
        typeof base.realMinInt === "number" && Number.isFinite(base.realMinInt)
          ? base.realMinInt
          : null;

      const baseFirstHoraMin =
        typeof base.firstHoraMin === "number" && Number.isFinite(base.firstHoraMin)
          ? base.firstHoraMin
          : null;

      const elapsed =
        baseRealMinInt != null ? nowMin - baseRealMinInt : null;

      const effectiveMin =
        baseFirstHoraMin != null && elapsed != null
          ? baseFirstHoraMin + elapsed
          : null;

      const effectiveHHMM =
        effectiveMin != null && Number.isFinite(effectiveMin)
          ? minutesToHHMM(effectiveMin)
          : "INVALID";

      // on met dans la console exactement ce que tu veux regarder
      console.log(
        `[FT][auto] heure réelle = ${minutesToHHMM(
          nowMin
        )} | première heure FT = ${
          baseFirstHoraMin != null ? minutesToHHMM(baseFirstHoraMin) : "INVALID"
        } | diff (minutes depuis activation) = ${
          elapsed ?? "INVALID"
        } | heure EFFECTIVE utilisée pour le '>' = ${effectiveHHMM}`
      );

      logTestEvent("ft:delta:tick", {
        nowHHMM: minutesToHHMM(nowMin),
        baseFirstHoraHHMM:
          baseFirstHoraMin != null ? minutesToHHMM(baseFirstHoraMin) : "INVALID",
        elapsedMinutes: elapsed,
        effectiveHHMM,
        fixedDelay: base.fixedDelay ?? null,
      });

      // ✅ Garde-fou : si la base horaire est invalide, on ne touche ni à la ligne active
      // ni au scroll. On conserve simplement la dernière ligne valide.
      if (
        baseRealMinInt == null ||
        baseFirstHoraMin == null ||
        elapsed == null ||
        effectiveMin == null ||
        !Number.isFinite(effectiveMin)
      ) {
        logTestEvent("ft:delta:tick:invalid-base", {
          nowHHMM: minutesToHHMM(nowMin),
          baseRealMinInt: base.realMinInt ?? null,
          baseFirstHoraMin: base.firstHoraMin ?? null,
          elapsedMinutes: elapsed,
          effectiveMin,
          fixedDelay: base.fixedDelay ?? null,
          activeRowIndexBefore: activeRowIndex,
          referenceMode: referenceModeRef.current,
        });
        return;
      }

      // 🔁 PAUSE AUTOMATIQUE SUR HEURE D’ARRIVÉE
      if (referenceModeRef.current === "HORAIRE") {
        const arrivalList = arrivalEventsRef.current || [];
        if (Array.isArray(arrivalList) && arrivalList.length > 0) {
          const matchingArrival = arrivalList.find(
            (ev) => ev.arrivalMin === effectiveMin
          );

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

            // On place la ligne active et la sélection sur cette arrivée
            setActiveRowIndex(matchingArrival.rowIndex);

            setSelectedRowIndex(matchingArrival.rowIndex);
            recalibrateFromRowRef.current = matchingArrival.rowIndex;

            // 👉 NOUVEAU : on recale immédiatement la FT sur cette ligne
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

            // On passe en Standby SANS couper l’autoscroll :
            // l’autoscroll reste engagé, mais il est mis en pause sur la ligne d’arrivée.
window.dispatchEvent(
  new CustomEvent("lim:hourly-mode", {
    detail: { enabled: true, standby: true },
  })
);
            // On s’arrête là pour cette minute : plus de recalage auto
            return;
          }
        }
      }

      // on cherche la ligne FT la plus proche de cette heure effective
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

      let dataIndex =
        exactDataIndex ?? lastPastDataIndex ?? firstValidDataIndex ?? activeRowIndex;

      // ✅ Tick 0 : on évite le "saut" au démarrage
      // - en reprise après Standby, on reste immédiatement sur la vraie ligne de recalage
      // - sinon, on garde le comportement historique (1ère ligne valide)
      if (referenceModeRef.current === "HORAIRE" && elapsed === 0) {
        const recalIndex =
          typeof forcedIndex === "number" && Number.isFinite(forcedIndex)
            ? forcedIndex
            : null;

        const standbyIndex =
          selectedRowIndex != null && Number.isFinite(selectedRowIndex)
            ? selectedRowIndex
            : null;

        const immediateIndex = recalIndex ?? standbyIndex;

        if (immediateIndex != null) {
          dataIndex = immediateIndex;
        } else if (firstValidDataIndex != null) {
          dataIndex = firstValidDataIndex;
        }
      }

      // 👉 Le moteur horaire ne pilote la ligne active que si on est en mode HORAIRE
      if (referenceModeRef.current === "HORAIRE") {

        // ✅ Tick 0 : on évite le "saut" visuel dû au recalage scroll auto
        // (on bloque le scroll programmatique très brièvement)
        if (elapsed === 0) {
          isManualScrollRef.current = true;
          window.setTimeout(() => {
            isManualScrollRef.current = false;
          }, 600);
        }

        setActiveRowIndex(dataIndex);
      }

      // pour la TitleBar : on renvoie le décalage figé au moment du play
      const fixed = base.fixedDelay ?? 0;
      const text =
        fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;
      if (effectiveFtView === "ES") {
        window.dispatchEvent(
          new CustomEvent("lim:schedule-delta", {
            detail: {
              text,
              isLargeDelay: Math.abs(fixed) >= 5,
            },
          })
        );
      }

    }; // ✅ fermeture de updateFromClock (manquante dans TON fichier)

    // premier calage immédiat
    updateFromClock();

    // recalcule chaque minute (heure réelle)
    const timer = setInterval(() => {
      updateFromClock();
    }, 60_000);

    const handleForceTime = (e: Event) => {
      const ce = e as CustomEvent;
      const time = ce?.detail?.time as string | undefined;
      if (time) {
        console.log("[FT] heure forcée =", time);
        updateFromClock(time);
      }
    };
    window.addEventListener("ft:force-time", handleForceTime);

    return () => {
      clearInterval(timer);
      window.removeEventListener("ft:force-time", handleForceTime);
    };
  }, [autoScrollEnabled]);

  // avance auto de la ligne active tant qu'on est en play :
  // on ajuste le scroll pour rapprocher la ligne active de la ligne rouge
  // (on autorise désormais le scroll à monter OU descendre),
  // quel que soit le mode de référence (HORAIRE ou GPS).
useEffect(() => {
    // ✅ En GPS, on autorise aussi le recentrage auto même si autoScrollEnabled est faux
    // (sinon la ligne active suit le PK, mais le viewport ne suit pas).
    if (!autoScrollEnabled && referenceMode !== "GPS") return;
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

    // Centre vertical de la ligne active (en coordonnées écran)
    const rowCenterY = rowRect.top + rowRect.height / 2;
    // Position verticale de la ligne rouge (milieu)
    const refCenterY = refRect.top + refRect.height / 2;

    // delta > 0 : la ligne est sous la ligne rouge → on monte le tableau
    // delta < 0 : la ligne est au-dessus de la ligne rouge → on descend le tableau
    const delta = rowCenterY - refCenterY;

    // Si la ligne est déjà parfaitement alignée, on ne fait rien
    if (delta === 0) return;

    // Si l'utilisateur est en train de scroller manuellement, on ne touche pas au scroll
    // sauf juste après une reprise de standby, où on autorise un seul réalignement immédiat
    const bypassManualLock = forceRealignOnResumeRef.current;

    if (isManualScrollRef.current && !bypassManualLock) {
      return;
    }

    if (bypassManualLock) {
      forceRealignOnResumeRef.current = false;
    }

    const currentScrollTop = container.scrollTop;
    let targetScrollTop = currentScrollTop + delta;

    // On borne proprement dans [0 ; maxScrollTop]
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (maxScrollTop < 0) return;

    if (targetScrollTop < 0) targetScrollTop = 0;
    if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop;
        console.log("[FT auto-scroll debug]", {
      referenceMode,
      activeRowIndex,
      rowCenterY,
      refCenterY,
      delta,
      currentScrollTop,
      targetScrollTop,
      maxScrollTop,
      blockedByClampTop: delta < 0 && currentScrollTop === 0 && targetScrollTop === 0,
      blockedByClampBottom:
        delta > 0 &&
        currentScrollTop === maxScrollTop &&
        targetScrollTop === maxScrollTop,
      isManualScroll: isManualScrollRef.current,
    });

    // Si après bornage la valeur n'a pas changé, inutile de scroller
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

    // ===== Expose le contexte train à la TitleBar (sens + disponibilité FT France) =====
  useEffect(() => {
    if (trainNumber === null || isOdd === null || currentCsvSens === null) return;

    // ⚠️ Ici, on suit la convention ACTUELLE de ton FT.tsx :
    // isOdd === true  -> "IMPAIR (Espagne→France)" (cf tes logs)
    // isOdd === false -> "PAIR  (France→Espagne)"
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
      picked = getFtLignePair(trainNumber);
      oriented = picked;
      console.log(
        "[FT] Sens choisi: IMPAIR (Espagne→France, PK croissants) / Jeu de données = getFtLignePair(trainNumber)"
      );
    } else {
      picked = getFtLigneImpair(trainNumber);
      oriented = [...picked].reverse();
      console.log(
        "[FT] Sens choisi: PAIR (France→Espagne, PK décroissants) / Jeu de données = getFtLigneImpair(trainNumber) inversé"
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

    const hasFranceFtLocal = !!trainNumber && FT_FR_WHITELIST.has(trainNumber);
    let firstIdx = 0;
    let lastIdx = oriented.length - 1;

    // Tronquage NORMAL routeStart/routeEnd : évite d'afficher des branches hors parcours (ex: CAN TUNIS)
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

    // Extension "France" : si train whitelisté, on étend la portion pour inclure UNIQUEMENT les lignes RFN
    // (sans toucher au terminus Barcelone, donc sans réintroduire CAN TUNIS)
    if (hasFranceFtLocal) {
      let minRfn = Number.POSITIVE_INFINITY;
      let maxRfn = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < oriented.length; i++) {
        const e = oriented[i] as any;
        if (e.isNoteOnly) continue;
        if (e.network === "RFN") {
          if (i < minRfn) minRfn = i;
          if (i > maxRfn) maxRfn = i;
        }
      }

      if (Number.isFinite(minRfn) && Number.isFinite(maxRfn)) {
        firstIdx = Math.min(firstIdx, minRfn);
        lastIdx = Math.max(lastIdx, maxRfn);
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

    // Vérification si la destination est "Barcelona Sants"
    if (routeEnd === "Barcelona Sants") {
      // Vérifier si la dernière ligne est bien 621.0
      const lastLineIs621_0 = (lastEntry as any).pk === "621.0";

      // Affichage dans la console pour le débogage
      console.log(`Dernière ligne détectée, 621.0 : ${lastLineIs621_0 ? "Oui" : "Non"}`);
    }

    console.log(
      "[FT] Aperçu (5 premières lignes après tronquage):",
      snapshot
    );

    return visibleEntries;
  }, [isOdd, trainNumber, routeStart, routeEnd]);

    useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const run = () => {
      const scrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;

      const rowEls = el.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
      if (!rowEls.length) return;

      let firstVisible = 0;
      for (let i = 0; i < rowEls.length; i++) {
        const r = rowEls[i];
        const top = r.offsetTop;
        const bottom = top + r.offsetHeight;
        if (bottom >= scrollTop) {
          firstVisible = i;
          break;
        }
      }

      const viewportBottom = scrollTop + clientHeight;
      let lastVisible = firstVisible;
      for (let i = firstVisible; i < rowEls.length; i++) {
        const r = rowEls[i];
        const top = r.offsetTop;
        if (top <= viewportBottom) {
          lastVisible = i;
        } else {
          break;
        }
      }

      const firstDataAttr = rowEls[firstVisible]?.getAttribute("data-ft-row") ?? "";
      const lastDataAttr = rowEls[lastVisible]?.getAttribute("data-ft-row") ?? "";
      const firstDataRow = firstDataAttr ? parseInt(firstDataAttr, 10) : null;
      const lastDataRow = lastDataAttr ? parseInt(lastDataAttr, 10) : null;

      const nextFirst =
        typeof firstDataRow === "number" && Number.isFinite(firstDataRow)
          ? firstDataRow
          : firstVisible;

      const nextLast =
        typeof lastDataRow === "number" && Number.isFinite(lastDataRow)
          ? lastDataRow
          : lastVisible;

      setVisibleRows({ first: nextFirst, last: nextLast });
    };

    requestAnimationFrame(run);
  }, [rawEntries]);
  
  // Trouve l'index de la ligne FT correspondant au PK GPS,
  // en prenant la dernière ligne "atteinte" (en amont) dans le sens du parcours.
function findRowIndexFromPk(targetPk: number | null): number | null {
  if (targetPk == null || !Number.isFinite(targetPk)) return null;

  type NetRef = "ADIF" | "LFP" | "RAC" | "RFN";

  // ------------------------------------------------------------------
  // ✅ Unification PK → "ADIF fictif" (copié de FTFrance.tsx)
  //    - ADIF/LFP : 752.4 ADIF ↔ 44.4 LFP
  //    - LGV/RAC  : 796.8 fictif ↔ 0 LFP ↔ 2.9 RAC
  //    - RAC/RFN  : 799.7 fictif ↔ 0 RAC ↔ 471.0 RFN
  // ------------------------------------------------------------------
  const ANCHOR_ADIF_LFP_ADIF = 752.4;
  const ANCHOR_ADIF_LFP_LFP = 44.4;

  const ANCHOR_LGV_RAC_FICTIF = 796.8;
  const ANCHOR_LGV_RAC_LFP = 0.0;
  const ANCHOR_LGV_RAC_RAC = 2.9;

  const ANCHOR_RAC_RFN_FICTIF = 799.7;
  const ANCHOR_RAC_RFN_RAC = 0.0;
  const ANCHOR_RAC_RFN_RFN = 471.0;

  const parsePk = (v: any): number | null => {
    if (v == null) return null;
    const s = String(v).trim().replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const detectRefFromPkValue = (pk: number): NetRef => {
    // même heuristique que FTFrance.tsx
    if (pk >= 600) return "ADIF";
    if (pk >= 300) return "RFN";
    return "LFP";
  };

  const pkToFictif = (pk: number, ref: NetRef): number | null => {
    if (!Number.isFinite(pk)) return null;

    if (ref === "ADIF") return pk;

    if (ref === "LFP") {
      // 44.4 LFP ↔ 752.4 fictif, et 0 LFP ↔ 796.8 fictif
      return ANCHOR_ADIF_LFP_ADIF + (ANCHOR_ADIF_LFP_LFP - pk);
    }

    if (ref === "RAC") {
      // 2.9 RAC ↔ 796.8 fictif, et 0 RAC ↔ 799.7 fictif
      return ANCHOR_LGV_RAC_FICTIF + (ANCHOR_LGV_RAC_RAC - pk);
    }

    // RFN : 471.0 RFN ↔ 799.7 fictif
    return ANCHOR_RAC_RFN_FICTIF + (ANCHOR_RAC_RFN_RFN - pk);
  };

  // ------------------------------------------------------------------
  // ✅ FT row → fictif
  // Important : on privilégie pk_lfp / pk_rfn / pk_adif / pk_rac quand présents
  // (car e.pk peut rester “ADIF” sur des lignes France dans la FT fusionnée)
  // ------------------------------------------------------------------
  const getRowPkFictif = (e: any): number | null => {
    if (!e || e.isNoteOnly) return null;

    // 1) si une colonne réseau est présente, elle prime (comme pkAlt dans FTFrance)
    const pkRac = parsePk(e.pk_rac ?? null);
    if (pkRac != null) return pkToFictif(pkRac, "RAC");

    const pkLfp = parsePk(e.pk_lfp ?? null);
    if (pkLfp != null) return pkToFictif(pkLfp, "LFP");

    const pkRfn = parsePk(e.pk_rfn ?? null);
    if (pkRfn != null) return pkToFictif(pkRfn, "RFN");

    const pkAdif = parsePk(e.pk_adif ?? null);
    if (pkAdif != null) return pkToFictif(pkAdif, "ADIF");

    // 2) fallback : on détecte la ref depuis e.pk (comme FTFrance sur row.pk)
    const pkMain = parsePk(e.pk ?? null);
    if (pkMain == null) return null;

    const ref = detectRefFromPkValue(pkMain);
    return pkToFictif(pkMain, ref);
  };

  // GPS → fictif (même logique que FTFrance)
  const gpsRef = detectRefFromPkValue(targetPk);
  const gpsFictif = pkToFictif(targetPk, gpsRef);
  if (gpsFictif == null) return null;

  // ------------------------------------------------------------------
  // Recherche : dernière ligne atteinte (sens du tableau détecté automatiquement)
  // - si u augmente avec i : on prend la dernière ligne telle que u <= gpsFictif
  // - si u diminue avec i : on prend la dernière ligne telle que u >= gpsFictif
  // ------------------------------------------------------------------
  let candidateIndex: number | null = null;

  // Détecter le sens global du tableau (u croissant ou décroissant)
  let firstU: number | null = null;
  let lastU: number | null = null;

  for (let i = 0; i < rawEntries.length; i++) {
    const u = getRowPkFictif(rawEntries[i] as any);
    if (u == null) continue;
    firstU = u;
    break;
  }

  for (let i = rawEntries.length - 1; i >= 0; i--) {
    const u = getRowPkFictif(rawEntries[i] as any);
    if (u == null) continue;
    lastU = u;
    break;
  }

  const isIncreasing =
    firstU != null && lastU != null ? lastU >= firstU : true;

  for (let i = 0; i < rawEntries.length; i++) {
    const u = getRowPkFictif(rawEntries[i] as any);
    if (u == null) continue;

    if (isIncreasing) {
      if (u <= gpsFictif) candidateIndex = i;
    } else {
      if (u >= gpsFictif) candidateIndex = i;
    }
  }

  // fallback : plus proche en fictif
  if (candidateIndex == null) {
    let bestIndex: number | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < rawEntries.length; i++) {
      const u = getRowPkFictif(rawEntries[i] as any);
      if (u == null) continue;

      const d = Math.abs(u - gpsFictif);
      if (d < bestDelta) {
        bestDelta = d;
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

    // 1) Hora directe issue de la FT, si présente
    const directHora = (entry as any).hora ?? "";
    if (typeof directHora === "string" && directHora.trim().length > 0) {
      return directHora.trim();
    }

    // 1bis) Hora France (RFN/LFP) via ftFranceTimes (même logique que l'affichage)
    const net = (entry as any).network as ("RFN" | "LFP" | "ADIF" | undefined);

    if (net === "RFN" || net === "LFP") {
      const sitKm =
        net === "RFN"
          ? ((entry as any).pk_rfn ?? "")
          : net === "LFP"
            ? ((entry as any).pk_lfp ?? "")
            : "";

      const pkKey = (sitKm ?? "").toString().replace(".", ",");
      const horaFrance = getFtFranceHhmm(trainNumber, pkKey);

      if (typeof horaFrance === "string" && horaFrance.trim().length > 0) {
        return horaFrance.trim();
      }
    }

    // 2) Sinon, on reconstruit le mapping "ligne éligible" ↔ heuresDetectees
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
    // --- helper : trouver la gare commerciale la plus proche (via arrivalEventsRef) ---
    const findNearestCommercialStopRowIndex = (
      targetPk: number,
      maxDeltaKm: number
    ): { rowIndex: number; deltaKm: number } | null => {
      const stops = arrivalEventsRef.current || [];
      if (!Array.isArray(stops) || stops.length === 0) return null;

      let bestRow: number | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (const s of stops) {
        const rowIndex = s?.rowIndex;
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

      // On mémorise brut pour l'instant (lat, lon, pk, etc.)
      lastGpsPositionRef.current = detail as GpsPosition;

      // ✅ DEBUG GPS (throttled) : 1 log / 2s, ou si changement réseau / acceptedMode, ou relock
      const dbg = gpsDebugRef.current;
      const net = (detail as any)?.network ?? null;

      const pkRawNum =
        typeof (detail as any).pk === "number" && Number.isFinite((detail as any).pk)
          ? ((detail as any).pk as number)
          : null;

      const acceptedModeLocal = (detail as any)?.pkDecision?.acceptedMode ?? null;
      const isRelockLocal = acceptedModeLocal === "relock";
      const nowDbg = Date.now();

      const shouldLog =
        isRelockLocal ||
        dbg.lastNet !== net ||
        dbg.lastAcceptedMode !== acceptedModeLocal ||
        nowDbg - dbg.lastLogTs >= 2000;

      if (shouldLog) {
        dbg.lastLogTs = nowDbg;
        dbg.lastNet = net;
        dbg.lastAcceptedMode = acceptedModeLocal;
        dbg.lastPkRaw = pkRawNum;
                // ✅ Buffer des derniers logs pour pouvoir les relire après (sans captures)
        const w = window as any;
        if (!Array.isArray(w.__ftGpsBase)) w.__ftGpsBase = [];
        w.__ftGpsBase.push({
          at: Date.now(),
          pk: pkRawNum,
          network: net,
          acceptedMode: acceptedModeLocal,
          onLine: (detail as any)?.onLine ?? null,
          ts: (detail as any)?.timestamp ?? null,
          keys: Object.keys(detail),
          pkDecision: (detail as any)?.pkDecision ?? null,
          // candidats éventuels de "position continue"
          s_km: (detail as any)?.s_km ?? null,
          distance_m: (detail as any)?.distance_m ?? null,
          abs: (detail as any)?.abs ?? null,
          ribbonKm: (detail as any)?.ribbonKm ?? null,
        });
        if (w.__ftGpsBase.length > 60) w.__ftGpsBase.splice(0, w.__ftGpsBase.length - 60);

        console.log("[FT][gps] base", {
          pk: pkRawNum,
          network: net,
          acceptedMode: acceptedModeLocal,
          onLine: (detail as any)?.onLine ?? null,
          ts: (detail as any)?.timestamp ?? null,

          // 🔎 Pour savoir si on a déjà une référence "continue" (PK internal)
          keys: Object.keys(detail),

          pkDecision: (detail as any)?.pkDecision ?? null,

          pkInternal: (detail as any)?.pkInternal ?? null,
          pk_internal: (detail as any)?.pk_internal ?? null,
          pkInt: (detail as any)?.pkInt ?? null,

          s_km: (detail as any)?.s_km ?? null,
          skm: (detail as any)?.skm ?? null,
          abs: (detail as any)?.abs ?? null,
          ribbonKm: (detail as any)?.ribbonKm ?? null,
          chainage: (detail as any)?.chainage ?? null,
        });
      }

// PK brut reçu
const pkRaw = (detail as any).pk as number | null | undefined;
// PK "utilisable" (peut être forcé à null par le garde-fou)
let pk: number | null =
  typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

// ✅ info moteur PK : permet d’ignorer le garde-fou FT lors d’une bascule de référentiel
const acceptedMode = (detail as any)?.pkDecision?.acceptedMode ?? null;
const isRelock = acceptedMode === "relock";


      // --- Qualité GPS + machine d'états (RED / ORANGE / GREEN) + hystérésis ---
      const nowTs = Date.now();

      const hasGpsFix =
        typeof (detail as any).lat === "number" &&
        typeof (detail as any).lon === "number";

      const onLine = !!(detail as any).onLine;

      // Fraîcheur : on prend le timestamp fourni si dispo, sinon "maintenant"
      const sampleTs =
        typeof (detail as any).timestamp === "number"
          ? (detail as any).timestamp
          : nowTs;

      lastGpsSampleAtRef.current = sampleTs;

      const ageSec = Math.max(0, (nowTs - sampleTs) / 1000);
      const isStale = ageSec > GPS_FRESH_SEC;

      // ===== GARDE-FOU "SAUT DE PK" =====
      // Objectif : si un saut énorme arrive, on ne pilote plus la FT avec ce PK.
      // On force ORANGE et on attend de retrouver une cohérence.
      const speedKmPerSec = GPS_JUMP_MAX_SPEED_KMH / 3600;

      const lastCoherentPk = lastCoherentPkRef.current;
      const lastCoherentTs = lastCoherentTsRef.current;

      // ✅ NOUVEAU :
      // On privilégie la dernière référence "accepted" fournie par pkDecision
      // quand elle est exploitable, car elle peut mieux représenter la continuité
      // réelle à travers un tunnel que le dernier "coherent" local.
      const pkDecisionObj =
        detail && typeof (detail as any).pkDecision === "object"
          ? (detail as any).pkDecision
          : null;

      const lastAcceptedPkFromDecision =
        pkDecisionObj && typeof pkDecisionObj.lastAcceptedPk === "number" && Number.isFinite(pkDecisionObj.lastAcceptedPk)
          ? pkDecisionObj.lastAcceptedPk
          : null;

      const lastAcceptedAtMsFromDecision =
        pkDecisionObj && typeof pkDecisionObj.lastAcceptedAtMs === "number" && Number.isFinite(pkDecisionObj.lastAcceptedAtMs)
          ? pkDecisionObj.lastAcceptedAtMs
          : null;

      // ✅ Base de comparaison utilisée pour détecter le saut :
      // priorité au dernier "accepted", sinon fallback sur le dernier "coherent".
      const jumpRefPk =
        lastAcceptedPkFromDecision != null ? lastAcceptedPkFromDecision : lastCoherentPk;

      const jumpRefTs =
        lastAcceptedAtMsFromDecision != null && lastAcceptedAtMsFromDecision > 0
          ? lastAcceptedAtMsFromDecision
          : lastCoherentTs;

      const jumpRefSource =
        lastAcceptedPkFromDecision != null &&
        lastAcceptedAtMsFromDecision != null &&
        lastAcceptedAtMsFromDecision > 0
          ? "lastAccepted"
          : "lastCoherent";

      // Détection uniquement si on a un point de référence précédent, un PK courant,
      // et un fix sur la ligne non-stale.
      let pkJumpSuspect = false;

      if (
        !isRelock &&
        hasGpsFix &&
        onLine &&
        !isStale &&
        pk != null &&
        jumpRefPk != null &&
        jumpRefTs > 0
      ) {
        const dtSecRaw = Math.max(0, (sampleTs - jumpRefTs) / 1000);
        // ✅ On évite le “trou” à 0.99s : on détecte quand même,
        // en bornant juste le dt utilisé pour la tolérance.
        const dtSec = Math.max(dtSecRaw, GPS_JUMP_MIN_ELAPSED_SEC);

        const maxDeltaKm = GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSec;
        const dPk = Math.abs(pk - jumpRefPk);

        if (dPk > maxDeltaKm) {
          pkJumpSuspect = true;
        }
      }

      // Entrée en garde-fou : on se base sur la référence utilisée pour la détection
      if (
        pkJumpSuspect &&
        !pkJumpGuardActiveRef.current &&
        jumpRefPk != null
      ) {
        pkJumpGuardActiveRef.current = true;
        pkJumpGuardBasePkRef.current = jumpRefPk;
        pkJumpGuardBaseTsRef.current = sampleTs;

        // 📌 enrichissement log : tout le contexte utile au diagnostic
        const dtSecSinceLast =
          jumpRefTs > 0 ? Math.max(0, (sampleTs - jumpRefTs) / 1000) : null;

        const maxDeltaKmSinceLast =
          dtSecSinceLast != null
            ? GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSecSinceLast
            : null;

        const dPkSinceLast =
          pk != null && jumpRefPk != null ? Math.abs(pk - jumpRefPk) : null;

        logTestEvent("gps:pk-jump-guard:enter", {
          // --- brut GPS / projection ---
          lat: typeof (detail as any).lat === "number" ? (detail as any).lat : null,
          lon: typeof (detail as any).lon === "number" ? (detail as any).lon : null,
          accuracyM: typeof (detail as any).accuracy === "number" ? (detail as any).accuracy : null,
          distanceRibbonM:
            typeof (detail as any).distance_m === "number" ? (detail as any).distance_m : null,
          s_km: typeof (detail as any).s_km === "number" ? (detail as any).s_km : null,

          // --- timestamps / fraîcheur ---
          sampleTs,
          nowTs,
          ageSec,
          isStale,

          // --- PK ---
          pkRaw: pkRaw ?? null,
          pkCandidate: pk, // PK qui a déclenché le suspect
          pkLastCoherent: lastCoherentPk,
          pkLastAccepted: lastAcceptedPkFromDecision,
          jumpRefPk,
          jumpRefSource,

          // --- calculs de détection ---
          dtSecSinceLast,
          dPkSinceLast,
          maxDeltaKmSinceLast,
          minElapsedSec: GPS_JUMP_MIN_ELAPSED_SEC,
          jumpRefTs,
          lastCoherentTs,
          lastAcceptedAtMs: lastAcceptedAtMsFromDecision,

          // --- contexte app ---
          onLine,
          hasGpsFix,
          referenceMode: referenceModeRef.current,
          autoScrollEnabled: autoScrollEnabledRef.current,

          // --- paramètres garde-fou ---
          baseToleranceKm: GPS_JUMP_BASE_TOLERANCE_KM,
          maxSpeedKmh: GPS_JUMP_MAX_SPEED_KMH,
        });
      }

      // Si le garde-fou est actif : on reste ORANGE tant qu’on n’a pas récupéré un PK cohérent
      if (pkJumpGuardActiveRef.current) {
        const basePk = pkJumpGuardBasePkRef.current;
        const baseTs = pkJumpGuardBaseTsRef.current;

        if (pk != null && basePk != null && baseTs > 0) {
          const dtSecFromBase = Math.max(0, (sampleTs - baseTs) / 1000);
          const recoverMaxDeltaKm =
            GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSecFromBase;

          const dBase = Math.abs(pk - basePk);

          if (dBase <= recoverMaxDeltaKm) {
            // Sortie garde-fou : PK redevenu cohérent
            pkJumpGuardActiveRef.current = false;
            pkJumpGuardBasePkRef.current = null;
            pkJumpGuardBaseTsRef.current = 0;

            // ce PK redevient la nouvelle référence cohérente
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
            // Toujours incohérent -> on ignore le PK
            // ✅ Log enrichi : tout ce qu'il faut pour diagnostiquer le "saut"
            const lcPk = lastCoherentPkRef.current;
            const lcTs = lastCoherentTsRef.current;
            const dtSecFromLastCoherent =
              lcTs > 0 ? Math.max(0, (sampleTs - lcTs) / 1000) : null;

            // Tolérance "théorique" par rapport au dernier PK cohérent (si dispo)
            const maxDeltaFromLastCoherentKm =
              dtSecFromLastCoherent != null
                ? GPS_JUMP_BASE_TOLERANCE_KM + speedKmPerSec * dtSecFromLastCoherent
                : null;

            const dPkFromLastCoherentKm =
              typeof pk === "number" &&
              Number.isFinite(pk) &&
              typeof lcPk === "number" &&
              Number.isFinite(lcPk)
                ? Math.abs(pk - lcPk)
                : null;

            logTestEvent("gps:pk-jump-guard:reject", {
              // valeurs brutes / utilisées
              pkRaw: pkRaw ?? null,
              pkRejected: typeof pk === "number" && Number.isFinite(pk) ? pk : null,

              // base du garde-fou
              basePk,
              baseTs,
              dtSecFromBase,
              recoverMaxDeltaKm,
              dBase,

              // dernière référence cohérente
              lastCoherentPk: typeof lcPk === "number" && Number.isFinite(lcPk) ? lcPk : null,
              lastCoherentTs: lcTs > 0 ? lcTs : null,
              dtSecFromLastCoherent,

              // comparaison “classique” (avant garde-fou) pour comprendre le déclenchement
              maxDeltaFromLastCoherentKm,
              dPkFromLastCoherentKm,
              jumpBaseToleranceKm: GPS_JUMP_BASE_TOLERANCE_KM,
              jumpMaxSpeedKmh: GPS_JUMP_MAX_SPEED_KMH,
              jumpMinElapsedSec: GPS_JUMP_MIN_ELAPSED_SEC,

              // contexte GPS
              sampleTs,
              nowTs,
              ageSec,
              onLine,
              hasGpsFix,
              isStale,
              gpsState: gpsStateRef.current,
              referenceMode: referenceModeRef.current,

              // contexte utile (si tu lis le log après coup)
              pkJumpSuspectNow: pkJumpSuspect,
              pkJumpGuardActive: pkJumpGuardActiveRef.current,
            });

            pk = null;
          }
        } else {
          // Pas de PK exploitable => on ignore
          pk = null;
        }
      }

      // Si on n’est PAS en garde-fou, et que tout est sain, on met à jour la référence cohérente
      if (
        !pkJumpGuardActiveRef.current &&
        hasGpsFix &&
        onLine &&
        !isStale &&
        pk != null
      ) {
        lastCoherentPkRef.current = pk;
        lastCoherentTsRef.current = sampleTs;
      }

      // ===== Vérif cohérence sens attendu (train) vs sens observé (GPS) =====
      const expectedDir = expectedDirRef.current;
      if (
        expectedDir &&
        hasGpsFix &&
        onLine &&
        !isStale &&
        pk != null &&
        !pkJumpGuardActiveRef.current
      ) {
        const prevPk = dirLastPkRef.current;

        if (typeof prevPk === "number" && Number.isFinite(prevPk)) {
          const dPk = pk - prevPk;

          // ignore micro-variations / immobilité
          if (Math.abs(dPk) >= DIR_MIN_DELTA_KM) {
            const observedDir: "UP" | "DOWN" = dPk > 0 ? "UP" : "DOWN";

            // fenêtre glissante
            const w = dirWindowRef.current;
            if (w.startTs <= 0) {
              w.startTs = nowTs;
              w.sample = 0;
              w.mismatch = 0;
            }
            if (nowTs - w.startTs > DIR_WINDOW_MS) {
              w.startTs = nowTs;
              w.sample = 0;
              w.mismatch = 0;
            }

            w.sample += 1;
            if (observedDir !== expectedDir) w.mismatch += 1;

            const ratio = w.sample > 0 ? w.mismatch / w.sample : 0;

            // alerte si incohérence persistante (anti-spam)
            if (
              w.sample >= DIR_MIN_SAMPLES &&
              ratio >= DIR_MISMATCH_MIN_RATIO &&
              nowTs - dirLastMismatchEmitAtRef.current >= DIR_MISMATCH_COOLDOWN_MS
            ) {
              dirLastMismatchEmitAtRef.current = nowTs;

              logTestEvent("direction:mismatch", {
                train: expectedDirTrainRef.current,
                expectedDir,
                observedDir,
                sampleCount: w.sample,
                mismatchCount: w.mismatch,
                mismatchRatio: ratio,
                source: expectedDirSourceRef.current,
                pk,
                prevPk,
              });

              // event UI (TitleBar pourra afficher une invite "confirmer le sens")
              window.dispatchEvent(
                new CustomEvent("lim:direction-mismatch", {
                  detail: {
                    train: expectedDirTrainRef.current,
                    expectedDir,
                    observedDir,
                    sampleCount: w.sample,
                    mismatchCount: w.mismatch,
                    mismatchRatio: ratio,
                    hint: "Vérifier le sens (flèche) dans la TitleBar",
                  },
                })
              );
            }

            // mise à jour du PK de référence direction
            dirLastPkRef.current = pk;
          }
        } else {
          // première référence direction
          dirLastPkRef.current = pk;
        }
      }

      const distRibbonM =

        typeof (detail as any).distance_m === "number"
          ? (detail as any).distance_m
          : null;

      const accuracyM =
        typeof (detail as any).accuracy === "number" &&
        Number.isFinite((detail as any).accuracy)
          ? (detail as any).accuracy
          : null;

      const hasAcceptableAccuracy =
        accuracyM == null || accuracyM <= GPS_MAX_ACCURACY_M;

      // --- Détection "PK figé" ---
      if (typeof pk === "number" && Number.isFinite(pk)) {
        const prevPk = lastPkRef.current;
        if (typeof prevPk === "number" && Number.isFinite(prevPk)) {
          const dPk = Math.abs(pk - prevPk);
          if (dPk >= GPS_FREEZE_PK_DELTA_KM) {
            lastPkChangeAtRef.current = nowTs;
            lastPkRef.current = pk;
          }
        } else {
          lastPkRef.current = pk;
          lastPkChangeAtRef.current = nowTs;
        }
      }

      const pkFreezeElapsedMs =
        hasGpsFix &&
        onLine &&
        typeof pk === "number" &&
        Number.isFinite(pk) &&
        lastPkChangeAtRef.current > 0
          ? nowTs - lastPkChangeAtRef.current
          : 0;

      // PK figé : ORANGE à 10s, puis RED à 30s total
      const pkFrozenOrange = pkFreezeElapsedMs >= GPS_FREEZE_WINDOW_MS;
      const pkFrozenRed = pkFreezeElapsedMs >= GPS_FREEZE_TO_RED_MS;

      const hasUsablePk =
        typeof pk === "number" && Number.isFinite(pk);

      const reasonCodes: string[] = [];
      if (!hasGpsFix) reasonCodes.push("no_fix");
      if (hasGpsFix && !onLine) reasonCodes.push("off_line");
      if (hasGpsFix && onLine && isStale) reasonCodes.push("stale_fix");
      if (hasGpsFix && onLine && !isStale && !hasUsablePk) {
        reasonCodes.push("no_usable_pk");
      }
      if (hasGpsFix && onLine && !isStale && !hasAcceptableAccuracy) {
        reasonCodes.push("poor_accuracy");
      }
      if (pkJumpGuardActiveRef.current) reasonCodes.push("pk_jump_guard");
      if (pkFrozenRed) reasonCodes.push("pk_frozen_red");
      else if (pkFrozenOrange) reasonCodes.push("pk_frozen_orange");

      // ✅ on mémorise l'état précédent pour détecter "entrée en RED"
      const prevGpsState = gpsStateRef.current;

      // PK incohérent (garde-fou) => on force ORANGE (et PAS RED)
      // Objectif : éviter le rouge à chaque tunnel ; on garde le GPS "présent mais douteux"
      const pkIncoherentNow = pkJumpSuspect || pkJumpGuardActiveRef.current;
      if (pkIncoherentNow) {
        if (!reasonCodes.includes("pk_incoherent")) {
          reasonCodes.push("pk_incoherent");
        }
      }

      let nextState: "RED" | "ORANGE" | "GREEN" = "RED";

      if (!hasGpsFix) {
        nextState = "RED";
      } else if (pkFrozenRed) {
        // GPS figé trop longtemps => RED
        nextState = "RED";
      } else if (
        pkIncoherentNow ||
        !onLine ||
        isStale ||
        pkFrozenOrange ||
        !hasUsablePk ||
        !hasAcceptableAccuracy
      ) {
        // GPS présent mais non pleinement exploitable => ORANGE
        nextState = "ORANGE";
      } else {
        nextState = "GREEN";
      }

      // ✅ vrai uniquement AU MOMENT où on bascule en RED à cause du figeage
      const enteredRedFromFreeze =
        prevGpsState !== "RED" && nextState === "RED" && pkFrozenRed === true;

      // ✅ utile pour log : entrée ORANGE provoquée par PK incohérent
      const enteredOrangeFromPkIncoherent =
        prevGpsState !== "ORANGE" && nextState === "ORANGE" && pkIncoherentNow === true;


      const emitGpsStateToTitleBar = (forced: boolean) => {
        // throttle léger pour éviter le spam si watchPosition "mitraille"
        const now = nowTs;

        const pkFinite =
          typeof pk === "number" && Number.isFinite(pk) ? pk : null;

        // On n'affiche un PK que si GREEN (TitleBar attend ça)
        const pkForUi = nextState === "GREEN" ? pkFinite : null;

        const lastEmitAt = lastGpsStateEmitAtRef.current;
        const lastEmitPk = lastGpsStateEmitPkRef.current;

        const pkChanged =
          pkForUi != null &&
          (lastEmitPk == null || Math.abs(pkForUi - lastEmitPk) >= 0.05); // seuil ~50m

        const timeOk = now - lastEmitAt >= GPS_STATE_EMIT_MIN_INTERVAL_MS;

        // forced = changement d'état, sinon seulement si PK change ou throttle OK
        if (!forced && !pkChanged && !timeOk) return;

        lastGpsStateEmitAtRef.current = now;
        lastGpsStateEmitPkRef.current = pkForUi;

        window.dispatchEvent(
          new CustomEvent("lim:gps-state", {
            detail: {
              state: nextState, // "RED" | "ORANGE" | "GREEN"
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

      if (gpsStateRef.current !== nextState) {
        const prevState = gpsStateRef.current;
        gpsStateRef.current = nextState;

        // 🔊 Source de vérité GPS (FT) -> TitleBar (FORCÉ si changement d'état)
        emitGpsStateToTitleBar(true);

        logTestEvent("gps:state-change", {
          prevState,
          nextState,
          reasonCodes,
          ageSec,
          distRibbonM,
          accuracyM,
          pk: typeof pk === "number" && Number.isFinite(pk) ? pk : null,
          onLine,

          // ✅ paramètres utiles pour interpréter le state
          gpsFreshSec: GPS_FRESH_SEC,
          gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
          gpsFreezeToRedMs: GPS_FREEZE_TO_RED_MS,
          gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
          orangeTimeoutMs: ORANGE_TIMEOUT_MS,
          stationProxKm: STATION_PROX_KM,
        });

        // ✅ log dédié : entrée en ORANGE provoquée par PK incohérent
        if (enteredOrangeFromPkIncoherent) {
          logTestEvent("gps:orange:pk-incoherent", {
            pkRaw: pkRaw ?? null,
            pkUsed: typeof pk === "number" && Number.isFinite(pk) ? pk : null,
            pkJumpSuspect,
            pkJumpGuardActive: pkJumpGuardActiveRef.current,

            lastCoherentPk:
              typeof lastCoherentPkRef.current === "number" &&
              Number.isFinite(lastCoherentPkRef.current)
                ? lastCoherentPkRef.current
                : null,
            lastCoherentTs: lastCoherentTsRef.current > 0 ? lastCoherentTsRef.current : null,

            sampleTs,
            nowTs,
            ageSec,
            onLine,
            hasGpsFix,
            isStale,

            prevGpsState,
            nextState,
            reasonCodes,
          });
        }
      }
      // 🔄 Même si l'état ne change pas, on met à jour le PK affiché en TitleBar quand on est GREEN
      if (nextState === "GREEN") {
        emitGpsStateToTitleBar(false);
      }

      const isHealthy = nextState === "GREEN";

      // On met à jour l'état "GPS OK" (conservé pour les logs / debug)
      gpsHealthyRef.current = isHealthy;

      // --- Mode de référence (HORAIRE / GPS) ---
      // Règle centrale :
      // - GREEN  => GPS autorisé
      // - ORANGE => HORAIRE obligatoire
      // - RED    => HORAIRE obligatoire
      const stateForMode = gpsStateRef.current;
      const nextMode: ReferenceMode = stateForMode === "GREEN" ? "GPS" : "HORAIRE";
      const currentMode = referenceModeRef.current;

      // On n'utilise plus l'hystérésis ORANGE : si un timer traîne, on le coupe.
      if (orangeTimeoutRef.current !== null) {
        const startedAt = orangeTimeoutStartedAtRef.current;
        const now = Date.now();

        const elapsedMs =
          typeof startedAt === "number" ? Math.max(0, now - startedAt) : null;

        window.clearTimeout(orangeTimeoutRef.current);
        orangeTimeoutRef.current = null;
        orangeTimeoutStartedAtRef.current = null;

        logTestEvent("gps:orange-hysteresis-abort", {
          reason: "rule_changed_no_hysteresis",
          state: stateForMode,
          elapsedMs,
          orangeTimeoutMs: ORANGE_TIMEOUT_MS,
          mode: currentMode,
        });
      }

      logTestEvent("gps:mode-check", {
        gpsState: stateForMode,
        referenceModeState: referenceMode,
        referenceModeRef: currentMode,
        nextMode,
      });

      if (currentMode !== nextMode) {
        const modeReason =
          stateForMode === "GREEN"
            ? "gps_green"
            : stateForMode === "ORANGE"
            ? "gps_orange_forces_horaire"
            : pkIncoherentNow
            ? "gps_red_pk_incoherent"
            : pkFrozenRed
            ? "gps_red_pk_frozen"
            : !hasGpsFix
            ? "gps_red_no_fix"
            : !onLine
            ? "gps_red_off_line"
            : isStale
            ? "gps_red_stale_fix"
            : "gps_red_other";

        console.log("[FT][gps] GPS", stateForMode, "-> mode", nextMode);

        logTestEvent("gps:mode-change", {
          prevMode: currentMode,
          nextMode,
          reason: modeReason,
          state: stateForMode,
          reasonCodes,
          hasGpsFix,
          onLine,
          isStale,
          ageSec,
          pkRaw: pkRaw ?? null,
          pkUsed: typeof pk === "number" && Number.isFinite(pk) ? pk : null,
          pkJumpGuardActive: pkJumpGuardActiveRef.current,
          gpsFreshSec: GPS_FRESH_SEC,
          gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
          gpsFreezeToRedMs: GPS_FREEZE_TO_RED_MS,
          gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
          orangeTimeoutMs: ORANGE_TIMEOUT_MS,
        });

        // Synchro immédiate du ref pour les events suivants
        referenceModeRef.current = nextMode;
        setReferenceMode(nextMode);
      }


      // ✅ CAS SPÉCIAL ARRÊT EN GARE :
      // Si on ENTRE en RED suite à PK figé >= 30s, et si le PK figé est proche d'une gare commerciale,
      // alors on passe automatiquement en Standby horaire avec cette gare sélectionnée.
      if (enteredRedFromFreeze && typeof pk === "number" && Number.isFinite(pk)) {
        // ✅ Log "entrée en RED depuis freeze" (avant décision proximité gare)
        logTestEvent("gps:freeze-red:entered", {
          pk,
          pkFreezeElapsedMs,
          lastPkChangeAt: lastPkChangeAtRef.current,
          stationProxKm: STATION_PROX_KM,
          prevGpsState,
          nextState,
          ageSec,
          hasGpsFix,
          onLine,
          reasonCodes,
        });

        console.log("[FT][gps] ENTER RED (freeze)", {
          pk,
          pkFreezeElapsedMs,
          lastPkChangeAt: lastPkChangeAtRef.current,
          stationProxKm: STATION_PROX_KM,
          prevGpsState,
          nextState,
          ageSec,
          hasGpsFix,
          onLine,
          reasonCodes,
        });

        const nearest = findNearestCommercialStopRowIndex(pk, STATION_PROX_KM);

        if (nearest) {
          const { rowIndex, deltaKm } = nearest;

          console.log(
            "[FT][gps] RED sur figeage + proche gare commerciale -> Standby auto sur rowIndex=",
            rowIndex,
            "deltaKm=",
            deltaKm,
            "pk=",
            pk
          );

          logTestEvent("gps:freeze-red:station-standby", {
            rowIndex,
            deltaKm,
            pk,
            state: gpsStateRef.current,
            reason: "pk_frozen_red_near_commercial_stop",
            stationProxKm: STATION_PROX_KM,
          });

          // 🔎 DEBUG DIAGNOSTIC standby auto
          const autoStandbyEntry = rawEntries[rowIndex] as any;
          const autoStandbyHora = resolveHoraForRowIndex(rowIndex);

          logTestEvent("ft:standby:auto:debug", {
            rowIndex,
            pk,
            deltaKm,
            selectedRowIndexBefore: selectedRowIndex,
            activeRowIndexBefore: activeRowIndex,
            recalibrateFromRowBefore: recalibrateFromRowRef.current,
            standbyLockedRowBefore: standbyLockedRowRef.current,
            horaResolved: autoStandbyHora || null,
            rowPk: autoStandbyEntry?.pk ?? null,
            rowPkAdif: autoStandbyEntry?.pk_adif ?? null,
            rowPkLfp: autoStandbyEntry?.pk_lfp ?? null,
            rowPkRfn: autoStandbyEntry?.pk_rfn ?? null,
            rowNetwork: autoStandbyEntry?.network ?? null,
            dependencia: autoStandbyEntry?.dependencia ?? null,
          });

          // Visuel + base de recalage (comme un clic Standby)
          setSelectedRowIndex(rowIndex);
          recalibrateFromRowRef.current = rowIndex;

          // Optionnel mais cohérent : mettre aussi la ligne active sur cette gare
          setActiveRowIndex(rowIndex);

// On passe en Standby (🕑 orange) SANS couper l’auto-scroll
window.dispatchEvent(
  new CustomEvent("ft:auto-scroll-change", {
    detail: { enabled: true },
  })
);

window.dispatchEvent(
  new CustomEvent("lim:hourly-mode", {
    detail: { enabled: true, standby: true },
  })
);
        } else {
          // Pas de gare commerciale proche => on ne fait rien (comportement normal)
          logTestEvent("gps:freeze-red:station-standby-skip", {
            pk,
            reason: "no_near_commercial_stop",
            stationProxKm: STATION_PROX_KM,
          });
        }
      }

      // --- Suite : projection PK -> ligne FT + recalage horaire (inchangé dans l'esprit) ---
      if (pk != null) {
        console.log(
  "[FT][gps] BEFORE findRowIndexFromPk: pk=",
  pk,
  " pkRaw=",
  pkRaw,
  " acceptedMode=",
  acceptedMode,
  " isRelock=",
  isRelock
);
        const idx = findRowIndexFromPk(pk);
        if (idx != null) {
          const entry = rawEntries[idx];
                    // ✅ Buffer index FT calculé (pour diagnostiquer un "idx bloqué")
          const w2 = window as any;
          if (!Array.isArray(w2.__ftGpsIdx)) w2.__ftGpsIdx = [];

          const last = w2.__ftGpsIdx[w2.__ftGpsIdx.length - 1];
          const now2 = Date.now();

          // On enregistre seulement si idx change, ou toutes les 2s max
          const shouldPush =
            !last ||
            last.idx !== idx ||
            now2 - (last.at ?? 0) >= 2000;

          if (shouldPush) {
            w2.__ftGpsIdx.push({
              at: now2,
              pk, // pk utilisé pour la recherche
              s_km: (detail as any)?.s_km ?? null, // coord continue dispo !
              idx,
              rowPk: (entry as any)?.pk ?? null,
              rowNet: (entry as any)?.network ?? null,
              rowPkLfp: (entry as any)?.pk_lfp ?? null,
              rowPkRfn: (entry as any)?.pk_rfn ?? null,
              rowPkAdif: (entry as any)?.pk_adif ?? null,
              dependencia: (entry as any)?.dependencia ?? null,
            });

            if (w2.__ftGpsIdx.length > 80) w2.__ftGpsIdx.splice(0, w2.__ftGpsIdx.length - 80);
          }
          console.log(
            "[FT][gps] pk≈",
            pk,
            " → ligne FT index=",
            idx,
            " pk=",
            entry?.pk,
            " dependencia=",
            entry?.dependencia
          );

          // 🧭 En mode GPS calé sur la ligne → la ligne active est pilotée par le PK
          const currentRefMode = referenceModeRef.current;

          if (hasGpsFix && onLine && currentRefMode === "GPS") {
            // Ligne active = ligne GPS (PK projeté)
            setActiveRowIndex(idx);

            const lastIdx = lastAnchoredRowRef.current;
            const isNewAnchor = lastIdx == null || lastIdx !== idx;

            if (isNewAnchor) {
              lastAnchoredRowRef.current = idx;

              const lastDeltaRecalage = lastDeltaRecalageRef.current;
              const gpsRecalageBlockedByManual =
                lastDeltaRecalage != null &&
                lastDeltaRecalage.source === "MANUAL" &&
                lastDeltaRecalage.rowIndex === idx;

              if (gpsRecalageBlockedByManual) {
                logTestEvent("ft:delta:gps-recalage:skip", {
                  rowIndex: idx,
                  pk: entry?.pk ?? null,
                  dependencia: entry?.dependencia ?? null,
                  reason: "manual_recalage_already_done_on_same_row",
                  lastDeltaRecalageSource: lastDeltaRecalage.source,
                  lastDeltaRecalageTs: lastDeltaRecalage.ts,
                });
              } else {
                // ✅ Définition métier d’un point d’ancrage GPS :
                // ligne portant une heure de départ RÉELLE (non interpolée),
                // qu’elle vienne du PDF Espagne ou des données fixes France.
                const departHoraText = resolveHoraForRowIndex(idx);
                const departMinutes = parseHoraToMinutes(departHoraText);

                const entryNetwork = String((entry as any)?.network ?? "").trim();
                const entryPkRfn = String((entry as any)?.pk_rfn ?? "").trim();

                const isForbiddenGpsDeltaAnchor =
                  entryNetwork === "RFN" &&
                  (entryPkRfn === "471.0" || entryPkRfn === "473.3");

                const isGpsDeltaAnchor =
                  !isForbiddenGpsDeltaAnchor &&
                  typeof departHoraText === "string" &&
                  departHoraText.trim().length > 0 &&
                  departMinutes != null;

                if (!isGpsDeltaAnchor) {
                  logTestEvent("ft:delta:gps-recalage:skip", {
                    rowIndex: idx,
                    pk: entry?.pk ?? null,
                    dependencia: entry?.dependencia ?? null,
                    reason: isForbiddenGpsDeltaAnchor
                      ? "gps_row_forbidden_delta_anchor"
                      : "gps_row_without_real_departure_time",
                  });
                } else {
                  // En mode GPS : si une heure d'arrivée a été calculée pour cette ligne,
                  // on l'utilise pour le calcul du delta (objectif : heure réelle d'arrivée).
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
                    // 1) On note la ligne pour les futurs démarrages du mode horaire
                    recalibrateFromRowRef.current = idx;

                    // 2) On recalcule le delta réel (maintenant - heure utilisée)
                    const now = new Date();

                    const nowMinInt = now.getHours() * 60 + now.getMinutes();
                    const nowMinFloat = nowMinInt + now.getSeconds() / 60;
                    const nowTotalSec = nowMinInt * 60 + now.getSeconds();

                    const usedTotalSec = usedMinutes * 60;
                    const deltaSec = nowTotalSec - usedTotalSec;
                    const fixedDelay = Math.round(deltaSec / 60);

                    // 3) On recale la base interne du mode horaire sur cette ligne
                    autoScrollBaseRef.current = {
                      realMinInt: nowMinInt,
                      realMinFloat: nowMinFloat,
                      firstHoraMin: usedMinutes,
                      fixedDelay,
                      deltaSec,
                    };

                    lastDeltaRecalageRef.current = {
                      rowIndex: idx,
                      source: "GPS",
                      ts: Date.now(),
                    };

                    logTestEvent("ft:delta:recalage:mark", {
                      rowIndex: idx,
                      source: "GPS",
                    });

                    // 4) On met à jour immédiatement le delta affiché dans la TitleBar
                    const text =
                      fixedDelay === 0
                        ? "0 min"
                        : fixedDelay > 0
                        ? `+ ${fixedDelay} min`
                        : `- ${-fixedDelay} min`;

                    if (effectiveFtView === "ES") {
                      window.dispatchEvent(
                        new CustomEvent("lim:schedule-delta", {
                          detail: {
                            text,
                            isLargeDelay: Math.abs(fixedDelay) >= 5,
                            deltaSec,
                          },
                        })
                      );
                    }

                    const nowHHMM =
                      now.getHours().toString().padStart(2, "0") +
                      ":" +
                      now.getMinutes().toString().padStart(2, "0");

                    console.log(
                      "[FT][gps] Recalage horaire via GPS (real-anchor) — source=",
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
                      deltaSec,
                      pk: entry?.pk ?? null,
                      dependencia: entry?.dependencia ?? null,

                      // détails recalage
                      usedSource,
                      usedHora: usedHoraText,
                      usedMinutes,

                      // debug ancrage
                      anchorType: "REAL_DEPARTURE_TIME",
                      departHora: departHoraText || null,
                      departMinutes: departMinutes ?? null,
                      arrivalMinutes,
                    });
                  } else {
                    logTestEvent("ft:delta:gps-recalage:skip", {
                      rowIndex: idx,
                      pk: entry?.pk ?? null,
                      dependencia: entry?.dependencia ?? null,
                      reason: "gps_anchor_without_usable_time",
                    });
                  }
                }
              }
            }
          }
        } else {
          console.log(
            "[FT][gps] pk≈",
            pk,
            " → aucune ligne FT correspondante trouvée"
          );
        }
      }
    };

    window.addEventListener("gps:position", handler as EventListener);
    return () => {
      window.removeEventListener("gps:position", handler as EventListener);
      // On nettoie aussi le timer d'hystérésis au démontage
      if (orangeTimeoutRef.current !== null) {
        window.clearTimeout(orangeTimeoutRef.current);
        orangeTimeoutRef.current = null;
      }
      orangeTimeoutStartedAtRef.current = null;
    };
  }, [rawEntries, referenceMode, heuresDetectees]);

  //
  // ===== 4. HELPERS REMARQUES ROUGES =================================
  //
  function renderRedNoteLine(line: string) {
    const firstSpace = line.indexOf(" ");
    const firstToken = firstSpace === -1 ? line : line.slice(0, firstSpace);
    const rest = firstSpace === -1 ? "" : line.slice(firstSpace + 1);

    return (
      <div className="ft-rednote-line">
        <span className="ft-rednote-strong">{firstToken}</span>
        {rest ? " " + rest : ""}
      </div>
    );
  }

  function renderDependenciaCell(entry: FTEntry) {
    const hasNotesArray =
      Array.isArray(entry.notes) && entry.notes.length > 0;
    const hasSingleNote = entry.note && entry.note.trim() !== "";

    if (entry.isNoteOnly) {
      return (
        <div className="ft-dependencia-cell">
          {hasNotesArray
            ? entry.notes!.map((line, idx) => (
                <div key={idx}>{renderRedNoteLine(line)}</div>
              ))
            : hasSingleNote
            ? renderRedNoteLine(entry.note!)
            : null}
        </div>
      );
    }

    return (
      <div className="ft-dependencia-cell">
        <div>{entry.dependencia ?? ""}</div>

        {hasNotesArray
          ? entry.notes!.map((line, idx) => (
              <div key={idx}>{renderRedNoteLine(line)}</div>
            ))
          : hasSingleNote
          ? renderRedNoteLine(entry.note!)
          : null}
      </div>
    );
  }

  //
  // ===== 5. TIMELINE VITESSE / POINTS DE RUPTURE ======================
  //
  type SpeedInfo = { v: number; highlight: boolean };

  function extractSpeedTimeline(
    entries: FTEntry[],
    seed: SpeedInfo | null
  ): {
    speedMap: Record<string, SpeedInfo>;
    breakpointsArr: string[];
  } {
    const speedMap: Record<string, SpeedInfo> = {};
    const breakpointsArr: string[] = [];

    let currentSpeed: number | null = seed ? seed.v : null;
    let currentHighlight = seed ? seed.highlight : false;

    for (const e of entries) {
      if (e.isNoteOnly) continue;

      const pk = e.pk;

      const previousSpeed = currentSpeed;

      if (typeof e.vmax === "number" && !isNaN(e.vmax)) {
        currentSpeed = e.vmax;
        currentHighlight = !!(e as any).vmax_highlight;
      }

      if (
        pk &&
        previousSpeed !== null &&
        currentSpeed !== null &&
        currentSpeed !== previousSpeed
      ) {
        breakpointsArr.push(pk);
      }

      if (pk && currentSpeed !== null) {
        speedMap[pk] = {
          v: currentSpeed,
          highlight: currentHighlight,
        };
      }
    }

    return {
      speedMap,
      breakpointsArr,
    };
  }

  const firstVisiblePk = useMemo(() => {
    const e = rawEntries.find((e) => !e.isNoteOnly && e.pk);
    return e?.pk ?? null;
  }, [rawEntries]);

  function computeSeedSpeed(
    pkStart: string | null,
    isOddFlag: boolean | null
  ): SpeedInfo | null {
    if (!pkStart || isOddFlag === null) return null;

    // IMPORTANT :
    // on reprend exactement la même orientation que rawEntries
    // pour éviter un seed calculé dans le mauvais sens.
    let baseOriented: FTEntry[];
    if (isOddFlag) {
      baseOriented = getFtLignePair(trainNumber);
    } else {
      baseOriented = [...getFtLigneImpair(trainNumber)].reverse();
    }

    const idxStart = baseOriented.findIndex(
      (e) => !e.isNoteOnly && e.pk === pkStart
    );

    let currentSpeed: number | null = null;
    let currentHighlight = false;

    if (idxStart > 0) {
      for (let i = 0; i < idxStart; i++) {
        const e = baseOriented[i];
        if (typeof e.vmax === "number" && !isNaN(e.vmax)) {
          currentSpeed = e.vmax;
          currentHighlight = !!(e as any).vmax_highlight;
        }
      }
    }

    console.log("[VMAX SEED DEBUG]", JSON.stringify({
      pkStart,
      isOddFlag,
      idxStart,
      first10: baseOriented
        .filter((e) => !e.isNoteOnly && e.pk)
        .slice(0, 10)
        .map((e) => ({
          pk: e.pk,
          vmax: e.vmax ?? null,
          dependencia: e.dependencia ?? "",
        })),
      currentSpeed,
      currentHighlight,
    }));

    if (idxStart <= 0 || currentSpeed === null) return null;

    return { v: currentSpeed, highlight: currentHighlight };
  }

  const seedSpeed = useMemo(
    () => computeSeedSpeed(firstVisiblePk, isOdd),
    [firstVisiblePk, isOdd]
  );

  const { speedMap, breakpointsArr } = useMemo(
    () => extractSpeedTimeline(rawEntries, seedSpeed),
    [rawEntries, seedSpeed]
  );

  const breakpointsSet = useMemo(
    () => new Set<string>(breakpointsArr),
    [breakpointsArr]
  );

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

  //
  // ===== 6. CONSTRUCTION DU TBODY ====================================
  //
  const rows: JSX.Element[] = [];

  function isEligible(e: FTEntry): boolean {
    if ((e as any).isNoteOnly) return false;

    // Les heures détectées (ft:heures) sont celles de la FT Espagne (ADIF).
    // Quand on affiche la FT complète (avec la partie France), certaines lignes "techniques"
    // ne doivent PAS consommer le curseur d'heures, sinon décalage global.
const net = (e as any).network as string | undefined;

// ✅ Train whitelisté => les heures détectées proviennent de la FT ADIF,
// donc seules les lignes ADIF consomment le curseur (sinon décalage).
const hasFranceFtLocal = !!trainNumber && FT_FR_WHITELIST.has(trainNumber);
if (hasFranceFtLocal) {
  if (net && net !== "ADIF") return false; // exclut RFN + LFP + tout le reste
} else {
  // garde-fou historique
  if (net === "RFN") return false;
}

    const s = (e.pk ?? "").toString().trim();
    const d = (e.dependencia ?? "").toString().trim();

    // Exclure les lignes techniques intermédiaires (elles n'ont pas d'heure dans le PDF ADIF)
    const dUp = d.toUpperCase();
    if (
      dUp.includes("LFP PK") ||
      dUp.includes("POINT TECHNIQUE") ||
      dUp.includes("LIMITE RFN")
    ) {
      return false;
    }

    return s.length > 0 && d.length > 0;
  }

  const eligibleIndices: number[] = [];

  // --- Pré-calcul des segments de vitesse ---
  const speedSegmentIndex: number[] = [];
  const segmentPkLists = new Map<number, string[]>();

  let currentSegmentId = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];

    if (!e.isNoteOnly && e.pk) {
      const pk = e.pk;
      const isBreakpoint =
        breakpointsSet.has(pk) && pk !== firstPk && pk !== lastPk;

      if (currentSegmentId === 0) {
        currentSegmentId = 1;
      }

      if (isBreakpoint && i !== 0) {
        currentSegmentId++;
      }

      speedSegmentIndex[i] = currentSegmentId;

      if (!segmentPkLists.has(currentSegmentId)) {
        segmentPkLists.set(currentSegmentId, []);
      }
      segmentPkLists.get(currentSegmentId)!.push(pk);
    } else {
      speedSegmentIndex[i] = currentSegmentId;
    }
  }

  const segmentLabelRowIndex = new Map<number, number>();
  const segmentSpeed = new Map<number, SpeedInfo>();

  {
    for (let i = 0; i < rawEntries.length; i++) {
      const segId = speedSegmentIndex[i] ?? 0;
      if (segId <= 0) continue;

      if (segmentLabelRowIndex.has(segId)) continue;

      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;

      segmentLabelRowIndex.set(segId, i);
    }

    for (const [segId, pkList] of segmentPkLists.entries()) {
      let info: SpeedInfo | null = null;
      for (const pk of pkList) {
        const s = speedMap[pk];
        if (s) {
          info = s;
          break;
        }
      }
      if (info) {
        segmentSpeed.set(segId, info);
      }
    }
  }
   // --- Pré-calcul des segments Radio (logique propagation + changement de valeur) ---
  const radioSegmentIndex: number[] = [];
  const radioLabelRowIndex = new Map<number, number>();
  const radioValueBySeg = new Map<number, string>();

  {
    let currentRadioSegId = 0;
    let propagatedRadio = "";
    let previousSegmentValue = "";

    for (let i = 0; i < rawEntries.length; i++) {
      const e: any = rawEntries[i];

      if (e?.isNoteOnly) {
        radioSegmentIndex[i] = currentRadioSegId;
        continue;
      }

      const rawVal = String(e?.radio ?? "").trim();

      // Une nouvelle valeur explicite remplace la valeur propagée
      if (rawVal) {
        propagatedRadio = rawVal;
      }

      // Tant qu'on n'a encore aucune valeur radio, pas de segment exploitable
      if (!propagatedRadio) {
        radioSegmentIndex[i] = 0;
        continue;
      }

      // Nouveau segment au premier texte radio rencontré,
      // puis à chaque changement de valeur radio
      if (currentRadioSegId === 0 || propagatedRadio !== previousSegmentValue) {
        currentRadioSegId++;

        if (!radioLabelRowIndex.has(currentRadioSegId)) {
          radioLabelRowIndex.set(currentRadioSegId, i);
        }

        radioValueBySeg.set(currentRadioSegId, propagatedRadio);
        previousSegmentValue = propagatedRadio;
      }

      radioSegmentIndex[i] = currentRadioSegId;
    }
  }

  console.log(
    "[RADIO SEGMENTS JSON]",
    JSON.stringify(Array.from(radioValueBySeg.entries()))
  );

  // --- Pré-calcul des segments Bloqueo (recalculés dans l’ordre affiché) ---
  const bloqueoSegmentIndex: number[] = [];
  const bloqueoLabelRowIndex = new Map<number, number>();
  const bloqueoValueBySeg = new Map<number, string>();
  const bloqueoBarRows = new Set<number>();

  {
    let currentBloqueoSegId = 0;
    let prevValue = "";
    let previousDataRowIndex: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e: any = rawEntries[i];

      if (e?.isNoteOnly) {
        bloqueoSegmentIndex[i] = currentBloqueoSegId;
        continue;
      }

      const val = String(e?.bloqueo ?? "").trim();

      if (val && val !== prevValue) {
        // À partir du 2e segment, la barre se place sur la ligne de données
        // juste avant le nouveau texte de Bloqueo.
        if (currentBloqueoSegId > 0 && previousDataRowIndex !== null) {
          bloqueoBarRows.add(previousDataRowIndex);
        }

        currentBloqueoSegId =
          currentBloqueoSegId === 0 ? 1 : currentBloqueoSegId + 1;
        prevValue = val;

        if (!bloqueoLabelRowIndex.has(currentBloqueoSegId)) {
          bloqueoLabelRowIndex.set(currentBloqueoSegId, i);
        }
        bloqueoValueBySeg.set(currentBloqueoSegId, val);
      }

      bloqueoSegmentIndex[i] = currentBloqueoSegId;
      previousDataRowIndex = i;
    }
  }

  // --- Pré-calcul du type de surlignage CSV (stratégie historique basée sur CSV_ZONES) ---
  const csvHighlightByIndex: ("none" | "full" | "top" | "bottom")[] = [];

  // Par défaut : aucun surlignage
  for (let i = 0; i < rawEntries.length; i++) {
    csvHighlightByIndex[i] = "none";
  }

  // Première vraie ligne affichée
  const firstDisplayedDataIndex = (() => {
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (!e.pk || e.isNoteOnly) continue;

      const pkNum = Number(e.pk);
      if (Number.isNaN(pkNum)) continue;

      return i;
    }
    return -1;
  })();

  // Règle métier :
  // si la première vraie ligne affichée appartient déjà à une zone CSV,
  // alors cette première zone visible ne doit pas être surlignée.
  let firstVisibleCsvZoneSkipped = false;

  if (currentCsvSens) {
    const zonesForSens = CSV_ZONES.filter((z) => z.sens === currentCsvSens);

    for (const zone of zonesForSens) {
      const pkMin = Math.min(zone.pkFrom, zone.pkTo);
      const pkMax = Math.max(zone.pkFrom, zone.pkTo);

      const matchingIndices: number[] = [];

      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (!e.pk || e.isNoteOnly) continue;

        const pkNum = Number(e.pk);
        if (Number.isNaN(pkNum)) continue;

        if (pkNum >= pkMin && pkNum <= pkMax) {
          matchingIndices.push(i);
        }
      }

      if (matchingIndices.length === 0) continue;

      const firstZoneIsAlreadyOpenAtTop =
        !firstVisibleCsvZoneSkipped &&
        firstDisplayedDataIndex >= 0 &&
        matchingIndices.includes(firstDisplayedDataIndex);

      if (firstZoneIsAlreadyOpenAtTop) {
        firstVisibleCsvZoneSkipped = true;

        console.log(
          "[CSV FIRST ZONE SKIPPED FT]",
          JSON.stringify({
            sens: currentCsvSens,
            firstDisplayedDataIndex,
            zone: {
              pkFrom: zone.pkFrom,
              pkTo: zone.pkTo,
            },
            matchingIndices,
            matchingPks: matchingIndices.map((idx) => rawEntries[idx]?.pk ?? ""),
          })
        );

        continue;
      }

      if (matchingIndices.length === 1) {
        csvHighlightByIndex[matchingIndices[0]] = "full";
        continue;
      }

      for (let j = 0; j < matchingIndices.length; j++) {
        const idx = matchingIndices[j];

        if (j === 0) {
          csvHighlightByIndex[idx] = "bottom";
        } else if (j === matchingIndices.length - 1) {
          csvHighlightByIndex[idx] = "top";
        } else {
          csvHighlightByIndex[idx] = "full";
        }
      }
    }
  }

  // --- Réconciliation CSV stratégie B ---
  // Désactivée temporairement pour vérifier si elle casse le rendu historique.
  // On conserve uniquement la logique historique basée sur CSV_ZONES.

  console.log(
    "[CSV ZONES JSON]",
    JSON.stringify({
      sens: currentCsvSens,
      zones: currentCsvSens ? CSV_ZONES.filter((z) => z.sens === currentCsvSens) : [],
      rows: rawEntries.map((e: any, i: number) => ({
        i,
        pk: e?.pk ?? "",
        note: !!e?.isNoteOnly,
        highlight: csvHighlightByIndex[i],
      })),
    })
  );

  console.log(
    "[CSV GIRONA WINDOW FT]",
    JSON.stringify({
      sens: currentCsvSens,
      zones: (currentCsvSens ? CSV_ZONES.filter((z) => z.sens === currentCsvSens) : []).filter(
        (z) => {
          const pkMin = Math.min(z.pkFrom, z.pkTo);
          const pkMax = Math.max(z.pkFrom, z.pkTo);
          return pkMin <= 715.5 && pkMax >= 714.7;
        }
      ),
      rows: rawEntries
        .map((e: any, i: number) => ({
          i,
          pk: e?.pk ?? "",
          dependencia: e?.dependencia ?? "",
          note: !!e?.isNoteOnly,
          csv: !!e?.csv,
          highlight: csvHighlightByIndex[i],
        }))
        .filter((row) =>
          ["716.8", "715.5", "714.7", "713.2", "710.7"].includes(row.pk)
        ),
    })
  );

  console.log(
    "[CSV LA SAGRERA WINDOW FT]",
    JSON.stringify({
      sens: currentCsvSens,
      zones: (currentCsvSens ? CSV_ZONES.filter((z) => z.sens === currentCsvSens) : []).filter(
        (z) => {
          const pkMin = Math.min(z.pkFrom, z.pkTo);
          const pkMax = Math.max(z.pkFrom, z.pkTo);
          return pkMin <= 629.4 && pkMax >= 627.7;
        }
      ),
      rows: rawEntries
        .map((e: any, i: number) => ({
          i,
          pk: e?.pk ?? "",
          dependencia: e?.dependencia ?? "",
          note: !!e?.isNoteOnly,
          csv: !!e?.csv,
          highlight: csvHighlightByIndex[i],
        }))
        .filter((row) => row.i >= 4 && row.i <= 11),
    })
  );

  console.log(
    "[CSV BARCELONA SANTS WINDOW FT]",
    JSON.stringify({
      sens: currentCsvSens,
      zones: (currentCsvSens ? CSV_ZONES.filter((z) => z.sens === currentCsvSens) : []).filter(
        (z) => {
          const pkMin = Math.min(z.pkFrom, z.pkTo);
          const pkMax = Math.max(z.pkFrom, z.pkTo);
          return pkMin <= 621.7 && pkMax >= 621.0;
        }
      ),
      rows: rawEntries
        .map((e: any, i: number) => ({
          i,
          pk: e?.pk ?? "",
          dependencia: e?.dependencia ?? "",
          note: !!e?.isNoteOnly,
          csv: !!e?.csv,
          highlight: csvHighlightByIndex[i],
        }))
        .filter((row) =>
          ["623.8", "621.7", "621.0"].includes(row.pk)
        ),
    })
  );

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];
    if (isEligible(e)) eligibleIndices.push(i);
  }

  const totalEligible = eligibleIndices.length;
  const assignedCount = Math.min(heuresDetectees.length, totalEligible);
  console.log(
    "[FT] Mapping heures -> lignes éligibles (S&D):",
    `${assignedCount}/${totalEligible}`,
    {
      eligibleIndices: eligibleIndices.slice(0, 30),
      heures: heuresDetectees.slice(0, assignedCount),
    }
  );

  let heuresDetecteesCursor = 0;
  let previousHoraForConc: string | null = null;

  const firstNonNoteIndex = (() => {
    for (let i = 0; i < rawEntries.length; i++) {
      if (!rawEntries[i].isNoteOnly) return i;
    }
    return -1;
  })();

  useEffect(() => {
    firstNonNoteIndexRef.current = firstNonNoteIndex;
  }, [firstNonNoteIndex]);

  const lastNonNoteIndex = (() => {
    for (let i = rawEntries.length - 1; i >= 0; i--) {
      if (!rawEntries[i].isNoteOnly) return i;
    }
    return -1;
  })();

  function parseHoraToMinutes(h?: string | null): number | null {
    if (!h) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
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
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}`;
  }

    // ============================================================
  // Export heures Figueres (départ + arrivée) depuis la FT Espagne
  // ============================================================
  const figueresTimes = useMemo(() => {
    // 1) trouver l'index de FIGUERES-VILAFANT
    let figIdx: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] as any;
      if (e?.isNoteOnly) continue;

      const depNorm = (e?.dependencia ?? "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();

      if (depNorm === "FIGUERES-VILAFANT") {
        figIdx = i;
        break;
      }
    }

    if (figIdx == null) {
      return { departureHhmm: null as string | null, arrivalHhmm: null as string | null };
    }

    // 2) heure de départ (même logique que l’affichage)
    const departure = resolveHoraForRowIndex(figIdx);
    const departureHhmm = departure && departure.trim() ? departure.trim() : null;

    // 3) heure d’arrivée = départ - COM (même logique que l’affichage)
    let arrivalHhmm: string | null = null;

    const isOriginOrTerminus = figIdx === firstNonNoteIndex || figIdx === lastNonNoteIndex;

    if (departureHhmm && !isOriginOrTerminus) {
      const codesPourHeure = codesCParHeure[departureHhmm] ?? [];
      const firstCode = codesPourHeure[0];
      const n = Number(firstCode);

      if (Number.isFinite(n) && n > 0) {
        const depMinutes = parseHoraToMinutes(departureHhmm);
        if (depMinutes != null) {
          const arrMinutes = depMinutes - n;
          arrivalHhmm = formatMinutesToHora(arrMinutes);
        }
      }
    }

    return { departureHhmm, arrivalHhmm };
  }, [
    rawEntries,
    codesCParHeure,
    heuresDetectees,
    firstNonNoteIndex,
    lastNonNoteIndex,
  ]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("ft:figueres-hhmm", {
        detail: {
          departureHhmm: figueresTimes.departureHhmm,
          arrivalHhmm: figueresTimes.arrivalHhmm,
        },
      })
    );

    // Debug léger (tu peux enlever après validation)
    console.log("[FT] ft:figueres-hhmm", figueresTimes);
  }, [figueresTimes.departureHhmm, figueresTimes.arrivalHhmm]);

  // ===== Horaires théoriques (interpolation PK ↔ temps) =====
  // ✅ Règle : entre A -> B, on interpole de :
  // - départ(A)
  // - arrivée(B) si elle existe, sinon départ(B)
  const horaTheoMinutesByIndex = useMemo(() => {
    // 1) Reconstruire les heures de DÉPART par index (même logique que l'affichage)
    const departMinutesByIndex: Array<number | null> = new Array(rawEntries.length).fill(null);
    const departHoraTextByIndex: Array<string | null> = new Array(rawEntries.length).fill(null);

    let cursor = 0;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if ((e as any).isNoteOnly) continue;

      const eligible = isEligible(e);

      // ✅ Source "Espagne" (ADIF) : heures détectées si la ligne est éligible, sinon e.hora
      const horaAssigned =
        eligible && cursor < heuresDetectees.length
          ? heuresDetectees[cursor]
          : ((e as any).hora ?? "");

      if (eligible && cursor < heuresDetectees.length) cursor++;

      // ✅ Source "France" (même logique que l'affichage)
      const net = (e as any).network as ("RFN" | "LFP" | "ADIF" | undefined);

      let horaFrance = "";
      if (net === "RFN" || net === "LFP") {
        const sitKm =
          net === "RFN"
            ? ((e as any).pk_rfn ?? "")
            : ((e as any).pk_lfp ?? "");

        const pkKey = (sitKm ?? "").toString().replace(".", ",");
        const v = getFtFranceHhmm(trainNumber, pkKey);
        horaFrance = typeof v === "string" ? v.trim() : "";
      }

      // ✅ Priorité : heure ADIF/assignée si présente, sinon heure France
      const horaText = (
        (typeof horaAssigned === "string" ? horaAssigned.trim() : "") ||
        horaFrance
      ).trim();

      departHoraTextByIndex[i] = horaText.length > 0 ? horaText : null;
      departMinutesByIndex[i] = parseHoraToMinutes(horaText);
    }

    // 2) Calculer les minutes d'ARRIVÉE pour B si possible (arrivée = départ - COM)
    const arrivalMinutesByIndex: Array<number | null> = new Array(rawEntries.length).fill(null);

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if ((e as any).isNoteOnly) continue;

      const depMin = departMinutesByIndex[i];
      const horaText = departHoraTextByIndex[i];
      if (depMin == null || !horaText) continue;

      const depNorm = (e.dependencia ?? "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();

      const isVoyageursStop =
        depNorm === "BARCELONA SANTS" ||
        depNorm === "LA SAGRERA AV" ||
        depNorm === "GIRONA" ||
        depNorm === "FIGUERES-VILAFANT";

      const isOriginOrTerminus = i === firstNonNoteIndex || i === lastNonNoteIndex;

      if (!isVoyageursStop || isOriginOrTerminus) continue;

      const codesPourHeure = codesCParHeure[horaText] ?? [];
      const firstCode = codesPourHeure[0];
      const n = Number(firstCode);

      if (Number.isFinite(n) && n > 0) {
        arrivalMinutesByIndex[i] = depMin - n;
      }
    }

    // 3) Interpoler entre ancres consécutives (PK + minute de départ)
    const out: Array<number | null> = [...departMinutesByIndex];

    const getPkNum = (idx: number): number | null => {
      const pkStr = rawEntries[idx]?.pk;
      const pkNum =
        typeof pkStr === "string" || typeof pkStr === "number" ? Number(pkStr) : NaN;
      return Number.isFinite(pkNum) ? pkNum : null;
    };

    let lastAnchorIndex: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if ((e as any).isNoteOnly) continue;

      const depB = departMinutesByIndex[i];
      const pkB = getPkNum(i);
      if (depB == null || pkB == null) continue;

      if (lastAnchorIndex == null) {
        lastAnchorIndex = i;
        continue;
      }

      const a = lastAnchorIndex;
      const depA = departMinutesByIndex[a];
      const pkA = getPkNum(a);

      if (depA == null || pkA == null) {
        lastAnchorIndex = i;
        continue;
      }

      // ✅ fin de segment = arrivée(B) si dispo, sinon départ(B)
      const endB = arrivalMinutesByIndex[i] ?? depB;

      const denom = pkB - pkA;
      if (denom === 0) {
        lastAnchorIndex = i;
        continue;
      }

      for (let k = a + 1; k < i; k++) {
        if ((rawEntries[k] as any)?.isNoteOnly) continue;
        if (out[k] != null) continue;

        const pkK = getPkNum(k);
        if (pkK == null) continue;

        let t = (pkK - pkA) / denom; // 0 à A, 1 à B
        if (t < 0) t = 0;
        if (t > 1) t = 1;

        const mk = depA + t * (endB - depA);

        // ✅ garde-fou : ne jamais dépasser les bornes du segment (arrondi inclus)
        const lo = Math.min(depA, endB);
        const hi = Math.max(depA, endB);
        const mkClamped = Math.min(Math.max(mk, lo), hi);

        out[k] = Math.round(mkClamped);
      }

      lastAnchorIndex = i;
    }

    return out;
  }, [rawEntries, heuresDetectees, codesCParHeure, trainNumber]);

  // ===== Horaires théoriques en SECONDES (pondérés par Vmax) — mode test =====
  // Objectif : progression plus réaliste quand Vmax varie + suppression des doublons HH:MM
  // ===== Horaires théoriques en SECONDES (pondérés par Vmax) — mode test =====
  // Objectif : progression plus réaliste quand Vmax varie + suppression des doublons HH:MM
  const horaTheoSecondsByIndex = useMemo(() => {
    if (!testModeEnabled) {
      return new Array<number | null>(rawEntries.length).fill(null);
    }

    const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

    const getPkNum = (idx: number): number | null => {
      const pkStr = rawEntries[idx]?.pk;
      const pkNum =
        typeof pkStr === "string" || typeof pkStr === "number" ? Number(pkStr) : NaN;
      return Number.isFinite(pkNum) ? pkNum : null;
    };

    const getVmaxForIndex = (idx: number): number | null => {
      const e = rawEntries[idx] as any;
      const v = typeof e?.vmax === "number" ? e.vmax : null;
      return v != null && Number.isFinite(v) && v > 0 ? v : null;
    };

    // --------
    // 1) Recalcul des ancres uniquement (départs + arrivées possibles)
    //    (copie contrôlée de la logique de horaTheoMinutesByIndex)
    // --------
    const departMinutesByIndex: Array<number | null> = new Array(rawEntries.length).fill(null);
    const departHoraTextByIndex: Array<string | null> = new Array(rawEntries.length).fill(null);

    let cursor = 0;
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] as any;
      if (e?.isNoteOnly) continue;

      const eligible = isEligible(rawEntries[i]);

      const horaFromNormalized =
        typeof e?.hora === "string" ? e.hora.trim() : "";

      const horaFromPdf =
        eligible && cursor < heuresDetectees.length
          ? heuresDetectees[cursor]
          : "";

      if (eligible && cursor < heuresDetectees.length) cursor++;

      const horaText = (horaFromNormalized || horaFromPdf).trim();
      departHoraTextByIndex[i] = horaText.length > 0 ? horaText : null;

      // parseHoraToMinutes existe déjà dans ton fichier
      departMinutesByIndex[i] = parseHoraToMinutes(horaText);
    }

    const arrivalMinutesByIndex: Array<number | null> = new Array(rawEntries.length).fill(null);

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] as any;
      if (e?.isNoteOnly) continue;

      const depMin = departMinutesByIndex[i];
      const horaText = departHoraTextByIndex[i];
      if (depMin == null || !horaText) continue;

      const depNorm = (rawEntries[i].dependencia ?? "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();

      const isVoyageursStop =
        depNorm === "BARCELONA SANTS" ||
        depNorm === "LA SAGRERA AV" ||
        depNorm === "GIRONA" ||
        depNorm === "FIGUERES-VILAFANT";

      const isOriginOrTerminus = i === firstNonNoteIndex || i === lastNonNoteIndex;
      if (!isVoyageursStop || isOriginOrTerminus) continue;

      const codesPourHeure = codesCParHeure[horaText] ?? [];
      const firstCode = codesPourHeure[0];
      const n = Number(firstCode);

      if (Number.isFinite(n) && n > 0) {
        arrivalMinutesByIndex[i] = depMin - n;
      }
    }

    // --------
    // 2) Construire les ancres en secondes (UNIQUEMENT sur les vrais points)
    //    - l’ancre i porte depMin (départ) en secondes
    //    - et pour la borne de segment B, on utilisera arrival(B) si dispo sinon depart(B)
    // --------
    const anchorSecByIndex: Array<number | null> = new Array(rawEntries.length).fill(null);
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] as any;
      if (e?.isNoteOnly) continue;

      const depMin = departMinutesByIndex[i];
      const pk = getPkNum(i);
      if (depMin == null || pk == null) continue;

      anchorSecByIndex[i] = Math.round(depMin * 60);
    }

    // --------
    // 3) Remplissage pondéré Vmax entre ancres successives
    // --------
    const out: Array<number | null> = new Array(rawEntries.length).fill(null);

    let lastAnchorIndex: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] as any;
      if (e?.isNoteOnly) continue;

      const depB = departMinutesByIndex[i];
      const pkB = getPkNum(i);
      if (depB == null || pkB == null) continue;

      if (lastAnchorIndex == null) {
        // première ancre rencontrée
        out[i] = Math.round(depB * 60);
        lastAnchorIndex = i;
        continue;
      }

      const a = lastAnchorIndex;

      const depA = departMinutesByIndex[a];
      const pkA = getPkNum(a);
      if (depA == null || pkA == null) {
        lastAnchorIndex = i;
        continue;
      }

      // borne B = arrivée(B) si dispo, sinon départ(B)
      const endB = arrivalMinutesByIndex[i] ?? depB;

      const secA = Math.round(depA * 60);
      const secB = Math.round(endB * 60);

            // 🔎 DEBUG (uniquement 1er segment) : comprendre les "téléportations" au début
      if (a === lastAnchorIndex && a === 0) {
        try {
          const pkA_dbg = getPkNum(a);
          const pkB_dbg = getPkNum(i);

          const arrB_dbg = arrivalMinutesByIndex[i];

          const fmtMin = (m: number | null) => {
            if (m == null) return null;
            const hh = Math.floor((((m % (24 * 60)) + (24 * 60)) % (24 * 60)) / 60);
            const mm = (((m % (24 * 60)) + (24 * 60)) % (24 * 60)) % 60;
            const pad = (n: number) => n.toString().padStart(2, "0");
            return `${pad(hh)}:${pad(mm)}`;
          };

          console.log(
            "[FT][horaTheoSeconds][SEG0_JSON]",
            JSON.stringify(
              {
                A: { idx: a, pk: pkA_dbg, depA_raw: depA, secA },
                B: { idx: i, pk: pkB_dbg, depB_raw: depB, endB_raw: endB, secB },
                arrivalB_raw: arrB_dbg,
                deltaSec: secB - secA,
              },
              null,
              0
            )
          );

        } catch (err) {
          console.warn("[FT][horaTheoSeconds][SEG0] debug failed", err);
        }
      }


      out[a] = secA;
      out[i] = Math.round(depB * 60); // on garde l’affichage “départ B” sur la ligne B (cohérent avec ta colonne)

      const totalSec = secB - secA;
      const totalAbs = Math.abs(totalSec);
      if (totalAbs === 0) {
        lastAnchorIndex = i;
        continue;
      }

      // segments entre a -> i (uniquement sur les points PK valides)
      type Seg = { idxTo: number; w: number };
      const segs: Seg[] = [];

      // 1) Liste des indices ayant un PK exploitable entre a..i
      const idxPts: number[] = [];
      for (let k = a; k <= i; k++) {
        const ee = rawEntries[k] as any;
        if (ee?.isNoteOnly) continue;
        const pkK = getPkNum(k);
        if (pkK == null) continue;
        idxPts.push(k);
      }

      // 2) Construire les segments entre points successifs valides
      for (let j = 0; j < idxPts.length - 1; j++) {
        const k0 = idxPts[j];
        const k1 = idxPts[j + 1];

        const pk0 = getPkNum(k0);
        const pk1 = getPkNum(k1);
        if (pk0 == null || pk1 == null) continue;

        const dKm = Math.abs(pk1 - pk0);
        if (!Number.isFinite(dKm) || dKm <= 0) continue;

        // Vmax applicable : priorité au "début" du segment
        const v = getVmaxForIndex(k0) ?? getVmaxForIndex(k1) ?? 120;
        const w = dKm / v;

        segs.push({ idxTo: k1, w });
      }

      const W = segs.reduce((s, it) => s + it.w, 0);

      // fallback linéaire PK si W invalide
      if (!Number.isFinite(W) || W <= 0) {
        const denom = pkB - pkA;
        if (denom === 0) {
          lastAnchorIndex = i;
          continue;
        }

        for (let k = a + 1; k < i; k++) {
          const ee = rawEntries[k] as any;
          if (ee?.isNoteOnly) continue;
          if (out[k] != null) continue;

          const pkK = getPkNum(k);
          if (pkK == null) continue;

          let t = (pkK - pkA) / denom;
          t = clamp(t, 0, 1);

          const sk = secA + t * (secB - secA);
          const lo = Math.min(secA, secB);
          const hi = Math.max(secA, secB);
          out[k] = Math.round(clamp(sk, lo, hi));
        }

        lastAnchorIndex = i;
        continue;
      }

      // cumul pondéré
      let cum = 0;
      const cumByIndex = new Map<number, number>();
      for (const seg of segs) {
        cum += seg.w;
        cumByIndex.set(seg.idxTo, cum);
      }

      // remplissage
      for (let k = a + 1; k < i; k++) {
        const ee = rawEntries[k] as any;
        if (ee?.isNoteOnly) continue;
        if (out[k] != null) continue;

        const cumK = cumByIndex.get(k);
        if (cumK == null) continue;

        const t = clamp(cumK / W, 0, 1);
        const sk = secA + t * (secB - secA);
        const lo = Math.min(secA, secB);
        const hi = Math.max(secA, secB);
        out[k] = Math.round(clamp(sk, lo, hi));
      }

      lastAnchorIndex = i;
    }

    // Si certaines cases restent null (avant la première ancre), on laisse null.
    return out;
  }, [testModeEnabled, rawEntries, heuresDetectees, codesCParHeure, firstNonNoteIndex, lastNonNoteIndex]);


  // Gestion RC
  let rcCurrentSegmentId = 0;
  const rcPrintedSegments = new Set<number>();

  // Gestion Bloqueo/Sen-SIG (scroll intelligent)
  const bloqueoPrintedSegments = new Set<number>();

  // Gestion VMax (scroll intelligent)
  const vPrintedSegments = new Set<number>();

  // Gestion Radio (logique type VMAX)
  let radioCurrentSegmentId = 0;
  const radioPrintedSegments = new Set<number>();

  // Debug : index de ligne visuelle (toutes les <tr> rendues)
  let renderedRowIndex = 0;

  // CSV : état "zone ouverte" entre un bottom et un top
  let csvZoneOpen = false;
  // compteur des VRAIES lignes principales (<tr className="ft-row-main">)
  let mainRowCounter = 0;

  const arrivalEvents: { arrivalMin: number; rowIndex: number }[] = [];

  // Gestion des clics sur le corps de la FT :
  // - en mode horaire actif : sélection de la ligne la plus proche => Standby
  // - en standby : même mécanique, clic près d'une autre ligne => changement de sélection
  // - la sortie du standby se fait uniquement via le bouton Play
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // En mode GPS, le clic sur la fiche train ne doit jamais déclencher Standby / recalage
    if (referenceModeRef.current === "GPS") {
      return;
    }

    const container = e.currentTarget;
    const clickY = e.clientY;

    const isStandby =
      !autoScrollEnabled &&
      recalibrateFromRowRef.current !== null &&
      selectedRowIndex !== null;

    const mainRows =
      container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
    if (!mainRows.length) return;

    let bestRow: HTMLTableRowElement | null = null;
    let bestIndex = -1;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < mainRows.length; idx++) {
      const tr = mainRows[idx];

      // On ne considère que les lignes "calibrables" : horaire + dependencia présents
      const tdHora = tr.querySelector<HTMLTableCellElement>("td:nth-child(6)");

      const horaDep = tr.querySelector<HTMLSpanElement>(
        "td:nth-child(6) .ft-hora-depart"
      );
      const horaTheo = tr.querySelector<HTMLSpanElement>(
        "td:nth-child(6) .ft-hora-theo"
      );

      // 1) source "structurée" (spans) : depart prioritaire, sinon theo
      let horaText = ((horaDep?.textContent ?? horaTheo?.textContent) ?? "").trim();

      // 2) fallback : texte brut de la cellule (utile si FR n’utilise pas ces spans)
      if (!horaText) {
        const raw = (tdHora?.textContent ?? "").trim();
        const mAny = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
        if (mAny) horaText = mAny[0];
      }

      const depCell = tr.querySelector<HTMLDivElement>(".ft-dependencia-cell");
      let depText = (depCell?.textContent ?? "").trim();

      // fallback : colonne Dependencia (structure FR possible)
      if (!depText) {
        const tdDep = tr.querySelector<HTMLTableCellElement>("td:nth-child(4)");
        depText = (tdDep?.textContent ?? "").trim();
      }

      const hasHoraAndDep = !!horaText && !!depText;
      if (!hasHoraAndDep) {
        continue;
      }

      const rect = tr.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(clickY - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestRow = tr;
        bestIndex = idx;
      }
    }

    // Aucune ligne "valide" (avec horaire + dependencia) trouvée à proximité
    if (!bestRow) {
      return;
    }

    const dataIndexAttr = bestRow.getAttribute("data-ft-row");
    const rowIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : bestIndex;

    if (!Number.isFinite(rowIndex)) {
      return;
    }

    // ✅ En standby : même mécanique que pour l'entrée initiale
    // On prend la ligne la plus proche, mais sans relancer le mode horaire
    if (isStandby) {
      if (selectedRowIndex === rowIndex) {
        return;
      }

      setSelectedRowIndex(rowIndex);
      setActiveRowIndex(rowIndex);
      recalibrateFromRowRef.current = rowIndex;
      standbyLockedRowRef.current = rowIndex;

      logTestEvent("ui:standby:move-selection", {
        rowIndex,
        hora: resolveHoraForRowIndex(rowIndex) || null,
        pk: rawEntries[rowIndex]?.pk ?? null,
        dependencia: rawEntries[rowIndex]?.dependencia ?? null,
        source: "ft:body-click-nearest",
      });

      return;
    }

    // Si on n'est pas en auto-scroll (avant Play ou en pause normale), on ne fait rien
    if (!autoScrollEnabled) {
      return;
    }

    // Entrée initiale en standby
    setSelectedRowIndex(rowIndex);
    setActiveRowIndex(rowIndex);
    recalibrateFromRowRef.current = rowIndex;
    standbyLockedRowRef.current = rowIndex;

    logTestEvent("ui:standby:enter", {
      rowIndex,
      hora: resolveHoraForRowIndex(rowIndex) || null,
      pk: rawEntries[rowIndex]?.pk ?? null,
      dependencia: rawEntries[rowIndex]?.dependencia ?? null,
      autoScrollWasEnabled: autoScrollEnabled,
      source: "ft:body-click-nearest",
    });

    window.dispatchEvent(
  new CustomEvent("lim:hourly-mode", {
    detail: { enabled: true, standby: true },
  })
);

  };

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];

    const isSelected = selectedRowIndex === i;

    if (entry.isNoteOnly) {
      continue;
    }

    const nextEntry = rawEntries[i + 1];
    const hasNoteAfter = nextEntry && nextEntry.isNoteOnly === true;

    const net = (entry as any).network as ("RFN" | "LFP" | "ADIF" | undefined);

const sitKm =
  entry.isNoteOnly
    ? ""
    : net === "RFN"
      ? ((entry as any).pk_rfn ?? "")
      : net === "LFP"
        ? ((entry as any).pk_lfp ?? "")
        : net === "ADIF"
          ? ((entry as any).pk_adif ?? entry.pk ?? "")
          : (entry.pk ?? "");

// FT France : lookup horaire (clé = PK affiché, mais en virgule comme dans ftFranceTimes)
const pkKey = (sitKm ?? "").toString().replace(".", ",");

const eligible = isEligible(entry);

const horaFromNormalized =
  typeof (entry as any).hora === "string"
    ? (entry as any).hora.trim()
    : "";

const horaFromPdf =
  eligible && heuresDetecteesCursor < heuresDetectees.length
    ? heuresDetectees[heuresDetecteesCursor]
    : "";

// Heures France (si dispo) : lookup par n° de train + PK "à la française" (virgule)
const horaFrance =
  net === "RFN" || net === "LFP"
    ? getFtFranceHhmm(trainNumber, pkKey)
    : "";

const hora = horaFromNormalized || horaFromPdf || horaFrance;

    const depNorm = (entry.dependencia ?? "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();

    const isVoyageursStop =
      depNorm === "BARCELONA SANTS" ||
      depNorm === "LA SAGRERA AV" ||
      depNorm === "GIRONA" ||
      depNorm === "FIGUERES-VILAFANT";

    let com = "";
    let comMinutes: number | null = null;

    const isOriginOrTerminus =
      !entry.isNoteOnly &&
      (i === firstNonNoteIndex || i === lastNonNoteIndex);

    // Origine / destination utilisée pour le surlignage
    const isLimiteAdifLfspa = depNorm === "LIMITE ADIF - LFPSA";
    const isOriginOrDestinationForHighlight =
      isOriginOrTerminus && !isLimiteAdifLfspa;

    // ✅ COM : priorité au fichier normalisé, fallback PDF seulement si absent
    const comFromNormalizedRaw = (entry as any).com;
    const comFromNormalized =
      typeof comFromNormalizedRaw === "string"
        ? comFromNormalizedRaw.trim()
        : typeof comFromNormalizedRaw === "number" && Number.isFinite(comFromNormalizedRaw)
          ? String(comFromNormalizedRaw)
          : "";

    const comFromPdfList =
      hora && isVoyageursStop && !isOriginOrTerminus
        ? (codesCParHeure[hora] ?? [])
        : [];

    const comFromPdf =
      comFromPdfList.length > 0 ? comFromPdfList.join(" ").trim() : "";

    com = comFromNormalized || comFromPdf;

    if (com) {
      const firstCode = com.split(/\s+/)[0];
      const n = Number(firstCode);

      if (Number.isFinite(n)) {
        comMinutes = n;
      } else {
        console.warn(
          "[FT] Impossible de parser COM en minutes pour la ligne",
          i,
          "hora=",
          hora,
          "com=",
          com
        );
      }

      if (!comFromNormalized && comFromPdfList.length > 1) {
        console.warn(
          "[FT] Plusieurs codes C détectés pour la même heure",
          hora,
          comFromPdfList
        );
      }
    }

    if (eligible && heuresDetecteesCursor < heuresDetectees.length) {
      heuresDetecteesCursor++;
    }

    // ✅ TECN : priorité au fichier normalisé
    const tecnicoRaw =
      (entry as any).tecn ?? (entry as any).tecnico;

    const tecnico =
      typeof tecnicoRaw === "string"
        ? tecnicoRaw.trim()
        : typeof tecnicoRaw === "number" && Number.isFinite(tecnicoRaw)
          ? String(tecnicoRaw)
          : "";

    // ✅ CONC : priorité au fichier normalisé, sans recalcul local
    const concRaw = (entry as any).conc;
    const conc =
      typeof concRaw === "string"
        ? concRaw.trim()
        : typeof concRaw === "number" && Number.isFinite(concRaw)
          ? String(concRaw)
          : "";

    // ✅ Heure d'arrivée calculée à partir du COM effectivement retenu
    let horaArrivee: string | null = null;
    if (hora && comMinutes != null && comMinutes > 0) {
      const depMinutes = parseHoraToMinutes(hora);
      if (depMinutes != null) {
        const arrMinutes = depMinutes - comMinutes;
        horaArrivee = formatMinutesToHora(arrMinutes);

        // On mémorise cet événement d'arrivée pour l'auto-scroll horaire
        arrivalEvents.push({
          arrivalMin: arrMinutes,
          rowIndex: i,
        });
      }
    }

    const radio = (entry as any).radio ?? "";
    const bloqueo = (entry as any).bloqueo ?? "";
    const bloqueoBar = (entry as any).bloqueo_bar ?? null;

    // Arrêt : ligne principale avec COM ou TECN non vide
    const hasComOrTecnico =
      (com && com.trim() !== "") || (tecnico && tecnico.trim() !== "");
    const isStopMainForHighlight = !!(hora && hasComOrTecnico);

    // Flag final pour le surlignage (origine/destination ou arrêt)
    const shouldHighlightRow =
      isOriginOrDestinationForHighlight || isStopMainForHighlight;

    if (hora) {
      previousHoraForConc = hora;
    }

    // visibilité de la ligne principale dans le viewport
    const isCurrentlyVisible =
      i >= visibleRows.first && i <= visibleRows.last;

    // RC
    const isRcBreakpointHere =
      !!(entry as any).rc_bar && i !== firstNonNoteIndex;

    // avance dans les segments RC
    if (rcCurrentSegmentId === 0) {
      rcCurrentSegmentId = 1;
    } else if (isRcBreakpointHere) {
      rcCurrentSegmentId++;
    }

    const rawRamp =
      typeof (entry as any).rc === "number"
        ? (entry as any).rc.toString()
        : "";

    let ramp = "";

    // lignes principales visibles
    const visibleStart = visibleRows.first;
    const visibleEnd = visibleRows.last;
    const targetVisible = visibleStart + 1; // on vise la 2e ligne principale visible

    const isTargetVisibleRow =
      mainRowCounter >= targetVisible && mainRowCounter <= visibleEnd;

    if (
      !isRcBreakpointHere &&
      rawRamp !== "" &&
      rcCurrentSegmentId > 0 &&
      !rcPrintedSegments.has(rcCurrentSegmentId) &&
      isTargetVisibleRow
    ) {
      ramp = rawRamp;
      rcPrintedSegments.add(rcCurrentSegmentId);
    }

    const showRcBar = isRcBreakpointHere && i !== rawEntries.length - 1;

// Colonne N (ETCS) : valeur explicite uniquement, sans fallback ni propagation
const nivel =
  typeof (entry as any).etcs === "string"
    ? (entry as any).etcs.trim()
    : "";

    // --- Vitesse par segment ---
    const segId = speedSegmentIndex[i] ?? 0;
    const labelRowIndex =
      segId > 0 ? segmentLabelRowIndex.get(segId) ?? null : null;
    const speedInfo =
      segId > 0 ? segmentSpeed.get(segId) ?? null : null;

    const currentSpeedText =
      speedInfo && typeof speedInfo.v === "number"
        ? String(speedInfo.v)
        : "";

    const isLabelRow = labelRowIndex === i;



    // est-ce qu'il y a une barre de V sur CETTE ligne principale ?
    const isBreakpointRow =
      entry.pk &&
      breakpointsSet.has(entry.pk) &&
      entry.pk !== firstPk &&
      entry.pk !== lastPk;

    const showVBar = !!isBreakpointRow;

    if (
      !entry.isNoteOnly &&
      entry.pk &&
      ["805.5", "802.0", "799.7", "752.4"].includes(entry.pk)
    ) {
      console.log(
        "[VMAX ROW DEBUG]",
        JSON.stringify({
          i,
          pk: entry.pk,
          segId,
          labelRowIndex,
          isLabelRow,
          currentSpeedText,
          isBreakpointRow,
          showVBar,
        })
      );
    }

    // Contenu qui sera vraiment rendu plus bas
    let mainRowSpeedContent = "";
    let speedSpacerContent = "";

    // 1) CAS NORMAL : on est sur la ligne-label du segment
    if (isLabelRow && currentSpeedText) {
      if (showVBar) {
        // ligne label + barre → on met la Vmax dans la petite ligne
        speedSpacerContent = currentSpeedText;
      } else {
        // ligne label sans barre → on peut la mettre dans la cellule
        mainRowSpeedContent = currentSpeedText;
      }
    }
    // 2) CAS "SCROLL INTELLIGENT" : la vraie ligne du segment est sortie de l’écran
    else if (
      segId > 0 &&
      currentSpeedText &&
      !vPrintedSegments.has(segId)
    ) {
      // zone visible actuelle (sur les lignes PRINCIPALES)
      const visibleStart2 = visibleRows.first;
      const visibleEnd2 = visibleRows.last;

      // est-ce que la ligne-label de ce segment est visible ?
      const labelIsVisible =
        labelRowIndex !== null &&
        labelRowIndex >= visibleStart2 &&
        labelRowIndex <= visibleEnd2;

      // on ne réaffiche que si la ligne-label n'est plus visible
      if (!labelIsVisible) {
        // est-ce que cette ligne principale est dans le viewport ?
        const segStillVisible = i >= visibleStart2 && i <= visibleEnd2;

        // comme pour RC : on évite de coller la valeur sur la première ligne visible
        const targetVisible2 = visibleStart2 + 1;
        const isGoodSpot =
          mainRowCounter >= targetVisible2 && mainRowCounter <= visibleEnd2;

        if (segStillVisible && isGoodSpot) {
          speedSpacerContent = currentSpeedText;
          vPrintedSegments.add(segId);

          console.log(
            "[SCROLL INTELLIGENT VMAX] réaffiché sur ligne",
            i,
            "(mainRowCounter =",
            mainRowCounter,
            ") pour segment",
            segId,
            "valeur",
            currentSpeedText
          );
        }
      }
    }

    const showSpeedSpacer =
      speedSpacerContent && speedSpacerContent.trim() !== "";

    // --- Radio par segment (logique type VMAX) ---
    const isRadioBreakpointHere =
      !!(entry as any).radio_bar && i !== firstNonNoteIndex;

    if (radioCurrentSegmentId === 0) {
      radioCurrentSegmentId = 1;
    } else if (isRadioBreakpointHere) {
      radioCurrentSegmentId++;
    }

    const rawRadio = typeof radio === "string" ? radio.trim() : "";

    let mainRowRadioContent = "";
    let radioSpacerContent = "";

    const segIdRadio = radioSegmentIndex[i] ?? 0;
    const labelRowIndexRadio =
      segIdRadio > 0 ? radioLabelRowIndex.get(segIdRadio) ?? null : null;
    const radioValue =
      segIdRadio > 0 ? radioValueBySeg.get(segIdRadio) ?? "" : "";

    const isLabelRowRadio = labelRowIndexRadio === i;

    const visibleStart4 = visibleRows.first;
    const visibleEnd4 = visibleRows.last;
    const targetVisible4 = visibleStart4 + 1;

    const isInViewport =
      i >= visibleStart4 && i <= visibleEnd4;

    const isGoodSpotRadio =
      mainRowCounter >= targetVisible4 && mainRowCounter <= visibleEnd4;


    // --- Ligne principale ---
    if (segIdRadio === 1 && isLabelRowRadio && radioValue) {
      mainRowRadioContent = radioValue;
    }

    // --- Ligne intermédiaire ---
    if (
      segIdRadio > 1 &&
      radioValue &&
      labelRowIndexRadio !== null &&
      i === labelRowIndexRadio
    ) {
      radioSpacerContent = radioValue;
    }

          const showRadioBar = false;
    const showRadioSpacer =
      radioSpacerContent && radioSpacerContent.trim() !== "";

    const showArrivalSpacer =
      horaArrivee && horaArrivee.trim() !== "";

    // CSV : surlignage de la cellule V Max selon la classification calculée plus haut
    const highlightKind = csvHighlightByIndex[i];
    const isCsvStart = highlightKind === "bottom";
    const isCsvEnd = highlightKind === "top";

    // Important : la dernière ligne d'une zone doit être rendue en "full"
    // dès la ligne principale, sinon le bas manque visuellement.
    const mainRowHighlightKind =
      isCsvEnd ? "full" : highlightKind;

    let vmaxHighlightClass = "";

    const isLastDisplayedDataRow = i === lastNonNoteIndex;

    if (highlightKind === "full") {
      vmaxHighlightClass = " ft-v-csv-full";
    } else if (highlightKind === "top") {
      vmaxHighlightClass = isLastDisplayedDataRow
        ? " ft-v-csv-full"
        : " ft-v-csv-top";
    } else if (highlightKind === "bottom") {
      vmaxHighlightClass = " ft-v-csv-bottom";
    }

    if (["715.5", "714.7", "713.2"].includes(entry.pk ?? "")) {
      console.log(
        "[CSV GIRONA MAIN FT]",
        JSON.stringify({
          pk: entry.pk ?? "",
          highlightKind,
          vmaxHighlightClass,
          showVBar,
          mainRowSpeedContent,
        })
      );
    }

    if (["629.4", "627.7", "626.7", "624.3"].includes(entry.pk ?? "")) {
      console.log(
        "[CSV LA SAGRERA MAIN FT]",
        JSON.stringify({
          i,
          pk: entry.pk ?? "",
          dependencia: entry.dependencia ?? "",
          note: !!entry.isNoteOnly,
          csv: !!entry.csv,
          highlightKind,
          isCsvStart,
          isCsvEnd,
          mainRowHighlightKind,
          vmaxHighlightClass,
          showVBar,
          mainRowSpeedContent,
          hasNoteAfter,
          nextPk: rawEntries[i + 1]?.pk ?? "",
          nextIsNoteOnly: !!rawEntries[i + 1]?.isNoteOnly,
          nextDependencia: rawEntries[i + 1]?.dependencia ?? "",
        })
      );
    }

    // 1) INTERLIGNES (remarque rouge + heure d'arrivée) AVANT la ligne principale
    //    - Trains PAIRS : remarque rouge + heure d'arrivée sur la même ligne, puis heure de départ (ligne principale)
    //    - Autres cas   : heure d'arrivée seule au-dessus de la ligne principale (comportement inchangé)
    const shouldRenderArrivalSpacer =
      showArrivalSpacer &&
      !(hasNoteAfter && i < rawEntries.length - 1);

    if (!isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      // 👇 Remarque rouge (ligne noteOnly) en premier pour les trains PAIRS
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-inter" key={`note-before-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">
            {renderDependenciaCell(nextEntry as FTEntry)}
          </td>

          {/* Com vide */}
          <td className="ft-td" />

          {/* Hora d'arrivée sur la même ligne que les remarques rouges,
              alignée en bas de la cellule */}
          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          {/* Técn / Conc / Radio vides */}
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    } else if (shouldRenderArrivalSpacer) {
      // Cas général (IMPAIR ou sans remarque rouge) : heure d'arrivée seule au-dessus de la ligne principale
      const vmaxClassForArrival = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-spacer" key={`arrival-${i}`}>
          <td className="ft-td"></td>

          <td className={"ft-td ft-v-cell" + vmaxClassForArrival}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          <td className="ft-td ft-hora-cell">
            <span className="ft-hora-arrivee">{horaArrivee}</span>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      renderedRowIndex++;
    }

    // 2) LIGNE PRINCIPALE (toujours)
    rows.push(
      <tr
        className={
          "ft-row-main" +
          (isCurrentlyVisible ? " ft-row-visible" : "") +
          (isSelected ? " ft-row-selected" : "")
        }
        key={`main-${i}`}
        data-ft-row={i}
onClick={undefined}

      >
        {(() => {
         // 0) Barre de séparation Bloqueo
if (bloqueoBarRows.has(i)) {
  return (
    <td className="ft-td" style={{ position: "relative" }}>
      <div
        style={{
          height: 2,

width: "calc(100% + 2px)",
left: -1,
right: -1,

          borderRadius: 0,
          background: "currentColor",
          opacity: 1,

          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />
    </td>
  );
}
          // 1) Affichage type VMAX : valeur au début de segment
          const segId = bloqueoSegmentIndex[i] ?? 0;
          const labelRowIndex =
            segId > 0 ? bloqueoLabelRowIndex.get(segId) ?? null : null;
          const segValue = segId > 0 ? bloqueoValueBySeg.get(segId) ?? "" : "";

          if (labelRowIndex !== null && i === labelRowIndex) {
            return <td className="ft-td">{segValue}</td>;
          }

          // 2) Scroll intelligent : si la ligne-label est hors viewport,
          // on réaffiche la valeur une seule fois dans la zone visible.
          if (segId > 0 && segValue && !bloqueoPrintedSegments.has(segId)) {
            const visibleStart = visibleRows.first;
            const visibleEnd = visibleRows.last;

            const labelIsVisible =
              labelRowIndex !== null &&
              labelRowIndex >= visibleStart &&
              labelRowIndex <= visibleEnd;

            if (!labelIsVisible) {
              const segStillVisible = i >= visibleStart && i <= visibleEnd;
              const targetVisible = visibleStart + 1; // même logique que VMAX/RC
              const isGoodSpot =
                segStillVisible &&
                mainRowCounter >= targetVisible &&
                mainRowCounter <= visibleEnd;

              if (isGoodSpot) {
                bloqueoPrintedSegments.add(segId);
                return <td className="ft-td">{segValue}</td>;
              }
            }
          }

          return <td className="ft-td"></td>;
        })()}

        <td className={"ft-td ft-v-cell" + vmaxHighlightClass}>
          <div className="ft-v-inner">{mainRowSpeedContent}</div>
          {showVBar && <div className="ft-v-bar" />}
        </td>

        <td className="ft-td" style={{ position: "relative", textAlign: "center" }}>
          {sitKm}

          {testModeEnabled && activeRowIndex === i && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderLeft: "10px solid #2563eb",
                pointerEvents: "none",
              }}
            />
          )}
        </td>
        {/* Dependencia (surlignable) */}
        <td
          className={
            "ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {renderDependenciaCell(entry)}
        </td>

        {/* Com (surlignable) */}
        <td
          className={
            "ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {com}
        </td>

   {/* Hora */}
        <td
          className={
            "ft-td ft-hora-main" +
            (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {hora ? (
            <span className="ft-hora-depart">{hora}</span>
          ) : testModeEnabled && typeof horaTheoSecondsByIndex[i] === "number" ? (
            <span className="ft-hora-theo">
              {(() => {
                const sec = horaTheoSecondsByIndex[i] as number
                const minutesInDay = 24 * 60 * 60
                let t = sec % minutesInDay
                if (t < 0) t += minutesInDay
                const hh = Math.floor(t / 3600)
                const mm = Math.floor((t % 3600) / 60)
                const ss = Math.floor(t % 60)
                const pad = (n: number) => n.toString().padStart(2, "0")
                return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
              })()}
            </span>
          ) : null}

        </td>


        <td className="ft-td">{tecnico}</td>
        <td className="ft-td">{conc}</td>

        <td className="ft-td" style={{ position: "relative" }}>
          {(() => {
            const segId = radioSegmentIndex[i] ?? 0;
            const labelRowIndex =
              segId > 0 ? radioLabelRowIndex.get(segId) ?? null : null;
            const segValue =
              segId > 0 ? radioValueBySeg.get(segId) ?? "" : "";

            const isLabelRow = labelRowIndex === i;
            const radioBar = segId > 1 && isLabelRow;

            // Segment 1 : affichage direct sur la ligne principale
            if (segId === 1 && isLabelRow) {
              return (
                <>
                  {segValue}
                  {radioBar && (
                    <div
                      style={{
                        height: 2,
width: "calc(100% + 2px)",
left: -1,
right: -1,
                        borderRadius: 0,
                        background: "currentColor",
                        opacity: 1,
                        position: "absolute",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                  )}
                </>
              );
            }

            // Segments suivants : barre seule sur la ligne principale
            if (radioBar) {
              return (
                <div
                  style={{
                    height: 2,
width: "calc(100% + 2px)",
left: -1,
right: -1,
                    borderRadius: 0,
                    background: "currentColor",
                    opacity: 1,
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
              );
            }

            return "";
          })()}
        </td>

        <td className="ft-td ft-rc-cell" id={`rc-cell-${i}`}>
          {showRcBar ? (
            <div className="ft-rc-bar" />
          ) : (
            <div className="ft-rc-value">{ramp}</div>
          )}
        </td>

        <td className="ft-td ft-td-nivel">{nivel}</td>
      </tr>
    );

    // ✅ IMPORTANT : on compte cette vraie ligne principale
    mainRowCounter++;

    // Mise à jour de l'état de zone CSV après la ligne principale :
    // - bottom  => on ouvre la zone (les lignes suivantes seront "full")
    // - top     => on ferme la zone (les lignes suivantes sont hors zone)
    if (isCsvStart) {
      csvZoneOpen = true;
    } else if (isCsvEnd) {
      csvZoneOpen = false;
    }

    // Vérifier si c'est la dernière ligne d'une zone CSV
    if (isCsvEnd) {
      // Si c'est la dernière ligne à surligner, on étend le surlignage à toute la ligne
      csvHighlightByIndex[i] = "full";
    }

    // 3) LIGNE INTERMÉDIAIRE POUR LA VITESSE / RADIO (sous la ligne principale)

    if (showSpeedSpacer || showRadioSpacer) {
      // Si la zone CSV est ouverte, cette ligne est "entre deux barres" => full
      const vmaxClassForSpeed = csvZoneOpen ? " ft-v-csv-full" : "";

      if (["715.5", "714.7", "713.2", "710.7"].includes(entry.pk ?? "")) {
        console.log(
          "[CSV GIRONA SPACER FT]",
          JSON.stringify({
            pk: entry.pk ?? "",
            highlightKind,
            isCsvStart,
            isCsvEnd,
            csvZoneOpen,
            vmaxClassForSpeed,
            showSpeedSpacer,
            showRadioSpacer,
          })
        );
      }

      if (["629.4", "627.7", "626.7", "624.3"].includes(entry.pk ?? "")) {
        console.log(
          "[CSV LA SAGRERA SPACER FT]",
          JSON.stringify({
            i,
            pk: entry.pk ?? "",
            dependencia: entry.dependencia ?? "",
            highlightKind,
            isCsvStart,
            isCsvEnd,
            csvZoneOpen,
            vmaxClassForSpeed,
            showSpeedSpacer,
            speedSpacerContent,
            showRadioSpacer,
            radioSpacerContent,
          })
        );
      }

      rows.push(
        <tr className="ft-row-spacer" key={`speed-radio-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForSpeed}>
            <div className="ft-v-inner text-center">{speedSpacerContent}</div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          {/* Pas d'heure ici, on laisse la cellule vide */}
          <td className="ft-td ft-hora-cell" />

          <td className="ft-td" />
          <td className="ft-td" />

          <td className="ft-td">{radioSpacerContent}</td>

          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    }

    // 4) LIGNE INTERMÉDIAIRE POUR LES REMARQUES ROUGES (noteOnly) SOUS la ligne principale
    // ➜ désormais seulement pour les trains IMPAIR (isOdd === true)
    if (isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      // Si on est dans une zone CSV, la ligne de note est aussi "dans la zone" => full
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      if (["629.4", "627.7", "626.7", "624.3"].includes(entry.pk ?? "")) {
        console.log(
          "[CSV LA SAGRERA NOTE FT]",
          JSON.stringify({
            i,
            pk: entry.pk ?? "",
            dependencia: entry.dependencia ?? "",
            highlightKind,
            csvZoneOpen,
            vmaxClassForNote,
            notePk: rawEntries[i + 1]?.pk ?? "",
            noteIsNoteOnly: !!rawEntries[i + 1]?.isNoteOnly,
            noteDependencia: rawEntries[i + 1]?.dependencia ?? "",
          })
        );
      }

      rows.push(
        <tr className="ft-row-inter" key={`note-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">
            {renderDependenciaCell(nextEntry as FTEntry)}
          </td>

          {/* Com vide */}
          <td className="ft-td" />

          {/* Hora d'arrivée sur la même ligne que les remarques rouges */}
          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          {/* Técn / Conc / Radio vides */}
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      // on consomme la ligne noteOnly
      i++;
    }
  }

  // On expose la liste des heures d'arrivée calculées pour le moteur d'auto-scroll
  arrivalEventsRef.current = arrivalEvents;

  //
  // ===== 7. RENDU FINAL ==============================================
  //

  return (
    <section className="ft-wrap h-full">
      <style>{`
        /* ===================== FT (Feuille de Train) ===================== */

        .ft-wrap {
          background: transparent;
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;

        }

        .ft-scroll-x {
          width: 100%;
          height: 100%;
          max-height: 100%;
          display: flex;
          flex-direction: column;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        .ft-body-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .ft-table {
          border-collapse: separate;
          border-spacing: 0;
          width: 100%;
          min-width: 700px;
          table-layout: fixed;
          border: 2px solid #000;
          background: #fff;
          color: #000;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }

        .ft-table th:nth-child(1),
        .ft-table td:nth-child(1) { width: 13%; }

        .ft-table th:nth-child(2),
        .ft-table td:nth-child(2) { width: 5%; }

        .ft-table th:nth-child(3),
        .ft-table td:nth-child(3) { width: 9%; }

        .ft-table th:nth-child(4),
        .ft-table td:nth-child(4) { width: 35%; }

        .ft-table th:nth-child(5),
        .ft-table td:nth-child(5) { width: 5%; }

        .ft-table th:nth-child(6),
        .ft-table td:nth-child(6) { width: 7%; }

        .ft-table th:nth-child(7),
        .ft-table td:nth-child(7) { width: 5%; }

        .ft-table th:nth-child(8),
        .ft-table td:nth-child(8) { width: 5%; }

        .ft-table th:nth-child(9),
        .ft-table td:nth-child(9) { width: 6%; }

        .ft-table th:nth-child(10),
        .ft-table td:nth-child(10) { width: 6%; }

        .ft-table th:nth-child(11),
        .ft-table td:nth-child(11) { width: 4%; }

        .dark .ft-table {
          border: 2px solid #fff;
          background: #000;
          color: #fff;
        }

        .ft-th {
          position: sticky;
          top: 0;
          z-index: 10;
          border: 2px solid #000;
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
          color: #000;
          font-size: 0.8rem;
          line-height: 1.2;
          font-weight: 600;
          text-align: center;
          padding: 4px 6px;
          vertical-align: middle;
          white-space: nowrap;
        }

        .dark .ft-th {
          border: 2px solid #fff;
          background: rgba(234,179,8,0.4);
          color: #fff;
        }

        .ft-th-n {
          background: transparent !important;
          color: transparent !important;
          border-top: none !important;
          border-right: none !important;
          border-bottom: none !important;
          border-left: none !important;
        }
        .dark .ft-th-n {
          background: transparent !important;
          color: transparent !important;
          border-top: none !important;
          border-right: none !important;
          border-bottom: none !important;
          border-left: none !important;
        }

        .ft-table thead .ft-th {
          border-left: 2px solid #000;
          border-right: 2px solid #000;
        }

        .dark .ft-table thead .ft-th {
          border-left: 2px solid #fff;
          border-right: 2px solid #fff;
        }

        .ft-td {
          border-left: 1px solid #000;
          border-right: 1px solid #000;
          /* pointillés de débug retirés temporairement */
          background: #fff;
          color: #000;
          font-size: 16px;
          line-height: 1.2;
          font-weight: 600;
          text-align: center;
          padding: 4px 6px;
          vertical-align: middle;
        }
        .dark .ft-td {
          background: #000;
          color: #fff;
          border-left: 1px solid #fff;
          border-right: 1px solid #fff;
          /* pointillés de débug retirés temporairement */
        }

        .dark .ft-row-spacer .ft-td,
        .dark .ft-row-inter .ft-td {
          background: #000;
          color: #fff;
        }
        .dark .ft-highlight-cell {
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
          color: #000;
        }

        /* Surlignage jaune (même esprit que InfoPanel) */
        .ft-highlight-cell {
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
        }

        /* Surlignage spécifique V max (ancienne version, conservée au cas où) */
        .ft-v-highlight {
          background: #ffc000;
        }
        .dark .ft-v-highlight {
          background: #ffc000;
        }

        /* Préparation CSV : surlignage V max par demi-cellule */
        .ft-v-cell.ft-v-csv-full {
          background: #ffc000;
        }

        .ft-v-cell.ft-v-csv-top {
          background: linear-gradient(
            to bottom,
            #ffc000 0,
            #ffc000 50%,
            transparent 50%,
            transparent 100%
          );
        }

        .ft-v-cell.ft-v-csv-bottom {
          background: linear-gradient(
            to bottom,
            transparent 0,
            transparent 50%,
            #ffc000 50%,
            #ffc000 100%
          );
        }

        .dark .ft-v-cell.ft-v-csv-full {
          background: #ffc000;
        }
        .dark .ft-v-cell.ft-v-csv-top {
          background: linear-gradient(
            to bottom,
            #ffc000 0,
            #ffc000 50%,
            transparent 50%,
            transparent 100%
          );
        }
        .dark .ft-v-cell.ft-v-csv-bottom {
          background: linear-gradient(
            to bottom,
            transparent 0,
            transparent 50%,
            #ffc000 50%,
            #ffc000 100%
          );
        }

        /* Dark mode : garder le texte noir dans les Vmax surlignées */
        .dark .ft-v-cell.ft-v-csv-full,
        .dark .ft-v-cell.ft-v-csv-top,
        .dark .ft-v-cell.ft-v-csv-bottom {
          color: #000;
        }

        /* Surlignage jaune type InfoPanel */
        .ft-hl {
          background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%);
        }

        .dark .ft-hl {
          background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%);
        }

        .ft-table tbody tr:first-child .ft-td {
          border-top: 2px solid #000;
        }

        .dark .ft-table tbody tr:first-child .ft-td {
          border-top: 2px solid #fff;
        }

        .ft-table td:nth-child(4) {
          text-align: left;
        }
        .ft-table th:nth-child(4) {
          text-align: center;
        }

        .ft-table td:nth-child(6):not(.ft-hora-cell) {
          vertical-align: middle;
        }

        .ft-table td:nth-child(9) {
          font-size: 10px;
        }

        .ft-td-nivel {
          text-align: center;
        }

        .ft-v-cell {
          position: relative;
        }
        .ft-v-inner {
          position: relative;
          z-index: 1;
        }
        .ft-v-bar {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          height: 2px;
          background: #000;
        }
        .dark .ft-v-bar {
          background: #fff;
        }

        .ft-rc-cell {
          position: relative;
        }
        .ft-rc-bar {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          height: 2px;
          background: #000;
        }
        .dark .ft-rc-bar {
          background: #fff;
        }
        .ft-rc-value {
          position: relative;
          z-index: 1;
          text-align: center;
        }

        .ft-dependencia-cell {
          line-height: 1.2;
          font-weight: 600;
          font-size: 16px;
        }

        .ft-hora-cell {
          position: relative;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          height: 1.2em;
          line-height: 1.1;
          font-size: 0.75rem;
          padding: 0 4px 2px;
        }
        .ft-hora-arrivee {
          font-style: italic;
          opacity: 0.6;
        }
        .ft-hora-depart {
          font-weight: 600;
        }
               /* Heures calculées (interpolées) : affichage gris + italique */
        .ft-hora-theo {
          font-style: italic;
          color: #6b7280;
          opacity: 0.85;

          /* ✅ iPad : hh:mm:ss -> réduction nette + prioritaire */
          font-size: 0.72em !important;
          line-height: 1.0 !important;
          white-space: nowrap;
        }
        .dark .ft-hora-theo {
          color: #9ca3af;
          opacity: 0.9;
        }

        .ft-rednote-line {
          font-size: 0.7rem;
          line-height: 1.2;
          font-style: italic;
          font-weight: 400;
          color: #dc2626;
        }
        .dark .ft-rednote-line {
          color: #f87171;
        }
        .ft-rednote-strong {
          font-weight: 700;
          font-style: normal;
        }

        .ft-row-spacer .ft-td {
          line-height: 0.4;
          font-weight: 400;
          height: 4px;
          padding: 2px 4px;
        }

        .ft-row-spacer .ft-td:not(.ft-hora-cell):not(:first-child):not(:nth-child(9)) {
          font-size: 0;
        }

        .ft-row-spacer td:nth-child(9) {
          font-size: 0.75rem;
          line-height: 1.1;
          font-weight: 600;
          text-align: center;
        }

        .ft-row-spacer .ft-hora-cell {
          display: table-cell;
          text-align: center;
          vertical-align: bottom;
          font-size: 0.75rem;
          line-height: 1.1;
          height: 1.2em;
          padding: 0 4px 2px;
        }

        /* Lignes de remarques rouges : on veut la même logique que pour les spacers,
           mais sur toute la hauteur de la ligne (même bas que le texte rouge) */
        .ft-row-inter .ft-hora-cell {
          display: table-cell;
          text-align: center;
          vertical-align: bottom;
          font-size: 0.75rem;
          line-height: 1.1;
          padding: 0 4px 2px;
        }

        .ft-row-spacer .ft-rc-bar,
        .ft-row-spacer .ft-rc-value,
        .ft-row-spacer .ft-v-bar {
          display: none;
        }
        .ft-row-spacer .ft-v-inner {
          font-size: 16px;
          line-height: 1.1;
          font-weight: 600;
          text-align: center;
          color: inherit;
        }

        .ft-row-inter .ft-rc-bar,
        .ft-row-inter .ft-rc-value,
        .ft-row-inter .ft-v-bar {
          display: none;
        }
        .ft-row-inter .ft-v-inner {
          text-align: center;
        }

        @media print {
          .ft-th {
            font-size: 0.75rem;
            line-height: 1.1;
            padding: 3px 4px;
          }
          .ft-td {
            font-size: 0.8rem;
            line-height: 1.15;
            padding: 3px 4px;
          }
          .ft-rednote-line {
            font-size: 0.6rem;
          }
          .ft-row-spacer .ft-td {
            height: 3px;
            padding: 2px 3px;
          }
        }

        .ft-wrap {
          position: relative;
        }

        .ft-bloqueo-overlay {
          position: absolute;
          left: 0;
          top: 50%;
          width: 13%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 1rem;
          color: #000;
          pointer-events: none;
          z-index: 5;
        }

        .ft-radio-overlay {
          position: absolute;
          left: 84%;
          top: 50%;
          width: 6%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.75rem;
          letter-spacing: 0.03em;
          color: #000;
          pointer-events: none;
          z-index: 5;
        }

        .dark .ft-bloqueo-overlay {
          color: #fff;
        }

        .dark .ft-radio-overlay {
          color: #fff;
        }

.ft-active-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 40%;
  height: 2px;
  background: transparent; /* invisible mais garde la boîte */
  pointer-events: none;
  z-index: 6;
}

        /* Couleur du '>' de la ligne active (debug) */
        .ft-active-marker-gps {
          color: #16a34a; /* vert GPS */
        }

        .ft-active-marker-horaire {
          color: #2563eb; /* bleu HORAIRE */
        }

        .dark .ft-active-marker-gps {
          color: #4ade80;
        }

        .dark .ft-active-marker-horaire {
          color: #60a5fa;
        }

        /* Ligne sélectionnée pour recalage manuel : cadre rouge clignotant S + D + C + H */
        .ft-row-main.ft-row-selected td:nth-child(3),
        .ft-row-main.ft-row-selected td:nth-child(4),
        .ft-row-main.ft-row-selected td:nth-child(5),
        .ft-row-main.ft-row-selected td:nth-child(6) {
          border-top: 2px solid red;
          border-bottom: 2px solid red;
          animation: ft-selection-blink 1s step-start infinite;
        }

        .ft-row-main.ft-row-selected td:nth-child(3) {
          border-left: 2px solid red;
        }

        .ft-row-main.ft-row-selected td:nth-child(6) {
          border-right: 2px solid red;
        }

        @keyframes ft-selection-blink {
          0%, 50% {
            border-color: red;
          }
          50.01%, 100% {
            border-color: transparent;
          }
        }

      `}</style>

      <div className="ft-active-line" aria-hidden="true" />

      {/* FT FR (alternatif) — placeholder pour cette étape */}
      <div
        style={{ display: effectiveFtView === "FR" ? "block" : "none" }}
        className="p-3"
      >
        <div className="text-sm font-semibold">FT France</div>
        <div className="text-xs opacity-70">
          Mode FR activé. (Table France Perpignan→Figueres à brancher ensuite.)
        </div>
      </div>

      {/* FT ES (moteur existant, inchangé) */}
      <div
        style={{ display: effectiveFtView === "ES" ? "block" : "none" }}
        className={
          "ft-scroll-x " +
          (variant === "modern" ? "ft-modern-wrap" : "ft-classic-wrap")
        }
      >

        {/* En-tête fixe */}
        <table className="ft-table">
          <thead>
            <tr className="whitespace-nowrap">
              <th className="ft-th">Bloqueo</th>
              <th className="ft-th">V Max</th>
              <th className="ft-th">Sit Km</th>
              <th className="ft-th">Dependencia</th>
              <th className="ft-th">Com</th>
              <th className="ft-th">Hora</th>
              <th className="ft-th">Técn</th>
              <th className="ft-th">Conc</th>
              <th className="ft-th">Radio</th>
              <th className="ft-th">
                Ramp<br />Caract
              </th>
              <th className="ft-th ft-th-n"></th>
            </tr>
          </thead>
        </table>

        {/* Corps scrollable */}
        <FTScrolling
          onScroll={handleScroll}
          onContainerRef={(el) => {
            scrollContainerRef.current = el;
          }}
          overlay={
            (() => {
              if (!testModeEnabled && gpsStateUi !== "GREEN") {
                return null;
              }

              const color =
                referenceMode === "HORAIRE"
                  ? "red"
                  : gpsStateUi === "GREEN"
                  ? "#16a34a" // vert (proche de tes codes GPS)
                  : gpsStateUi === "ORANGE"
                  ? "#f97316" // orange
                  : "red"; // GPS RED

              return (
                <div
                  style={{
                    position: "absolute",

                    // ✅ Étape 4-2b : top piloté par le state (timer) si dispo
                    top:
                      typeof trainPosYpx === "number" && Number.isFinite(trainPosYpx)
                        ? `${trainPosYpx}px`
                        : (() => {
                            const container = scrollContainerRef.current;
                            if (!container) return "40vh";

                            const row = container.querySelector<HTMLTableRowElement>(
                              `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
                            );
                            if (!row) return "40vh";

                            const VISUAL_OFFSET_PX = -2;
                            const y =
                              row.offsetTop +
                              row.offsetHeight / 2 -
                              container.scrollTop +
                              VISUAL_OFFSET_PX;

                            const clamped = Math.max(0, Math.min(y, container.clientHeight));
                            return `${Math.round(clamped)}px`;
                          })(),

                    transform: "translateY(-6px)",
                    left: !testModeEnabled ? "18%" : "13%",
                    width: !testModeEnabled ? "10px" : "14%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: !testModeEnabled ? "flex-start" : "initial",
                    pointerEvents: "none",
                    zIndex: 999,
                  }}
                >
                  {/* Triangle gauche (pointe vers l’intérieur = vers la droite) */}
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderLeft: `10px solid ${color}`,
                    }}
                  />

                  {testModeEnabled && (
                    <>
                      {/* Barre */}
                      <div
                        style={{
                          flex: 1,
                          height: "2px",
                          background: color,
                        }}
                      />
                      {/* Triangle droite (pointe vers l’intérieur = vers la gauche) */}
                      <div
                        style={{
                          width: 0,
                          height: 0,
                          borderTop: "6px solid transparent",
                          borderBottom: "6px solid transparent",
                          borderRight: `10px solid ${color}`,
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })()
          }
        >
          <div className="ft-body-scroll" onClick={handleBodyClick}>
            <table className="ft-table">
              <tbody>{rows}</tbody>
            </table>
          </div>
        </FTScrolling>


      </div>
    </section>
  );
}