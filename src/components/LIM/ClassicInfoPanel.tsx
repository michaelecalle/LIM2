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
  /** Nombre de moteurs isolés (0, 1 ou 2) — voir la tuile MOT. ISOLÉS. */
  moteursIsoles?: number
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

// ---------------------------------------------------------------------------
// MOTEURS ISOLÉS — reproduction des deux indications de la cabine :
//   • le pictogramme « moteur isolé » : un M dans un cercle, barré d'une
//     diagonale, avec deux ergots latéraux (les bornes du moteur) — JAUNE ;
//   • le nombre de moteurs isolés, en afficheur SEPT SEGMENTS ROUGE.
// À 0, les deux sont rendus en gris sombre : métaphore du voyant ÉTEINT, qui
// reste visible sur un pupitre sans se lire comme une alerte.
// ---------------------------------------------------------------------------

const MI_ON_PICTO = "#ffd400"   // jaune du pictogramme cabine
const MI_ON_DIGIT = "#ff2020"   // rouge de l'afficheur sept segments
const MI_OFF = "#9ca3af"        // gris « voyant éteint »

function MoteurIsoleIcon({ active }: { active: boolean }) {
  const c = active ? MI_ON_PICTO : MI_OFF
  return (
    <svg viewBox="0 0 100 100" width="26" height="26" aria-hidden="true">
      {/* ergots latéraux (bornes) */}
      <rect x="4" y="43" width="16" height="14" fill={c} />
      <rect x="80" y="43" width="16" height="14" fill={c} />
      {/* cercle */}
      <circle cx="50" cy="50" r="33" fill="none" stroke={c} strokeWidth="8" />
      {/* M */}
      <text
        x="50"
        y="50"
        fill={c}
        fontSize="46"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        M
      </text>
      {/* diagonale barrant le symbole, débordant du cercle */}
      <line x1="10" y1="90" x2="90" y2="10" stroke={c} strokeWidth="8" strokeLinecap="square" />
    </svg>
  )
}

// Segments allumés par chiffre (a=haut, b=haut-droit, c=bas-droit, d=bas,
// e=bas-gauche, f=haut-gauche, g=milieu). Seuls 0, 1 et 2 sont possibles.
const SEVEN_SEG: Record<number, string[]> = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "g", "e", "d"],
}

// ⚠️ 14/08 — afficheur LÉGÈREMENT réduit (20×34 → 17×29) pour gagner de la
// hauteur dans le bloc info. Volontairement modeste : le chiffre reste lisible.
// Il ne s'agit QUE d'un paramétrage applicatif servant à choisir la courbe
// empirique — le vrai nombre de moteurs isolés, information de conduite,
// s'affiche sur le pupitre de la motrice, pas dans cette application.
function SevenSegmentDigit({ value, active }: { value: number; active: boolean }) {
  const on = SEVEN_SEG[value] ?? SEVEN_SEG[0]
  const lit = active ? MI_ON_DIGIT : MI_OFF
  const dim = active ? "rgba(255,32,32,0.12)" : "rgba(156,163,175,0.18)"
  const S = (id: string, points: string) => (
    <polygon key={id} points={points} fill={on.includes(id) ? lit : dim} />
  )
  return (
    <svg viewBox="0 0 40 68" width="17" height="29" aria-hidden="true">
      {S("a", "8,3 32,3 27,9 13,9")}
      {S("b", "33,4 33,30 28,25 28,11")}
      {S("c", "33,38 33,64 28,57 28,43")}
      {S("d", "8,65 32,65 27,59 13,59")}
      {S("e", "7,38 7,64 12,57 12,43")}
      {S("f", "7,4 7,30 12,25 12,11")}
      {S("g", "9,34 13,29 27,29 31,34 27,39 13,39")}
    </svg>
  )
}

