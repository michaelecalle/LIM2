import React from "react"

export type InfoData = {
  tren?: string
  trenPadded?: string
  trenShouldBlink?: boolean
  trenCommitted?: string
  trenPending?: string
  trenPendingActive?: boolean
  type?: string
  origenDestino?: string
  fecha?: string
  composicion?: string
  material?: string
  linea?: string
  longitud?: string | number
  masa?: string | number
  operador?: string
  operadorLogo?: string
}

// -------- FECHA helpers (accept numeric and FR/ES textual long dates) --------
function parseFechaNumeric(fecha?: string) {
  if (!fecha) return null
  const m = fecha.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (!m) return null
  const d = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  const yRaw = parseInt(m[3], 10)
  const y = yRaw < 100 ? 2000 + yRaw : yRaw
  const dt = new Date(y, mo, d)
  return isNaN(dt.getTime()) ? null : dt
}

function parseFechaTextual(fecha?: string) {
  if (!fecha) return null
  const s = fecha
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[,\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  const months: Record<string, number> = {
    // fr
    "janvier":0,"fevrier":1,"février":1,"mars":2,"avril":3,"mai":4,"juin":5,"juillet":6,"aout":7,"août":7,"septembre":8,"octobre":9,"novembre":10,"decembre":11,"décembre":11,
    // es
    "enero":0,"febrero":1,"marzo":2,"abril":3,"mayo":4,"junio":5,"julio":6,"agosto":7,"septiembre":8,"setiembre":8,"octubre":9,"noviembre":10,"diciembre":11
  }

  const re = /(?:(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})\s+([a-záéíóúñçâêîôûäëïöüèàùœ\-]+)\s+(\d{4})/
  const m = s.match(re)
  if (m) {
    const day = parseInt(m[1], 10)
    const moName = m[2].toLowerCase()
    const year = parseInt(m[3], 10)
    const mi = months[moName]
    if (mi != null) {
      const dt = new Date(year, mi, day)
      return isNaN(dt.getTime()) ? null : dt
    }
  }
  return null
}

function parseFechaWide(fecha?: string) {
  return parseFechaNumeric(fecha) || parseFechaTextual(fecha) || (() => {
    if (!fecha) return null
    const t = new Date(fecha)
    return isNaN(t.getTime()) ? null : t
  })()
}

function formatFechaLongFr(fecha?: string): string {
  const dt = parseFechaWide(fecha)
  if (!dt) return String(fecha ?? "")
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(dt)
  } catch {
    return String(fecha ?? "")
  }
}

function isFechaToday(fecha?: string): boolean {
  const dt = parseFechaWide(fecha)
  if (!dt) return false
  const t = new Date()
  return dt.getFullYear() === t.getFullYear() && dt.getMonth() === t.getMonth() && dt.getDate() === t.getDate()
}

