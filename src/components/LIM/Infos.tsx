import React from "react"
import ClassicInfoPanel from "./ClassicInfoPanel"

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
    React.useState<DisplayedTrainNumberState | null>(null)

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

  const panelBaseData = buildPanelData(raw)

  const panelData = {
    ...panelBaseData,
    tren:
      displayedTrainNumberState?.displayedNumber ??
      panelBaseData.tren,
    trenShouldBlink:
      displayedTrainNumberState?.isBlinking ?? false,
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

  const handleTrenDoubleClick = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-manual-toggle-request', {
        detail: {
          source: 'infos_tren',
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
        onTrenDoubleClick={handleTrenDoubleClick}
      />
    </section>
  )
}

