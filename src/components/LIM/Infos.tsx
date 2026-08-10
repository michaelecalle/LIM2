import React from "react"
import ClassicInfoPanel from "./ClassicInfoPanel"
import {
  getTrainComposition,
  getTrainLigne,
  getTrainMateriel,
  getTrainRelation,
} from "../../data/ligneFT.normalized.adapter"
import type { CategoriesByNetwork } from "./titleBarTrainUtils"
type LIMData = {

  train?: string
  type?: string
  relation?: string
  rawDate?: string
  unit?: string
  material?: string
  line?: string
  lengthMeters?: number
  massTons?: number
  ouigoLogoUrl?: string
  // Enrichissements éventuels
  categoriesByNetwork?: CategoriesByNetwork
  originNetwork?: 'ADIF' | 'LFP' | 'RFN'
  tren?: string
  origenDestino?: string
  fecha?: string
  composicion?: string
  linea?: string
  longitud?: string | number
  masa?: string | number
  operador?: string
  operadorLogo?: string
}

type DisplayedTrainNumberState = {
  trainNumberEs?: string
  trainNumberFr?: string
  displayedSide: 'ES' | 'FR'
  pendingSide: 'ES' | 'FR' | null
  isBlinking: boolean
  displayedNumber?: string
}
type DisplayedCompositionState = {
  normalizedComposition?: string
  displayedComposition?: string
  manualOverrideActive: boolean
}
function buildPanelData(src: any): any {
  const d = src || {}
  // Accepte soit les clés déjà "espagnoles", soit les clés du LIMData
  const tren = String(d.tren ?? d.train ?? "").replace(/^0(?=\d)/, "")
  return {
    tren,
    type: d.type ?? "",
    origenDestino: d.origenDestino ?? d.relation ?? "",
    fecha: d.fecha ?? d.rawDate ?? "",
    composicion: d.composicion ?? d.unit ?? "",
    material: d.material ?? "",
    linea: d.linea ?? d.line ?? "",
    longitud: d.longitud ?? d.lengthMeters ?? "",
    masa: d.masa ?? d.massTons ?? "",
    operador: d.operador ?? "OUIGO",
    operadorLogo: d.operadorLogo ?? d.ouigoLogoUrl ?? "/ouigo.svg",
  }
}

