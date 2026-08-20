import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildTestLogFile,
  startTestSession,
  stopTestSession,
  exportTestLogLocal,
  getCurrentTestExportNaming,
  logTestEvent,
} from '../../lib/testLogger'

import {
  initGpsPkEngine,
  projectGpsToPk,
  resetGpsPkEngineMemory,
  setExpectedDirectionForReplay,
} from '../../lib/gpsPkEngine'
import { RIBBON_POINTS } from '../../lib/ligne050_ribbon_dense'

import { getOcrOnlineEnabled, setOcrOnlineEnabled } from '../../lib/ocrSettings'

import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { APP_VERSION } from '../version'
import { LIGNE_FT_NORMALIZED } from '../../data/normalized/ligneFT.normalized'
import ManualPdfCanvasViewer from './ManualPdfCanvasViewer'
import ManualViewer from './ManualViewer'
import GuiaViewer from './GuiaViewer'
import DemoLoader, { type DemoData } from './DemoLoader'
import DemoRunner from './DemoRunner'
import DemoTouchIndicator from './DemoTouchIndicator'
import Mode2026Modal from './Mode2026Modal'
import SdmModal, { type SdmDraft } from './SdmModal'
import { loadPdfLtvRows } from './titleBarLtvUtils'
import {
  type LIMFields,
  type ManualTrainOption,
  toTitleNumber,
  formatTodayForManualImport,
  buildManualParsedFields,
  normalizeKnownTrainNumber,
  buildDetectedTrainTokenVariants,
  detectedTokenMatchesKnownTrain,
} from './titleBarTrainUtils'
import {
  type ManualLtvApiEntry,
  type ManualLtvApiResponse,
  type ManualLtvDisplayRow,
  type ManualLtvRowsResult,
  type NormalizedLtvFile,
  type ManualFtRoutePkRange,
  getManualLtvApiUrl,
  formatManualLtvPk,
  formatManualLtvDate,
  isManualLtvYes,
  mapManualLtvEntryToDisplayRow,
  getManualLtvPkSpan,
  manualLtvOverlapsRoute,
  waitForFtRoutePkRange,
  fetchManualLtvRows,
  loadNormalizedLtvRows,
  cacheLtvNormalized,
} from './titleBarLtvUtils'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
import {
  getTrainCategorieEspagne,
  getTrainCategorieFrance,
  getTrainComposition,
  getTrainLigne,
  getTrainMateriel,
  getTrainNumeroFrance,
  getTrainRelation,
  setSdmSessionTrain,
} from '../../data/ligneFT.normalized.adapter'
import { useLigneFt2026TrainOptions } from '../../data/ligneFT2026.adapter'
// Sens de circulation DÉCLARÉ (jamais déduit de la parité du numéro).
import {
  getTrainDirection,
  isTrainSudNord,
  // ⚠️ 20/08 — Importée SOUS ALIAS, à côté de son homonyme de l'ancien adaptateur
  // qui reste importé plus haut. Les deux coexistent volontairement : celle-ci
  // interroge le normalisé 2026 et sert au SEUL usage vivant (ligne ~2500,
  // bascule du numéro à la frontière) ; l'ancienne continue d'alimenter deux
  // chemins vestigiaux (`manualImportTrainOptions` et la voie `__limLastParsed`),
  // qu'on ne réveille pas ici. Migration complète des 7 fonctions = dette notée,
  // à traiter à froid.
  getTrainNumeroFrance as getTrainNumeroFrance2026,
} from '../../data/ligneFT2026.ft.adapter'

// ⚠️ FT France = fonctionnalité ABANDONNÉE (on a fusionné FR+ES). Neutralisée le 2026-06-08 :
// l'auto-switch "zone Figueres" réveillait l'overlay FT France quand le train restait vert/stable
// à l'arrêt de Figueres (révélé par le patch #20 qui garde le vert à l'arrêt).
// Remettre à true SEULEMENT si on réactive un jour une FT France séparée.
// Suppression complète de la machinerie FT France = dette technique (fin de dév).
const FT_FRANCE_AUTOSWITCH_ENABLED = false

// Course du curseur d'espacement de la fiche train (#25), rétabli le 15/08.
//
// ⚠️ LE MULTIPLICATEUR EST UN NOMBRE D'ÉCRANS. La hauteur du plus grand
// intervalle vaut `mult × densiteReference × plusGrandIntervalle`, or
// `densiteReference = hauteurVisible / (plusGrandIntervalle × 1,05)` : le plus
// grand intervalle se simplifie et il reste `mult × hauteurVisible / 1,05`. Le
// multiplicateur dit donc, à 5 % près, combien d'écrans occupe le plus grand
// intervalle de la fiche — sur n'importe quel train et n'importe quel écran.
// C'est pourquoi le MAXIMUM reste une constante : il porte déjà une contrainte
// physique invariante (jamais plus de ~3,8 écrans pour un intervalle). L'indexer
// sur le seuil d'exactitude la ferait au contraire varier d'un train à l'autre.
// ⚠️ 15/08 — Ce n'est PLUS le maximum de la course, mais le seuil d'ALERTE.
// Au-delà, la fiche reste rigoureusement exacte, elle est seulement très étalée
// (un intervalle approche les 4 écrans) : le curseur passe à l'orange pour le
// dire, sans rien interdire.
const FT_SCALE_MULT_ALERTE = 4
/**
 * Maximum de la course : `2 × seuil d'exactitude`, plancher à FT_SCALE_MULT_ALERTE.
 *
 * ⚠️ Pourquoi indexé sur le seuil et non fixe. En développant,
 * `2 × seuil × hauteurVisible / 1,05 = 2 × base × plusGrandIntervalle` : la
 * hauteur visible se simplifie. La borne est donc INVARIANTE EN ABSOLU et offre
 * toujours 100 % de marge au-dessus de l'exactitude, que les blocs INFOS/LTV
 * soient pliés ou non. Un maximum fixe, lui, garantissait un nombre d'écrans
 * constant mais laissait par moments presque aucune marge : en mode déplié le
 * seuil monte à 3,3× sur le 9705, il ne restait que 0,7 de course au-dessus.
 * Cette contrainte-là est désormais portée par la couleur d'alerte, pas par la
 * borne — ce qui est atteignable et ce qui est raisonnable sont deux choses.
 *
 * Le plancher à 4 évite de RÉDUIRE la course sur un train court : avec un seuil
 * de 1,0×, `2 × seuil` vaudrait 2,0 là où on allait jusqu'à 4 jusqu'ici.
 */
const bornerMax = (seuil: number | null) =>
  seuil === null
    ? FT_SCALE_MULT_ALERTE
    : Math.max(FT_SCALE_MULT_ALERTE, Math.ceil(seuil * 2 * 10) / 10)
// Le MINIMUM, lui, est dynamique : c'est le POINT MORT annoncé par FT, en
// dessous duquel plus aucun segment n'est écarté (le curseur ne ferait plus
// rien). Repli à 0,5 tant que FT n'a pas mesuré.
const FT_SCALE_MULT_MIN_DEFAUT = 0.5

type NumberingSide = 'ES' | 'FR'

type DisplayedTrainNumberState = {
  trainNumberEs: string | undefined
  trainNumberFr: string | undefined
  displayedSide: NumberingSide
  pendingSide: NumberingSide | null
  isBlinking: boolean
  displayedNumber: string | undefined
}
type DisplayedCompositionState = {
  normalizedComposition: string | undefined
  displayedComposition: string | undefined
  manualOverrideActive: boolean
}

/**
 * TitleBar — LIMGPT α2.1 (+ keep-awake video trigger)
 */
