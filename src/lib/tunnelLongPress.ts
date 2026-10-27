// src/lib/tunnelLongPress.ts
// 27/10 — Appui long sur une bande de tunnel (vues verticale ET horizontale).
//
// Les bandes restent en `pointer-events: none` : on écoute le conteneur qui les
// porte et on teste nous-mêmes si le doigt est sur une bande. Les gestes existants
// (défilement, appuis courts) ne changent donc pas. Si le doigt bouge de plus de
// MOVE_TOLERANCE_PX, c'est un défilement → annulé. Après un appui long, le clic
// qui suit est avalé pour ne pas déclencher l'action habituelle de l'appui court.

import { useCallback, useRef } from 'react'
import type React from 'react'

export const TUNNEL_LONG_PRESS_MS = 600
/** Événement émis (detail.id = id de TUNNEL_ZONES_PKINTERNAL), écouté par TunelesViewer. */
export const TUNNEL_LONG_PRESS_EVENT = 'lim:tunnel-long-press'
const MOVE_TOLERANCE_PX = 10

/** Rend l'id du tunnel sous le point (coordonnées écran), ou null. */
export type TunnelHitTest = (clientX: number, clientY: number) => string | null

export function useTunnelLongPress(hitTest: TunnelHitTest) {
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const cancel = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    startRef.current = null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    cancel()
    firedRef.current = false
    const id = hitTest(e.clientX, e.clientY)
    if (!id) return
    startRef.current = { x: e.clientX, y: e.clientY }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      startRef.current = null
      firedRef.current = true
      window.dispatchEvent(new CustomEvent(TUNNEL_LONG_PRESS_EVENT, { detail: { id } }))
    }, TUNNEL_LONG_PRESS_MS)
  }, [hitTest, cancel])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = startRef.current
    if (!s) return
    if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE_PX) cancel()
  }, [cancel])

  // Clic consécutif à un appui long : avalé (phase de capture, avant les
  // gestionnaires existants du conteneur et de ses enfants).
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!firedRef.current) return
    firedRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Menu contextuel / loupe iOS déclenchés par l'appui long : bloqués sur un tunnel.
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (firedRef.current || timerRef.current != null) e.preventDefault()
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
    onContextMenu,
  }
}