export default function ClassicInfoPanel({
  data,
  onTrenClick,
  onTrenLongPress,
  onTrenDoubleClick,
  onCompositionLongPress,
  onMaterialLongPress,
  onMoteursIsolesLongPress,
}: {
  data: InfoData
  onTrenClick?: () => void
  onTrenLongPress?: () => void
  onTrenDoubleClick?: () => void
  onCompositionLongPress?: () => void
  onMaterialLongPress?: () => void
  onMoteursIsolesLongPress?: () => void
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
  }, [D.origenDestino, D.material, D.longitud, D.masa, fechaText])

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
  const compositionLongPressTimerRef = React.useRef<number | null>(null)

  const clearCompositionLongPressTimer = React.useCallback(() => {
    if (compositionLongPressTimerRef.current != null) {
      window.clearTimeout(compositionLongPressTimerRef.current)
      compositionLongPressTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    return () => {
      clearCompositionLongPressTimer()
    }
  }, [clearCompositionLongPressTimer])

  const startCompositionLongPress = React.useCallback(() => {
    if (!onCompositionLongPress) return

    clearCompositionLongPressTimer()

    compositionLongPressTimerRef.current = window.setTimeout(() => {
      compositionLongPressTimerRef.current = null
      onCompositionLongPress()
    }, TREN_LONG_PRESS_DELAY_MS)
  }, [clearCompositionLongPressTimer, onCompositionLongPress])

  const cancelCompositionLongPress = React.useCallback(() => {
    clearCompositionLongPressTimer()
  }, [clearCompositionLongPressTimer])

  // Appui long sur MATERIAL → matériel suivant du catalogue (même patron que la
  // composition ci-dessus). Cycle inerte tant qu'il n'y a qu'un seul matériel.
  const materialLongPressTimerRef = React.useRef<number | null>(null)

  const clearMaterialLongPressTimer = React.useCallback(() => {
    if (materialLongPressTimerRef.current != null) {
      window.clearTimeout(materialLongPressTimerRef.current)
      materialLongPressTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    return () => {
      clearMaterialLongPressTimer()
    }
  }, [clearMaterialLongPressTimer])

  const startMaterialLongPress = React.useCallback(() => {
    if (!onMaterialLongPress) return

    clearMaterialLongPressTimer()

    materialLongPressTimerRef.current = window.setTimeout(() => {
      materialLongPressTimerRef.current = null
      onMaterialLongPress()
    }, TREN_LONG_PRESS_DELAY_MS)
  }, [clearMaterialLongPressTimer, onMaterialLongPress])

  const cancelMaterialLongPress = React.useCallback(() => {
    clearMaterialLongPressTimer()
  }, [clearMaterialLongPressTimer])

  // Appui long sur MOTEURS ISOLÉS → valeur suivante du cycle (même patron).
  const moteursIsolesLongPressTimerRef = React.useRef<number | null>(null)

  const clearMoteursIsolesLongPressTimer = React.useCallback(() => {
    if (moteursIsolesLongPressTimerRef.current != null) {
      window.clearTimeout(moteursIsolesLongPressTimerRef.current)
      moteursIsolesLongPressTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    return () => {
      clearMoteursIsolesLongPressTimer()
    }
  }, [clearMoteursIsolesLongPressTimer])

  const startMoteursIsolesLongPress = React.useCallback(() => {
    if (!onMoteursIsolesLongPress) return

    clearMoteursIsolesLongPressTimer()

    moteursIsolesLongPressTimerRef.current = window.setTimeout(() => {
      moteursIsolesLongPressTimerRef.current = null
      onMoteursIsolesLongPress()
    }, TREN_LONG_PRESS_DELAY_MS)
  }, [clearMoteursIsolesLongPressTimer, onMoteursIsolesLongPress])

  const cancelMoteursIsolesLongPress = React.useCallback(() => {
    clearMoteursIsolesLongPressTimer()
  }, [clearMoteursIsolesLongPressTimer])

  const moteursIsoles = Number(D.moteursIsoles ?? 0)
  const moteursIsolesActifs = moteursIsoles > 0
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
            className={`border-r-2 border-black px-2 py-1 grid place-items-center text-center tile-yellow ${trenShouldBlink ? 'classic-blink-strong' : ''} ${(onTrenClick || handleTrenLongPress) ? 'cursor-pointer' : ''}`}
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

          <div style={{ flex: 1, minWidth: 0 }} className="border-r-2 border-black px-2 py-1 grid place-items-center text-center">
            <div className="text-[18px] font-extrabold leading-6 truncate max-w-full">{D.origenDestino || ''}</div>
          </div>

          <div
            ref={fechaTileRef}
            style={wLastCol ? { width: wLastCol, minWidth: 0, background: yellow } : { flex: 1, minWidth: 0, background: yellow }}
            className={`tile-yellow px-2 py-1 grid place-items-center text-center ${fechaShouldBlink ? 'classic-blink-strong' : ''}`}
          >
            <div className={`text-[18px] font-extrabold leading-6 truncate max-w-full ${fechaShouldBlink ? 'classic-blink-text' : ''}`}>{fechaText}</div>
          </div>
        </div>

        {/* ⚠️ 14/08 — ÉTIQUETTES SUPPRIMÉES (TREN, ORIGEN/DESTINO, FECHA,
            COMPOSICIÓN, MOT. ISOLÉS, MATERIAL, LONGITUD — MASA) pour réduire la
            hauteur du bloc info : le contenu de chaque case est identifiable sans
            elles. Le bloc n'existe qu'à l'écran (le mode secours affiche le
            document source), aucun autre rendu n'est impacté. */}
        <div className="flex items-stretch border-t-2 border-black">
          {/* Logo TGV inOui. ⚠️ 14/08 — la silhouette du train (2e image) a été
              retirée : purement décorative, elle coûtait de la hauteur au bloc info.
              Fond BLANC : le bleu de la cellule venait de l'ancien logo OUIGO. */}
          <div style={{ width: 'var(--w-tren)' }} className="border-r-2 border-black px-2 py-1 flex items-center justify-center">
            <img src="/inoui.png" alt="TGV inOui" className="w-full max-w-[80px] h-auto object-contain" />
          </div>

          <div
            className={`border-r-2 border-black px-2 py-1 grid place-items-center text-center tile-yellow ${onCompositionLongPress ? 'cursor-pointer' : ''}`}
            style={{ background: yellow, flex: '0 0 auto' }}
            onPointerDown={startCompositionLongPress}
            onPointerUp={cancelCompositionLongPress}
            onPointerLeave={cancelCompositionLongPress}
            onPointerCancel={cancelCompositionLongPress}
            onContextMenu={(e) => e.preventDefault()}
            title={onCompositionLongPress ? 'Appui long : basculer la composition UM / US' : undefined}
          >
            <div className="text-[18px] font-extrabold tracking-tight">{(D.composicion || '').toUpperCase()}</div>
          </div>

          {/* MOTEURS ISOLÉS — reproduit les indications de la cabine (pictogramme
              jaune + afficheur sept segments rouge). Éteint (gris) à 0. Le cycle
              est borné par la composition : 1 moteur isolé maximum par rame,
              donc max 1 en US et 2 en UM. */}
          <div
            className={`border-r-2 border-black px-2 py-1 grid place-items-center text-center ${onMoteursIsolesLongPress ? 'cursor-pointer' : ''}`}
            style={{ flex: '0 0 auto' }}
            onPointerDown={startMoteursIsolesLongPress}
            onPointerUp={cancelMoteursIsolesLongPress}
            onPointerLeave={cancelMoteursIsolesLongPress}
            onPointerCancel={cancelMoteursIsolesLongPress}
            onContextMenu={(e) => e.preventDefault()}
            title={onMoteursIsolesLongPress ? 'Appui long : nombre de moteurs isolés' : undefined}
          >
            <div className="flex items-center justify-center gap-1.5">
              <MoteurIsoleIcon active={moteursIsolesActifs} />
              <SevenSegmentDigit value={moteursIsoles} active={moteursIsolesActifs} />
            </div>
          </div>

          <div
            style={{ flex: 1, minWidth: 0 }}
            className={`border-r-2 border-black px-2 py-1 grid place-items-center text-center ${onMaterialLongPress ? 'cursor-pointer' : ''}`}
            onPointerDown={startMaterialLongPress}
            onPointerUp={cancelMaterialLongPress}
            onPointerLeave={cancelMaterialLongPress}
            onPointerCancel={cancelMaterialLongPress}
            onContextMenu={(e) => e.preventDefault()}
            title={onMaterialLongPress ? 'Appui long : matériel suivant' : undefined}
          >
            {/* MATERIAL seul : la ligne « LINEA » n'est plus affichée (décision 07/08,
                ligne supprimée du normalisé et de l'affichage du bloc info). */}
            <div className="text-[18px] font-extrabold uppercase leading-6 truncate max-w-full">
              {(D.material || '').toUpperCase()}
            </div>
          </div>

          <div ref={longitudTileRef} style={wLastCol ? { width: wLastCol, minWidth: 0 } : { flex: 1, minWidth: 0 }} className="px-2 py-1 grid place-items-center text-center">
            <div className="text-[18px] font-extrabold leading-6">{(D.longitud ?? '')} m — {(D.masa ?? '')} t</div>
          </div>
        </div>
      </div>
    </div>
  )
}
