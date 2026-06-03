// src/components/LIM/DemoRunner.tsx
// Injecte les evenements GPS du log de demo en temps reel.
// Demarre apres la sortie du stand-by initial (premier autoScroll actif).

import { useEffect, useRef } from 'react'

type DemoEvent = {
  tMs: number   // temps relatif depuis le debut du log (ms)
  kind: string
  payload: any
}

type Props = {
  /** Evenements GPS du log de demo, deja normalises en tMs relatif. */
  events: DemoEvent[]
  /** True quand le conducteur a demarré (sorti du stand-by initial). */
  running: boolean
}

function dispatch(name: string, detail?: any) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export default function DemoRunner({ events, running }: Props) {
  const startPerfRef = useRef<number | null>(null)
  const cursorRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  // Reset quand running passe a true
  useEffect(() => {
    if (!running) return
    startPerfRef.current = performance.now()
    cursorRef.current = 0

    const tick = () => {
      if (startPerfRef.current === null) return
      const elapsed = performance.now() - startPerfRef.current

      while (
        cursorRef.current < events.length &&
        events[cursorRef.current].tMs <= elapsed
      ) {
        const ev = events[cursorRef.current]
        applyEvent(ev)
        cursorRef.current++
      }

      if (cursorRef.current < events.length) {
        rafRef.current = window.requestAnimationFrame(tick)
      }
      // Quand les evenements sont epuises, on s'arrete — derniere position figee
    }

    rafRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
      startPerfRef.current = null
    }
  }, [running, events])

  return null
}

function applyEvent(ev: DemoEvent) {
  const { kind, payload } = ev
  switch (kind) {
    case 'gps:position':
      dispatch('gps:position', payload)
      return
    case 'gps:state-change': {
      const state = payload?.nextState
      const pk = payload?.pk ?? null
      if (state) dispatch('lim:gps-state', { state, pk, source: 'demo' })
      return
    }
    // ui:autoScroll:toggle ignore — le conducteur gere le Play manuellement
    default:
      return
  }
}