export default function ClassicInfoPanel({
  data,
  onTrenClick,
  onTrenLongPress,
  onTrenDoubleClick,
}: {
  data: InfoData
  onTrenClick?: () => void
  onTrenLongPress?: () => void
  onTrenDoubleClick?: () => void
}) {
  const D = data || {}
  const trainDisplay = D.tren ? String(D.tren) : ""
  const trenCommitted = D.trenCommitted ? String(D.trenCommitted) : ""
  const trenPending = D.trenPending ? String(D.trenPending) : ""
  const trenCommittedDisplay = trenCommitted || trainDisplay || '—'
  const trenPendingActive = Boolean(D.trenPendingActive && trenPending)
  const trainMeasureText = trenPendingActive
    ? `${trenCommittedDisplay} → ${trenPending}`
    : (trainDisplay || '—')
  const trenShouldBlink = Boolean(D.trenShouldBlink)
  const fechaText = formatFechaLongFr(D.fecha)
  const fechaShouldBlink = Boolean(parseFechaWide(D.fecha)) && !isFechaToday(D.fecha)

  const yellow = 'linear-gradient(180deg,#ffff00 0%,#fffda6 100%)'
  const blue = 'linear-gradient(180deg,#01a5ce 0%,#7ed9ea 120%)'

  // Mesures pour TREN et TYPE (auto), appliquées via variables CSS
  const trenRef = React.useRef<HTMLDivElement | null>(null)
  const typeRef = React.useRef<HTMLDivElement | null>(null)
  const [wTren, setWTren] = React.useState<number>(120) // fallback
  const [wType, setWType] = React.useState<number>(160) // fallback
  const fechaTileRef = React.useRef<HTMLDivElement | null>(null)
  const longitudTileRef = React.useRef<HTMLDivElement | null>(null)
  const [wLastCol, setWLastCol] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const measure = () => {
      const f = fechaTileRef.current?.offsetWidth || 0
      const l = longitudTileRef.current?.offsetWidth || 0
      if (f && l) setWLastCol(Math.min(f, l))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [D.origenDestino, D.material, D.linea, D.longitud, D.masa, fechaText])

  React.useLayoutEffect(() => {
    const pad = 24
    const t = trenRef.current?.scrollWidth || 0
    const ty = typeRef.current?.scrollWidth || 0
    if (t) setWTren(t + pad)
    if (ty) setWType(ty + pad)
  }, [trainMeasureText, D.type])

  const [isNight, setIsNight] = React.useState<boolean>(false)
  React.useEffect(() => {
    const isN = () => {
      const de = document.documentElement
      const bd = document.body
      return (
        de.classList.contains('dark') ||
        bd.classList.contains('dark') ||
        de.getAttribute('data-theme') === 'night' ||
        bd.getAttribute('data-theme') === 'night'
      )
    }
    setIsNight(isN())
    const obs = new MutationObserver(() => setIsNight(isN()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class','data-theme'] })
    obs.observe(document.body, { attributes: true, attributeFilter: ['class','data-theme'] })
    return () => obs.disconnect()
  }, [])

  const trenLongPressTimerRef = React.useRef<number | null>(null)
  const trenLongPressTriggeredRef = React.useRef(false)
  const TREN_LONG_PRESS_DELAY_MS = 500

  const handleTrenLongPress = onTrenLongPress ?? onTrenDoubleClick

  const clearTrenLongPressTimer = React.useCallback(() => {
    if (trenLongPressTimerRef.current != null) {
      window.clearTimeout(trenLongPressTimerRef.current)
      trenLongPressTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    return () => {
      clearTrenLongPressTimer()
    }
  }, [clearTrenLongPressTimer])

  const startTrenLongPress = React.useCallback(() => {
    if (!handleTrenLongPress) return

    trenLongPressTriggeredRef.current = false
    clearTrenLongPressTimer()

    trenLongPressTimerRef.current = window.setTimeout(() => {
      trenLongPressTimerRef.current = null
      trenLongPressTriggeredRef.current = true
      handleTrenLongPress()
    }, TREN_LONG_PRESS_DELAY_MS)
  }, [clearTrenLongPressTimer, handleTrenLongPress])

  const cancelTrenLongPress = React.useCallback(() => {
    clearTrenLongPressTimer()
  }, [clearTrenLongPressTimer])

  const handleTrenTileClick = React.useCallback(() => {
    if (trenLongPressTriggeredRef.current) {
      trenLongPressTriggeredRef.current = false
      return
    }

    onTrenClick?.()
  }, [onTrenClick])

  return (
    <div className="select-none">
      <style>{`
        @keyframes fechaPulseClassicBg {
          0%, 55% { background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%); }
          62%    { background: linear-gradient(180deg,#fff570 0%,#fffb9a 100%); }
          100%   { background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%); }
        }
        @keyframes fechaTextBlinkClassic {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: .35; }
        }
        .classic-blink-strong { animation: fechaPulseClassicBg 2s ease-in-out infinite; }
        .classic-blink-text { animation: fechaTextBlinkClassic 1s steps(2, end) infinite; will-change: opacity; }
        @media (prefers-reduced-motion: reduce) {
          .classic-blink-strong, .classic-blink-text { animation: none !important; }
        }

        .classic-root.classic-night { background:#111214; color:#e4e4e7; border-color:#fafafa !important; }
        .classic-root.classic-night, .classic-root.classic-night * { border-color:#e5e7eb; }
        .classic-root.classic-night .tile-yellow, .classic-root.classic-night .tile-yellow * { color:#111111 !important; }
        .classic-root.classic-night .text-zinc-600 { color:#9ca3af; }
      `}</style>

      <div
        className={`classic-root ${isNight ? 'classic-night' : ''} border-2 border-black text-zinc-900 bg-white`}
        style={{
          ['--w-tren' as any]: `${wTren}px`,
          ['--w-type' as any]: `${wType}px`,
        }}
      >
        <div className="flex items-stretch">
          <div
            style={{ width: 'var(--w-tren)', background: yellow }}
            className={`border-r-2 border-black px-2 py-1 tile-yellow ${trenShouldBlink ? 'classic-blink-strong' : ''} ${(onTrenClick || handleTrenLongPress) ? 'cursor-pointer' : ''}`}
            onPointerDown={startTrenLongPress}
            onPointerUp={cancelTrenLongPress}
            onPointerLeave={cancelTrenLongPress}
            onPointerCancel={cancelTrenLongPress}
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleTrenTileClick}
            title={
              handleTrenLongPress
                ? 'Appui long : demander le changement de numéro affiché'
                : onTrenClick
                  ? 'Valider le changement de numéro affiché'
                  : undefined
            }
          >
            <div className="text-[11px] font-semibold leading-none">TREN</div>
            <div
              ref={trenRef}
              className="text-[22px] leading-6 tracking-tight font-extrabold whitespace-nowrap"
            >
              {trenPendingActive ? (
                <>
                  <span>{trenCommittedDisplay}</span>
                  <span className="mx-1">→</span>
                  <span className={trenShouldBlink ? 'classic-blink-text' : ''}>
                    {trenPending}
                  </span>
                </>
              ) : (
                <span className={trenShouldBlink ? 'classic-blink-text' : ''}>
                  {trainDisplay || '—'}
                </span>
              )}
            </div>
          </div>

          <div style={{ width: 'var(--w-type)' }} className="border-r-2 border-black px-2 py-1 grid place-items-center text-center">
            <div ref={typeRef} className="text-[22px] font-extrabold leading-tight">{D.type || ''}</div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }} className="border-r-2 border-black px-2 py-1">
            <div className="text-[12px] font-semibold leading-none">ORIGEN/DESTINO :</div>
            <div className="text-[16px] font-extrabold leading-5 truncate">{D.origenDestino || ''}</div>
          </div>

          <div
            ref={fechaTileRef}
            style={wLastCol ? { width: wLastCol, minWidth: 0, background: yellow } : { flex: 1, minWidth: 0, background: yellow }}
            className={`tile-yellow px-2 py-1 ${fechaShouldBlink ? 'classic-blink-strong' : ''}`}
          >
            <div className="text-[11px] font-semibold leading-none">FECHA</div>
            <div className={`text-[16px] font-extrabold leading-5 truncate ${fechaShouldBlink ? 'classic-blink-text' : ''}`}>{fechaText}</div>
          </div>
        </div>

        <div className="flex items-stretch border-t-2 border-black">
          <div style={{ width: 'var(--w-tren)', background: blue }} className="border-r-2 border-black px-2 py-1 grid place-items-center">
            {D.operadorLogo ? (<img src={D.operadorLogo} alt="OUIGO" className="w-10 h-10 object-contain"/>) : null}
          </div>

          <div className="border-r-2 border-black px-2 py-1 text-center tile-yellow" style={{ background: yellow, flex: '0 0 auto' }}>
            <div className="text-[12px] font-semibold leading-none">COMPOSICIÓN</div>
            <div className="mt-0.5 text-[18px] font-extrabold tracking-tight">{(D.composicion || '').toUpperCase()}</div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }} className="border-r-2 border-black px-2 py-1">
            <div className="text-[16px] font-extrabold uppercase leading-5">
              MATERIAL: {(D.material || '').toUpperCase()}
            </div>
            <div className="text-[16px] font-extrabold uppercase leading-5 mt-0.5">
              LINEA: {(D.linea || '').toUpperCase()}
            </div>
          </div>

          <div ref={longitudTileRef} style={wLastCol ? { width: wLastCol, minWidth: 0 } : { flex: 1, minWidth: 0 }} className="px-2 py-1">
            <div className="text-[12px] text-zinc-600 font-semibold leading-none">LONGITUD (M) — MASA (T)</div>
            <div className="text-[18px] font-extrabold leading-6 mt-0.5">{(D.longitud ?? '')} m — {(D.masa ?? '')} t</div>
          </div>
        </div>
      </div>
    </div>
  )
}
