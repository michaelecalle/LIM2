import React from "react"
import ClassicInfoPanel from "./ClassicInfoPanel"
import type { CategoriesByNetwork, MaterielCatalogEntry } from "./titleBarTrainUtils"
import { getMaterielMetrics } from "./titleBarTrainUtils"
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
  materielCatalog?: MaterielCatalogEntry[]
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
    operadorLogo: d.operadorLogo ?? d.ouigoLogoUrl ?? "/inoui.png",
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
  // Matériel choisi MANUELLEMENT (appui long sur la tuile MATERIAL → matériel suivant
  // du catalogue 2026). null = celui du train. Cycle inerte tant que le catalogue n'a
  // qu'un matériel, mais le mécanisme est en place (décision 07/08, confirmée 10/08).
  const [materielOverride, setMaterielOverride] = React.useState<string | null>(null)

  // MOTEURS ISOLÉS (0, 1 ou 2). Saisi manuellement par le conducteur (appui long),
  // jamais dans le normalisé. Servira à choisir la courbe empirique utilisée par
  // la localisation horaire → la valeur est DIFFUSÉE, pas gardée en interne.
  const [moteursIsoles, setMoteursIsoles] = React.useState(0)

  React.useEffect(() => {
    const onNewTrain = () => {
      ;(window as any).__limCurrentNetwork = null
      setCurrentNetwork(null)
      setMaterielOverride(null) // nouveau train → on repart de SON matériel
      setMoteursIsoles(0)       // et d'aucun moteur isolé
    }
    window.addEventListener('lim:parsed', onNewTrain as EventListener)
    return () => window.removeEventListener('lim:parsed', onNewTrain as EventListener)
  }, [])

  const panelBaseData = buildPanelData(raw)

  // Catégorie (migration 2026) = celle du RÉSEAU courant, lue dans le normalisé 2026
  // (raw.categoriesByNetwork). Avant tout signal GPS (chargement / avant départ), on
  // prend le réseau de l'ORIGINE (raw.originNetwork). Repli ultime sur panelBaseData.type.
  const effectiveNetwork = currentNetwork ?? raw?.originNetwork ?? null
  const displayedCategory =
    (effectiveNetwork ? raw?.categoriesByNetwork?.[effectiveNetwork] : undefined) ??
    panelBaseData.type

  // Composition : plus lue du normalisé (décision 07/08 — hors normalisé).
  // Défaut US ; la bascule manuelle US↔UM (appui long) reste prioritaire.
  const displayedComposition =
    displayedCompositionState?.displayedComposition ??
    panelBaseData.composicion ??
    "US"

  const displayedCompositionKey = String(displayedComposition ?? "")
    .trim()
    .toUpperCase()

  // Matériel affiché : celui choisi manuellement (cycle) sinon celui du train (2026).
  const materielCatalog = raw?.materielCatalog
  const displayedMateriel = materielOverride ?? panelBaseData.material

  // Longueur/masse = spec UNITAIRE du matériel affiché × 2 si UM (décision 07/08).
  // Plus aucune constante en dur : rien n'est affiché si le matériel est hors catalogue.
  const { lengthMeters: derivedLengthMeters, massTons: derivedMassTons } = getMaterielMetrics(
    displayedMateriel,
    displayedCompositionKey,
    materielCatalog
  )

  // Un moteur isolé AU MAXIMUM PAR RAME → US : max 1, UM : max 2.
  const maxMoteursIsoles = displayedCompositionKey === "UM" ? 2 : 1

  // Si la composition repasse en US alors qu'on affichait 2, la valeur devient
  // impossible : on la ramène au maximum autorisé (1) plutôt qu'à 0 — on garde
  // l'information « il y a un moteur isolé », qui reste vraie.
  React.useEffect(() => {
    setMoteursIsoles((v) => (v > maxMoteursIsoles ? maxMoteursIsoles : v))
  }, [maxMoteursIsoles])

  // Diffusion : la sélection de la courbe empirique (ailleurs) doit pouvoir lire
  // cette valeur sans qu'on ait à retoucher le bloc info.
  React.useEffect(() => {
    ;(window as any).__limMoteursIsoles = moteursIsoles
    window.dispatchEvent(
      new CustomEvent("lim:moteurs-isoles-change", { detail: { moteursIsoles } })
    )
  }, [moteursIsoles])

  // Appui long sur MOT. ISOLÉS → valeur suivante (0 → 1 → … → max → 0).
  const handleMoteursIsolesLongPress = React.useCallback(() => {
    setMoteursIsoles((v) => (v >= maxMoteursIsoles ? 0 : v + 1))
  }, [maxMoteursIsoles])

  // Appui long sur MATERIAL → matériel suivant du catalogue (cycle).
  const handleMaterialLongPress = React.useCallback(() => {
    const list = materielCatalog ?? []
    if (list.length === 0) return
    const idx = list.findIndex((m) => m.nom === displayedMateriel)
    setMaterielOverride(list[(idx + 1) % list.length].nom)
  }, [materielCatalog, displayedMateriel])

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
    origenDestino: panelBaseData.origenDestino,
    composicion: displayedComposition,
    moteursIsoles,
    // Matériel : celui du normalisé 2026, ou celui choisi manuellement (cycle appui
    // long). « LINEA » n'est plus affichée (décision 07/08 : ligne supprimée du
    // normalisé et de l'affichage).
    material: displayedMateriel,
    // Pas de repli : si le matériel est hors catalogue, les cases restent vides.
    longitud: derivedLengthMeters,
    masa: derivedMassTons,
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
        onMaterialLongPress={handleMaterialLongPress}
        onMoteursIsolesLongPress={handleMoteursIsolesLongPress}
      />
    </section>
  )
}

