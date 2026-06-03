// src/components/LIM/DemoTouchIndicator.tsx
// Affiche un cercle anime a chaque clic/touch, uniquement en mode demo.
// pointer-events: none → n'interfere pas avec les interactions.

import { useEffect, useRef } from 'react'

type Ripple = { id: number; x: number; y: number }

type Props = { active: boolean }

export default function DemoTouchIndicator({ active }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    if (!active) return

    const handler = (e: PointerEvent) => {
      const container = containerRef.current
      if (!container) return

      const id = nextId.current++
      const x = e.clientX
      const y = e.clientY

      // Creer le cercle
      const circle = document.createElement('div')
      circle.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'border-radius:50%',
        'background:rgba(251,191,36,0.7)',
        'border:2px solid rgba(180,130,0,0.8)',
        'width:36px',
        'height:36px',
        'transform:translate(-50%,-50%) scale(0)',
        'transition:transform 0.15s ease-out, opacity 0.5s ease-out 0.15s',
        'z-index:999999',
        `left:${x}px`,
        `top:${y}px`,
      ].join(';')

      container.appendChild(circle)

      // Declencher l'animation
      requestAnimationFrame(() => {
        circle.style.transform = 'translate(-50%,-50%) scale(1)'
        circle.style.opacity = '1'
        setTimeout(() => {
          circle.style.opacity = '0'
          setTimeout(() => {
            if (container.contains(circle)) container.removeChild(circle)
          }, 550)
        }, 150)
      })
    }

    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [active])

  if (!active) return null

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 999998,
      }}
    />
  )
}