export default function Infos() {
  const [raw, setRaw] = React.useState<LIMData>(() => {
    const w = window as any
    return (w.__limLastParsed || {}) as LIMData
  })

  const [displayedTrainNumberState, setDisplayedTrainNumberState] =
    React.useState<DisplayedTrainNumberState | null>(() => {
      const w = window as any
      return (w.__limLastDisplayedTrainNumberState || null) as DisplayedTrainNumberState | null
    })
  const [displayedCompositionState, setDisplayedCompositionState] =
    React.useState<DisplayedCompositionState | null>(() => {
      const w = window as any
      return (w.__limLastDisplayedCompositionState || null) as DisplayedCompositionState | null
    })
  // écoute du parseur LIM -> met à jour les infos brutes
  React.useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const payload = ce.detail || {}
      ;(window as any).__limLastParsed = payload
      setRaw(payload)
    }
    window.addEventListener('lim:parsed', onParsed as EventListener)
    return () => window.removeEventListener('lim:parsed', onParsed as EventListener)
  }, [])

  React.useEffect(() => {
    const onDisplayedTrainNumberChange = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || null) as DisplayedTrainNumberState | null
      setDisplayedTrainNumberState(detail)
    }

    window.addEventListener(
      'lim:displayed-train-number-change',
      onDisplayedTrainNumberChange as EventListener
    )

    return () => {
      window.removeEventListener(
        'lim:displayed-train-number-change',
        onDisplayedTrainNumberChange as EventListener
      )
    }
  }, [])
  React.useEffect(() => {
    const onDisplayedCompositionChange = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || null) as DisplayedCompositionState | null
      setDisplayedCompositionState(detail)
    }

    window.addEventListener(
      'lim:displayed-composition-change',
      onDisplayedCompositionChange as EventListener
    )

    return () => {
      window.removeEventListener(
        'lim:displayed-composition-change',
        onDisplayedCompositionChange as EventListener
      )
    }
  }, [])
  // Réseau courant (ADIF/LFP/RFN) déduit du GPS par FT.tsx et diffusé via
  // 'lim:network-change'. En mode horaire, FT.tsx n'émet pas → la valeur reste gelée
  // jusqu'au retour du GPS (comportement voulu de la case « catégorie »).
  const [currentNetwork, setCurrentNetwork] = React.useState<'ADIF' | 'LFP' | 'RFN' | null>(() => {
    const w = window as any
    return (w.__limCurrentNetwork ?? null) as 'ADIF' | 'LFP' | 'RFN' | null
  })
  React.useEffect(() => {
    const onNet = (e: Event) => {
      const n = (e as CustomEvent).detail?.network
      if (n === 'ADIF' || n === 'LFP' || n === 'RFN') {
        ;(window as any).__limCurrentNetwork = n
        setCurrentNetwork(n)
      }
    }
    window.addEventListener('lim:network-change', onNet as EventListener)
    return () => window.removeEventListener('lim:network-change', onNet as EventListener)
  }, [])

  // À chaque nouveau train (lim:parsed), on OUBLIE le réseau GPS mémorisé : le nouveau
  // train doit repartir de SON réseau d'origine (raw.originNetwork) au chargement, pas
  // hériter du réseau du train précédent. Le GPS reprendra la main dès qu'il émettra.
  React.useEffect(() => {
    const onNewTrain = () => {
      ;(window as any).__limCurrentNetwork = null
      setCurrentNetwork(null)
    }
    window.addEventListener('lim:parsed', onNewTrain as EventListener)
    return () => window.removeEventListener('lim:parsed', onNewTrain as EventListener)
  }, [])

  const panelBaseData = buildPanelData(raw)

  const currentTrainNumber = raw?.tren ?? raw?.train
  const normalizedRelation = getTrainRelation(currentTrainNumber)
  const normalizedLigne = getTrainLigne(currentTrainNumber)
  const normalizedMateriel = getTrainMateriel(currentTrainNumber)
  const normalizedComposition = getTrainComposition(currentTrainNumber)

  // Catégorie (migration 2026) = celle du RÉSEAU courant, lue dans le normalisé 2026
  // (raw.categoriesByNetwork). Avant tout signal GPS (chargement / avant départ), on
  // prend le réseau de l'ORIGINE (raw.originNetwork). Repli ultime sur panelBaseData.type.
  const effectiveNetwork = currentNetwork ?? raw?.originNetwork ?? null
  const displayedCategory =
    (effectiveNetwork ? raw?.categoriesByNetwork?.[effectiveNetwork] : undefined) ??
    panelBaseData.type

  const displayedComposition =
    displayedCompositionState?.displayedComposition ??
    normalizedComposition ??
    panelBaseData.composicion

  const displayedCompositionKey = String(displayedComposition ?? "")
    .trim()
    .toUpperCase()

  const derivedLengthMeters =
    displayedCompositionKey === "US"
      ? 200
      : displayedCompositionKey === "UM"
        ? 400
        : undefined

  const derivedMassTons =
    displayedCompositionKey === "US"
      ? 433
      : displayedCompositionKey === "UM"
        ? 866
        : undefined

  const trenCommitted =
    displayedTrainNumberState?.displayedSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        panelBaseData.tren
      : displayedTrainNumberState?.trainNumberEs ??
        displayedTrainNumberState?.trainNumberFr ??
        panelBaseData.tren

  const trenPending =
    displayedTrainNumberState?.pendingSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        null
      : displayedTrainNumberState?.pendingSide === 'ES'
        ? displayedTrainNumberState.trainNumberEs ??
          displayedTrainNumberState.trainNumberFr ??
          null
        : null

  const panelData = {
    ...panelBaseData,
    type: displayedCategory,
    origenDestino: normalizedRelation ?? panelBaseData.origenDestino,
    composicion: displayedComposition,
    material: normalizedMateriel ?? panelBaseData.material,
    linea: normalizedLigne ?? panelBaseData.linea,
    longitud: derivedLengthMeters ?? panelBaseData.longitud,
    masa: derivedMassTons ?? panelBaseData.masa,
    tren:
      displayedTrainNumberState?.displayedNumber ??
      panelBaseData.tren,
    trenShouldBlink:
      displayedTrainNumberState?.isBlinking ?? false,
    trenCommitted,
    trenPending: trenPending ?? undefined,
    trenPendingActive: Boolean(displayedTrainNumberState?.pendingSide && trenPending),
  }
  const handleTrenClick = React.useCallback(() => {
    const pendingSide = displayedTrainNumberState?.pendingSide
    if (!pendingSide) return

    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-commit-request', {
        detail: {
          pendingSide,
          source: 'infos_tren',
        },
      })
    )
  }, [displayedTrainNumberState?.pendingSide])

  const handleTrenLongPress = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-manual-toggle-request', {
        detail: {
          source: 'infos_tren',
        },
      })
    )
  }, [])
    const handleCompositionLongPress = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('lim:displayed-composition-manual-toggle-request', {
        detail: {
          source: 'infos_composition',
        },
      })
    )
  }, [])
  // >>> AJOUT CRITIQUE <<<
  // Le numéro interne diffusé pour FT doit rester le numéro Espagne issu du PDF,
  // indépendamment du numéro actuellement affiché dans le panneau.
  const lastDispatchedTrainRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const rawTrainStr = String(raw?.tren ?? raw?.train ?? "").replace(/^0(?=\d)/, "")
    if (!rawTrainStr) return

    const n = parseInt(rawTrainStr, 10)
    if (Number.isNaN(n)) {
      console.warn("[Infos] raw train présent mais non numérique :", rawTrainStr)
      return
    }

    // ✅ Dédupe locale (évite les doubles runs StrictMode / rerenders)
    if (lastDispatchedTrainRef.current === n) return
    lastDispatchedTrainRef.current = n

    // ✅ Dédupe globale (évite les redispatch si HMR/remount)
    const w = window as any
    if (w.__limLastTrainChangeDispatched === n) return
    w.__limLastTrainChangeDispatched = n

    window.dispatchEvent(
      new CustomEvent("lim:train-change", {
        detail: { trainNumber: n },
      })
    )
    console.log("[Infos] dispatch lim:train-change trainNumber=", n)
  }, [raw?.tren, raw?.train])
  // <<< FIN AJOUT CRITIQUE <<<


  return (
    <section className="group/infos relative">
      <ClassicInfoPanel
        data={panelData}
        onTrenClick={
          displayedTrainNumberState?.pendingSide ? handleTrenClick : undefined
        }
        onTrenLongPress={handleTrenLongPress}
        onCompositionLongPress={handleCompositionLongPress}
      />
    </section>
  )
}