export default function TitleBar() {
  // ----- HORLOGE -----
  const formatTime = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  const [clock, setClock] = useState(() => formatTime(new Date()))
const [autoScroll, setAutoScroll] = useState(false)
const [autoScrollStartedOnce, setAutoScrollStartedOnce] = useState(false)
const autoScrollRef = useRef(false)
const autoScrollStartedOnceRef = useRef(false)
const [gpsState, setGpsState] = useState<0 | 1 | 2>(0)
  const [stationArretActive, setStationArretActive] = useState(false)
  // Nature de l'arret annoncee par FT ("station" / "pleine-ligne"). Elle ne sert
  // PLUS a choisir le libelle (cf. libelleSortieStandby) : seule la nature de
  // l'ENTREE en stand-by compte. On la conserve pour le JOURNAL, ou elle
  // documente la situation exacte d'une sortie a posteriori.
  const [stationArretKind, setStationArretKind] = useState<string | null>(null)
  // Nature de l'ENTREE en stand-by, annoncee par FT : 'auto' (le train s'est
  // arrete, ou va partir) ou 'manuel' (le conducteur a choisi une ligne). C'est
  // ce critere — et non la nature de l'arret — qui decide du libelle de sortie.
  const [standbyOrigine, setStandbyOrigine] = useState<'auto' | 'manuel'>('auto')
  const [hourlyMode, setHourlyMode] = useState(false)
  const [referenceMode, setReferenceMode] = useState<'HORAIRE' | 'GPS'>('HORAIRE')
  const [standbyMode, setStandbyMode] = useState(false)
  const [pdfMode, setPdfMode] = useState<'blue' | 'green' | 'red'>('blue')

  // 'ltv' = mode « LTV seul » : import du seul PDF LTV, pas de train ni de parcours,
  // affichage du seul bloc LTV (Infos + fiche train masqués). Fichier canonique partagé.
  type StartupMode = '2026' | 'ltv'

  const STARTUP_MODE_STORAGE_KEY = 'lim:startup-mode-default'

  const readStoredStartupMode = (): StartupMode | null => {
    try {
      const value = localStorage.getItem(STARTUP_MODE_STORAGE_KEY)

      return value === '2026' || value === 'ltv'
        ? value
        : null
    } catch {
      return null
    }
  }

  const [startupModeChoiceOpen, setStartupModeChoiceOpen] = useState(false)
  const [startupModeChoice, setStartupModeChoice] = useState<StartupMode>('2026')
  const [startupModeChoiceIntent, setStartupModeChoiceIntent] =
    useState<'start' | 'settings'>('start')
  const [activeStartupMode, setActiveStartupMode] = useState<StartupMode | null>(null)
  const startupLaunchModeRef = useRef<StartupMode | null>(null)

  type LtvRuntimeSource = 'normalized' | 'adif' | 'pdf' | 'pdf-ltv'

  const currentLtvSourceRef = useRef<LtvRuntimeSource>('normalized')
  const [ltvCountForTitle, setLtvCountForTitle] = useState<number | null>(null)
  const [ltvIsNormalized, setLtvIsNormalized] = useState(false)

  const getAvailableLtvSourcesForMode = (
    mode: StartupMode | null
  ): LtvRuntimeSource[] => {
    // Mode 2026 : une seule source LTV → pas de bascule, pas de flèches dans le bandeau.
    if (mode === '2026') return ['pdf-ltv']

    // Mode « LTV seul » : même source unique que le 2026.
    if (mode === 'ltv') return ['pdf-ltv']

    return []
  }

  // SDM (#27) : modale de creation d'un sillon de derniere minute (par-dessus la modale de demarrage).
  const [sdmOpen, setSdmOpen] = useState(false)
  // Train de session cree via « Creer un train » (brouillon). Non persiste.
  const [sdmTrain, setSdmTrain] = useState<SdmDraft | null>(null)

  const manualImportTrainOptions = useMemo<ManualTrainOption[]>(() => {
    const trains = (LIGNE_FT_NORMALIZED as any)?.trains ?? {}

    return Object.keys(trains)
      .map((trainNumber) => ({
        trainNumber,
        numeroFrance: getTrainNumeroFrance(trainNumber),
        relation: getTrainRelation(trainNumber),
        ligne: getTrainLigne(trainNumber),
        categorieEspagne: getTrainCategorieEspagne(trainNumber),
        categorieFrance: getTrainCategorieFrance(trainNumber),
        composition: getTrainComposition(trainNumber),
        materiel: getTrainMateriel(trainNumber),
      }))
      .sort((a, b) => {
        const na = Number(a.trainNumber)
        const nb = Number(b.trainNumber)

        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return a.trainNumber.localeCompare(b.trainNumber)
      })
  }, [])

  // Mode 2026 : liste de trains proposée = le normalisé 2026 PUBLIÉ (lecture
  // réseau), plus l'éventuel train SDM de session — PAS l'ancien fichier
  // statique embarqué (demande utilisateur, 10/08 : "les trains proposés
  // doivent être ceux du nouveau normalisé"). Mapping best-effort vers
  // ManualTrainOption (cf. ligneFT2026.adapter.ts) : certains champs de
  // l'ancien format (ligne, composition US/UM) n'ont pas d'équivalent 2026
  // et restent vides — volontaire, sert à voir ce qui reste à adapter.
  const ligneFt2026 = useLigneFt2026TrainOptions()
  const effective2026TrainOptions = useMemo<ManualTrainOption[]>(
    () =>
      sdmTrain
        ? [
            ...ligneFt2026.options,
            {
              trainNumber: sdmTrain.trainNumber,
              relation: `${sdmTrain.origine} - ${sdmTrain.destination}`,
              categorieEspagne: sdmTrain.type || undefined,
              composition: 'US',
              materiel: 'TGV 2N2',
            },
          ]
        : ligneFt2026.options,
    [ligneFt2026.options, sdmTrain]
  )

  // ----- FT VIEW MODE (ES / FR / AUTO) -----
  // Option A : pas de persistance (ce n’est pas une préférence, c’est un état de travail)
  // Par défaut : ADIF (ES)
  const [ftViewMode, setFtViewMode] = useState<'AUTO' | 'ES' | 'FR'>('ES')
  // ✅ Indique que le mode AUTO est engagé (même après bascule vers ES/FR)
  const [autoEngaged, setAutoEngaged] = useState(false)

  // autoEngaged passe a true quand le conducteur conduit activement (autoScroll actif, hors standby)
  // Necessaire pour que la detection d’arret en gare GPS (Figueres) s’active
  useEffect(() => {
    if (autoScroll && !standbyMode) setAutoEngaged(true)
  }, [autoScroll, standbyMode])

  // ✅ Verrou : après le 1er clic AUTO, on ne refait plus de "sélection auto" (hors Figueres)
  const autoLockedRef = useRef(false)
  const autoInitialTargetRef = useRef<'ES' | 'FR' | null>(null)

  // ----- UI fold INFOS/LTV -----
  const [folded, setFolded] = useState(false)

  // ✅ Sync du pli/dépli déclenché AILLEURS (clic sur une LTV de la fiche, clic sur le
  // tableau, clic sur le numéro de train…). Sans ça, la barre de titre ne se mettait à jour
  // que via son propre bouton : au clic LTV le tableau se dépliait mais l'en-tête restait
  // en mode plié (numéro + type + composition au lieu du numéro seul).
  useEffect(() => {
    const h = (e: Event) => {
      const f = (e as CustomEvent).detail?.folded
      if (typeof f === 'boolean') setFolded(f)
    }
    window.addEventListener('lim:infos-ltv-fold-change', h as EventListener)
    return () => window.removeEventListener('lim:infos-ltv-fold-change', h as EventListener)
  }, [])

  // ✅ Helper unique : forcer dépliage INFOS/LTV + dispatch + logs (1 seul endroit)
  const forceInfosUnfold = (meta: { reason: string; source: string }) => {
    // On force l’état local
    setFolded(false)

    // Et on force le reste de l’app à se réaligner
    window.dispatchEvent(
      new CustomEvent('lim:infos-ltv-fold-change', {
        detail: { folded: false },
      })
    )

    // Logs rejouables
    logTestEvent('ui:infos-ltv:auto-unfold', {
      reason: meta.reason,
      source: meta.source,
    })
    logTestEvent('ui:infos-ltv:fold-change', {
      folded: false,
      source: meta.source,
      reason: meta.reason,
      forced: true,
    })
  }

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('ft:view-mode-change', { detail: { mode: ftViewMode } })
    )
  }, [ftViewMode])

  // ✅ Quand FT France (FR) est affichée : on force le dépliage (un seul endroit, clair)
  useEffect(() => {
    if (ftViewMode !== 'FR') return
    forceInfosUnfold({ reason: 'ftViewMode_FR', source: 'titlebar' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftViewMode])

  // =========================
  // AUTO resolve (pré-calage GPS post-parsing)
  // - Calculé après lim:parsed (GPS ponctuel)
  // - Ne déclenche AUCUN switch automatique ici (ça viendra au clic AUTO, étape 2)
  // =========================
  const AUTO_FR_SKM_THRESHOLD = 136.442302
  // =========================
  // Zone Figueres (à calibrer)
  // =========================
  const FIGUERES_ZONE = {
    sKmMin: 132.714904 as number | null, // 133.114904 - 0.400
    sKmMax: 133.514904 as number | null, // 133.114904 + 0.400
    stableIdxTolerance: 10,
  }

  // ✅ Source de vérité runtime pour la zone (modifiable par calibration)
  const figueresZoneMinRef = useRef<number | null>(null)
  const figueresZoneMaxRef = useRef<number | null>(null)

  // ✅ “Latch” Figueres
  const figueresArmedRef = useRef(false)
  const figueresArmedAtRef = useRef<number | null>(null)

  const FIGUERES_ARM_TTL_MS = 10 * 60 * 1000 // 10 minutes

  // ✅ ref miroir pour lire l’état GPS courant dans d’autres handlers
  const gpsStateRef = useRef<0 | 1 | 2>(0)

  // ✅ Dernier fix GPS reçu (pour logique Figueres : zone + stabilité)
  const lastGpsFixRef = useRef<{
    ts: number
    nearestIdx: number | null
    s_km: number | null
    onLine: boolean | null
  } | null>(null)

  const isFigueresArmed = () => {
    if (!figueresArmedRef.current) return false
    const t0 = figueresArmedAtRef.current
    if (typeof t0 !== 'number' || !Number.isFinite(t0)) return false

    const nowMs =
      typeof lastGpsFixRef.current?.ts === 'number' && Number.isFinite(lastGpsFixRef.current.ts)
        ? lastGpsFixRef.current.ts
        : Date.now()

    return nowMs - t0 <= FIGUERES_ARM_TTL_MS
  }

  const FIGUERES_MIN_HALF_WIDTH_KM = 0.4
  const FIGUERES_SKM_ANCHOR = 133.114904
  const FIGUERES_ANCHOR_TOL_KM = 1.0

  const isInFigueresZone = (fix: {
    nearestIdx: number | null
    s_km: number | null
  } | null): boolean => {
    if (!fix) return false
    const { s_km } = fix
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return false

    const a = figueresZoneMinRef.current ?? FIGUERES_ZONE.sKmMin
    const b = figueresZoneMaxRef.current ?? FIGUERES_ZONE.sKmMax

    if (a == null && b == null) {
      const min = FIGUERES_SKM_ANCHOR - FIGUERES_MIN_HALF_WIDTH_KM
      const max = FIGUERES_SKM_ANCHOR + FIGUERES_MIN_HALF_WIDTH_KM
      if (Math.abs(s_km - FIGUERES_SKM_ANCHOR) > FIGUERES_ANCHOR_TOL_KM) return false
      return s_km >= min && s_km <= max
    }

    const rawMin = a != null ? a : (b as number)
    const rawMax = b != null ? b : (a as number)

    const min0 = Math.min(rawMin, rawMax)
    const max0 = Math.max(rawMin, rawMax)

    const center = (min0 + max0) / 2
    const half0 = (max0 - min0) / 2
    const half = Math.max(half0, FIGUERES_MIN_HALF_WIDTH_KM)

    const min = center - half
    const max = center + half
    return s_km >= min && s_km <= max
  }

  // ✅ Calibration Figueres (debug)
  useEffect(() => {
    const doCalib = () => {
      const fix = lastGpsFixRef.current
      const gpsStateNow = gpsStateRef.current

      const payload = {
        source: 'figueres:calibration',
        tLocal: Date.now(),
        gpsState: gpsStateNow,
        tsFix: fix?.ts ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
        s_km: fix?.s_km ?? null,
        onLine: fix?.onLine ?? null,
        zoneMin: figueresZoneMinRef.current,
        zoneMax: figueresZoneMaxRef.current,
        inZone: isInFigueresZone(fix),
      }

      console.log('[Figueres][CALIB]', payload)
      logTestEvent('figueres:calib', payload)

      window.alert(
        `Figueres CALIB\n` +
          `gpsState=${gpsStateNow}\n` +
          `s_km=${payload.s_km ?? 'null'}\n` +
          `idx=${payload.nearestIdx ?? 'null'}\n` +
          `zone=[${payload.zoneMin ?? 'null'} .. ${payload.zoneMax ?? 'null'}]\n` +
          `inZone=${payload.inZone ? 'YES' : 'NO'}`
      )
    }

    const setMin = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MIN: s_km indisponible')
        return
      }
      figueresZoneMinRef.current = s
      console.log('[Figueres][CALIB] SET MIN', { s_km: s })
      logTestEvent('figueres:calib:set-min', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MIN OK\ns_km=${s}`)
    }

    const setMax = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MAX: s_km indisponible')
        return
      }
      figueresZoneMaxRef.current = s
      console.log('[Figueres][CALIB] SET MAX', { s_km: s })
      logTestEvent('figueres:calib:set-max', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MAX OK\ns_km=${s}`)
    }

    const dumpZone = () => {
      const a = figueresZoneMinRef.current
      const b = figueresZoneMaxRef.current

      console.log('[Figueres][CALIB] ZONE', {
        sKmMin: a,
        sKmMax: b,
        ready:
          typeof a === 'number' &&
          Number.isFinite(a) &&
          typeof b === 'number' &&
          Number.isFinite(b),
      })

      if (
        typeof a === 'number' &&
        Number.isFinite(a) &&
        typeof b === 'number' &&
        Number.isFinite(b)
      ) {
        const min = Math.min(a, b)
        const max = Math.max(a, b)
        window.alert(`Figueres ZONE\nsKmMin=${min}\nsKmMax=${max}`)
      } else {
        window.alert('Figueres ZONE: min/max incomplets')
      }
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'F8') {
        ev.preventDefault()
        doCalib()
        return
      }
      if (ev.key === 'F9') {
        ev.preventDefault()
        setMin()
        return
      }
      if (ev.key === 'F6') {
        ev.preventDefault()
        setMax()
        return
      }
      if (ev.key === 'F7') {
        ev.preventDefault()
        dumpZone()
        return
      }
    }

    const onRequest = () => doCalib()

    window.addEventListener('keydown', onKeyDown, { capture: true } as any)
    window.addEventListener('figueres:calib-request', onRequest as EventListener)

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
      window.removeEventListener('figueres:calib-request', onRequest as EventListener)
    }
  }, [])

  type AutoResolvedSide = 'ES' | 'FR' | null

  const [autoResolved, setAutoResolved] = useState<{
    available: boolean
    side: AutoResolvedSide
    s_km: number | null
    pk: number | null
    ts: number | null
    reason:
      | 'ok'
      | 'no_geolocation'
      | 'permission_denied'
      | 'timeout'
      | 'proj_null'
      | 'no_s_km'
      | 'engine_not_ready'
      | 'error'
      | null
  }>(() => ({
    available: false,
    side: null,
    s_km: null,
    pk: null,
    ts: null,
    reason: null,
  }))
  const autoSwitchTimerRef = useRef<number | null>(null)

  const resolveSideFromSkm = (s_km: number | null): AutoResolvedSide => {
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return null
    return s_km < AUTO_FR_SKM_THRESHOLD ? 'ES' : 'FR'
  }

  // ----- TRAITEMENT PDF (spinner + garde-fou timeout) -----
  const [pdfProcessing, setPdfProcessing] = useState(false)
  const pdfProcessingTimerRef = useRef<number | null>(null)

  const PDF_PROCESSING_TIMEOUT_MS = 45_000

  const PDF_PROCESSING_FAIL_MESSAGE =
    "Le traitement du PDF n’a pas abouti. Réessayez ou passez en mode SECOURS (affichage PDF brut)."

  const stopPdfProcessing = () => {
    if (pdfProcessingTimerRef.current != null) {
      window.clearTimeout(pdfProcessingTimerRef.current)
      pdfProcessingTimerRef.current = null
    }
    setPdfProcessing(false)
  }

  const startPdfProcessing = () => {
    stopPdfProcessing()
    setPdfProcessing(true)

    pdfProcessingTimerRef.current = window.setTimeout(() => {
      pdfProcessingTimerRef.current = null
      setPdfProcessing(false)
      setPdfLoadingErrorMessage(PDF_PROCESSING_FAIL_MESSAGE)
    }, PDF_PROCESSING_TIMEOUT_MS)
  }

  const [testRecording, setTestRecording] = useState(false)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [simulationEnabled, setSimulationEnabled] = useState(false)

  // Vrai si un replay a été lancé pendant cette session.
  // Bloque l’export local et l’upload GitHub : le log de session replay
  // ne contient que des reflets du replay, pas de données réelles.
  const wasReplaySessionRef = useRef(false)

  // État de l’upload au moment du Stop ('idle' | 'uploading' | 'success' | 'failed')
  const [stopUploadStatus, setStopUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'failed'>('idle')

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('sim:enable', { detail: { enabled: simulationEnabled } })
    )
  }, [simulationEnabled])

  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

  useEffect(() => {
    autoScrollStartedOnceRef.current = autoScrollStartedOnce
  }, [autoScrollStartedOnce])

  const [ocrOnlineEnabled, setOcrOnlineEnabledState] = useState(() =>
    getOcrOnlineEnabled()
  )

  useEffect(() => {
    setOcrOnlineEnabled(ocrOnlineEnabled)
  }, [ocrOnlineEnabled])

  // TEMPORAIRE (présentation vidéo) : afficher les appuis (cercle orange) dans
  // toute l’application, dès l’ouverture. Persisté en localStorage.
  const [touchIndicatorEnabled, setTouchIndicatorEnabled] = useState(() => {
    try { return localStorage.getItem('lim:touch-indicator') === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('lim:touch-indicator', touchIndicatorEnabled ? '1' : '0') } catch {}
  }, [touchIndicatorEnabled])

  // Présentation PORTRAIT — réglage normal depuis le 19/08.
  // Elle était derrière le menu avancé le temps de la mise au point ; validée en
  // usage, elle passe dans les Paramètres et devient le comportement PAR DÉFAUT.
  //
  // Deux conséquences de ce changement de défaut :
  //  1. On ne mémorise plus que l'EXCEPTION (`lim:portrait-fige`). Rien de stocké
  //     = portrait adapté. Le sens sûr : un stockage vide ou illisible donne le
  //     comportement voulu par la majorité, pas l'inverse.
  //  2. Il n'y a plus d'écran de blocage. Décocher la case ne fait plus
  //     apparaître « Tournez l'iPad » : elle FIGE simplement la présentation
  //     paysage, l'application se contentant de s'afficher plus étroite.
  //     ⚠️ On ne peut PAS empêcher la tablette de tourner : le manifeste déclare
  //     déjà `"orientation": "landscape"` et iOS l'ignore (constaté). Le CSS est
  //     le seul levier disponible.
  const [autoriserPortrait, setAutoriserPortrait] = useState(() => {
    try { return localStorage.getItem('lim:portrait-fige') !== '1' } catch { return true }
  })

  useEffect(() => {
    try {
      if (autoriserPortrait) localStorage.removeItem('lim:portrait-fige')
      else localStorage.setItem('lim:portrait-fige', '1')
      // Clé de la phase d'essai (18/08), remplacée par la précédente.
      localStorage.removeItem('lim:allow-portrait')
    } catch {}
    const root = document.documentElement
    if (autoriserPortrait) root.removeAttribute('data-portrait-fige')
    else root.setAttribute('data-portrait-fige', '')
  }, [autoriserPortrait])

  // ===== Mise à l'échelle de la fiche train (#25) — option + multiplicateur. =====
  // La DENSITÉ DE RÉFÉRENCE (px/km) est calculée automatiquement par FT — celle
  // pour laquelle le plus grand intervalle de la fiche remplit un écran ; ici on
  // ne règle qu'un MULTIPLICATEUR (1× = cette référence).
  // ⚠️ 14/08 — VOLONTAIREMENT NON RESTAURÉ au démarrage (demande utilisateur).
  // L'état était relu depuis localStorage : la case revenait donc cochée alors
  // que la mise à l'échelle, elle, est suspendue tant que INFOS/LTV sont
  // dépliés. La case affichait le MÉMORISÉ, l'écran montrait l'ACTIF — d'où la
  // manœuvre absurde « décocher puis recocher » pour l'activer réellement.
  // L'application ouvre maintenant toujours désactivée, case décochée : les deux
  // concordent. Seul le multiplicateur reste mémorisé (c'est une préférence).
  const [ftScaleEnabled, setFtScaleEnabled] = useState(false)
  /**
   * ⚠️ 15/08 — Curseur RÉTABLI (retiré le 14/08). Il avait été retiré parce que
   * sa course utile s'écrasait à 0,2-0,3 : la densité était alors PLAFONNÉE pour
   * qu'aucun intervalle ne dépasse la hauteur d'écran, faute de quoi on le
   * traversait sans aucune ligne affichée, donc sans Bloc, Vmax ni rampe. La
   * refonte du scroll intelligent (couche en surimpression) a supprimé cette
   * contrainte : le plafond est devenu une simple RÉFÉRENCE, et le multiplicateur
   * retrouve une course réelle. Cf. FT.tsx, `densiteReference`.
   *
   * Valeur COURANTE du curseur. Elle n'est PAS mémorisée telle quelle : c'est
   * l'écart au seuil qui l'est (cf. `ftScaleOffset`).
   */
  const [ftScaleMult, setFtScaleMult] = useState(1)
  /**
   * Seuil de proportionnalité exacte, annoncé par FT (`lim:ft-scale-exact`).
   * À partir de ce multiplicateur, TOUS les segments atteignent la hauteur que
   * leur distance commande : la fiche cesse d'être approximative. Au-delà elle
   * le reste — c'est un plancher, pas un plafond, donc on ne borne PAS le
   * curseur dessus (ce serait retirer précisément la plage exacte).
   * `null` = inconnu (mise à l'échelle inactive, FT n'a rien mesuré).
   */
  const [ftScaleMultExact, setFtScaleMultExact] = useState<number | null>(null)
  /**
   * Point mort annoncé par FT : en dessous, plus aucun segment n'est écarté et
   * la fiche est identique au mode non mis à l'échelle. Borne basse de la
   * course — descendre plus bas ne ferait plus rien du tout.
   */
  const [ftScaleMultPlancher, setFtScaleMultPlancher] = useState<number | null>(null)
  /**
   * ⚠️ VERDICT calculé par FT, jamais déduit ici. La tentation est grande de
   * colorier en vert dès que `ftScaleMult >= ftScaleMultExact` — c'est faux sur
   * un train court : le garde-fou de remplissage abaisse l'étalement réel APRÈS
   * le multiplicateur, et l'exactitude annoncée n'existe plus. Seul FT connaît
   * la valeur finale.
   */
  const [ftScaleExact, setFtScaleExact] = useState(false)
  /**
   * Fiche SATURÉE : le parcours tient dans l'écran et le remplit déjà. Le
   * multiplicateur n'a plus aucun effet — on masque le curseur plutôt que de
   * proposer un réglage inerte.
   */
  const [ftScaleSature, setFtScaleSature] = useState(false)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      const nb = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      setFtScaleMultExact(nb(d?.multiplicateur))
      setFtScaleMultPlancher(nb(d?.plancher))
      setFtScaleExact(!!d?.exact)
      setFtScaleSature(!!d?.sature)
    }
    window.addEventListener('lim:ft-scale-exact', h as EventListener)
    return () => window.removeEventListener('lim:ft-scale-exact', h as EventListener)
  }, [])
  // Bornes effectives de la course, recalculées à chaque annonce.
  const ftScaleMin = ftScaleMultPlancher ?? FT_SCALE_MULT_MIN_DEFAUT
  const ftScaleMax = bornerMax(ftScaleMultExact)

  /**
   * ── PRÉFÉRENCE D'ESPACEMENT : un ÉCART, pas une valeur ────────────────────
   *
   * Ce que le conducteur retient, c'est « un peu plus serré que l'exact », pas
   * « 2,4× ». Et 2,4× ne veut pas la même chose d'un train à l'autre : le seuil
   * d'exactitude dépend du contenu de la fiche et de la hauteur visible, donc de
   * l'orientation de l'iPad. Mémoriser la valeur absolue transporterait un
   * réglage qui n'a plus de sens sur le train suivant.
   *
   * On mémorise donc `multiplicateur − seuil`. Le réglage se recalibre tout seul
   * à chaque train et à chaque rotation, en gardant l'habitude de conduite.
   *
   * ⚠️ Clé NOUVELLE (`lim:ft-scale-offset`). L'ancienne `lim:ft-scale-mult`
   * contenait une valeur absolue de deux sémantiques successives : la relire
   * comme un écart n'aurait aucun sens. Elle n'est plus ni lue ni écrite.
   */
  const [ftScaleOffset, setFtScaleOffset] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('lim:ft-scale-offset') ?? '0')
      return Number.isFinite(v) ? v : 0
    } catch { return 0 }
  })
  useEffect(() => {
    try { localStorage.setItem('lim:ft-scale-offset', String(ftScaleOffset)) } catch {}
  }, [ftScaleOffset])

  /**
   * Recalage du curseur sur `seuil + écart`.
   *
   * ⚠️ Il y a un œuf et une poule : FT ne calcule le seuil que pendant que la
   * mise à l'échelle est active. À l'instant où la case est cochée il est encore
   * inconnu — la fiche est donc mesurée une première fois à la valeur courante,
   * puis recalée. Ce sursaut est assumé (validé par l'utilisateur le 15/08).
   * Il ne peut PAS osciller : `base` est mesuré espacements remis à zéro et la
   * densité de référence ne dépend que du plus grand intervalle et de la hauteur
   * visible — aucun des deux ne dépend du multiplicateur.
   */
  useEffect(() => {
    if (!ftScaleEnabled || ftScaleMultExact === null) return
    const cible = Math.min(
      ftScaleMax,
      Math.max(ftScaleMin, Math.round((ftScaleMultExact + ftScaleOffset) * 10) / 10)
    )
    setFtScaleMult(prev => (Math.abs(prev - cible) < 0.05 ? prev : cible))
  }, [ftScaleEnabled, ftScaleMultExact, ftScaleOffset, ftScaleMin, ftScaleMax])

  useEffect(() => {
    // FT écoute cet événement et se re-rend en direct.
    window.dispatchEvent(new CustomEvent('lim:ft-scale', {
      detail: { enabled: ftScaleEnabled, multiplier: ftScaleMult },
    }))
  }, [ftScaleEnabled, ftScaleMult])

  // #28 — mode de défilement FT : "vertical" (défaut) ou "horizontal".
  // ⚠️ 19/08 — le mode horizontal n'est PLUS expérimental (décision utilisateur,
  // après validation en usage). Ne pas réintroduire la mention « exp. ».
  const [ftScrollMode, setFtScrollMode] = useState<'vertical' | 'horizontal'>(() => {
    try { return localStorage.getItem('lim:ft-scroll-mode') === 'horizontal' ? 'horizontal' : 'vertical' } catch { return 'vertical' }
  })
  useEffect(() => {
    try { localStorage.setItem('lim:ft-scroll-mode', ftScrollMode) } catch {}
    window.dispatchEvent(new CustomEvent('lim:ft-scroll-mode', { detail: { mode: ftScrollMode } }))
  }, [ftScrollMode])

  // #28 — échelle horizontale (px/km) de la FT horizontale (réglage permanent, défaut 100).
  const [ftHScale, setFtHScale] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('lim:fth-scale') ?? '60'); return Number.isFinite(v) && v > 0 ? v : 60 } catch { return 60 }
  })
  useEffect(() => {
    try { localStorage.setItem('lim:fth-scale', String(ftHScale)) } catch {}
    window.dispatchEvent(new CustomEvent('lim:fth-scale', { detail: { pxPerKm: ftHScale } }))
  }, [ftHScale])

  // Menu caché (dev / présentation) : appui LONG sur la roue dentée.
  // Appui court = vrai menu paramètres ; appui long = ce menu caché.
  const [hiddenMenuOpen, setHiddenMenuOpen] = useState(false)
  const settingsLongPressTimerRef = useRef<number | null>(null)
  const settingsLongPressTriggeredRef = useRef(false)
  const SETTINGS_LONG_PRESS_MS = 500

  const clearSettingsLongPress = () => {
    if (settingsLongPressTimerRef.current != null) {
      window.clearTimeout(settingsLongPressTimerRef.current)
      settingsLongPressTimerRef.current = null
    }
  }

  const startSettingsLongPress = () => {
    settingsLongPressTriggeredRef.current = false
    clearSettingsLongPress()
    settingsLongPressTimerRef.current = window.setTimeout(() => {
      settingsLongPressTimerRef.current = null
      settingsLongPressTriggeredRef.current = true
      // Fermer le vrai menu s’il était ouvert, ouvrir le menu caché
      if (settingsDetailsRef.current?.hasAttribute('open')) {
        settingsDetailsRef.current.removeAttribute('open')
      }
      setHiddenMenuOpen(true)
    }, SETTINGS_LONG_PRESS_MS)
  }

  useEffect(() => () => clearSettingsLongPress(), [])

  const [pdfLoading, setPdfLoading] = useState(false)

    const [pdfLoadingErrorMessage, setPdfLoadingErrorMessage] = useState<string | null>(null)

  const pdfLoadingTimerRef = useRef<number | null>(null)

  const stopPdfLoadingGuard = () => {
    if (pdfLoadingTimerRef.current != null) {
      window.clearTimeout(pdfLoadingTimerRef.current)
      pdfLoadingTimerRef.current = null
    }
  }

  const testAutoStartedRef = useRef(false)

  const [scheduleDelta, setScheduleDelta] = useState<string | null>(null)
  const [scheduleDeltaIsLarge, setScheduleDeltaIsLarge] = useState(false)
  const [scheduleDeltaSec, setScheduleDeltaSec] = useState<number | null>(null)

  // =========================
  // GPS Replay (offline) — projection pure
  // =========================
  const gpsReplayInputRef = useRef<HTMLInputElement>(null)
  const [gpsReplayBusy, setGpsReplayBusy] = useState(false)
  const [gpsReplayProgress, setGpsReplayProgress] = useState(0)

  const downloadBlobFile = (filename: string, blob: Blob): boolean => {
    if (typeof document === 'undefined') return false

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)

    try {
      a.click()
      return true
    } finally {
      a.remove()
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {}
      }, 1500)
    }
  }

  const downloadTextFile = (
    filename: string,
    content: string,
    mime = 'text/plain'
  ) => {
    const blob = new Blob([content], { type: mime })
    return downloadBlobFile(filename, blob)
  }

  type ZipEntryInput = {
    filename: string
    blob: Blob
    modifiedAt?: Date
  }

  const sanitizeArchiveEntryFilename = (name: string): string =>
    String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'fichier'

  const ZIP_CRC32_TABLE = (() => {
    const table = new Uint32Array(256)

    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      table[i] = c >>> 0
    }

    return table
  })()

  const encodeZipText = (value: string): Uint8Array => {
    return new TextEncoder().encode(value)
  }

  const concatUint8Arrays = (parts: Uint8Array[]): Uint8Array => {
    let total = 0
    for (const part of parts) total += part.length

    const out = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }

    return out
  }

  const crc32Bytes = (bytes: Uint8Array): number => {
    let crc = 0xffffffff

    for (let i = 0; i < bytes.length; i++) {
      crc = ZIP_CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    }

    return (crc ^ 0xffffffff) >>> 0
  }

  const toDosDateTime = (input?: Date) => {
    const d = input && !isNaN(input.getTime()) ? input : new Date()

    const year = Math.max(1980, d.getFullYear())
    const month = d.getMonth() + 1
    const day = d.getDate()
    const hours = d.getHours()
    const minutes = d.getMinutes()
    const seconds = Math.floor(d.getSeconds() / 2)

    const dosTime = (hours << 11) | (minutes << 5) | seconds
    const dosDate = ((year - 1980) << 9) | (month << 5) | day

    return { dosDate, dosTime }
  }

  const buildZipBlob = async (entries: ZipEntryInput[]): Promise<Blob> => {
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
      const safeName = sanitizeArchiveEntryFilename(entry.filename)
      const nameBytes = encodeZipText(safeName)
      const fileBytes = new Uint8Array(await entry.blob.arrayBuffer())
      const crc32 = crc32Bytes(fileBytes)
      const { dosDate, dosTime } = toDosDateTime(entry.modifiedAt)

      const localHeader = new Uint8Array(30 + nameBytes.length)
      const localView = new DataView(localHeader.buffer)

      localView.setUint32(0, 0x04034b50, true)
      localView.setUint16(4, 20, true)
      localView.setUint16(6, 0x0800, true)
      localView.setUint16(8, 0, true)
      localView.setUint16(10, dosTime, true)
      localView.setUint16(12, dosDate, true)
      localView.setUint32(14, crc32, true)
      localView.setUint32(18, fileBytes.length, true)
      localView.setUint32(22, fileBytes.length, true)
      localView.setUint16(26, nameBytes.length, true)
      localView.setUint16(28, 0, true)
      localHeader.set(nameBytes, 30)

      localParts.push(localHeader, fileBytes)

      const centralHeader = new Uint8Array(46 + nameBytes.length)
      const centralView = new DataView(centralHeader.buffer)

      centralView.setUint32(0, 0x02014b50, true)
      centralView.setUint16(4, 20, true)
      centralView.setUint16(6, 20, true)
      centralView.setUint16(8, 0x0800, true)
      centralView.setUint16(10, 0, true)
      centralView.setUint16(12, dosTime, true)
      centralView.setUint16(14, dosDate, true)
      centralView.setUint32(16, crc32, true)
      centralView.setUint32(20, fileBytes.length, true)
      centralView.setUint32(24, fileBytes.length, true)
      centralView.setUint16(28, nameBytes.length, true)
      centralView.setUint16(30, 0, true)
      centralView.setUint16(32, 0, true)
      centralView.setUint16(34, 0, true)
      centralView.setUint16(36, 0, true)
      centralView.setUint32(38, 0, true)
      centralView.setUint32(42, offset, true)
      centralHeader.set(nameBytes, 46)

      centralParts.push(centralHeader)

      offset += localHeader.length + fileBytes.length
    }

    const centralDirectory = concatUint8Arrays(centralParts)

    const endRecord = new Uint8Array(22)
    const endView = new DataView(endRecord.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(4, 0, true)
    endView.setUint16(6, 0, true)
    endView.setUint16(8, entries.length, true)
    endView.setUint16(10, entries.length, true)
    endView.setUint32(12, centralDirectory.length, true)
    endView.setUint32(16, offset, true)
    endView.setUint16(20, 0, true)

    const zipBytes = concatUint8Arrays([
      ...localParts,
      centralDirectory,
      endRecord,
    ])

    return new Blob([zipBytes], { type: 'application/zip' })
  }

  const exportCurrentTestBundleLocal = async (): Promise<boolean> => {
    const builtLog = buildTestLogFile()
    if (!builtLog.ok || !builtLog.blob) return false

    const pdfFile = currentPdfFileRef.current
    if (!pdfFile) {
      return exportTestLogLocal()
    }

    const naming = getCurrentTestExportNaming()
    const logFilename =
      naming?.logFilename ??
      builtLog.filename ??
      'LIM_testlog.log'

    const pdfFilename =
      naming?.pdfFilename ??
      sanitizeArchiveEntryFilename(pdfFile.name)

    const zipFilename =
      naming?.zipFilename ??
      'LIM_export_test.zip'

    const pdfModifiedAt =
      typeof pdfFile.lastModified === 'number' && Number.isFinite(pdfFile.lastModified)
        ? new Date(pdfFile.lastModified)
        : new Date()

    const zipEntries: ZipEntryInput[] = [
      { filename: logFilename, blob: builtLog.blob, modifiedAt: new Date() },
      { filename: pdfFilename, blob: pdfFile, modifiedAt: pdfModifiedAt },
    ]

    // PDF LTV importé (mode 2026) — inclus lui aussi, nom rendu distinct si collision.
    const ltvPdfFile = currentLtvPdfFileRef.current
    if (ltvPdfFile) {
      const used = new Set(zipEntries.map((e) => e.filename))
      let ltvFilename = sanitizeArchiveEntryFilename(ltvPdfFile.name)
      if (used.has(ltvFilename)) ltvFilename = `LTV_${ltvFilename}`
      zipEntries.push({
        filename: ltvFilename,
        blob: ltvPdfFile,
        modifiedAt:
          typeof ltvPdfFile.lastModified === 'number' && Number.isFinite(ltvPdfFile.lastModified)
            ? new Date(ltvPdfFile.lastModified)
            : new Date(),
      })
    }

    const zipBlob = await buildZipBlob(zipEntries)

    try {
      const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null
      const canShare = !!navAny?.share && !!navAny?.canShare

      if (canShare && typeof File !== 'undefined') {
        const zipFile = new File([zipBlob], zipFilename, {
          type: 'application/zip',
        })

        if (navAny.canShare({ files: [zipFile] })) {
          await navAny.share({
            files: [zipFile],
            title: 'LIM — export test',
            text: zipFilename,
          })
          return true
        }
      }
    } catch {
      // On ignore et on retombe sur le fallback téléchargement.
    }

    return downloadBlobFile(zipFilename, zipBlob)
  }

  // Upload du ZIP vers le repo GitHub privé.
  // Retourne true si succès, false si échec ou timeout (30 s).
  const uploadZipToGitHub = async (zipBlob: Blob, zipFilename: string): Promise<boolean> => {
    if (wasReplaySessionRef.current) return false
    const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
    if (!token) return false

    const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
    const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          resolve(dataUrl.substring(dataUrl.indexOf(',') + 1))
        }
        reader.onerror = reject
        reader.readAsDataURL(zipBlob)
      })

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 30_000)

      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(zipFilename)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: `log: ${zipFilename}`, content: base64 }),
            signal: controller.signal,
          }
        )
        window.clearTimeout(timeoutId)
        return res.ok
      } catch {
        window.clearTimeout(timeoutId)
        return false
      }
    } catch {
      return false
    }
  }

  // Upload (arrière-plan, silencieux, NON bloquant) du normalisé LTV vers GitHub
  // pour que l’éditeur puisse y accéder. Garde seulement le plus récent
  // (comparaison meta.publishedAt). Jamais appelé en mode démo.
  // Renvoie true si le normalisé a été (ré)écrit parce que la Fecha Vigor entrante est
  // STRICTEMENT plus récente (ou qu'aucun normalisé n'existait). Le dépôt du PDF source
  // suit cette décision (cf. uploadLtvSourcePdfToGitHub) → « le plus récent par date de
  // contenu », jamais « le plus récemment envoyé ».
  const uploadNormalizedLtvToGitHub = async (ltvData: NormalizedLtvFile): Promise<boolean> => {
    const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
    if (!token) return false
    const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
    const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
    const path = 'ltv-normalized/current.json'
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`

    // Base64 UTF-8 safe (les LTV contiennent des accents)
    const utf8ToBase64 = (s: string) => {
      const bytes = new TextEncoder().encode(s)
      let bin = ''
      bytes.forEach(b => (bin += String.fromCharCode(b)))
      return btoa(bin)
    }
    const base64ToUtf8 = (b64: string) => {
      const bin = atob(b64.replace(/\n/g, ''))
      return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
    }

    try {
      const newDate = Date.parse(ltvData.meta?.publishedAt ?? '') || 0

      // Récupérer l’existant (sha + date) pour appliquer "le plus récent gagne"
      let sha: string | undefined
      try {
        const getRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (getRes.ok) {
          const existing = await getRes.json()
          sha = existing.sha
          try {
            const decoded = JSON.parse(base64ToUtf8(existing.content ?? ''))
            const existingDate = Date.parse(decoded?.meta?.publishedAt ?? '') || 0
            // On n’uploade que si STRICTEMENT plus récent : évite de ré-écrire
            // des données identiques (ex. démarrage sur le normalisé de secours).
            if (newDate > 0 && existingDate > 0 && newDate <= existingDate) {
              console.log('[ltv-upload] normalisé en ligne à jour → upload ignoré')
              return false
            }
          } catch {}
        }
      } catch {}

      const body: Record<string, unknown> = {
        message: `ltv-normalized: ${ltvData.meta?.publishedAt ?? 'update'}`,
        content: utf8ToBase64(JSON.stringify(ltvData, null, 2)),
      }
      if (sha) body.sha = sha

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (putRes.ok) console.log('[ltv-upload] normalisé LTV partagé avec l\'éditeur')
      else console.warn('[ltv-upload] échec upload', putRes.status)
      return putRes.ok
    } catch (e) {
      console.warn('[ltv-upload] erreur (non bloquant)', e)
      return false
    }
  }

  // Upload (arrière-plan, silencieux, NON bloquant) du PDF SOURCE LTV vers lim-logs,
  // à côté du normalisé (ltv-normalized/current.pdf). Permet au mode secours d'afficher
  // le LTV même s'il n'a pas été importé dans la session courante. Jamais en démo.
  // `newer` = le normalisé vient d'être écrit car la Fecha Vigor entrante est plus
  // récente. On (ré)écrit le PDF si `newer` OU si aucun PDF n'existe encore (rattrapage
  // après déploiement). Sinon on ne touche pas au PDF stocké (« le plus récent » gagne).
  const uploadLtvSourcePdfToGitHub = async (pdf: File, opts: { newer: boolean }): Promise<void> => {
    const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
    if (!token) return
    const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
    const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
    const path = 'ltv-normalized/current.pdf'
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`

    // Binaire → base64 (même style que utf8ToBase64 ci-dessus).
    const bytesToBase64 = (bytes: Uint8Array) => {
      let bin = ''
      bytes.forEach(b => (bin += String.fromCharCode(b)))
      return btoa(bin)
    }

    try {
      // sha de l'existant (pour écraser) + savoir s'il existe (rattrapage).
      let sha: string | undefined
      let exists = false
      try {
        const getRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (getRes.ok) {
          const existing = await getRes.json()
          sha = existing.sha
          exists = true
        }
      } catch {}

      // Le normalisé n'a pas changé et le PDF est déjà là → rien à faire.
      if (!opts.newer && exists) {
        console.log('[ltv-upload] PDF source LTV déjà à jour → upload ignoré')
        return
      }

      const content = bytesToBase64(new Uint8Array(await pdf.arrayBuffer()))
      const body: Record<string, unknown> = {
        message: `ltv-source-pdf: ${new Date().toISOString()}`,
        content,
      }
      if (sha) body.sha = sha

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (putRes.ok) console.log('[ltv-upload] PDF source LTV partagé (secours)')
      else console.warn('[ltv-upload] échec upload PDF', putRes.status)
    } catch (e) {
      console.warn('[ltv-upload] erreur PDF (non bloquant)', e)
    }
  }

  // Construit le ZIP (log + PDF) sans l’exporter ni l’uploader.
  // Traitement du ZIP de demo : parse le log, demarre le mode mixte sans GPS reel
  const handleDemoLoaded = (data: DemoData) => {
    setDemoLoaderOpen(false)

    // Parser le log : normaliser en evenements relatifs
    const lines = data.logText.split(/\r?\n/).filter(l => l.trim())
    const parsed: Array<{ t: string; kind: string; payload: any }> = []
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)) } catch {}
    }
    if (!parsed.length) return
    const t0 = Date.parse(parsed[0].t)
    const events = parsed
      .filter(e => typeof e.kind === 'string' && typeof e.t === 'string')
      .map(e => ({ tMs: Math.max(0, Date.parse(e.t) - t0), kind: e.kind, payload: e.payload ?? {} }))
      .sort((a, b) => a.tMs - b.tMs)

    // Mémoriser le contexte démo : injecté au démarrage du parcours (confirm modale)
    demoCtxRef.current = { events, t0 }

    // Dériver le numéro de train (espagnol) depuis le nom du ZIP : 1ère suite de 3-5 chiffres
    const m = data.zipName.match(/\d{3,5}/)
    const rawNum = m ? m[0] : null
    // Faire correspondre à une option exacte (comparaison numérique = tolère un padding)
    const matched = rawNum
      ? (manualImportTrainOptions.find(t => t.trainNumber === rawNum)
         ?? manualImportTrainOptions.find(t => Number(t.trainNumber) === Number(rawNum)))
      : null
    const trainNum = matched ? matched.trainNumber : rawNum

    // Armer la démo : on n’ouvre PAS la modale tout de suite.
    // Elle s’ouvrira au clic sur Démarrer (comme en utilisation normale).
    setMode2026DemoPdfs(data.pdfFiles)
    setMode2026LockedTrain(trainNum)
    setDemoArmed(true)
  }

  const handleMode2026Confirm = (
    train: ManualTrainOption,
    ltvData: NormalizedLtvFile | null,
    ltvPdfFile: File | null
  ) => {
    setMode2026Open(false)
    ltvPdfDataRef.current = ltvData
    // ⚠️ 14/08 — mémoriser localement le LTV qu'on vient d'extraire : c'est lui
    // qui servira de « dernières LTV connues » au prochain démarrage SANS
    // couverture. Sans ça, un import réussi était perdu dès l'app fermée.
    cacheLtvNormalized(ltvData)
    // Conserver le PDF LTV importé pour l'inclure dans le ZIP au STOP.
    currentLtvPdfFileRef.current = ltvPdfFile
    // Rendre le PDF source LTV disponible au mode secours pour la session courante.
    if (ltvPdfFile)
      window.dispatchEvent(new CustomEvent('lim:ltv-pdf-raw', { detail: { file: ltvPdfFile } }))

    const demoCtx = demoCtxRef.current  // non-null si on démarre depuis le mode démo

    // Activation DÉMO (avant le démarrage du parcours, pour bloquer le GPS réel)
    if (demoCtx) {
      demoT0MsRef.current = demoCtx.t0
      demoWallStartMsRef.current = null
      demoStartedRef.current = false
      demoActiveRef.current = true        // bloque startGpsWatch
      setDemoEvents(demoCtx.events)
      setDemoRunning(false)
      setDemoActive(true)
      wasReplaySessionRef.current = true  // bloque export/upload au Stop
      window.dispatchEvent(new CustomEvent('sim:enable', { detail: { enabled: true } }))
    }

    // ⚠️ Plus d'import de PDF fiche train (étape 3 supprimée le 12/08) : le
    // document affiché en mode SECOURS est désormais le LIVRET FT publié par
    // l'éditeur, ouvert automatiquement à la page du train courant.
    // Le PDF LTV, lui, sert uniquement à l'extraction des données LTV (déjà parsé).
    currentPdfFileRef.current = null

    startNormalizedJourneyFromTrain(train, {
      source: 'mode2026_import',
      activeMode: '2026',
      keepPdf: true,
      closeManualImport: false,
    })

    if (demoCtx) {
      // startNormalizedJourneyFromTrain remet wasReplaySessionRef à false en interne → re-poser
      wasReplaySessionRef.current = true
      stopGpsWatch()  // sécurité iPad (closure simulationEnabled périmée)
      demoCtxRef.current = null
      setDemoArmed(false)
      setMode2026LockedTrain(null)
      setMode2026DemoPdfs([])
    } else if (ltvData) {
      // Usage réel uniquement (PAS en démo) et seulement s’il y a un normalisé LTV :
      // partager avec l’éditeur. Fire-and-forget, non bloquant.
      // Le PDF source suit la décision de date du normalisé (plus récent = on écrit).
      const ltvPdf = currentLtvPdfFileRef.current
      void uploadNormalizedLtvToGitHub(ltvData).then((newer) => {
        if (ltvPdf) void uploadLtvSourcePdfToGitHub(ltvPdf, { newer })
      })
    }
  }

  // Démarrage « LTV seul » : pas de train ni de parcours. On charge les LTV du
  // segment Barcelone→Perpignan (PK ≥ 616, plage FIXE — pas le parcours d'un train)
  // et on n'affiche que le bloc LTV (App masque Infos + fiche train via lim:ltv-only).
  const handleLtvOnlyConfirm = (
    ltvData: NormalizedLtvFile | null,
    ltvPdfFile: File | null
  ) => {
    setMode2026Open(false)
    setMode2026LtvOnly(false)

    ltvPdfDataRef.current = ltvData
    cacheLtvNormalized(ltvData)  // idem : repli hors couverture (cf. ci-dessus)
    currentLtvPdfFileRef.current = ltvPdfFile
    startupLaunchModeRef.current = 'ltv'
    setActiveStartupMode('ltv')
    // Rendre le PDF source LTV disponible au mode secours pour la session courante.
    if (ltvPdfFile)
      window.dispatchEvent(new CustomEvent('lim:ltv-pdf-raw', { detail: { file: ltvPdfFile } }))

    // Fichier canonique partagé (comme le mode 2026 / le viewer). Fire-and-forget.
    // Le PDF source suit la décision de date du normalisé (plus récent = on écrit).
    if (ltvData) {
      void uploadNormalizedLtvToGitHub(ltvData).then((newer) => {
        if (ltvPdfFile) void uploadLtvSourcePdfToGitHub(ltvPdfFile, { newer })
      })
    } else if (ltvPdfFile) {
      // Pas de normalisé : on ne dépose le PDF que s'il manque (rattrapage).
      void uploadLtvSourcePdfToGitHub(ltvPdfFile, { newer: false })
    }

    const ltvOnlyRange: ManualFtRoutePkRange = {
      trainNumber: 0,
      firstPk: 616,
      lastPk: Number.POSITIVE_INFINITY,
      minPk: 616,
      maxPk: Number.POSITIVE_INFINITY,
      source: 'ltv-only',
    }
    const result = loadPdfLtvRows(ltvData ?? {}, ltvOnlyRange)
    const ltvMeta = { ...result.meta, source: 'pdf-ltv' as const }
    currentLtvSourceRef.current = 'pdf-ltv'

    window.dispatchEvent(
      new CustomEvent('ltv:parsed', {
        detail: {
          mode: result.rows.length > 0 ? 'DISPLAY_DIRECT' : 'NO_LTV',
          rows: result.rows,
          source: 'ltv_only',
          ltvSource: 'pdf-ltv',
          availableSources: getAvailableLtvSourcesForMode('ltv'),
          trainNumber: null,
          meta: ltvMeta,
          fetchedAt: ltvMeta.fetchedAt,
          sourceUpdatedAt: ltvMeta.sourceUpdatedAt,
        },
      })
    )

    // Affiche la zone verte + active le flag « LTV seul » (App masque Infos + FT).
    window.dispatchEvent(new CustomEvent('lim:ltv-only', { detail: { enabled: true } }))
    setPdfMode('green')

    logTestEvent('ui:ltv-only:start', {
      source: 'ltv_only_modal',
      rowsCount: result.rows.length,
      hasPdf: ltvPdfFile != null,
    })
  }

  const buildCurrentZipBundle = async (): Promise<{ blob: Blob; filename: string } | null> => {
    const builtLog = buildTestLogFile()
    if (!builtLog.ok || !builtLog.blob) return null

    const naming = getCurrentTestExportNaming()
    const logFilename = naming?.logFilename ?? builtLog.filename ?? 'LIM_testlog.log'
    const zipFilename = naming?.zipFilename ?? 'LIM_export_test.zip'

    const modAt = (f: File): Date =>
      typeof f.lastModified === 'number' && Number.isFinite(f.lastModified)
        ? new Date(f.lastModified)
        : new Date()

    const entries: ZipEntryInput[] = [
      { filename: logFilename, blob: builtLog.blob, modifiedAt: new Date() },
    ]

    // PDF fiche train importé (secours).
    const pdfFile = currentPdfFileRef.current
    if (pdfFile) {
      const pdfFilename = naming?.pdfFilename ?? sanitizeArchiveEntryFilename(pdfFile.name)
      entries.push({ filename: pdfFilename, blob: pdfFile, modifiedAt: modAt(pdfFile) })
    }

    // PDF LTV importé (mode 2026) — inclus lui aussi. Nom rendu distinct si collision.
    const ltvPdfFile = currentLtvPdfFileRef.current
    if (ltvPdfFile) {
      const used = new Set(entries.map((e) => e.filename))
      let ltvFilename = sanitizeArchiveEntryFilename(ltvPdfFile.name)
      if (used.has(ltvFilename)) ltvFilename = `LTV_${ltvFilename}`
      entries.push({ filename: ltvFilename, blob: ltvPdfFile, modifiedAt: modAt(ltvPdfFile) })
    }

    // Aucun PDF → on renvoie juste le log (pas de ZIP), comme avant.
    if (entries.length === 1) return { blob: builtLog.blob, filename: logFilename }

    const zipBlob = await buildZipBlob(entries)
    return { blob: zipBlob, filename: zipFilename }
  }

  // Lance l’export local (share sheet iPad ou téléchargement fallback).
  const doLocalExport = async (blob: Blob, filename: string): Promise<void> => {
    try {
      const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null
      if (navAny?.share && navAny?.canShare && typeof File !== 'undefined') {
        const file = new File([blob], filename, { type: 'application/zip' })
        if (navAny.canShare({ files: [file] })) {
          await navAny.share({ files: [file], title: 'LIM — logs', text: filename })
          return
        }
      }
    } catch {}
    downloadBlobFile(filename, blob)
  }

  const buildRibbonKml = () => {
    const esc = (s: any) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    if (!Array.isArray(RIBBON_POINTS) || RIBBON_POINTS.length === 0) {
      throw new Error('RIBBON_POINTS vide')
    }

    const first = RIBBON_POINTS[0]
    const last = RIBBON_POINTS[RIBBON_POINTS.length - 1]

    let maxLatIdx = 0
    for (let i = 1; i < RIBBON_POINTS.length; i++) {
      if (RIBBON_POINTS[i].lat > RIBBON_POINTS[maxLatIdx].lat) maxLatIdx = i
    }
    const north = RIBBON_POINTS[maxLatIdx]

    const coords = RIBBON_POINTS.map((p) => `${p.lon},${p.lat},0`).join('\n')

    const pointPlacemark = (name: string, p: any, extra: string) => `
  <Placemark>
    <name>${esc(name)}</name>
    <description>${esc(extra)}</description>
    <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
  </Placemark>`

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LIM ribbon</name>
  <description>Export du ruban RIBBON_POINTS</description>

  <Placemark>
    <name>Ruban LAV050 (LineString)</name>
    <description>Points=${RIBBON_POINTS.length}</description>
    <Style><LineStyle><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>
${coords}
      </coordinates>
    </LineString>
  </Placemark>

  ${pointPlacemark('Start (index 0)', first, `index=0 | s_km=${first?.s_km ?? 'null'}`)}
  ${pointPlacemark('End (last index)', last, `index=${RIBBON_POINTS.length - 1} | s_km=${last?.s_km ?? 'null'}`)}
  ${pointPlacemark('Most north (max lat)', north, `index=${maxLatIdx} | s_km=${north?.s_km ?? 'null'}`)}

</Document>
</kml>`

    return kml
  }

  const runGpsReplayFromNdjson = async (file: File) => {
    try {
      setGpsReplayBusy(true)
      setGpsReplayProgress(0)

      stopGpsWatch()

      if (!gpsPkReady) {
        await initGpsPkEngine()
        setGpsPkReady(true)
      }
      resetGpsPkEngineMemory()

      const dirForEngine: 1 | -1 | null =
        expectedDir === 'DOWN' ? -1 : expectedDir === 'UP' ? 1 : null

      setExpectedDirectionForReplay(dirForEngine, {
        source: 'replay_lock',
        train: trainDisplay ?? null,
      })

      const parseTms = (t: any): number | null => {
        if (typeof t === 'number' && Number.isFinite(t)) return Math.trunc(t)
        if (typeof t === 'string' && t.trim().length > 0) {
          const parsed = Date.parse(t)
          if (Number.isFinite(parsed)) return parsed
        }
        return null
      }

      const SPEED = 60

      const text = await file.text()
      const lines = text.split(/\r?\n/)

      const points: Array<{
        tLogMs: number
        tRaw: any
        payload: any
      }> = []

      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue

        let obj: any
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }

        if (obj?.kind !== 'gps:position') continue
        const tLogMs = parseTms(obj?.t)
        if (tLogMs == null) continue

        points.push({
          tLogMs,
          tRaw: obj?.t ?? null,
          payload: obj?.payload ?? {},
        })
      }

      if (points.length === 0) {
        window.alert('Replay GPS: aucun événement kind:"gps:position" lisible dans ce fichier.')
        return
      }

      points.sort((a, b) => a.tLogMs - b.tLogMs)

      const t0Log = points[0].tLogMs
      const t0Sim = Date.now()

      const toSimMs = (tLogMs: number) => Math.trunc(t0Sim + (tLogMs - t0Log))

      const outLines: string[] = []
      outLines.push('# LIM gps replay projection')
      outLines.push(`# source=${file.name}`)
      outLines.push(`# generatedAt=${new Date().toISOString()}`)
      outLines.push('# format=one-JSON-per-line (NDJSON)')
      outLines.push('# kind=gps:replay:projection')

      let inCount = 0
      let outCount = 0

      for (let i = 0; i < points.length; i++) {
        const it = points[i]
        const p = it.payload ?? {}

        const lat = p?.lat
        const lon = p?.lon
        const accuracy = p?.accuracy

        if (typeof lat !== 'number' || typeof lon !== 'number') continue
        inCount++

        const simTs = toSimMs(it.tLogMs)

        if (i > 0) {
          const prevSimTs = toSimMs(points[i - 1].tLogMs)
          const waitMs = Math.max(0, (simTs - prevSimTs) / Math.max(0.0001, SPEED))
          if (waitMs > 0) {
            await new Promise((r) => window.setTimeout(r, waitMs))
          }
        }

        const proj = projectGpsToPk(lat, lon, { nowMs: simTs })
        const projOk = !!proj

        const pk = proj?.pk ?? null
        const s_km = proj?.s_km ?? null
        const distance_m = proj?.distance_m ?? null

        const nearestIdx = proj?.nearestIdx ?? null
        const nearestLat = proj?.nearestLat ?? null
        const nearestLon = proj?.nearestLon ?? null

        const pkCandidate = proj?.pkCandidate ?? null
        const pkDecision = proj?.pkDecision ?? null

        const dist = distance_m
        const onLine = dist != null && dist <= 200

        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat,
              lon,
              accuracy: typeof accuracy === 'number' ? accuracy : undefined,
              pk,
              s_km,
              distance_m,
              onLine,
              timestamp: simTs,
              nearestIdx,
              nearestLat,
              nearestLon,
              pkCandidate,
              pkDecision,
            },
          })
        )

        const record = {
          t: it.tRaw ?? null,
          kind: 'gps:replay:projection',
          payload: {
            lat,
            lon,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
            projOk,
            pk,
            s_km,
            distance_m,
            nearestIdx,
            nearestLat,
            nearestLon,
            pkCandidate,
            pkDecision,
          },
        }

        outLines.push(JSON.stringify(record))
        outCount++

        if (i % 20 === 0 || i === points.length - 1) {
          setGpsReplayProgress((i + 1) / points.length)
        }
      }

      outLines.push(`# stats_in=${inCount}`)
      outLines.push(`# stats_out=${outCount}`)

      downloadTextFile(
        'gps_replay_projection.ndjson',
        outLines.join('\n'),
        'application/x-ndjson'
      )

      window.alert(
        `Replay GPS terminé.\n\n` +
          `Points lus: ${inCount}\n` +
          `Points injectés/exportés: ${outCount}\n\n` +
          `Vitesse: x${SPEED}`
      )
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const stack = err?.stack ? String(err.stack) : ''

      console.warn('[TitleBar] GPS replay failed', err)
      if (stack) console.warn('[TitleBar] GPS replay stack:\n' + stack)

      const stackLine = stack.split('\n').slice(0, 2).join('\n')
      window.alert(`Replay GPS impossible: ${msg}\n\n${stackLine}`)
    } finally {
      setGpsReplayProgress(0)
      setGpsReplayBusy(false)
      if (gpsReplayInputRef.current) gpsReplayInputRef.current.value = ''
    }
  }

  const formatSignedHMS = (deltaSec: number): string => {
    const sign = deltaSec < 0 ? '-' : '+'
    const abs = Math.abs(deltaSec)
    const hh = Math.floor(abs / 3600)
    const mm = Math.floor((abs % 3600) / 60)
    const ss = abs % 60
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return hh > 0 ? `${sign}${hh}:${pad2(mm)}:${pad2(ss)}` : `${sign}${mm}:${pad2(ss)}`
  }

  // ----- GPS / PK (moteur labo) -----
  const [gpsPkReady, setGpsPkReady] = useState(false)
  const gpsWatchIdRef = useRef<number | null>(null)

  const gpsLastInfoRef = useRef<{
    lat: number
    lon: number
    accuracy?: number
    pk?: number | null
    s_km?: number | null
    dist_m?: number | null
  } | null>(null)

  const [gpsPkDisplay, setGpsPkDisplay] = useState<string | null>(null)

    const [gpsPkPeekVisible, setGpsPkPeekVisible] = useState(false)
  const gpsPkPeekTimerRef = useRef<number | null>(null)

  const showGpsPkTemporarily = () => {
    if (testModeEnabled) return
    if (gpsState !== 2) return
    if (!gpsPkDisplay) return

    setGpsPkPeekVisible(true)

    if (gpsPkPeekTimerRef.current != null) {
      window.clearTimeout(gpsPkPeekTimerRef.current)
    }

    gpsPkPeekTimerRef.current = window.setTimeout(() => {
      gpsPkPeekTimerRef.current = null
      setGpsPkPeekVisible(false)
    }, 10_000)

    logTestEvent('ui:gps-pk:temporary-show', {
      source: 'titlebar',
      pk: gpsPkDisplay,
      durationMs: 10_000,
    })
  }
  // Figueres — stabilité
  const FIGUERES_STOP_STABLE_MS = 30_000
  const figueresStableSinceRef = useRef<number | null>(null)
  const figueresStableIdxRef = useRef<number | null>(null)
  const figueresStopTriggeredRef = useRef(false)

  useEffect(() => {
    gpsStateRef.current = gpsState
  }, [gpsState])

    useEffect(() => {
    return () => {
      if (gpsPkPeekTimerRef.current != null) {
        window.clearTimeout(gpsPkPeekTimerRef.current)
        gpsPkPeekTimerRef.current = null
      }
    }
  }, [])

  // ✅ Arme Figueres quand GREEN dans zone
  useEffect(() => {
    if (gpsState !== 2) return
    const fix = lastGpsFixRef.current
    if (!fix) return

    if (
      gpsReplayBusy &&
      figueresZoneMinRef.current == null &&
      figueresZoneMaxRef.current == null &&
      typeof fix.s_km === 'number' &&
      Number.isFinite(fix.s_km)
    ) {
      const zMin = FIGUERES_ZONE.sKmMin
      const zMax = FIGUERES_ZONE.sKmMax

      const hasBounds =
        typeof zMin === 'number' &&
        Number.isFinite(zMin) &&
        typeof zMax === 'number' &&
        Number.isFinite(zMax)

      if (hasBounds) {
        const minZ = Math.min(zMin as number, zMax as number) - 1.0
        const maxZ = Math.max(zMin as number, zMax as number) + 1.0

        const plausible = fix.s_km >= minZ && fix.s_km <= maxZ

        if (plausible) {
          figueresZoneMinRef.current = fix.s_km
          figueresZoneMaxRef.current = fix.s_km

          console.log('[Figueres][REPLAY] AUTO-CALIB ZONE', { s_km: fix.s_km })
          logTestEvent('figueres:calib:auto', {
            source: 'replay_auto',
            s_km: fix.s_km,
            tLocal: Date.now(),
          })
        }
      }
    }

    figueresArmedRef.current = true

    const tArmed = typeof fix.ts === 'number' && Number.isFinite(fix.ts) ? fix.ts : Date.now()
    figueresArmedAtRef.current = tArmed

    console.log('[Figueres] ARMED (GREEN in zone)', {
      s_km: fix?.s_km ?? null,
      idx: fix?.nearestIdx ?? null,
      tLocal: tArmed,
    })
    logTestEvent('figueres:armed', {
      reason: 'green_in_zone',
      s_km: fix?.s_km ?? null,
      nearestIdx: fix?.nearestIdx ?? null,
      tLocal: figueresArmedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsState, gpsReplayBusy])

  // ✅ Arrêt Figueres => auto switch FT
  useEffect(() => {
    const t = window.setInterval(() => {
      // ⚠️ FT France abandonnée : auto-switch Figueres NEUTRALISÉ (2026-06-08). Voir flag en haut du fichier.
      if (!FT_FRANCE_AUTOSWITCH_ENABLED) return
      if (!isFigueresArmed()) {
        figueresStopTriggeredRef.current = false
        return
      }

      const fix = lastGpsFixRef.current
      if (!fix) return

      if (!isInFigueresZone(fix)) {
        figueresStopTriggeredRef.current = false
        return
      }

      const t0 = figueresStableSinceRef.current
      if (typeof t0 !== 'number' || !Number.isFinite(t0)) return

      const nowMs = gpsReplayBusy ? Date.now() : lastGpsFixRef.current?.ts ?? Date.now()
      const stableMs = nowMs - t0
      if (stableMs < FIGUERES_STOP_STABLE_MS) return

      if (figueresStopTriggeredRef.current) return
      figueresStopTriggeredRef.current = true

      const target: 'FR' | 'ES' = 'FR'

      if (!autoEngaged) {
        console.log('[Figueres][DEBUG] autoEngaged=', autoEngaged)
        logTestEvent('figueres:auto-switch:skipped', {
          reason: 'auto_not_engaged',
          target,
          stableMs,
          s_km: fix?.s_km ?? null,
          nearestIdx: fix?.nearestIdx ?? null,
        })
        return
      }

      setFtViewMode(target)
      logTestEvent('figueres:auto-switch:applied', {
        target,
        stableMs,
        s_km: fix?.s_km ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
      })

      console.log('[Figueres] AUTO SWITCH FT =>', target, {
        stableMs,
        s_km: fix?.s_km ?? null,
        idx: fix?.nearestIdx ?? null,
      })
    }, 250)

    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEngaged])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lim:pdf-mode-change', { detail: { mode: pdfMode } }))
    logTestEvent('ui:pdf:mode-change', { mode: pdfMode })
  }, [pdfMode])

  // Quand un replay démarre : on pose le flag (bloque l'UPLOAD GitHub au Stop) ET on
  // (re)démarre l'ENREGISTREMENT. Indispensable au diagnostic : on veut capturer les
  // RÉACTIONS de l'app au replay (gps:state-change, gps:mode-change, gps:arret:*,
  // figueres:*…), pas seulement le reflet des positions. L'export se fait en LOCAL au Stop.
  // (if !testRecording : ne pas relancer sur un simple resume → pas de perte d'events.)
  useEffect(() => {
    const handler = () => {
      wasReplaySessionRef.current = true
      if (!testRecording) {
        startTestSession('replay')
        setTestRecording(true)
      }
      // ✅ HORLOGE VIRTUELLE DE REPLAY (#21) : on remplace window.Date par un Proxy qui renvoie
      // l'heure du REPLAY (et non l'heure réelle), exactement comme la démo. Sinon les deltas,
      // les positions horaire et l'heuristique de vitesse sont faussés (calculés sur l'heure réelle).
      // Source = __limgptReplay.nowIso() (le player calcule nowMs via performance.now(), donc pas de
      // récursion ; getNowIso construit ses dates avec argument => insensible au proxy).
      if (!origDateRef.current) {
        const origDate = window.Date
        origDateRef.current = origDate
        const replayNowMs = (): number => {
          try {
            const iso = (window as any).__limgptReplay?.nowIso?.()
            if (iso) {
              const ms = origDate.parse(iso)
              if (Number.isFinite(ms)) return ms
            }
          } catch {}
          return origDate.now()
        }
        window.Date = new Proxy(origDate, {
          construct(target, args) {
            if (args.length === 0) return Reflect.construct(target, [replayNowMs()])
            return Reflect.construct(target, args as any)
          },
          get(target, prop, receiver) {
            if (prop === 'now') return () => replayNowMs()
            const val = Reflect.get(target, prop, receiver)
            return typeof val === 'function' ? val.bind(target) : val
          },
        }) as unknown as typeof Date
        console.log('[TitleBar] Horloge virtuelle REPLAY installée')
      }
    }
    window.addEventListener('replay:play-started', handler)
    return () => window.removeEventListener('replay:play-started', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRecording])

  // ✅ Fin d'un replay (Stop du PANNEAU Replay, #23) : on propose l'export LOCAL du log
  // (jamais d'upload, pour ne pas polluer lim-logs), on finalise l'enregistrement et on
  // restaure l'horloge réelle.
  useEffect(() => {
    const handler = () => {
      // 1) Restaurer l'horloge réelle (fin du replay).
      if (origDateRef.current) {
        window.Date = origDateRef.current
        origDateRef.current = null
      }
      // 2) Finaliser l'enregistrement.
      let hadLog = false
      if (testRecording) {
        logTestEvent('replay:stopped', {})
        stopTestSession()
        setTestRecording(false)
        hadLog = true
      }
      // 3) Proposer l'export LOCAL (OUI = télécharger / NON = effacer). Jamais d'upload.
      if (wasReplaySessionRef.current && hadLog) {
        const doExport = window.confirm(
          'Replay terminé.\n\nExporter le log de ce replay en local ?\n\nOK = télécharger    /    Annuler = effacer'
        )
        if (doExport) {
          void exportTestLogLocal().catch((e) =>
            console.warn('[TitleBar] Export log replay impossible', e)
          )
        }
      }
      wasReplaySessionRef.current = false
    }
    window.addEventListener('replay:stopped', handler)
    return () => window.removeEventListener('replay:stopped', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRecording])

  // Pendant le replay, le player/overlay dispatch lim:pdf-mode-change avec
  // source='replay' ou 'replay-catchup'. TitleBar étant la source de vérité de
  // pdfMode, il doit se mettre à jour pour rendre les indicateurs (GPS, Play, 🕑).
  // Pas de boucle : TitleBar dispatch toujours SANS ces flags source.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const source = ce?.detail?.source as string | undefined
      if (source !== 'replay' && source !== 'replay-catchup') return
      const mode = ce?.detail?.mode as 'blue' | 'green' | 'red' | undefined
      if (mode === 'blue' || mode === 'green' || mode === 'red') {
        setPdfMode(mode)
      }
    }
    window.addEventListener('lim:pdf-mode-change', handler as EventListener)
    return () => window.removeEventListener('lim:pdf-mode-change', handler as EventListener)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lim:test-mode', { detail: { enabled: testModeEnabled } }))
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lim:test-mode', { detail: { enabled: testModeEnabled } }))
    }, 400)
    return () => window.clearTimeout(t)
  }, [testModeEnabled])

  // ----- NUMÉRO DE TRAIN + TYPE + COMPOSITION -----
  const [trainDisplay, setTrainDisplay] = useState<string | undefined>(() => {
    const w = window as any
    const last: LIMFields | undefined = w.__limLastParsed
    const raw = last?.trenPadded ?? last?.tren
    return toTitleNumber(raw)
  })

  useEffect(() => {
    if (!trainDisplay) return
    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const FT_FR_WHITELIST = new Set<number>([9712, 9714, 9707, 9709, 9705, 9710])
    const isEligible = FT_FR_WHITELIST.has(n)

    if (!isEligible && ftViewMode !== 'ES') {
      setFtViewMode('ES')
      logTestEvent('ui:ftViewMode:force', {
        reason: 'train_not_eligible',
        train: trainDisplay,
        forcedMode: 'ES',
        source: 'titlebar',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

  const [trainType, setTrainType] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawTrain = last?.trenPadded ?? last?.tren
    const trainNumber = toTitleNumber(rawTrain)

    const normalizedTypeEs = trainNumber
      ? getTrainCategorieEspagne(trainNumber)
      : undefined
    const normalizedTypeFr = trainNumber
      ? getTrainCategorieFrance(trainNumber)
      : undefined

    const normalizedDisplayedType = normalizedTypeEs ?? normalizedTypeFr

    if (normalizedDisplayedType) return normalizedDisplayedType

    const rawType = last?.type
    return rawType ? String(rawType) : undefined
  })

  const [trainComposition, setTrainComposition] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawComp = last?.composicion ?? last?.unit
    return rawComp ? String(rawComp) : undefined
  })
  const [displayedCompositionState, setDisplayedCompositionState] =
    useState<DisplayedCompositionState>(() => {
      const w = window as any
      return (
        (w.__limLastDisplayedCompositionState as DisplayedCompositionState | undefined) ?? {
          normalizedComposition: undefined,
          displayedComposition: undefined,
          manualOverrideActive: false,
        }
      )
    })

  const displayedCompositionStateRef = useRef<DisplayedCompositionState>(
    displayedCompositionState
  )

  useEffect(() => {
    displayedCompositionStateRef.current = displayedCompositionState
  }, [displayedCompositionState])

  const applyDisplayedCompositionState = (
    nextState: DisplayedCompositionState,
    meta?: { source?: string; reason?: string }
  ) => {
    setDisplayedCompositionState(nextState)
    displayedCompositionStateRef.current = nextState
    setTrainComposition(nextState.displayedComposition)
    ;(window as any).__limLastDisplayedCompositionState = nextState

    window.dispatchEvent(
      new CustomEvent('lim:displayed-composition-change', {
        detail: nextState,
      })
    )

    logTestEvent('ui:displayed-composition-change', {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? 'unspecified',
      normalizedComposition: nextState.normalizedComposition ?? null,
      displayedComposition: nextState.displayedComposition ?? null,
      manualOverrideActive: nextState.manualOverrideActive,
    })
  }
  const [displayedTrainNumberState, setDisplayedTrainNumberState] =
    useState<DisplayedTrainNumberState>({
      trainNumberEs: undefined,
      trainNumberFr: undefined,
      displayedSide: 'ES',
      pendingSide: null,
      isBlinking: false,
      displayedNumber: undefined,
    })
  const applyDisplayedTrainNumberState = (
    nextState: DisplayedTrainNumberState,
    meta?: { source?: string; reason?: string }
  ) => {
    setDisplayedTrainNumberState(nextState)
    ;(window as any).__limLastDisplayedTrainNumberState = nextState

    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-change', {
        detail: nextState,
      })
    )

    logTestEvent('ui:displayed-train-number-change', {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? 'unspecified',
      trainNumberEs: nextState.trainNumberEs ?? null,
      trainNumberFr: nextState.trainNumberFr ?? null,
      displayedSide: nextState.displayedSide,
      pendingSide: nextState.pendingSide,
      isBlinking: nextState.isBlinking,
      displayedNumber: nextState.displayedNumber ?? null,
    })
  }
    const buildDisplayedTrainNumberState = (params: {
    trainNumberEs?: string
    trainNumberFr?: string
    displayedSide: NumberingSide
    pendingSide?: NumberingSide | null
    isBlinking?: boolean
  }): DisplayedTrainNumberState => {
    const trainNumberEs = params.trainNumberEs
    const trainNumberFr = params.trainNumberFr
    const displayedSide = params.displayedSide
    const pendingSide = params.pendingSide ?? null
    const isBlinking = params.isBlinking ?? false

    const visibleSide: NumberingSide =
      isBlinking && pendingSide ? pendingSide : displayedSide

    const displayedNumber =
      visibleSide === 'FR'
        ? trainNumberFr ?? trainNumberEs
        : trainNumberEs ?? trainNumberFr

    return {
      trainNumberEs,
      trainNumberFr,
      displayedSide,
      pendingSide,
      isBlinking,
      displayedNumber,
    }
  }
    const displayedTrainNumberStateRef = useRef<DisplayedTrainNumberState>(
    displayedTrainNumberState
  )

  useEffect(() => {
    displayedTrainNumberStateRef.current = displayedTrainNumberState
  }, [displayedTrainNumberState])

  useEffect(() => {
    return () => {
      if (titleBarLongPressTimerRef.current != null) {
        window.clearTimeout(titleBarLongPressTimerRef.current)
        titleBarLongPressTimerRef.current = null
      }
    }
  }, [])

  const NUMBERING_SWITCH_ANCHORS = {
    DOWN: {
      label: 'LLERS',
      triggerSkm: 138.393795 - 0.3,
      targetSide: 'ES' as NumberingSide,
    },
    UP: {
      label: 'FIGUERES-VILAFANT',
      triggerSkm: 133.765372 + 0.3,
      targetSide: 'FR' as NumberingSide,
    },
  }

  const numberingAnchorTriggeredRef = useRef(false)
  const TITLEBAR_LONG_PRESS_MS = 500
  const titleBarLongPressTimerRef = useRef<number | null>(null)
  const titleBarLongPressTriggeredRef = useRef(false)
  const titleBarPointerGestureIdRef = useRef(0)
  const titleBarLongPressGestureIdRef = useRef(0)

  const applyDisplayedTrainNumberSide = (
    displayedSide: NumberingSide,
    meta?: {
      trainNumberEs?: string
      trainNumberFr?: string
      pendingSide?: NumberingSide | null
      isBlinking?: boolean
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: meta?.trainNumberEs ?? current.trainNumberEs,
      trainNumberFr: meta?.trainNumberFr ?? current.trainNumberFr,
      displayedSide,
      pendingSide: meta?.pendingSide ?? null,
      isBlinking: meta?.isBlinking ?? false,
    })

    applyDisplayedTrainNumberState(nextState, {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? `switch_to_${displayedSide}`,
    })
  }
    const applyDisplayedTrainNumberPendingSide = (
    pendingSide: NumberingSide | null,
    meta?: {
      displayedSide?: NumberingSide
      trainNumberEs?: string
      trainNumberFr?: string
      isBlinking?: boolean
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: meta?.trainNumberEs ?? current.trainNumberEs,
      trainNumberFr: meta?.trainNumberFr ?? current.trainNumberFr,
      displayedSide: meta?.displayedSide ?? current.displayedSide,
      pendingSide,
      isBlinking: meta?.isBlinking ?? pendingSide != null,
    })

    applyDisplayedTrainNumberState(nextState, {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? (pendingSide ? `pending_${pendingSide}` : 'pending_clear'),
    })
  }
    const armDisplayedTrainNumberPendingSide = (
    targetSide: NumberingSide,
    meta?: {
      trainNumberEs?: string
      trainNumberFr?: string
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const trainNumberEs = meta?.trainNumberEs ?? current.trainNumberEs
    const trainNumberFr = meta?.trainNumberFr ?? current.trainNumberFr

    if (targetSide === current.displayedSide) return

    if (current.pendingSide === targetSide && current.isBlinking) return

    const hasTargetNumber =
      targetSide === 'FR'
        ? typeof trainNumberFr === 'string' && trainNumberFr.trim() !== ''
        : typeof trainNumberEs === 'string' && trainNumberEs.trim() !== ''

    if (!hasTargetNumber) return

    applyDisplayedTrainNumberPendingSide(targetSide, {
      displayedSide: current.displayedSide,
      trainNumberEs,
      trainNumberFr,
      isBlinking: true,
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? `arm_pending_${targetSide}`,
    })
  }
    useEffect(() => {
    const onCommitRequest = () => {
      const current = displayedTrainNumberStateRef.current
      const pendingSide = current.pendingSide

      if (!pendingSide) return

      applyDisplayedTrainNumberSide(pendingSide, {
        trainNumberEs: current.trainNumberEs,
        trainNumberFr: current.trainNumberFr,
        pendingSide: null,
        isBlinking: false,
        source: 'infos_tren',
        reason: 'manual_commit_pending_side',
      })
    }

    const onManualToggleRequest = () => {
      const current = displayedTrainNumberStateRef.current

      const hasNumeroFrance =
        typeof current.trainNumberFr === 'string' &&
        current.trainNumberFr.trim() !== ''

      if (!hasNumeroFrance) return

      const targetSide: NumberingSide =
        current.displayedSide === 'ES' ? 'FR' : 'ES'

      armDisplayedTrainNumberPendingSide(targetSide, {
        trainNumberEs: current.trainNumberEs,
        trainNumberFr: current.trainNumberFr,
        source: 'infos_tren',
        reason: 'manual_toggle_request',
      })
    }

    const onCompositionManualToggleRequest = () => {
      const current = displayedCompositionStateRef.current

      const fallback = current.displayedComposition ?? current.normalizedComposition
      const currentValue = String(fallback ?? '').trim().toUpperCase()

      const nextComposition = currentValue === 'UM' ? 'US' : 'UM'

      applyDisplayedCompositionState(
        {
          normalizedComposition: current.normalizedComposition,
          displayedComposition: nextComposition,
          manualOverrideActive: nextComposition !== current.normalizedComposition,
        },
        {
          source: 'infos_composition',
          reason: 'manual_toggle_request',
        }
      )
    }

    window.addEventListener(
      'lim:displayed-train-number-commit-request',
      onCommitRequest as EventListener
    )
    window.addEventListener(
      'lim:displayed-train-number-manual-toggle-request',
      onManualToggleRequest as EventListener
    )
    window.addEventListener(
      'lim:displayed-composition-manual-toggle-request',
      onCompositionManualToggleRequest as EventListener
    )

    return () => {
      window.removeEventListener(
        'lim:displayed-train-number-commit-request',
        onCommitRequest as EventListener
      )
      window.removeEventListener(
        'lim:displayed-train-number-manual-toggle-request',
        onManualToggleRequest as EventListener
      )
      window.removeEventListener(
        'lim:displayed-composition-manual-toggle-request',
        onCompositionManualToggleRequest as EventListener
      )
    }
  }, [])
  useEffect(() => {
    numberingAnchorTriggeredRef.current = false

    const numeroEs = trainDisplay
    // ⚠️ 20/08 — CORRIGÉ : lisait l'ANCIEN normalisé, qui indexe les trains
    // montants par leur numéro FRANÇAIS (9710/9712/9714) là où le 2026 les
    // indexe par l'ESPAGNOL (9711/9713/9715). Aucune clé ne correspondait pour
    // un train nordSud → `undefined` → `hasNumeroFrance: false` → bascule de
    // numéro à la frontière impossible. Constaté en ligne le 20/08 sur le 9715.
    const numeroFr = numeroEs ? getTrainNumeroFrance2026(numeroEs) : undefined

    const numeroEsAsNumber =
      typeof numeroEs === 'string' && numeroEs.trim() !== ''
        ? Number(numeroEs)
        : NaN

    const hasNumeroFrance = typeof numeroFr === 'string' && numeroFr.trim() !== ''
    // ⚠️ 13/08 : « démarre en France » = train nordSud (part de Perpignan), lu
    // dans le normalisé — la parité (ancien critère) est fausse pour 9713 & co.
    const shouldStartInFrance =
      hasNumeroFrance &&
      Number.isFinite(numeroEsAsNumber) &&
      isTrainSudNord(numeroEsAsNumber) === false

    const displayedSide: NumberingSide = shouldStartInFrance ? 'FR' : 'ES'


    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: numeroEs,
      trainNumberFr: numeroFr,
      displayedSide,
      pendingSide: null,
      isBlinking: false,
    })

    console.log('[TitleBar][displayed-train-number:init]', {
      trainDisplay,
      numeroEs,
      numeroFr,
      numeroEsAsNumber,
      hasNumeroFrance,
      shouldStartInFrance,
      displayedSide,
      displayedNumber: nextState.displayedNumber,
      nextState,
    })

    applyDisplayedTrainNumberSide(displayedSide, {
      trainNumberEs: numeroEs,
      trainNumberFr: numeroFr,
      pendingSide: null,
      isBlinking: false,
      source: 'titlebar',
      reason: hasNumeroFrance ? 'initial_rule_fr_if_es_even_else_es' : 'initial_rule_es_only',
    })
  }, [trainDisplay])
  useEffect(() => {
    const currentTrainNumber = trainDisplay
    if (!currentTrainNumber) return

    const normalizedTypeEs = getTrainCategorieEspagne(currentTrainNumber)
    const normalizedTypeFr = getTrainCategorieFrance(currentTrainNumber)

    const normalizedDisplayedType =
      displayedTrainNumberState.displayedSide === 'FR'
        ? normalizedTypeFr ?? normalizedTypeEs
        : normalizedTypeEs ?? normalizedTypeFr

    if (normalizedDisplayedType) {
      setTrainType(normalizedDisplayedType)
      return
    }

    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawType = last?.type
    setTrainType(rawType ? String(rawType) : undefined)
  }, [trainDisplay, displayedTrainNumberState.displayedSide])
    useEffect(() => {
    const currentTrainNumber = trainDisplay
    if (!currentTrainNumber) return

    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawComp = last?.composicion ?? last?.unit
    const fallbackComposition = rawComp ? String(rawComp).trim().toUpperCase() : undefined

    // Composition : plus lue du normalisé (décision 07/08). Défaut US, bascule manuelle UM.
    const baseComposition = fallbackComposition ?? 'US'

    applyDisplayedCompositionState(
      {
        normalizedComposition: baseComposition,
        displayedComposition: baseComposition,
        manualOverrideActive: false,
      },
      {
        source: 'titlebar',
        reason: 'train_display_reset_to_base_composition',
      }
    )
  }, [trainDisplay])
  // =========================
  // Direction attendue (PK)
  // =========================
  type ExpectedDir = 'UP' | 'DOWN'
  const [expectedDir, setExpectedDir] = useState<ExpectedDir | null>(null)
  const expectedDirRef = useRef<ExpectedDir | null>(null)
  const expectedDirLockedRef = useRef(false)
  // `normalized_direction` = sens DÉCLARÉ dans le normalisé (source de référence
  // depuis le 13/08) ; `train_number` = ancien repli par parité du numéro.
  const expectedDirSourceRef = useRef<
    'normalized_direction' | 'train_number' | 'manual' | null
  >(null)
  const expectedDirTrainRef = useRef<string | null>(null)

  const emitExpectedDir = (dir: ExpectedDir, meta: { source: string }) => {
    const detail = {
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      train: trainDisplay ?? null,
      locked: true,
      source: meta.source,
    }

    window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
    window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
      window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))
    }, 400)
  }

  useEffect(() => {
    if (!trainDisplay) return

    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const trainChanged = expectedDirTrainRef.current !== trainDisplay
    if (!trainChanged && expectedDirLockedRef.current) return

    // ⚠️ CORRIGÉ le 13/08 — le sens attendu vient du SENS DÉCLARÉ, plus de la parité.
    //
    // Ce sens pilote le moteur de position : il sert à écarter les relevés dont
    // le déplacement contredit la marche (`rejected_direction`), et il arme un
    // cliquet qui interdit tout retour vers un référentiel « plus au sud »
    // (`applyDirectionalPkRefFloor`, actif uniquement en sens UP).
    //
    // Ça marchait tant que le numéro AFFICHÉ était le français : 9712 pair →
    // DOWN, ce qui est juste pour un train descendant. La migration 2026 affiche
    // désormais l'espagnol seul (`initial_rule_es_only`) : 9713 est IMPAIR, donc
    // la parité renvoie UP pour un train qui descend. Tout s'inverse.
    // Mesuré sur les journaux : le 9712 du 24/06 acceptait 97,4 % des positions
    // et n'a JAMAIS rejeté pour cause de sens ; le 9713 du 13/08 tombe à 85,6 %,
    // avec 28 rejets de sens qui en entraînent 278 pour saut, par verrouillage.
    //
    // ⚠️ Le sens est exprimé sur la coordonnée MONOTONE `s_km`, pas sur le PK
    // réseau : celui-ci croît sur RFN et LFP puis décroît sur ADIF pour un même
    // train, il ne peut donc pas servir de référence de sens.
    //   sudNord (Can Tunis → Perpignan, s_km croissant)  = UP
    //   nordSud (Perpignan → Can Tunis, s_km décroissant) = DOWN
    // Repli sur la parité si le train n'est pas déclaré (ancien comportement).
    const declaredDirection = getTrainDirection(trainDisplay)
    const dir: ExpectedDir = declaredDirection
      ? (declaredDirection === 'sudNord' ? 'UP' : 'DOWN')
      : (n % 2 === 0 ? 'DOWN' : 'UP')

    expectedDirLockedRef.current = true
    expectedDirTrainRef.current = trainDisplay
    expectedDirSourceRef.current = declaredDirection
      ? 'normalized_direction'
      : 'train_number'
    setExpectedDir(dir)

    logTestEvent('direction:lock', {
      // Étiquette FIDÈLE à la source réellement retenue : indispensable pour
      // diagnostiquer un journal (c'est elle qui a révélé le défaut du 13/08).
      source: expectedDirSourceRef.current ?? 'train_number',
      declaredDirection: declaredDirection ?? null,
      train: trainDisplay,
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      trainChanged,
    })

    emitExpectedDir(dir, { source: expectedDirSourceRef.current ?? 'train_number' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

  useEffect(() => {
    expectedDirRef.current = expectedDir
  }, [expectedDir])

  useEffect(() => {
    const reset = () => {
      expectedDirLockedRef.current = false
      expectedDirTrainRef.current = null
      expectedDirSourceRef.current = null
      numberingAnchorTriggeredRef.current = false
      startupLaunchModeRef.current = null
      setActiveStartupMode(null)
      setExpectedDir(null)
      logTestEvent('direction:reset', { source: 'clear_pdf' })
    }

    window.addEventListener('lim:clear-pdf', reset as EventListener)
    window.addEventListener('ft:clear-pdf', reset as EventListener)
    return () => {
      window.removeEventListener('lim:clear-pdf', reset as EventListener)
      window.removeEventListener('ft:clear-pdf', reset as EventListener)
    }
  }, [])

  // ----- INFOS (à afficher depuis la roue dentée) -----
  const [aboutOpen, setAboutOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualInitialPage, setManualInitialPage] = useState(1)
  const [manualInitialTocId, setManualInitialTocId] = useState('cover')
  const [guiaOpen, setGuiaOpen] = useState(false)

  // ----- MODE 2026 -----
  const [mode2026Open, setMode2026Open] = useState(false)
  // Variante « LTV seul » de la modale mode 2026 (import PDF LTV uniquement).
  const [mode2026LtvOnly, setMode2026LtvOnly] = useState(false)
  const ltvPdfDataRef = useRef<NormalizedLtvFile | null>(null)
  // Mode 2026 en contexte DÉMO : train verrouillé + PDF issus du ZIP
  const [mode2026LockedTrain, setMode2026LockedTrain] = useState<string | null>(null)
  const [mode2026DemoPdfs, setMode2026DemoPdfs] = useState<File[]>([])
  // Démo "armée" : ZIP chargé, en attente du clic Démarrer pour ouvrir la modale guidée
  const [demoArmed, setDemoArmed] = useState(false)
  // Évènements GPS du log de démo en attente (injectés au démarrage du parcours)
  const demoCtxRef = useRef<{ events: Array<{ tMs: number; kind: string; payload: any }>; t0: number } | null>(null)

  // ----- MODE DEMO -----
  const [demoLoaderOpen, setDemoLoaderOpen] = useState(false)
  const [demoActive, setDemoActive] = useState(false)
  const [demoEvents, setDemoEvents] = useState<Array<{ tMs: number; kind: string; payload: any }>>([])
  const [demoRunning, setDemoRunning] = useState(false)
  // Lance l’injection GPS quand autoScroll devient actif pour la premiere fois en mode demo
  const demoStartedRef = useRef(false)
  const demoActiveRef = useRef(false)  // ref synchrone pour bloquer startGpsWatch en mode demo
  const demoT0MsRef = useRef<number | null>(null)       // timestamp epoch du 1er event du log
  const demoWallStartMsRef = useRef<number | null>(null) // instant mur au demarrage de la demo
  const origDateRef = useRef<typeof Date | null>(null)   // Date original avant patch global
  const settingsDetailsRef = useRef<HTMLDetailsElement | null>(null)

  // Demo : demarrer l’injection GPS quand l’autoscroll devient actif (sortie du stand-by initial)
  useEffect(() => {
    if (!demoActive || demoStartedRef.current) return
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      if (!!ce.detail?.enabled && !ce.detail?.standby) {
        if (demoStartedRef.current) return  // deja demarre → ignorer les sorties de stand-by suivantes
        demoStartedRef.current = true

        // 1. Enregistrer l’heure reelle AVANT tout patch
        const wallNow = window.Date.now()
        demoWallStartMsRef.current = wallNow
        const t0 = demoT0MsRef.current ?? wallNow

        // Offset = difference d’heure dans la journee uniquement (pas de decalage de date).
        // Le log peut dater d’un autre jour, mais la demo reste aujourd’hui.
        // Ex: log 16h23, demo demarre 18h20 → offset = -1h57 (meme date conservee).
        const t0D = new window.Date(t0)
        const wallD = new window.Date(wallNow)
        const t0TodMs = (t0D.getHours() * 3600 + t0D.getMinutes() * 60 + t0D.getSeconds()) * 1000 + t0D.getMilliseconds()
        const wallTodMs = (wallD.getHours() * 3600 + wallD.getMinutes() * 60 + wallD.getSeconds()) * 1000 + wallD.getMilliseconds()
        let offsetMs = t0TodMs - wallTodMs
        // Gerer le passage a minuit (fenetre ±12h)
        if (offsetMs > 12 * 3600000) offsetMs -= 24 * 3600000
        if (offsetMs < -12 * 3600000) offsetMs += 24 * 3600000

        // 2. Sauvegarder le Date original
        const origDate = window.Date
        origDateRef.current = origDate

        // 3. Remplacer window.Date par un Proxy qui ajoute l’offset a tous les appels d’heure
        window.Date = new Proxy(origDate, {
          construct(target, args) {
            // new Date() sans argument → heure virtuelle
            if (args.length === 0) return Reflect.construct(target, [origDate.now() + offsetMs])
            return Reflect.construct(target, args)
          },
          get(target, prop, receiver) {
            // Date.now() → heure virtuelle
            if (prop === 'now') return () => origDate.now() + offsetMs
            const val = Reflect.get(target, prop, receiver)
            return typeof val === 'function' ? val.bind(target) : val
          },
        }) as unknown as typeof Date

        // 4. __limgptDemo.nowIso() tire maintenant de new Date() (deja virtuel)
        ;(window as any).__limgptDemo = { nowIso: () => new Date().toISOString() }

        setDemoRunning(true)
      }
    }
    window.addEventListener('ft:auto-scroll-change', handler as EventListener)
    return () => window.removeEventListener('ft:auto-scroll-change', handler as EventListener)
  }, [demoActive])

  // Listener externe : ouvrir le manuel sur une page précise depuis l’app
  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<{ page?: number; tocId?: string; source?: string }>
      const p = typeof ce.detail?.page === 'number' && Number.isFinite(ce.detail.page) ? Math.trunc(ce.detail.page) : 5
      const t = typeof ce.detail?.tocId === 'string' && ce.detail.tocId.trim().length > 0 ? ce.detail.tocId : 'prerequis-ipad'
      setManualInitialPage(p)
      setManualInitialTocId(t)
      setManualOpen(true)
      if (settingsDetailsRef.current?.hasAttribute('open')) settingsDetailsRef.current.removeAttribute('open')
      logTestEvent('ui:manual:open-page', { source: ce.detail?.source ?? 'external_event', page: p, tocId: t })
    }
    window.addEventListener('lim:manual-open-page', handler as EventListener)
    return () => window.removeEventListener('lim:manual-open-page', handler as EventListener)
  }, [])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = settingsDetailsRef.current
      if (!el) return

      const isOpen = el.hasAttribute('open')
      if (!isOpen) return

      const target = e.target as Node | null
      if (!target) return

      if (!el.contains(target)) {
        el.removeAttribute('open')
      }
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any)
    }
  }, [])

  const CHANGELOG_TEXT = `🆕 Changelog

- Modes de démarrage : mixte, manuel, PDF historique.
- LTV depuis ADIF (alternative au PDF).
- Recadrage LTV en mode mixte (bouton "Utiliser le PDF").
- Flèches sources LTV aux extrémités de la barre de légende.
- Bouton Play : entrée automatique en stand-by sur la première ligne au premier clic.
- Bouton Play verrouillé une fois le parcours lancé (indicateur d’état visible).
- Correction clignotement du numéro de train en mode plié.
- Correction stand-by : la sortie revenait à la première station au lieu de la ligne sélectionnée.
- Correction delta horaire au premier Play et à la sortie manuelle du stand-by.
- Correction GPS : protection contre l’écrasement de la ligne active lors d’un recalage manuel.
- Correction "ressort" : la fiche train ne revient plus à sa position initiale pendant le stand-by.
- Correction scroll : la fiche train reste bien sur la ligne de recalage après sortie du stand-by.
- Remarques LTV en sens sud-nord : les PK s’affichent dans le sens de circulation.
- Mode plié : affichage du nombre de LTV normalisées.
- Bouton "Forcer la mise à jour" (ex "Vider le cache").
- Corrections de bugs divers.
`

  useEffect(() => {
    const handler = () => {
      setAboutOpen(true)
      if (settingsDetailsRef.current?.hasAttribute('open')) {
        settingsDetailsRef.current.removeAttribute('open')
      }
    }

    window.addEventListener('lim:about-open', handler as EventListener)
    return () => {
      window.removeEventListener('lim:about-open', handler as EventListener)
    }
  }, [])

  // ----- MISE À JOUR PWA (Service Worker) -----
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null)

  // Attend qu'un service worker en cours d'installation atteigne un état terminal
  // ('installed' = waiting, 'activated' ou 'redundant'). Garde-fou 4 s pour ne jamais
  // bloquer si aucune nouvelle version ne s'installe.
  const waitForSwInstalled = (nw: ServiceWorker) => new Promise<void>((resolve) => {
    const isDone = () => nw.state === 'installed' || nw.state === 'activated' || nw.state === 'redundant'
    if (isDone()) { resolve(); return }
    const to = window.setTimeout(() => { nw.removeEventListener('statechange', on); resolve() }, 4000)
    const on = () => {
      if (isDone()) {
        window.clearTimeout(to)
        nw.removeEventListener('statechange', on)
        resolve()
      }
    }
    nw.addEventListener('statechange', on)
  })

  const applySwUpdate = async () => {
    try {
      if (!('serviceWorker' in navigator)) return

      const reg = swRegRef.current ?? (await navigator.serviceWorker.getRegistration())
      if (!reg?.waiting) {
        console.log('[TitleBar][SW] no waiting worker')
        return
      }

      const onCtrl = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onCtrl)
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', onCtrl)

      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      console.log('[TitleBar][SW] SKIP_WAITING sent')
    } catch (err) {
      console.warn('[TitleBar][SW] apply update failed', err)
    }
  }

    const forceAppRefresh = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()

        if (reg) {
          await reg.update()

          // Laisser le nouveau SW finir de s'installer AVANT de tester reg.waiting :
          // juste après update() il est encore 'installing' (reg.waiting = null), d'où
          // l'ancien bug qui obligeait à appuyer plusieurs fois pour activer la maj.
          if (reg.installing) await waitForSwInstalled(reg.installing)

          if (reg.waiting) {
            await applySwUpdate()
            return
          }
        }
      }
    } catch (err) {
      console.warn('[TitleBar][SW] force refresh failed', err)
    }

    const url = new URL(window.location.href)
    url.searchParams.set('limRefresh', String(Date.now()))
    window.location.replace(url.toString())
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    const markIfWaiting = (reg: ServiceWorkerRegistration | null, reason: string) => {
      if (!reg) return
      swRegRef.current = reg

      if (reg.waiting && navigator.serviceWorker.controller) {
        setSwUpdateAvailable(true)
        console.log('[TitleBar][SW] update available (waiting)', reason)
      }
    }

    const attachUpdateFound = (reg: ServiceWorkerRegistration) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return

        const onState = () => {
          if (cancelled) return
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            markIfWaiting(reg, 'updatefound:installed')
          }
        }

        nw.addEventListener('statechange', onState)
      })
    }

    const check = async (reason: string) => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (cancelled) return

        if (reg) {
          attachUpdateFound(reg)
          reg.update().catch(() => {})
          markIfWaiting(reg, reason)
        }
      } catch (err) {
        console.warn('[TitleBar][SW] check failed', err)
      }
    }

    check('boot')

    const t1 = window.setTimeout(() => check('boot+800ms'), 800)
    const t2 = window.setTimeout(() => check('boot+2500ms'), 2500)

    const onControllerChange = () => {
      setSwUpdateAvailable(false)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  useEffect(() => {
    if (testAutoStartedRef.current) return
    testAutoStartedRef.current = true

    if (!testModeEnabled) {
      setTestRecording(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Initialisation du moteur GPS→PK -----
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await initGpsPkEngine()
        if (!cancelled) {
          setGpsPkReady(true)
          console.log('[TitleBar] gpsPkEngine prêt')
        }
      } catch (err) {
        console.error('[TitleBar] Erreur init gpsPkEngine', err)
        if (!cancelled) setGpsPkReady(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime(new Date())), 1000)
    return () => clearInterval(t)
  }, [])

  // ----- HELPERS DOM -----
  const getMainEl = (): HTMLElement | null => {
    const explicit = document.querySelector('main') as HTMLElement | null
    if (explicit) return explicit
    const self = document.getElementById('lim-titlebar-root') as HTMLElement | null
    return self?.closest('main') as HTMLElement | null
  }
  const getRootEl = (): HTMLElement | null => {
    return (document.getElementById('root') ||
      document.getElementById('__next')) as HTMLElement | null
  }

  // ----- THEME Jour/Nuit -----
  const getInitialDark = () => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') return true
    if (stored === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  }
  const [dark, setDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const main = getMainEl()
    const applyTheme = (on: boolean) => {
      const m = on ? 'add' : 'remove'
      root.classList[m]('dark')
      body.classList[m]('dark')
      if (main) main.classList[m]('dark')
      root.setAttribute('data-theme', on ? 'dark' : 'light')
      body.setAttribute('data-theme', on ? 'dark' : 'light')
      if (main) main.setAttribute('data-theme', on ? 'dark' : 'light')
      try {
        localStorage.setItem('theme', on ? 'dark' : 'light')
      } catch {}
      window.dispatchEvent(new CustomEvent('lim:toggle-theme', { detail: { dark: on } }))
      window.dispatchEvent(new CustomEvent('lim:theme-change', { detail: { dark: on } }))
    }
    applyTheme(dark)
  }, [dark])

  // ----- LUMINOSITÉ -----
  const getInitialBrightness = () => {
    if (typeof window === 'undefined') return 1
    const raw = localStorage.getItem('brightness')
    if (!raw) return 1
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    const value = n > 3 ? Math.max(0.5, n / 100) : Math.max(0.5, n)
    return Math.min(1, value)
  }
  const [brightness, setBrightness] = useState<number>(getInitialBrightness)

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const root = getRootEl()
    const main = getMainEl()
    // NE PAS appliquer filter sur les éléments racine.
    // filter crée un stacking context qui piège les modales (position:fixed
    // z-[99999]) dans un sous-contexte — résultat : l’en-tête de la fiche
    // train (Infos, z=auto) s’affiche par-dessus les modales.
    // La luminosité est désormais gérée par l’overlay #lim-dim-overlay
    // (z=1, pointer-events:none) ajouté dans le JSX ci-dessous.
    ;[html, body, root, main].forEach((el) => {
      if (el) (el as HTMLElement).style.filter = ''
    })
    try {
      localStorage.setItem('brightness', String(brightness))
    } catch {}
    window.dispatchEvent(new CustomEvent('lim:brightness-change', { detail: { brightness } }))
    return () => {
      ;[html, body, root, main].forEach((el) => {
        if (el) (el as HTMLElement).style.filter = ''
      })
    }
  }, [brightness])

  const brightnessPct = useMemo(() => Math.round(brightness * 100), [brightness])

  // ----- IMPORT PDF -----
  const currentPdfFileRef = useRef<File | null>(null)
  // PDF LTV importé (mode 2026) — conservé pour être inclus dans le ZIP au STOP,
  // au même titre que le PDF fiche train. Remis à null aux mêmes points de reset.
  const currentLtvPdfFileRef = useRef<File | null>(null)
  const currentPdfIdRef = useRef<string | null>(null)
  const currentPdfReplayKeyRef = useRef<string | null>(null)

  const launchStartupMode = (mode: StartupMode, source: string) => {
    startupLaunchModeRef.current = mode

    logTestEvent('ui:startup-mode:launch', {
      source,
      mode,
      train: trainDisplay ?? null,
      pdfMode,
    })

    if (mode === '2026') {
      setMode2026Open(true)
      return
    }

    if (mode === 'ltv') {
      setMode2026LtvOnly(true)
      setMode2026Open(true)
      return
    }
  }

  const handleStartClick = () => {
    // Démo armée : le bouton Démarrer ouvre la modale Mode 2026 guidée.
    if (demoArmed) {
      setMode2026Open(true)
      return
    }

    if (simulationEnabled) {
      logTestEvent('ui:blocked', { control: 'startButton', source: 'titlebar' })
      return
    }

    const storedMode = readStoredStartupMode()

    if (storedMode) {
      launchStartupMode(storedMode, 'start_button_stored_mode')
      return
    }

    setStartupModeChoice('2026')
    setStartupModeChoiceIntent('start')
    setStartupModeChoiceOpen(true)

    logTestEvent('ui:startup-mode-choice:open', {
      source: 'start_button',
      reason: 'no_stored_mode',
    })
  }

  const validateStartupModeChoice = () => {
    const selectedMode = startupModeChoice
    const intent = startupModeChoiceIntent

    try {
      localStorage.setItem(STARTUP_MODE_STORAGE_KEY, selectedMode)
    } catch {
      // non bloquant : si le stockage local échoue, on continue quand même
    }

    setStartupModeChoiceOpen(false)

    logTestEvent('settings:startup-mode:set', {
      source: intent === 'settings' ? 'settings' : 'startup_mode_choice',
      mode: selectedMode,
      intent,
    })

    if (intent === 'start') {
      launchStartupMode(selectedMode, 'startup_mode_choice')
    }
  }

    const dispatchLtvRowsForSource = async (params: {
    ltvSource: Exclude<LtvRuntimeSource, 'pdf'>
    trainNumber: string
    journeySource: string
    activeMode: StartupMode
    reason: string
  }) => {
    const routePkRange = await waitForFtRoutePkRange(params.trainNumber)

    const result =
      params.ltvSource === 'adif'
        ? await fetchManualLtvRows(routePkRange)
        : params.ltvSource === 'pdf-ltv'
        ? loadPdfLtvRows(ltvPdfDataRef.current ?? {}, routePkRange)
        : loadNormalizedLtvRows(routePkRange)

    const ltvMeta = {
      ...result.meta,
      source: params.ltvSource,
    }

    const availableSources = getAvailableLtvSourcesForMode(params.activeMode)

    currentLtvSourceRef.current = params.ltvSource

    console.log('[TitleBar] LTV source chargée', {
      trainNumber: params.trainNumber,
      rowsCount: result.rows.length,
      firstRow: result.rows[0] ?? null,
      meta: ltvMeta,
      journeySource: params.journeySource,
      ltvSource: params.ltvSource,
      availableSources,
      reason: params.reason,
    })

    window.dispatchEvent(
      new CustomEvent('ltv:parsed', {
        detail: {
          mode: result.rows.length > 0 ? 'DISPLAY_DIRECT' : 'NO_LTV',
          rows: result.rows,
          source: params.journeySource,
          ltvSource: params.ltvSource,
          availableSources,
          trainNumber: params.trainNumber,
          meta: ltvMeta,
          fetchedAt: ltvMeta.fetchedAt,
          sourceUpdatedAt: ltvMeta.sourceUpdatedAt,
          displayedCount: ltvMeta.displayedCount,
        },
      })
    )

    setLtvCountForTitle(result.rows.length)
    setLtvIsNormalized(params.ltvSource === 'normalized')

    logTestEvent('ltv:source:loaded', {
      source: 'titlebar',
      mode: params.journeySource,
      activeMode: params.activeMode,
      ltvSource: params.ltvSource,
      trainNumber: params.trainNumber,
      rowsCount: result.rows.length,
      fetchedAt: ltvMeta.fetchedAt ?? null,
      sourceUpdatedAt: ltvMeta.sourceUpdatedAt ?? null,
      displayedCount: ltvMeta.displayedCount,
      total: ltvMeta.total ?? null,
      reason: params.reason,
    })
  }

  const startNormalizedJourneyFromTrain = (
    train: ManualTrainOption,
    options: {
      source: 'manual_import' | 'mixed_import' | 'mixed_import_manual_fallback' | 'mode2026_import'
      activeMode: StartupMode
      keepPdf: boolean
      closeManualImport: boolean
    }
  ) => {
    const trainNumber = train.trainNumber
    const parsedFields = {
      ...buildManualParsedFields(train),
      source: options.source,
    }

    stopPdfLoadingGuard()
    setPdfLoading(false)

    if (!options.keepPdf) {
      currentPdfFileRef.current = null
      currentLtvPdfFileRef.current = null
      currentPdfIdRef.current = null
      currentPdfReplayKeyRef.current = null
    }

    if (!testRecording) {
      const labelParts: string[] = []
      labelParts.push('silent')
      labelParts.push(options.source)
      labelParts.push(trainNumber)

      const label = labelParts.join('_')

      wasReplaySessionRef.current = false // nouveau vrai trajet → réinitialiser
      startTestSession(label)
      setTestRecording(true)

      logTestEvent('testlog:silent-start', {
        source: options.source,
        label,
        trainNumber,
        numeroFrance: train.numeroFrance ?? null,
        relation: train.relation ?? null,
        ligne: train.ligne ?? null,
        testModeEnabled,
      })
    }

    startupLaunchModeRef.current = options.activeMode
    setActiveStartupMode(options.activeMode)

    setFtViewMode('ES')
    setAutoEngaged(false)
    setPdfMode('green')

    if (!simulationEnabled) {
      startGpsWatch()
    }

    ;(window as any).__limLastParsed = parsedFields

    logTestEvent('ui:manual-import:train-selected', {
      source: 'titlebar',
      mode: options.source,
      trainNumber,
      numeroFrance: train.numeroFrance ?? null,
      relation: train.relation ?? null,
      ligne: train.ligne ?? null,
    })

    window.dispatchEvent(
      new CustomEvent('lim:manual-train-selected', {
        detail: {
          source: options.source,
          trainNumber,
          train,
        },
      })
    )

    window.dispatchEvent(
      new CustomEvent('lim:parsed', {
        detail: parsedFields,
      })
    )

    const n = parseInt(trainNumber, 10)
    if (Number.isFinite(n)) {
      window.dispatchEvent(
        new CustomEvent('lim:train-change', {
          detail: {
            trainNumber: n,
            source: options.source,
          },
        })
      )

      window.dispatchEvent(
        new CustomEvent('lim:train', {
          detail: {
            train: trainNumber,
            source: options.source,
          },
        })
      )
    }

    void dispatchLtvRowsForSource({
      ltvSource: options.activeMode === '2026' ? 'pdf-ltv' : 'normalized',
      trainNumber,
      journeySource: options.source,
      activeMode: options.activeMode,
      reason: 'journey_start_default_source',
    }).catch((error) => {
      console.warn('[TitleBar] Import LTV normalisées impossible', error)

      logTestEvent('ltv:manual-import:failed', {
        source: 'titlebar',
        mode: options.source,
        trainNumber,
        error: error instanceof Error ? error.message : String(error),
      })

      window.dispatchEvent(
        new CustomEvent('ltv:parsed', {
          detail: {
            mode: 'NO_LTV',
            rows: [],
            source: options.source,
            ltvSource: 'normalized',
            availableSources: getAvailableLtvSourcesForMode(options.activeMode),
            trainNumber,
            meta: {
              source: 'normalized',
              displayedCount: 0,
            },
            displayedCount: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      )
    })
  }

  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail

      logTestEvent('ui:lim:parsed', {
        train: (detail as any)?.trenPadded ?? (detail as any)?.tren ?? null,
        type: (detail as any)?.type ?? null,
        composicion: (detail as any)?.composicion ?? (detail as any)?.unit ?? null,
        source: 'titlebar:onParsed',
      })

      stopPdfLoadingGuard()
      setPdfLoading(false)

      const raw = detail.trenPadded ?? detail.tren
      const disp = toTitleNumber(raw)
      setTrainDisplay(disp)

      if (disp) {
        const n = parseInt(disp, 10)
        if (Number.isFinite(n)) {
          window.dispatchEvent(new CustomEvent('lim:train-change', { detail: { trainNumber: n } }))
        }
      }

      const parsedTrainNumber = toTitleNumber(detail.trenPadded ?? detail.tren)

      const normalizedTypeEs = parsedTrainNumber
        ? getTrainCategorieEspagne(parsedTrainNumber)
        : undefined
      const normalizedTypeFr = parsedTrainNumber
        ? getTrainCategorieFrance(parsedTrainNumber)
        : undefined

      const normalizedDisplayedType =
        displayedTrainNumberStateRef.current.displayedSide === 'FR'
          ? normalizedTypeFr ?? normalizedTypeEs
          : normalizedTypeEs ?? normalizedTypeFr

      if (normalizedDisplayedType) {
        setTrainType(normalizedDisplayedType)
      } else {
        const rawType = (detail as any).type
        setTrainType(rawType ? String(rawType) : undefined)
      }

      const parsedFallbackComposition = (() => {
        const rawComp = (detail as any).composicion ?? (detail as any).unit
        return rawComp ? String(rawComp).trim().toUpperCase() : undefined
      })()

      // Composition : plus lue du normalisé (décision 07/08). Défaut US, bascule manuelle UM.
      const baseComposition = parsedFallbackComposition ?? 'US'

      applyDisplayedCompositionState(
        {
          normalizedComposition: baseComposition,
          displayedComposition: baseComposition,
          manualOverrideActive: false,
        },
        {
          source: 'titlebar',
          reason: 'parsed_reset_to_base_composition',
        }
      )

      ;(async () => {
        try {
          setAutoEngaged(false)

          setAutoResolved({
            available: false,
            side: null,
            s_km: null,
            pk: null,
            ts: Date.now(),
            reason: null,
          })

          if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            setAutoResolved((prev) => ({
              ...prev,
              available: false,
              side: null,
              reason: 'no_geolocation',
              ts: Date.now(),
            }))
            logTestEvent('ui:auto:precal:failed', { reason: 'no_geolocation', source: 'onParsed' })
            return
          }

          if (!gpsPkReady) {
            try {
              await initGpsPkEngine()
              setGpsPkReady(true)
            } catch {
              setAutoResolved((prev) => ({
                ...prev,
                available: false,
                side: null,
                reason: 'engine_not_ready',
                ts: Date.now(),
              }))
              logTestEvent('ui:auto:precal:failed', { reason: 'engine_not_ready', source: 'onParsed' })
              return
            }
          }

          const getPos = () =>
            new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                maximumAge: 10_000,
                timeout: 6_000,
              })
            })

          const pos = await getPos()
          const lat = pos.coords.latitude
          const lon = pos.coords.longitude
          const accuracy = pos.coords.accuracy

          const proj = projectGpsToPk(lat, lon)
          if (!proj) {
            setAutoResolved({
              available: false,
              side: null,
              s_km: null,
              pk: null,
              ts: Date.now(),
              reason: 'proj_null',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'proj_null',
              source: 'onParsed',
              lat,
              lon,
              accuracy,
            })
            return
          }

          const s_km =
            typeof proj.s_km === 'number' && Number.isFinite(proj.s_km) ? proj.s_km : null
          const pk = typeof proj.pk === 'number' && Number.isFinite(proj.pk) ? proj.pk : null

          const side = resolveSideFromSkm(s_km)

          if (side == null) {
            setAutoResolved({
              available: false,
              side: null,
              s_km,
              pk,
              ts: Date.now(),
              reason: 'no_s_km',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'no_s_km',
              source: 'onParsed',
              s_km,
              pk,
              lat,
              lon,
              accuracy,
            })
            return
          }

          setAutoResolved({
            available: true,
            side,
            s_km,
            pk,
            ts: Date.now(),
            reason: 'ok',
          })

          logTestEvent('ui:auto:precal:ok', {
            source: 'onParsed',
            side,
            s_km,
            pk,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
          })
        } catch (err: any) {
          const code = err?.code
          const isTimeout = code === 3
          const isDenied = code === 1

          const reason = isDenied ? 'permission_denied' : isTimeout ? 'timeout' : 'error'

          setAutoResolved((prev) => ({
            ...prev,
            available: false,
            side: null,
            reason,
            ts: Date.now(),
          }))

          logTestEvent('ui:auto:precal:failed', {
            reason,
            source: 'onParsed',
            code: typeof code === 'number' ? code : null,
            message: err?.message ?? String(err),
          })
        }
      })()
    }

    const onTrain = (e: Event) => {
      const ce = e as CustomEvent
      const val = (ce.detail as any)?.train as string | undefined
      const disp = toTitleNumber(val)
      if (disp) setTrainDisplay(disp)
    }

    window.addEventListener('lim:parsed', onParsed as EventListener)
    window.addEventListener('lim:train', onTrain as EventListener)
    return () => {
      window.removeEventListener('lim:parsed', onParsed as EventListener)
      window.removeEventListener('lim:train', onTrain as EventListener)
    }
  }, [gpsPkReady])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent

      console.log(
        "[TitleBar] lim:schedule-delta detail =",
        ce?.detail,
        "\n[TitleBar] origin stack =\n",
        new Error().stack
      )

      const rawText = ce?.detail?.text as string | null | undefined
      const isLarge = !!ce?.detail?.isLargeDelay

      const deltaSecRaw = ce?.detail?.deltaSec
      const deltaSec =
        typeof deltaSecRaw === 'number' && Number.isFinite(deltaSecRaw)
          ? Math.trunc(deltaSecRaw)
          : null

      const text = rawText && rawText.trim().length > 0 ? rawText.trim() : null

      if (text) {
        setScheduleDelta(text)
        setScheduleDeltaIsLarge(isLarge)

        if (deltaSec !== null) {
          setScheduleDeltaSec(deltaSec)
        }
      } else {
        setScheduleDelta(null)
        setScheduleDeltaIsLarge(false)
        setScheduleDeltaSec(null)
      }
    }

    window.addEventListener('lim:schedule-delta', handler as EventListener)
    return () => {
      window.removeEventListener('lim:schedule-delta', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const enabled = !!ce?.detail?.enabled
      const standby = !!ce?.detail?.standby

setHourlyMode(enabled || standby)
setStandbyMode(standby)
if (standby) setStandbyOrigine((ce?.detail?.origine === 'manuel') ? 'manuel' : 'auto')

setAutoScroll(enabled)

if (enabled || standby) {
  setAutoScrollStartedOnce(true)
}
    }

    window.addEventListener('lim:hourly-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:hourly-mode', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce?.detail?.mode as 'HORAIRE' | 'GPS' | undefined
      if (mode === 'HORAIRE' || mode === 'GPS') setReferenceMode(mode)
    }

    window.addEventListener('lim:reference-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:reference-mode', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    let redSeq = 0

    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const state = ce?.detail?.state as 'RED' | 'ORANGE' | 'GREEN' | undefined
      const pk = ce?.detail?.pk as number | null | undefined
      const pkRaw = ce?.detail?.pkRaw as number | null | undefined
      const reasonCodes = ce?.detail?.reasonCodes as any

      if (testModeEnabled && state === 'RED') {
        redSeq++
        if (redSeq % 10 === 1) {
          logTestEvent('ui:gps-state:red', {
            seq: redSeq,
            state,
            reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : null,
            pk: typeof pk === 'number' && Number.isFinite(pk) ? pk : null,
            pkRaw: typeof pkRaw === 'number' && Number.isFinite(pkRaw) ? pkRaw : null,
            tLocal: Date.now(),
          })
        }
      }

      if (state === 'ARRET') {
        // Mode ARRÊT GPS : icône sous-jacente verte (le badge arrêt est piloté
        // par l'événement lim:station-arret, et affiché en BLEU).
        setGpsState(2)
        return
      }

      if (state === 'RED') {
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      if (state === 'ORANGE') {
        setGpsState(1)
        if (typeof pkRaw === 'number' && Number.isFinite(pkRaw)) {
          setGpsPkDisplay(pkRaw.toFixed(1))
        }
        return
      }

      if (state === 'GREEN') {
        setGpsState(2)
        // ⚠️ Ne PAS forcer stationArretActive=false ici : sous bon GPS un arrêt
        // reste GREEN (#20). Le badge arrêt est piloté uniquement par lim:station-arret.

// ✅ Au retour réel en GPS, on réaligne l’état visuel du bouton Play
// uniquement si l’autoscroll a déjà été engagé.
// Le GPS passif au chargement du parcours ne doit pas activer visuellement Play.
if (autoScrollRef.current || autoScrollStartedOnceRef.current) {
  setAutoScrollStartedOnce(true)
}

        if (typeof pk === 'number' && Number.isFinite(pk)) {
          setGpsPkDisplay(pk.toFixed(1))
        } else {
          setGpsPkDisplay(null)
        }
      }
    }

    window.addEventListener('lim:gps-state', handler as EventListener)
    return () => {
      window.removeEventListener('lim:gps-state', handler as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testModeEnabled])

  // ── Sortie de stand-by par le bouton Play (19/08) ─────────────────────────
  // Le bouton n'est cliquable QUE dans cette situation, et son clic ne fait que
  // sortir du stand-by. En mode GPS on n'ouvre rien : le depart s'y detecte tout
  // seul au bout de 75 m, il n'y aurait rien a confirmer.
  const sortieStandbyPossible = standbyMode && referenceMode === 'HORAIRE'
  // Le libelle dit la VERITE sur la consequence : en gare la sortie fixe l'heure
  // de depart et recale le delta ; hors gare (arret au signal) le moteur
  // journalise `gps:arret:departure-no-recal` et ne recale rien.
  // DEUX libelles, pas trois. Le critere est la nature de l'ENTREE en stand-by :
  //  - MANUELLE (le conducteur a choisi une ligne) : il n'y a pas de depart a
  //    confirmer, on recale une position ;
  //  - AUTOMATIQUE (stand-by initial, ou arret detecte en gare) : la sortie fixe
  //    l'heure de depart reelle, qui devient la base du delta.
  //
  // ⚠️ 19/08 — Une 3e branche « Reprendre » avait ete ecrite pour l'arret detecte
  // HORS gare (`kind === 'pleine-ligne'`). Elle est INATTEIGNABLE et a ete retiree :
  // ce cas n'existe qu'en mode GPS, et surtout le bloc qui le detecte
  // (`FT.tsx` ~5385) arme le badge ARRET **sans emettre aucun evenement de
  // stand-by** — `standbyMode` reste donc faux et le bouton ne s'affiche pas.
  // Ne pas la reintroduire sans avoir verifie que ce bloc entre en stand-by.
  const libelleSortieStandby =
    standbyOrigine === 'manuel' ? 'Recaler' : 'Confirmer le départ'

  // ✅ Indicateur ARRÊT en gare (mode GPS ou standby horaire)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const active = !!ce?.detail?.active
      setStationArretActive(active)
      setStationArretKind(active ? (ce?.detail?.kind ?? null) : null)
    }
    window.addEventListener('lim:station-arret', handler as EventListener)
    return () => window.removeEventListener('lim:station-arret', handler as EventListener)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const d = (ce?.detail || {}) as any

      const nearestIdx =
        typeof d?.nearestIdx === 'number' && Number.isFinite(d.nearestIdx)
          ? Math.trunc(d.nearestIdx)
          : null

      const s_km =
        typeof d?.s_km === 'number' && Number.isFinite(d.s_km) ? Number(d.s_km) : null

      const onLine = typeof d?.onLine === 'boolean' ? d.onLine : null

      const ts =
        typeof d?.timestamp === 'number' && Number.isFinite(d.timestamp)
          ? Math.trunc(d.timestamp)
          : Date.now()

      const previousFix = lastGpsFixRef.current
      lastGpsFixRef.current = { ts, nearestIdx, s_km, onLine }

      const expectedDirNow = expectedDirRef.current

      if (typeof s_km === 'number' && Number.isFinite(s_km)) {
        if (s_km < 150 && s_km > 120) {
          console.log('[Numbering][GPS][DIAG]', {
            expectedDir: expectedDirNow,
            onLine,
            s_km,
            nearestIdx,
            numberingAnchorTriggered: numberingAnchorTriggeredRef.current,
          })
        }
      }

      if (
        onLine === true &&
        typeof s_km === 'number' &&
        Number.isFinite(s_km) &&
        expectedDirNow &&
        !numberingAnchorTriggeredRef.current
      ) {
        const currentNumbering = displayedTrainNumberStateRef.current
        const hasNumeroFrance =
          typeof currentNumbering.trainNumberFr === 'string' &&
          currentNumbering.trainNumberFr.trim() !== ''

        const hasNoPendingSide = currentNumbering.pendingSide == null

        if (hasNumeroFrance && hasNoPendingSide) {
          const anchor =
            expectedDirNow === 'DOWN'
              ? NUMBERING_SWITCH_ANCHORS.DOWN
              : NUMBERING_SWITCH_ANCHORS.UP

          const triggerReached =
            expectedDirNow === 'DOWN'
              ? s_km <= anchor.triggerSkm
              : s_km >= anchor.triggerSkm

          if (
            triggerReached &&
            currentNumbering.displayedSide !== anchor.targetSide
          ) {
            numberingAnchorTriggeredRef.current = true

            armDisplayedTrainNumberPendingSide(anchor.targetSide, {
              trainNumberEs: currentNumbering.trainNumberEs,
              trainNumberFr: currentNumbering.trainNumberFr,
              source: 'gps_anchor',
              reason: `anchor_${anchor.label}_arm_pending_${anchor.targetSide}`,
            })
          }
        }
      }

      const now = ts
      if (nearestIdx != null && onLine === true) {
        const prevIdx = figueresStableIdxRef.current

        if (prevIdx == null) {
          figueresStableIdxRef.current = nearestIdx
          figueresStableSinceRef.current = now
        } else {
          const tol = FIGUERES_ZONE.stableIdxTolerance
          const dIdx = Math.abs(nearestIdx - prevIdx)

          if (dIdx <= tol) {
            // stable
          } else {
            figueresStableIdxRef.current = nearestIdx
            figueresStableSinceRef.current = now
          }
        }
      } else {
        figueresStableIdxRef.current = null
        figueresStableSinceRef.current = null
      }
    }

    window.addEventListener('gps:position', handler as EventListener)
    return () => window.removeEventListener('gps:position', handler as EventListener)
  }, [])

  // ----- GPS : démarrage / arrêt du watchPosition -----
  useEffect(() => {
    return () => {
      stopGpsWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startGpsWatch() {
    if (demoActiveRef.current) return  // mode demo : GPS reel jamais demarre
    if (gpsWatchIdRef.current != null) return
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[TitleBar] Geolocation non disponible')
      logTestEvent('gps:watch:start:failed', { reason: 'no_geolocation' })
      return
    }

    console.log('[TitleBar] Démarrage watchPosition GPS...')
    logTestEvent('gps:watch:start', {})

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords

        gpsLastInfoRef.current = { lat: latitude, lon: longitude, accuracy }

        if (!gpsPkReady) {
          logTestEvent('gps:position:noPkEngine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const proj = projectGpsToPk(latitude, longitude)
        if (!proj) {
          console.log(
            `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → hors ruban (proj=null)`
          )
          logTestEvent('gps:position:offLine', { lat: latitude, lon: longitude, accuracy })
          return
        }

        const { pk, s_km, distance_m, nearestIdx, nearestLat, nearestLon, pkCandidate, pkDecision } =
          proj
        const dist = distance_m ?? null
        const onLine = dist != null && dist <= 200

        gpsLastInfoRef.current = {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          dist_m: dist,
        }

        logTestEvent('gps:position', {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          distance_m: dist,
          onLine,
          nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
          nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
          nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
          pkCandidate:
            typeof pkCandidate === 'number' && Number.isFinite(pkCandidate) ? pkCandidate : null,
          pkDecision: pkDecision ?? null,
        })

        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat: latitude,
              lon: longitude,
              accuracy,
              pk: pk ?? null,
              s_km: s_km ?? null,
              distance_m: dist,
              onLine,
              timestamp: Date.now(),
              nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
              nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
              nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
              pkCandidate:
                typeof pkCandidate === 'number' && Number.isFinite(pkCandidate)
                  ? pkCandidate
                  : null,
              pkDecision: pkDecision ?? null,
            },
          })
        )

        console.log(
          `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → PK≈${pk?.toFixed?.(
            3
          )}  s≈${s_km?.toFixed?.(3)} km  dist=${dist?.toFixed?.(1)} m  onLine=${onLine}`
        )
      },
      (err) => {
        console.error('[TitleBar] Erreur GPS', err)
        logTestEvent('gps:watch:error', {
          code: (err as any)?.code ?? null,
          message: (err as any)?.message ?? String(err),
        })
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    gpsWatchIdRef.current = id
  }

  function stopGpsWatch() {
    const id = gpsWatchIdRef.current
    if (id != null) logTestEvent('gps:watch:stop', {})

    if (id != null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(id)
    }
    gpsWatchIdRef.current = null
    gpsLastInfoRef.current = null
    console.log('[TitleBar] Arrêt watchPosition GPS')
  }

  const resetCurrentJourney = async (source: string) => {
    if (simulationEnabled) {
      logTestEvent('ui:blocked', {
        control: 'resetJourney',
        source,
      })
      return
    }

    const ok = window.confirm(
      'Réinitialiser le parcours ?\n\n' +
        'L’application reviendra à l’écran initial.\n' +
        'Le parcours chargé sera déchargé.\n\n' +
        'Le mode de démarrage enregistré ne sera pas modifié.'
    )

    if (!ok) return

    if (settingsDetailsRef.current?.hasAttribute('open')) {
      settingsDetailsRef.current.removeAttribute('open')
    }

    setAutoScroll(false)
    setAutoScrollStartedOnce(false)

    if (autoScroll) {
      window.dispatchEvent(
        new CustomEvent('ft:auto-scroll-change', {
          detail: { enabled: false, source: 'reset_journey' },
        })
      )
    }

    stopGpsWatch()
    setGpsState(0)
    setGpsPkDisplay(null)
    setGpsPkPeekVisible(false)

    setLtvCountForTitle(null)
    setLtvIsNormalized(false)

    setScheduleDelta(null)
    setScheduleDeltaIsLarge(false)
    setScheduleDeltaSec(null)

    if (testRecording) {
      logTestEvent('ui:journey:reset', {
        source,
        activeStartupMode,
        train: trainDisplay ?? null,
      })

      stopTestSession()
      setTestRecording(false)

      const wantExport = window.confirm(
        'Exporter les logs de la session qui vient d’être arrêtée ?\n\n' +
          'Choisissez OK pour exporter les logs, ou Annuler pour réinitialiser sans export.'
      )

      if (wantExport) {
        try {
          const exported = await exportCurrentTestBundleLocal()

          if (!exported) {
            window.alert('Aucun élément de test à exporter.')
          }
        } catch {
          window.alert('Export local du paquet de test impossible.')
        }
      }
    } else {
      logTestEvent('ui:journey:reset', {
        source,
        activeStartupMode,
        train: trainDisplay ?? null,
        testRecording: false,
      })
    }

    setPdfMode('blue')
    setPdfLoading(false)
    stopPdfLoadingGuard()

    startupLaunchModeRef.current = null
    setActiveStartupMode(null)

    setFtViewMode('ES')
    setAutoEngaged(false)

    setTrainDisplay(undefined)
    setTrainType(undefined)
    setTrainComposition(undefined)

    currentPdfFileRef.current = null
    currentLtvPdfFileRef.current = null
    currentPdfIdRef.current = null
    currentPdfReplayKeyRef.current = null

    window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
    window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
    window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))
  }

  const titleBarCommittedTrainNumber =
    displayedTrainNumberState.displayedSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        trainDisplay
      : displayedTrainNumberState.trainNumberEs ??
        displayedTrainNumberState.trainNumberFr ??
        trainDisplay

  const titleBarPendingTrainNumber =
    displayedTrainNumberState.pendingSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        null
      : displayedTrainNumberState.pendingSide === 'ES'
        ? displayedTrainNumberState.trainNumberEs ??
          displayedTrainNumberState.trainNumberFr ??
          null
        : null

  const titleBarTrainShouldBlink = Boolean(displayedTrainNumberState.isBlinking)
  const [titleBarBlinkVisible, setTitleBarBlinkVisible] = useState(true)

  useEffect(() => {
    if (!titleBarTrainShouldBlink) {
      setTitleBarBlinkVisible(true)
      return
    }

    setTitleBarBlinkVisible(true)

    const intervalId = window.setInterval(() => {
      setTitleBarBlinkVisible((prev) => !prev)
    }, 500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [titleBarTrainShouldBlink])

  const titleSuffix = titleBarCommittedTrainNumber ?? ''

  const titlePendingSuffix =
    titleBarTrainShouldBlink && titleBarPendingTrainNumber
      ? `→ ${titleBarPendingTrainNumber}`
      : ''

  const baseTitle = `LIM${titleSuffix ? ` ${titleSuffix}` : ''}${titlePendingSuffix ? ` ${titlePendingSuffix}` : ''}`

  const extendedParts: string[] = []
  if (trainType && String(trainType).trim().length > 0) extendedParts.push(String(trainType).trim())
  if (trainComposition && String(trainComposition).trim().length > 0)
    extendedParts.push(String(trainComposition).trim())
  if (ltvIsNormalized && ltvCountForTitle !== null && ltvCountForTitle > 0)
    extendedParts.push(`${ltvCountForTitle} LTV`)

  const fullTitle =
    folded && extendedParts.length > 0 ? `${baseTitle} - ${extendedParts.join(' - ')}` : baseTitle

const runTitleBarSingleClickAction = () => {
  const currentNumbering = displayedTrainNumberStateRef.current

  if (currentNumbering.pendingSide) {
    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-commit-request', {
        detail: {
          pendingSide: currentNumbering.pendingSide,
          source: 'titlebar',
        },
      })
    )
    return
  }

  if (ftViewMode === 'FR') {
    logTestEvent('ui:blocked', {
      control: 'infosLtvFold',
      source: 'titlebar',
      reason: 'ftfrance_active',
    })
    return
  }

  if (simulationEnabled) {
    logTestEvent('ui:blocked', { control: 'infosLtvFold', source: 'titlebar' })
    return
  }

  const next = !folded
  setFolded(next)

  logTestEvent('ui:infos-ltv:fold-change', { folded: next, source: 'titlebar' })

  window.dispatchEvent(
    new CustomEvent('lim:infos-ltv-fold-change', {
      detail: { folded: next },
    })
  )
}

  const startTitleBarLongPress = (gestureId: number) => {
    const currentNumbering = displayedTrainNumberStateRef.current

    if (currentNumbering.pendingSide) return

    if (titleBarLongPressTimerRef.current != null) {
      window.clearTimeout(titleBarLongPressTimerRef.current)
      titleBarLongPressTimerRef.current = null
    }

    titleBarLongPressTriggeredRef.current = false

    titleBarLongPressTimerRef.current = window.setTimeout(() => {
      titleBarLongPressTimerRef.current = null

      const latestNumbering = displayedTrainNumberStateRef.current
      if (latestNumbering.pendingSide) return

      titleBarLongPressTriggeredRef.current = true
      titleBarLongPressGestureIdRef.current = gestureId

      window.dispatchEvent(
        new CustomEvent('lim:displayed-train-number-manual-toggle-request', {
          detail: {
            source: 'titlebar',
          },
        })
      )
    }, TITLEBAR_LONG_PRESS_MS)
  }

  const clearTitleBarLongPress = () => {
    if (titleBarLongPressTimerRef.current != null) {
      window.clearTimeout(titleBarLongPressTimerRef.current)
      titleBarLongPressTimerRef.current = null
    }
  }

  const handleTitlePointerDown = () => {
    const nextGestureId = titleBarPointerGestureIdRef.current + 1
    titleBarPointerGestureIdRef.current = nextGestureId
    startTitleBarLongPress(nextGestureId)
  }

  const handleTitlePointerUp = () => {
    clearTitleBarLongPress()
  }

  const handleTitlePointerLeave = () => {
    clearTitleBarLongPress()
  }

  const handleTitlePointerCancel = () => {
    clearTitleBarLongPress()
  }

  const handleTitleClick = () => {
    if (titleBarPointerGestureIdRef.current === titleBarLongPressGestureIdRef.current) {
      titleBarLongPressTriggeredRef.current = false
      return
    }

    if (titleBarLongPressTriggeredRef.current) {
      titleBarLongPressTriggeredRef.current = false
      return
    }

    runTitleBarSingleClickAction()
  }
