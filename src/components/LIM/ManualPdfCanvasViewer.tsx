// src/components/LIM/ManualPdfCanvasViewer.tsx
// Visionneuse PDF canvas pour les documents LIM (manuel, Guia BSN, livret FT).
//
// ⚠️ RÉÉCRITE le 14/08 — RENDU CONTINU (demande utilisateur, manuel + Guia + livret).
// Avant : une seule page affichée à la fois, remplacée à chaque changement.
// Arrivé en bas d'une page, le geste chargeait la suivante « à la place » en
// remettant le défilement à zéro : on se retrouvait visuellement au même endroit
// au lieu de voir la page suivante apparaître DESSOUS. Désormais toutes les
// pages sont empilées dans un seul conteneur défilant — comme le mode secours
// LTV le fait déjà avec ses images — et la lecture est linéaire, sans rupture.
//
// Le contrat `page` / `onPageChange` est CONSERVÉ (le sommaire du manuel et
// l'index de pages du livret FT s'en servent), mais sa sémantique change :
//   - `page` en entrée = page vers laquelle DÉFILER (au lieu de « la seule affichée ») ;
//   - `onPageChange`   = remonte la page actuellement VISIBLE pendant le défilement.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { logTestEvent } from '../../lib/testLogger'

type ManualPdfCanvasViewerProps = {
  pdfUrl: string
  page: number
  onPageChange: (page: number) => void
  /** Appliquer l'inversion couleurs en mode nuit (true par défaut).
   *  Passer false pour les documents où les couleurs doivent être fidèles (ex. Guia BSN). */
  applyDarkInvert?: boolean
}