const autoScrollButtonActive = autoScroll || autoScrollStartedOnce
  const IconSun = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <circle cx="12" cy="12" r="4" />
      <g strokeWidth="1.5" stroke="currentColor" fill="none">
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4L19 19M5 19l-1.4 1.4M20.4 3.6L19 5" />
      </g>
    </svg>
  )
  const IconMoon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
const IconFile = () => null
  return (
    <header id="lim-titlebar-root" className="surface-header rounded-2xl px-3 py-2 shadow-sm" style={{ position: 'relative', zIndex: 2000 }}>
      {/* ── Overlay de luminosité ──────────────────────────────────────────────
          • z-index:1000 → au-dessus de tout le contenu FT (header sticky z-10,
            flèche GPS z-999) pour que la luminosité s’applique partout.
          • TitleBar root (z-2000) est AU-DESSUS de l’overlay → TitleBar
            n’est jamais atténué ; modales/viewers (fixed z-9998+) aussi.
          • pointer-events:none → les interactions passent à travers.
          ──────────────────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          pointerEvents: 'none',
          backgroundColor: `rgba(0,0,0,${Math.max(0, 1 - brightness).toFixed(3)})`,
          transition: 'background-color 0.28s ease',
        }}
      />
      {pdfLoadingErrorMessage && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div
            className="w-[min(620px,92vw)] max-h-[80vh] overflow-auto rounded-2xl border shadow-xl p-4"
            style={{
              backgroundColor: dark ? '#18181b' : '#ffffff',
              color: dark ? '#f4f4f5' : '#18181b',
              borderColor: dark ? '#3f3f46' : '#e4e4e7',
            }}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="text-lg font-semibold">
                  Échec du traitement PDF
                </div>
                <div className="text-xs opacity-70 mt-1">
                  Diagnostic du traitement
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPdfLoadingErrorMessage(null)}
                className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
              >
                Fermer
              </button>
            </div>

            <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-3" />

            <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
              {pdfLoadingErrorMessage}
            </pre>
          </div>
        </div>,
        document.body
      )}
      {startupModeChoiceOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
          onClick={() => {
            setStartupModeChoiceOpen(false)
            logTestEvent('ui:startup-mode-choice:close', {
              source: 'backdrop',
              validated: false,
            })
          }}
        >
          <div
            className="w-[min(620px,92vw)] rounded-2xl border shadow-lg p-4"
            style={{
              backgroundColor: dark ? "#18181b" : "#ffffff",
              color: dark ? "#f4f4f5" : "#18181b",
              borderColor: dark ? "#3f3f46" : "#e4e4e7",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-lg font-semibold">
                Sélection du mode de démarrage
              </div>
              <div className="text-xs opacity-70 mt-1">
                Ce choix sera enregistré sur cet appareil.
              </div>
            </div>

            <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-3" />

            <div className="space-y-2">
              <label className="block rounded-xl border p-3 cursor-pointer"
style={{
  backgroundColor: dark ? "#27272a" : "#fafafa",
  color: dark ? "#f4f4f5" : "#18181b",
  borderColor: dark ? "#52525b" : "#e4e4e7",
}}>
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="startup-mode"
                    checked={startupModeChoice === '2026'}
                    onChange={() => setStartupModeChoice('2026')}
                    className="mt-1 h-4 w-4 cursor-pointer accent-blue-600"
                  />
                  <div>
                    <div className="text-sm font-semibold">
                      Mode 2026 <span className="opacity-70">(nouveau format LTV)</span>
                    </div>
<div className="text-xs opacity-75 mt-1">
  Le conducteur importe un PDF contenant uniquement le tableau LTV.
  <br />
  Le train est selectionne manuellement dans la liste normalisee.
  <br />
  Le mode SECOURS est <strong>DISPONIBLE</strong> (PDF LTV).
</div>
                  </div>
                </div>
              </label>

              <label className="block rounded-xl border p-3 cursor-pointer"
style={{
  backgroundColor: dark ? "#27272a" : "#fafafa",
  color: dark ? "#f4f4f5" : "#18181b",
  borderColor: dark ? "#52525b" : "#e4e4e7",
}}>
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="startup-mode"
                    checked={startupModeChoice === 'ltv'}
                    onChange={() => setStartupModeChoice('ltv')}
                    className="mt-1 h-4 w-4 cursor-pointer accent-blue-600"
                  />
                  <div>
                    <div className="text-sm font-semibold">
                      Mode LTV seul <span className="opacity-70">(consultation)</span>
                    </div>
<div className="text-xs opacity-75 mt-1">
  Le conducteur importe uniquement le PDF LTV — pas de train ni de fiche train.
  <br />
  Seul le tableau des LTV du parcours (PK ≥ 616) est affiché.
</div>
                  </div>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={validateStartupModeChoice}
                className="h-8 px-4 text-xs rounded-md bg-blue-600 text-white font-semibold"
              >
                Valider
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="tabular-nums text-[18px] leading-none font-semibold tracking-tight">
            {clock}
          </div>

          {(demoActive || demoArmed) && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-amber-900 tracking-widest">
              DEMO
            </span>
          )}

          {scheduleDelta && (
            <span
              className={
                scheduleDeltaIsLarge
                  ? 'text-xs italic text-red-500 dark:text-red-400 leading-none'
                  : 'text-xs italic text-gray-500 dark:text-gray-400 leading-none'
              }
            >
              {scheduleDelta}
{testModeEnabled &&
  typeof scheduleDeltaSec === 'number' &&
  Number.isFinite(scheduleDeltaSec) && (
    <>
      {' '}
      <span
        className="opacity-90"
        style={{ color: dark ? '#e5e7eb' : '#374151' }}
      >
        {formatSignedHMS(scheduleDeltaSec)}
      </span>
    </>
  )}
            </span>
          )}

          {/* Mode « LTV seul » : pas de train ni de parcours → Play + indicateurs
              GPS/horaire (et sens attendu) sont sans objet, on masque tout le groupe. */}
          {pdfMode === 'green' && activeStartupMode !== 'ltv' && (
            <>
              {/* Sortie de stand-by par le bouton Play (19/08). Il clignotait deja
                  en orange pour signaler l'attente, mais refusait le doigt : en
                  fiche HORIZONTALE, rien ne disait alors ce qu'il fallait faire. */}
              <button
                type="button"
                onClick={() => {
                  // ⚠️ SORTIE DE STAND-BY — se place AVANT toute autre logique et
                  // sort par `return` : le clic ne peut donc jamais atteindre la
                  // bascule marche/arret. Action identique a celle du badge ARRET
                  // en mode horaire, qui est eprouvee en service : la reprise
                  // calcule le delta et efface le badge.
                  if (sortieStandbyPossible) {
                    logTestEvent('ui:standby:exit-via-play', {
                      kind: stationArretKind,
                      libelle: libelleSortieStandby,
                    })
                    window.dispatchEvent(new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: true, standby: false, source: 'play-standby-exit' },
                    }))
                    return
                  }

                  if (autoScrollStartedOnce) return

                  if (simulationEnabled && !demoActive) {
                    logTestEvent('ui:blocked', { control: 'autoScroll', source: 'titlebar' })
                    return
                  }

                  if (standbyMode) {
                    logTestEvent('ui:autoScroll:standby-click-ignored', {
                      source: 'titlebar',
                      reason: 'resume_from_selected_ft_row_only',
                    })
                    return
                  }

                  const next = !autoScroll
                  // Premier Play de la session : on arme le départ en stand-by
                  const isFirstPlay = next === true && !autoScrollStartedOnce

                  logTestEvent('ui:autoScroll:toggle', {
                    enabled: next,
                    source: 'titlebar',
                  })
setAutoScroll(next)
setAutoScrollStartedOnce(next)
                  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', {
                      detail: {
                        enabled: next,
                        ...(isFirstPlay ? { standby: true } : {}),
                        source: 'titlebar',
                      },
                    })
                  )

                  if (!simulationEnabled && next) {
                    startGpsWatch()
                  }
                }}
                style={{
                  // ⚠️ 19/08 — Le bouton etait rendu DEFINITIVEMENT inerte des le
                  // premier Play, et c'etait voulu : une fois le defilement lance,
                  // lui seul ne doit plus pouvoir l'arreter — seul STOP le peut.
                  // On ouvre donc UNE seule breche, celle du stand-by : pendant le
                  // stand-by en mode horaire, il redevient cliquable, et son clic
                  // ne fait QUE sortir du stand-by (cf. onClick, qui sort avant
                  // d'atteindre la bascule marche/arret). La protection d'origine
                  // est donc intacte en marche.
                  pointerEvents: !autoScrollStartedOnce || sortieStandbyPossible ? 'auto' : 'none',
                  cursor: !autoScrollStartedOnce || sortieStandbyPossible ? 'pointer' : 'default',
                }}
                className={`h-7 px-3 rounded-full flex items-center justify-center text-[11px] transition
                  ${
                    standbyMode
                      ? 'bg-orange-400 text-white animate-pulse'
: autoScrollButtonActive
  ? 'bg-emerald-500 text-white'
                        : 'bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100'
                  }
                `}
                title={
                  standbyMode
                    ? 'Standby'
: autoScrollButtonActive
  ? 'Défilement automatique engagé'
  : 'Activer le défilement automatique'
                }
              >
{sortieStandbyPossible ? (
                  <span className="font-bold whitespace-nowrap">{libelleSortieStandby}</span>
                ) : autoScrollButtonActive ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M8 5v14l10-7z" fill="currentColor" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (stationArretActive) {
                    if (gpsState === 2) {
                      // ARRÊT GPS : forcer la reprise (rattrape un départ non détecté par la position)
                      window.dispatchEvent(new CustomEvent('ft:station-arret-manual-exit'))
                    } else {
                      // ARRÊT en mode horaire : sortie manuelle du stand-by (équivaut au clic
                      // sur la ligne, mais plus intuitif en horizontal). La reprise calcule le
                      // delta et efface le badge ARRÊT.
                      window.dispatchEvent(new CustomEvent('ft:auto-scroll-change', {
                        detail: { enabled: true, standby: false, source: 'arret-badge' },
                      }))
                    }
                    return
                  }
                  showGpsPkTemporarily()
                }}
                className={`
                  relative h-7 px-3 rounded-full text-xs font-semibold bg-white dark:bg-zinc-900 transition
                  ${stationArretActive ? 'cursor-pointer' : ''}
                  ${!stationArretActive && !testModeEnabled && gpsState === 2 && gpsPkDisplay ? 'cursor-pointer' : ''}
                  ${stationArretActive || (!stationArretActive && !testModeEnabled && gpsState !== 2) ? '' : ''}
                  ${stationArretActive ? 'border-[3px] border-sky-500 text-sky-600 dark:text-sky-400' : ''}
                  ${!stationArretActive && gpsState === 0 ? 'border-[3px] border-red-500 text-red-600 dark:text-red-400' : ''}
                  ${!stationArretActive && gpsState === 1 ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300' : ''}
                  ${!stationArretActive && gpsState === 2 ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300' : ''}
                `}
                title={
                  stationArretActive && gpsState === 2
                    ? 'Arrêt détecté (GPS) — appuyer pour forcer la reprise sans recalage'
                    : stationArretActive && gpsState === 0
                      ? 'Arrêt détecté (mode horaire) — appuyer pour sortir du stand-by'
                      : gpsState === 0
                        ? 'GPS indisponible / non calé'
                        : gpsState === 1
                          ? 'GPS présent mais hors ligne de référence'
                          : !testModeEnabled && gpsPkDisplay
                            ? 'GPS OK : appuyer pour afficher temporairement le PK'
                            : 'GPS OK : position calée sur la ligne'
                }
              >
                <span className={`relative z-10 tabular-nums${stationArretActive ? ' animate-pulse' : ''}`}>
                  {stationArretActive
                    ? 'ARRÊT'
                    : (testModeEnabled || gpsPkPeekVisible) && gpsState === 2 && gpsPkDisplay
                      ? `PK ${gpsPkDisplay}`
                      : 'GPS'}
                </span>
                {gpsState === 0 && !stationArretActive && (
                  <span className="pointer-events-none absolute inset-1 z-20" aria-hidden>
                    <span
                      className="absolute top-1/2 left-1 right-1 h-[2px] bg-red-500/80"
                      style={{ transform: 'rotate(-28deg)', transformOrigin: 'center' }}
                    />
                  </span>
                )}
              </button>

              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'expectedDirection', source: 'titlebar' })
                      return
                    }

                    if (!expectedDir) {
                      window.alert('Sens attendu indisponible (numéro de train manquant).')
                      return
                    }

                    const currentLabel = expectedDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'
                    const nextDir = expectedDir === 'DOWN' ? 'UP' : 'DOWN'
                    const nextLabel = nextDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'

                    const ok = window.confirm(
                      `Changer le sens attendu ?\n\nActuel : ${currentLabel}\nNouveau : ${nextLabel}\n\n(Le train ne change pas de sens : utilisez ceci seulement si le numéro de train ne correspond pas au sens réel.)`
                    )
                    if (!ok) return

                    setExpectedDir(nextDir)
                    expectedDirLockedRef.current = true
                    expectedDirSourceRef.current = 'manual'

                    logTestEvent('direction:manual_override', {
                      train: trainDisplay ?? null,
                      from: expectedDir,
                      to: nextDir,
                      source: 'titlebar',
                    })

                    emitExpectedDir(nextDir, { source: 'manual_override' })
                  }}
                  className={`
                    h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition
                    ${expectedDir ? 'border-[3px] border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-100' : 'border-[3px] border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'}
                  `}
                  title={
                    expectedDir === 'DOWN'
                      ? 'Sens attendu : PK décroissants (train pair) — cliquer pour changer'
                      : expectedDir === 'UP'
                        ? 'Sens attendu : PK croissants (train impair) — cliquer pour changer'
                        : 'Sens attendu indisponible'
                  }
                  aria-label="Sens attendu PK"
                >
                  <span aria-hidden>{expectedDir === 'DOWN' ? '⬇️' : expectedDir === 'UP' ? '⬆️' : '↕️'}</span>
                </button>
              )}

              <button
                type="button"
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition cursor-default
                  ${
                    !autoScrollButtonActive
                      ? 'border-[3px] border-zinc-400 text-zinc-500 dark:border-zinc-500 dark:text-zinc-300'
                      : standbyMode
                        ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300'
                        : referenceMode === 'HORAIRE'
                          ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300'
                          : 'border-[3px] border-zinc-400 text-zinc-500 dark:border-zinc-500 dark:text-zinc-300'
                  }
                `}
                title={
                  !autoScrollButtonActive
                    ? 'Mode horaire inactif : autoscroll désactivé'
                    : standbyMode
                      ? 'Mode horaire en standby'
                      : referenceMode === 'HORAIRE'
                        ? 'Mode horaire actif'
                        : 'Mode horaire disponible mais non actif'
                }
                aria-pressed={autoScrollButtonActive && referenceMode === 'HORAIRE' && hourlyMode}
              >
                <span>🕑</span>
              </button>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1 text-center">
          <button
            type="button"
            onClick={handleTitleClick}
            onPointerDown={handleTitlePointerDown}
            onPointerUp={handleTitlePointerUp}
            onPointerLeave={handleTitlePointerLeave}
            onPointerCancel={handleTitlePointerCancel}
            className="max-w-full text-[18px] leading-none font-semibold tracking-tight bg-transparent border-0 cursor-pointer"
            title={folded ? 'Afficher les blocs INFOS et LTV' : 'Afficher uniquement la zone FT'}
          >
            <span className="inline-flex max-w-full items-baseline overflow-hidden">
              <span className="shrink-0">LIM</span>

              {titleSuffix && (
                <span className="shrink-0 ml-1">
                  {titleSuffix}
                </span>
              )}

              {titlePendingSuffix && (
                <span
                  className={
                    titleBarTrainShouldBlink
                      ? 'shrink-0 whitespace-nowrap ml-1 classic-blink-text'
                      : 'shrink-0 whitespace-nowrap ml-1'
                  }
                >
                  {titlePendingSuffix}
                </span>
              )}

              {folded && extendedParts.length > 0 && (
                <span className="min-w-0 truncate ml-1">
                  {`- ${extendedParts.join(' - ')}`}
                </span>
              )}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 relative z-10">
          {swUpdateAvailable && (
            <button
              type="button"
              onClick={() => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'swUpdate', source: 'titlebar' })
                  return
                }
                logTestEvent('ui:sw:update:click', { source: 'titlebar' })
                applySwUpdate()
              }}
              className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold flex items-center gap-2"
              title="Nouvelle version disponible — cliquer pour mettre à jour"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white/90" />
              MAJ
            </button>
          )}

          <div className="h-8 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-700 flex" title="Jour / Nuit">
            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (!dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(false)}
              aria-label="Mode jour"
            >
              <IconSun />
            </button>

            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(true)}
              aria-label="Mode nuit"
            >
              <IconMoon />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] opacity-60">Lum:</span>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={brightnessPct}
              onChange={(e) => {
                const raw = Number(e.target.value)
                const clipped = Math.max(50, Math.min(100, raw))
                setBrightness(clipped / 100)
              }}
              className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-zinc-200 outline-none accent-blue-600 dark:bg-zinc-700"
            />
            <span className="w-9 tabular-nums text-[11px] text-right opacity-60">
              {brightnessPct}%
            </span>
          </div>

          {/* Démarrage */}
          {pdfMode === 'blue' &&
            (() => {
              const storedStartupMode = readStoredStartupMode()

              const startupModeIcon =
                storedStartupMode === '2026'
                  ? '📋'
                  : storedStartupMode === 'ltv'
                    ? 'LTV'
                    : null

              const startupModeTitle =
                storedStartupMode === '2026'
                  ? 'Mode de démarrage sélectionné : 2026'
                  : storedStartupMode === 'ltv'
                    ? 'Mode de démarrage sélectionné : LTV seul'
                    : 'Aucun mode de démarrage enregistré'

              const startupModeIconClassName =
                storedStartupMode === 'ltv'
                  ? 'h-8 w-8 rounded-md bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold select-none cursor-pointer'
                  : 'h-8 w-8 rounded-md bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center text-sm select-none cursor-pointer'

              const openStartupModeChoice = () => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'startupModeIndicator', source: 'titlebar' })
                  return
                }
                const mode = readStoredStartupMode()
                setStartupModeChoice(mode ?? '2026')
                setStartupModeChoiceIntent('settings')
                setStartupModeChoiceOpen(true)
                logTestEvent('ui:startup-mode-choice:open', {
                  source: 'startup_mode_indicator',
                  reason: mode ? 'edit_stored_mode' : 'no_stored_mode',
                  storedMode: mode,
                })
              }

              return (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleStartClick}
                    className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold flex items-center gap-1"
                    title="Démarrer un parcours"
                  >
                    Démarrer
                  </button>

                  {startupModeIcon && (
                    <button
                      type="button"
                      onClick={openStartupModeChoice}
                      className={startupModeIconClassName}
                      title={`${startupModeTitle} — appuyer pour changer`}
                      aria-label={`${startupModeTitle}. Appuyer pour changer le mode de démarrage.`}
                    >
                      {startupModeIcon}
                    </button>
                  )}
                </div>
              )
            })()}

          {/* NORMAL / SECOURS : visible uniquement après démarrage */}
          {pdfMode !== 'blue' && (
            <button
              type="button"
              title={
                pdfMode === 'green'
                  ? 'Passer en mode SECOURS'
                  : 'Revenir en mode NORMAL'
              }
              onClick={() => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'pdfModeButton', source: 'titlebar' })
                  return
                }

                if (pdfMode === 'green') {
                  setPdfMode('red')
                } else {
                  setPdfMode('green')
                }
              }}
              className={
                pdfMode === 'green'
                  ? 'h-8 px-3 text-xs rounded-md bg-emerald-500 text-white flex items-center gap-1'
                  : 'h-8 px-3 text-xs rounded-md bg-red-500 text-white flex items-center gap-1'
              }
            >
              {pdfMode === 'green' && <span className="font-bold">NORMAL</span>}
              {pdfMode === 'red' && <span className="font-bold">SECOURS</span>}
            </button>
          )}

          {/* STOP — visible dès qu’un trajet est en cours, mode test ou non */}
          {pdfMode !== 'blue' && (
            stopUploadStatus !== 'idle' ? (
              /* Indicateur de statut pendant / après l’upload */
              <div
                className={`h-8 px-3 text-xs rounded-md font-semibold flex items-center gap-1.5 ${
                  stopUploadStatus === 'success'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : stopUploadStatus === 'failed'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300'
                }`}
              >
                {stopUploadStatus === 'uploading' && (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                )}
                {stopUploadStatus === 'uploading' && 'Envoi en cours…'}
                {stopUploadStatus === 'success' && '✅ Logs envoyés'}
                {stopUploadStatus === 'failed' && '📥 Export local…'}
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (simulationEnabled && !demoActive) {
                    logTestEvent('ui:blocked', { control: 'stopButton', source: 'titlebar' })
                    return
                  }

                  const ok = window.confirm(
                    demoActive ? 'Quitter le mode demo ?' : 'Terminer le trajet et exporter les logs ?'
                  )
                  if (!ok) return

                  // Arrêt immédiat des automatismes
                  setAutoScroll(false)
                  setAutoScrollStartedOnce(false)
                  if (autoScroll) {
                    window.dispatchEvent(new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: false, source: 'titlebar_stop_button' },
                    }))
                  }
                  stopGpsWatch()
                  setGpsState(0)
                  setGpsPkDisplay(null)
                  setGpsPkPeekVisible(false)
                  setScheduleDelta(null)
                  setScheduleDeltaIsLarge(false)
                  setScheduleDeltaSec(null)

                  if (testRecording) {
                    logTestEvent('ui:test:stop', { source: 'titlebar_stop_button' })
                    stopTestSession()
                    setTestRecording(false)
                  }

                  // Replay : l'export du log se fait désormais via le STOP du panneau Replay
                  // (événement replay:stopped, #23). Ici on se contente de restaurer l'horloge
                  // réelle si elle est encore proxifiée (sécurité), SANS export ni upload.
                  if (wasReplaySessionRef.current) {
                    if (origDateRef.current) {
                      window.Date = origDateRef.current
                      origDateRef.current = null
                      console.log('[TitleBar] Horloge réelle restaurée (sécurité STOP titlebar)')
                    }
                  }

                  if (!wasReplaySessionRef.current && !demoActive) {
                    const zipData = await buildCurrentZipBundle()
                    if (zipData) {
                      setStopUploadStatus('uploading')
                      const success = await uploadZipToGitHub(zipData.blob, zipData.filename)
                      if (success) {
                        setStopUploadStatus('success')
                        await new Promise<void>(resolve => window.setTimeout(resolve, 3000))
                      } else {
                        setStopUploadStatus('failed')
                        await doLocalExport(zipData.blob, zipData.filename)
                      }
                    }
                  }

                  setStopUploadStatus('idle')

                  // Reset mode demo : exporter le log de debug localement (diagnostic iPad)
                  if (demoActive) {
                    try {
                      const built = buildTestLogFile()
                      if (built.ok && built.blob) {
                        const url = URL.createObjectURL(built.blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `demo-debug-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.log`
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        setTimeout(() => URL.revokeObjectURL(url), 2000)
                      }
                    } catch (e) {
                      console.warn('[TitleBar] Export log demo impossible', e)
                    }

                    setDemoActive(false)
                    setDemoArmed(false)
                    setDemoRunning(false)
                    setDemoEvents([])
                    demoStartedRef.current = false
                    demoActiveRef.current = false
                    demoT0MsRef.current = null
                    demoWallStartMsRef.current = null
                    // Restaurer le Date original avant de supprimer __limgptDemo
                    if (origDateRef.current) {
                      window.Date = origDateRef.current
                      origDateRef.current = null
                    }
                    delete (window as any).__limgptDemo
                    window.dispatchEvent(new CustomEvent('sim:enable', { detail: { enabled: false } }))
                  }

                  // Reset complet de l’app
                  setPdfMode('blue')
                  setPdfLoading(false)
                  stopPdfLoadingGuard()
                  currentPdfFileRef.current = null
                  currentLtvPdfFileRef.current = null
                  currentPdfIdRef.current = null
                  currentPdfReplayKeyRef.current = null
                  window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                  window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                  window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))
                  setTestModeEnabled(false)
                }}
                className="h-8 px-3 text-xs rounded-md bg-red-600 text-white font-semibold flex items-center gap-1"
                title="Terminer le trajet et exporter les logs"
              >
                <span className="font-bold">STOP</span>
              </button>
            )
          )}
          {/* Paramètres */}
          <details ref={settingsDetailsRef} className="relative">
            <summary
              className="list-none h-8 w-10 rounded-md bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-pointer select-none"
              title="Paramètres (appui long : menu avancé)"
              aria-label="Paramètres"
              style={{ WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
              onPointerDown={startSettingsLongPress}
              onPointerUp={clearSettingsLongPress}
              onPointerLeave={clearSettingsLongPress}
              onPointerCancel={clearSettingsLongPress}
              onClick={(e) => {
                // Si l’appui long a déclenché le menu caché, on bloque l’ouverture
                // du menu natif <details>.
                if (settingsLongPressTriggeredRef.current) {
                  e.preventDefault()
                  settingsLongPressTriggeredRef.current = false
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z"
                  fill="currentColor"
                  opacity="0.18"
                />
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </summary>

            <div
              className={`absolute right-0 mt-2 w-72 rounded-xl border shadow-lg p-3 text-xs z-[9999]${dark ? ' dark' : ''}`}
              style={{
                backgroundColor: dark ? "#18181b" : "#ffffff",
                color: dark ? "#f4f4f5" : "#18181b",
                borderColor: dark ? "#3f3f46" : "#e4e4e7",
              }}
            >
              <div className="text-[11px] font-semibold opacity-70 mb-2">Paramètres</div>

              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', {
                      control: 'startupModeSettings',
                      source: 'settings',
                    })
                    return
                  }

                  const storedMode = readStoredStartupMode()

                  setStartupModeChoice(storedMode ?? '2026')
                  setStartupModeChoiceIntent('settings')
                  setStartupModeChoiceOpen(true)

                  if (settingsDetailsRef.current?.hasAttribute('open')) {
                    settingsDetailsRef.current.removeAttribute('open')
                  }

                  logTestEvent('ui:startup-mode-choice:open', {
                    source: 'settings',
                    reason: storedMode ? 'edit_stored_mode' : 'no_stored_mode',
                    storedMode,
                  })
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">Modifier le mode de démarrage</div>
                  <div className="text-[11px] opacity-70">
                    Choisir le mode utilisé par le bouton Démarrer
                  </div>
                </div>
              </button>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              {/* Défilement vertical / horizontal (#28) — déplacé du menu caché */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span>Défilement fiche train</span>
                <select
                  value={ftScrollMode}
                  onChange={(e) => setFtScrollMode(e.target.value === 'horizontal' ? 'horizontal' : 'vertical')}
                  className="text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-transparent px-1 py-0.5 cursor-pointer"
                >
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
              </label>
              {ftScrollMode === 'horizontal' && (
                <div className="pl-2 pb-1 text-xs text-zinc-600 dark:text-zinc-300">
                  <div className="flex justify-between"><span>Échelle horizontale</span><span>{ftHScale} px/km</span></div>
                  <input type="range" min={10} max={150} step={1} value={ftHScale}
                    onChange={(e) => setFtHScale(parseInt(e.target.value, 10))}
                    className="w-full cursor-pointer accent-blue-600" />
                </div>
              )}
              {/* Présentation portrait (19/08) — cochée par défaut. Décocher ne
                  bloque plus rien : ça fige la présentation paysage, pour qui
                  veut tourner sa tablette sans que la mise en page change. */}
              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span>Autoriser le mode portrait</span>
                <input
                  type="checkbox"
                  checked={autoriserPortrait}
                  onChange={() => {
                    const next = !autoriserPortrait
                    setAutoriserPortrait(next)
                    logTestEvent('settings:allowPortrait:set', { enabled: next, source: 'settings' })
                  }}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>

              {/* Mise à l'échelle de la fiche train (#25) — VERTICAL uniquement */}
              {ftScrollMode === 'vertical' && (
                <>
                  {/* ⚠️ 15/08 — Case de nouveau disponible EN PERMANENCE. Elle a
                      été grisée quelques heures en mode déplié, parce que FT y
                      suspendait la mise à l'échelle : la bande de fiche visible
                      étant courte, l'étalement n'y montrait que du vide, sans
                      Bloc ni Vmax ni rampe. La couche en surimpression a levé
                      cette limite (cf. `infosLtvFolded` dans FT.tsx) — la mise à
                      l'échelle vaut désormais dans les deux modes, avec un seuil
                      d'exactitude et des bornes de curseur qui se recalculent au
                      pli comme au dépli. */}
                  <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                    <span>Mise à l'échelle de la fiche train</span>
                    <input
                      type="checkbox"
                      checked={ftScaleEnabled}
                      onChange={() => setFtScaleEnabled(v => !v)}
                      className="h-4 w-4 cursor-pointer accent-blue-600"
                    />
                  </label>
                  {/* ⚠️ 15/08 — Curseur d'espacement RÉTABLI (cf. le commentaire
                      sur `ftScaleMult`). 1× = le plus grand intervalle de la
                      fiche remplit un écran ; au-delà il le dépasse, ce qui ne
                      pose plus de problème depuis que les valeurs de colonne ne
                      dépendent plus d'une ligne visible. */}
                  {/* Parcours court : la fiche tient dans l'écran et le remplit.
                      Le curseur serait sans aucun effet — on l'enlève et on dit
                      pourquoi, plutôt que de laisser croire à un réglage. */}
                  {ftScaleEnabled && ftScaleSature && (
                    <div className="pl-2 pb-1 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
                      Parcours court : la fiche entière tient dans l'écran et le
                      remplit. L'espacement n'est pas réglable ici.
                    </div>
                  )}

                  {ftScaleEnabled && !ftScaleSature && (() => {
                    // TROIS états, deux informations distinctes :
                    //  bleu   = en deçà du seuil, la fiche est approximative ;
                    //  vert   = au-delà, elle est rigoureusement proportionnelle ;
                    //  orange = exacte MAIS très étalée (un intervalle approche
                    //           les 4 écrans). Pas une faute, un avertissement —
                    //           d'où l'orange et non le rouge.
                    // ⚠️ `exact` vient de FT, il n'est PAS recalculé ici.
                    const exact = ftScaleExact
                    const tresEtale = ftScaleMult > FT_SCALE_MULT_ALERTE
                    const teinteTexte = tresEtale
                      ? 'text-amber-600 dark:text-amber-400'
                      : exact
                      ? 'text-green-600 dark:text-green-400'
                      : null
                    return (
                      <div className="pl-2 pb-1 text-xs text-zinc-600 dark:text-zinc-300 space-y-2">
                        <div>
                          <div className="flex justify-between items-center gap-2">
                            <span className="flex items-center gap-2">
                              Espacement
                              {/* Retour au seuil. N'apparaît QUE s'il y a un
                                  écart à annuler : le reste du temps elle
                                  encombrerait le panneau pour rien. Ne remet
                                  QUE l'écart d'espacement — ni la case, ni quoi
                                  que ce soit d'autre (choix utilisateur 15/08). */}
                              {ftScaleMultExact !== null && Math.abs(ftScaleOffset) >= 0.05 && (
                                <button
                                  type="button"
                                  onClick={() => setFtScaleOffset(0)}
                                  className="text-[10px] text-blue-600 dark:text-blue-400 underline underline-offset-2 px-1 py-0.5 -my-0.5"
                                >
                                  Revenir au seuil
                                </button>
                              )}
                            </span>
                            <span className={teinteTexte ? teinteTexte + ' font-semibold' : undefined}>
                              {ftScaleMult.toFixed(1)}×
                            </span>
                          </div>
                          <input type="range" min={ftScaleMin} max={ftScaleMax} step={0.1} value={ftScaleMult}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value)
                              setFtScaleMult(v)
                              // C'est l'ÉCART au seuil qui devient la préférence.
                              // Tant que le seuil est inconnu on ne l'enregistre
                              // pas : un écart calculé sur rien serait faux.
                              if (ftScaleMultExact !== null) {
                                setFtScaleOffset(Math.round((v - ftScaleMultExact) * 10) / 10)
                              }
                            }}
                            className={
                              'w-full cursor-pointer ' +
                              (tresEtale
                                ? 'accent-amber-500'
                                : exact
                                ? 'accent-green-600'
                                : 'accent-blue-600')
                            } />
                          {/* Le seuil n'est connu qu'une fois la fiche mesurée
                              par FT : tant qu'il manque, on n'affiche rien
                              plutôt qu'une valeur inventée. */}
                          {ftScaleMultExact !== null && (
                            <div className={
                              'text-[10px] leading-tight ' +
                              (teinteTexte ?? 'text-zinc-600 dark:text-zinc-300 opacity-80')
                            }>
                              {/* « environ » : le multiplicateur vaut le nombre
                                  d'écrans à la marge de 5 % près (cf. bornerMax). */}
                              {tresEtale
                                ? `Très étalé : exact (seuil ${ftScaleMultExact.toFixed(1)}×), mais le plus grand intervalle occupe environ ${ftScaleMult.toFixed(1)} écrans.`
                                : exact
                                ? `Proportionnel exact (seuil ${ftScaleMultExact.toFixed(1)}×) : les distances sont à l'échelle sur toute la fiche.`
                                : `Approximatif. Proportionnel exact à partir de ${ftScaleMultExact.toFixed(1)}×.`}
                            </div>
                          )}
                          <div className="text-[10px] opacity-70 leading-tight">1× = le plus grand intervalle de la fiche tient dans un écran. En dessous = plus compact. Au-dessus = plus étalé, les longs intervalles dépassent l'écran. Jamais de compression sous le contenu réel.</div>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />



              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', {
                      control: 'forceAppRefresh',
                      source: 'settings',
                    })
                    return
                  }

                  logTestEvent('ui:force-refresh:click', {
                    source: 'settings',
                    train: trainDisplay ?? null,
                  })

                  void forceAppRefresh()
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold text-blue-600 dark:text-blue-400">
                    Forcer la mise à jour
                  </div>
                  <div className="text-[11px] opacity-70">
                    Recharge l’application et les données pour récupérer la dernière version publiée
                  </div>
                </div>
              </button>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              <button
                type="button"
                onClick={() => {
                  void resetCurrentJourney('settings_reset_journey')
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold text-red-600 dark:text-red-400">
                    Réinitialiser le parcours
                  </div>
                  <div className="text-[11px] opacity-70">
                    Arrêter la session en cours et revenir à l’écran initial
                  </div>
                </div>
              </button>




              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', {
                      control: 'manual',
                      source: 'settings',
                    })
                    return
                  }

                  logTestEvent('ui:manual:open', { source: 'settings' })

                  if (settingsDetailsRef.current?.hasAttribute('open')) {
                    settingsDetailsRef.current.removeAttribute('open')
                  }

                  setManualInitialPage(1)
                  setManualInitialTocId('cover')
                  setManualOpen(true)
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">Manuel utilisateur</div>
                  <div className="text-[11px] opacity-70">
                    Consulter l’aide au format PDF
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (settingsDetailsRef.current) settingsDetailsRef.current.open = false
                  setGuiaOpen(true)
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">Guia BSN</div>
                  <div className="text-[11px] opacity-70">Livret d’aide a la conduite</div>
                </div>
              </button>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'about', source: 'settings' })
                    return
                  }

                  logTestEvent('ui:about:open', { source: 'settings' })
                  setAboutOpen(true)
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">À propos</div>
                  <div className="text-[11px] opacity-70">LIM — version & changelog</div>
                </div>
              </button>
            </div>
          </details>

          {/* ===== MENU CACHÉ (dev / présentation) — appui long sur la roue ===== */}
          {hiddenMenuOpen && createPortal(
            <div
              className="fixed inset-0 z-[99999] flex items-start justify-end p-3"
              onClick={() => setHiddenMenuOpen(false)}
            >
              <div
                className="w-72 rounded-xl border shadow-lg p-3 text-xs mt-14"
                style={{
                  backgroundColor: dark ? '#18181b' : '#ffffff',
                  color: dark ? '#f4f4f5' : '#18181b',
                  borderColor: dark ? '#3f3f46' : '#e4e4e7',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold opacity-70">Menu avancé (dev)</div>
                  <button
                    type="button"
                    onClick={() => setHiddenMenuOpen(false)}
                    className="h-6 px-2 text-[11px] rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
                  >
                    Fermer
                  </button>
                </div>

                {/* Mode test */}
                <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                  <span className="font-semibold">Mode test</span>
                  <input
                    type="checkbox"
                    checked={testModeEnabled}
                    onChange={() => {
                      if (simulationEnabled) {
                        logTestEvent('ui:blocked', { control: 'testModeToggle', source: 'hidden_menu' })
                        return
                      }
                      if (testModeEnabled) {
                        const wantDisable = window.confirm(
                          'Désactiver le mode test ?\n\n(Cela masque les fonctions de test, sans arrêter la session en cours ni décharger le PDF.)'
                        )
                        if (!wantDisable) return
                        logTestEvent('ui:test:manual-disable', { source: 'hidden_menu', train: trainDisplay ?? null })
                        setTestModeEnabled(false)
                        return
                      }
                      const wantEnable = window.confirm(
                        'Activer le mode test ?\n\n(Cela réaffiche les fonctions de test sans démarrer un nouvel enregistrement.)'
                      )
                      if (!wantEnable) return
                      logTestEvent('ui:test:manual-enable', { source: 'hidden_menu', train: trainDisplay ?? null, testRecording })
                      setTestModeEnabled(true)
                    }}
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                  />
                </label>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

                {/* OCR online */}
                <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                  <span>OCR online</span>
                  <input
                    type="checkbox"
                    checked={ocrOnlineEnabled}
                    onChange={() => {
                      if (simulationEnabled) {
                        logTestEvent('ui:blocked', { control: 'ocrOnlineToggle', source: 'hidden_menu' })
                        return
                      }
                      const next = !ocrOnlineEnabled
                      setOcrOnlineEnabledState(next)
                      logTestEvent('settings:ocrOnline:set', { enabled: next, source: 'hidden_menu' })
                    }}
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                  />
                </label>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

                {/* Afficher les appuis */}
                <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                  <span>Afficher les appuis (présentation)</span>
                  <input
                    type="checkbox"
                    checked={touchIndicatorEnabled}
                    onChange={() => setTouchIndicatorEnabled(v => !v)}
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                  />
                </label>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

                {/* Mode démo */}
                <button
                  type="button"
                  onClick={() => {
                    setHiddenMenuOpen(false)
                    setDemoLoaderOpen(true)
                  }}
                  className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
                >
                  <div className="text-left">
                    <div className="font-semibold">Mode demo</div>
                    <div className="text-[11px] opacity-70">Lancer une demonstration GPS</div>
                  </div>
                </button>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

                {/* Exporter log + PDF */}
                <button
                  type="button"
                  onClick={async () => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'exportLogs', source: 'hidden_menu' })
                      return
                    }
                    logTestEvent('testlog:manual-export:click', { source: 'hidden_menu', mode: 'silent', train: trainDisplay ?? null })
                    try {
                      const exported = await exportCurrentTestBundleLocal()
                      if (!exported) {
                        window.alert('Aucun élément de test à exporter.')
                        logTestEvent('testlog:export:failed', { reason: 'no_events', source: 'hidden_menu' })
                      } else {
                        logTestEvent('testlog:exported', { source: 'hidden_menu' })
                      }
                    } catch (err: any) {
                      window.alert('Export local du paquet de test impossible.')
                      logTestEvent('testlog:export:failed', { reason: err?.message ?? String(err), source: 'hidden_menu' })
                    }
                  }}
                  className="w-full h-8 px-3 text-xs rounded-md bg-sky-600 text-white font-semibold flex items-center justify-center"
                  title="Exporter manuellement le paquet de test de la session en cours"
                >
                  Exporter log + PDF
                </button>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

                {/* Replay */}
                <button
                  type="button"
                  onClick={() => {
                    setHiddenMenuOpen(false)
                    window.dispatchEvent(new CustomEvent('replay:show'))
                  }}
                  className="w-full h-8 px-3 text-xs rounded-md bg-amber-500 text-white font-semibold flex items-center justify-center"
                  title="Ouvrir la barre de navigation replay"
                >
                  Replay
                </button>
              </div>
            </div>,
            document.body
          )}

          <ManualViewer open={manualOpen} dark={dark} onClose={() => setManualOpen(false)} initialPage={manualInitialPage} initialTocId={manualInitialTocId} />

                    <GuiaViewer open={guiaOpen} dark={dark} onClose={() => setGuiaOpen(false)} />

          {mode2026Open && (
            <Mode2026Modal
              dark={dark}
              trainOptions={effective2026TrainOptions}
              preselectTrainNumber={sdmTrain?.trainNumber ?? null}
              onClose={() => {
                setMode2026Open(false)
                setMode2026LtvOnly(false)
                // Fermer sans démarrer = annuler la démo armée (retour état normal)
                demoCtxRef.current = null
                setDemoArmed(false)
                setMode2026LockedTrain(null)
                setMode2026DemoPdfs([])
              }}
              onConfirm={handleMode2026Confirm}
              ltvOnly={mode2026LtvOnly}
              onConfirmLtvOnly={handleLtvOnlyConfirm}
              lockedTrainNumber={mode2026LockedTrain}
              demoPdfFiles={mode2026DemoPdfs.length > 0 ? mode2026DemoPdfs : undefined}
              onSelectSdm={() => setSdmOpen(true)}
            />
          )}

          {sdmOpen && createPortal(
            <SdmModal
              dark={dark}
              onClose={() => setSdmOpen(false)}
              onConfirm={(draft) => {
                setSdmTrain(draft)
                // Active le train de session : l'app lira ce "normalise provisoire" pour ce numero.
                setSdmSessionTrain({
                  trainNumber: draft.trainNumber,
                  isPair: draft.isPair,
                  origine: draft.origine,
                  destination: draft.destination,
                  type: draft.type,
                  stations: draft.stations.map(s => ({ name: s.name, arr: s.arr, dep: s.dep })),
                })
                setSdmOpen(false)
              }}
            />,
            document.body
          )}

          {demoLoaderOpen && (
            <DemoLoader
              dark={dark}
              onLoaded={handleDemoLoaded}
              onClose={() => setDemoLoaderOpen(false)}
            />
          )}

          <DemoRunner events={demoEvents} running={demoRunning} />
          <DemoTouchIndicator active={demoActive || touchIndicatorEnabled} />

          {aboutOpen && createPortal(
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
              onClick={() => setAboutOpen(false)}
            >
              <div
                className="w-[min(900px,92vw)] max-h-[85vh] rounded-2xl border shadow-lg p-4"
                style={{
                  backgroundColor: dark ? '#18181b' : '#ffffff',
                  color: dark ? '#f4f4f5' : '#18181b',
                  borderColor: dark ? '#3f3f46' : '#e4e4e7',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">LIM</div>
                    <div className="text-xs opacity-70 tabular-nums">Version {APP_VERSION}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAboutOpen(false)}
                    className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
                  >
                    Fermer
                  </button>
                </div>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-3" />

                <div
                  className="rounded-xl border p-3 text-xs whitespace-pre-wrap overflow-auto"
                  style={{
                    maxHeight: '65vh',
                    backgroundColor: dark ? '#27272a' : '#fafafa',
                    color: dark ? '#f4f4f5' : '#18181b',
                    borderColor: dark ? '#52525b' : '#e4e4e7',
                  }}
                >
                  {CHANGELOG_TEXT}
                </div>
              </div>
            </div>,
            document.body
          )}

          <input
            ref={gpsReplayInputRef}
            type="file"
            accept=".log,.ndjson,application/json,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              await runGpsReplayFromNdjson(f)
            }}
            className="sr-only"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </header>
  )
}