export default function ManualPdfCanvasViewer({
  pdfUrl,
  page,
  onPageChange,
  applyDarkInvert = true,
}: ManualPdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Array<HTMLDivElement | null>>([])
  const onPageChangeRef = useRef(onPageChange)
  // Page demandée par le parent, pas encore honorée : évite de re-sauter à
  // chaque re-rendu et de lutter contre le défilement manuel du conducteur.
  const pendingScrollRef = useRef<number | null>(null)
  const lastReportedPageRef = useRef(0)

  const [pageCount, setPageCount] = useState(0)
  const [viewerWidth, setViewerWidth] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renderedCount, setRenderedCount] = useState(0)

  useEffect(() => {
    onPageChangeRef.current = onPageChange
  }, [onPageChange])

  // ── Largeur disponible (re-rendu des pages si elle change) ────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateWidth = () => setViewerWidth(el.clientWidth)
    updateWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Chargement + rendu de TOUTES les pages ────────────────────────────────
  useEffect(() => {
    if (!pdfUrl || viewerWidth <= 0) return
    let cancelled = false
    let loadingTask: any = null
    let loadedDoc: any = null

    setLoading(true)
    setError(null)
    setRenderedCount(0)

    void (async () => {
      try {
        loadingTask = pdfjsLib.getDocument(pdfUrl)
        loadedDoc = await loadingTask.promise
        if (cancelled) return

        const total =
          typeof loadedDoc.numPages === 'number' && Number.isFinite(loadedDoc.numPages)
            ? loadedDoc.numPages
            : 1
        setPageCount(total)
        pageRefs.current = new Array(total).fill(null)

        const availableWidth = Math.max(260, viewerWidth - 24)
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)

        // Rendu séquentiel, une seule passe au chargement. Le document reste
        // ensuite entièrement disponible, y compris hors couverture.
        for (let p = 1; p <= total; p++) {
          if (cancelled) return
          const pdfPage = await loadedDoc.getPage(p)
          const baseViewport = pdfPage.getViewport({ scale: 1 })
          const scale = Math.max(0.25, Math.min(3, availableWidth / baseViewport.width))
          const viewport = pdfPage.getViewport({ scale })

          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas indisponible')
          canvas.width = Math.floor(viewport.width * outputScale)
          canvas.height = Math.floor(viewport.height * outputScale)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.className = 'mx-auto block shadow-sm'
          canvas.style.backgroundColor = '#ffffff'
          canvas.style.filter =
            applyDarkInvert && document.documentElement.classList.contains('dark')
              ? 'invert(1) hue-rotate(180deg)'
              : 'none'

          await pdfPage.render({
            canvasContext: context,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise
          if (cancelled) return

          const host = pageRefs.current[p - 1]
          if (host) host.replaceChildren(canvas)
          setRenderedCount(p)
        }
      } catch (err: any) {
        if (cancelled) return
        console.warn('[ManualPdfCanvasViewer] Chargement impossible', err)
        setError(
          err?.message
            ? `Chargement du document impossible : ${err.message}`
            : 'Chargement du document impossible.'
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      try { loadedDoc?.destroy?.() } catch {}
      try { loadingTask?.destroy?.() } catch {}
    }
  }, [pdfUrl, viewerWidth, applyDarkInvert])

  // ── Aller à la page demandée par le parent (sommaire, index du livret) ────
  useEffect(() => {
    if (!Number.isFinite(page) || page < 1) return
    pendingScrollRef.current = page
  }, [page])

  useEffect(() => {
    const wanted = pendingScrollRef.current
    if (wanted == null || pageCount === 0) return
    // On attend que la page visée soit rendue (le rendu est séquentiel).
    const target = Math.min(wanted, pageCount)
    if (renderedCount < target) return
    const host = pageRefs.current[target - 1]
    const box = containerRef.current
    if (!host || !box) return
    pendingScrollRef.current = null
    box.scrollTop = Math.max(0, host.offsetTop - 8)
  }, [page, pageCount, renderedCount])

  // ── Page visible → remontée au parent ─────────────────────────────────────
  const handleScroll = useCallback(() => {
    const box = containerRef.current
    if (!box || pageCount === 0) return
    const mid = box.scrollTop + box.clientHeight / 3
    let current = 1
    for (let i = 0; i < pageCount; i++) {
      const host = pageRefs.current[i]
      if (host && host.offsetTop <= mid) current = i + 1
      else break
    }
    if (current !== lastReportedPageRef.current) {
      lastReportedPageRef.current = current
      onPageChangeRef.current(current)
    }
  }, [pageCount])

  const goToPage = (nextPage: number) => {
    const total = pageCount > 0 ? pageCount : 1
    const safePage = Math.max(1, Math.min(total, Math.trunc(nextPage)))
    logTestEvent('ui:manual:page-nav', {
      source: 'manual_canvas_viewer',
      from: page,
      to: safePage,
      pageCount,
    })
    const host = pageRefs.current[safePage - 1]
    const box = containerRef.current
    if (host && box) box.scrollTop = Math.max(0, host.offsetTop - 8)
    onPageChange(safePage)
  }

  const currentPage = Math.max(1, Math.min(pageCount || 1, page || 1))
  const canGoPrevious = currentPage > 1 && !loading
  const canGoNext = pageCount > 0 && currentPage < pageCount && !loading

  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div
      className="h-full min-h-0 flex flex-col"
      style={{
        backgroundColor: isDark ? '#09090b' : '#f4f4f5',
        color: isDark ? '#f4f4f5' : '#18181b',
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b"
        style={{
          backgroundColor: isDark ? '#18181b' : '#ffffff',
          borderColor: isDark ? '#3f3f46' : '#e4e4e7',
        }}
      >
        <button
          type="button"
          disabled={!canGoPrevious}
          onClick={() => goToPage(currentPage - 1)}
          className={
            canGoPrevious
              ? 'h-8 px-3 text-xs rounded-md bg-zinc-200/80 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 font-semibold'
              : 'h-8 px-3 text-xs rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 font-semibold cursor-not-allowed'
          }
        >
          Page précédente
        </button>
        <div className="min-w-0 text-center">
          <div className="text-xs font-semibold tabular-nums">
            Page {currentPage}{pageCount > 0 ? ` / ${pageCount}` : ''}
          </div>
          <div className="text-[11px] opacity-60">
            {loading
              ? `Chargement… ${renderedCount}${pageCount ? `/${pageCount}` : ''}`
              : 'Document complet — défilement continu'}
          </div>
        </div>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => goToPage(currentPage + 1)}
          className={
            canGoNext
              ? 'h-8 px-3 text-xs rounded-md bg-zinc-200/80 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 font-semibold'
              : 'h-8 px-3 text-xs rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 font-semibold cursor-not-allowed'
          }
        >
          Page suivante
        </button>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto p-3"
        style={{ backgroundColor: isDark ? '#000000' : '#e4e4e7' }}
      >
        {error && (
          <div className="mx-auto max-w-xl rounded-xl bg-red-50 border border-red-200 text-red-700 p-3 text-xs">
            {error}
          </div>
        )}
        {!error && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: Math.max(pageCount, 0) }).map((_, i) => (
              <div
                key={i}
                ref={(el) => { pageRefs.current[i] = el }}
                className="flex justify-center"
              />
            ))}
          </div>
        )}
        {!error && loading && pageCount === 0 && (
          <div className="mx-auto max-w-xl rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 text-xs text-center">
            Chargement du document…
          </div>
        )}
      </div>
    </div>
  )
}
