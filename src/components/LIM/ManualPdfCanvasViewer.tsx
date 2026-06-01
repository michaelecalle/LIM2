// src/components/LIM/ManualPdfCanvasViewer.tsx
// Visionneuse PDF canvas pour le manuel utilisateur LIM,
// extraite de TitleBar.tsx pour alléger ce fichier.

import { useEffect, useRef, useState } from 'react'
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<any>(null)
  const onPageChangeRef = useRef(onPageChange)

  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [pageCount, setPageCount] = useState(0)
  const [viewerWidth, setViewerWidth] = useState(0)
  const [loading, setLoading] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onPageChangeRef.current = onPageChange
  }, [onPageChange])

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

  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    let loadingTask: any = null
    let loadedDoc: any = null
    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setPageCount(0)
    ;(async () => {
      try {
        loadingTask = pdfjsLib.getDocument(pdfUrl)
        loadedDoc = await loadingTask.promise
        if (cancelled) return
        const totalPages =
          typeof loadedDoc.numPages === 'number' && Number.isFinite(loadedDoc.numPages)
            ? loadedDoc.numPages
            : 1
        setPdfDoc(loadedDoc)
        setPageCount(totalPages)
        if (page > totalPages) onPageChangeRef.current(totalPages)
      } catch (err: any) {
        if (cancelled) return
        console.warn('[ManualPdfCanvasViewer] Chargement impossible', err)
        setError(
          err?.message
            ? `Chargement du manuel impossible : ${err.message}`
            : 'Chargement du manuel impossible.'
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      try { renderTaskRef.current?.cancel?.() } catch {}
      try { loadedDoc?.destroy?.() } catch {}
      try { loadingTask?.destroy?.() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl])

  useEffect(() => {
    if (!pdfDoc) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    ;(async () => {
      setRendering(true)
      setError(null)
      try {
        try { renderTaskRef.current?.cancel?.() } catch {}
        const totalPages =
          typeof pdfDoc.numPages === 'number' && Number.isFinite(pdfDoc.numPages)
            ? pdfDoc.numPages
            : 1
        const safePage = Math.max(1, Math.min(totalPages, Math.trunc(page || 1)))
        if (safePage !== page) {
          onPageChangeRef.current(safePage)
          return
        }
        const pdfPage = await pdfDoc.getPage(safePage)
        if (cancelled) return
        const containerWidth =
          viewerWidth > 0 ? viewerWidth : containerRef.current?.clientWidth ?? 800
        const availableWidth = Math.max(260, containerWidth - 24)
        const baseViewport = pdfPage.getViewport({ scale: 1 })
        const scale = Math.max(0.25, Math.min(3, availableWidth / baseViewport.width))
        const viewport = pdfPage.getViewport({ scale })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas indisponible')
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)
        const renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        })
        renderTaskRef.current = renderTask
        await renderTask.promise
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException') return
        if (cancelled) return
        console.warn('[ManualPdfCanvasViewer] Rendu impossible', err)
        setError(
          err?.message
            ? `Affichage de la page impossible : ${err.message}`
            : 'Affichage de la page impossible.'
        )
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
      try { renderTaskRef.current?.cancel?.() } catch {}
    }
  }, [pdfDoc, page, viewerWidth])

  const goToPage = (nextPage: number) => {
    const totalPages = pageCount > 0 ? pageCount : 1
    const safePage = Math.max(1, Math.min(totalPages, Math.trunc(nextPage)))
    logTestEvent('ui:manual:page-nav', {
      source: 'manual_canvas_viewer',
      from: page,
      to: safePage,
      pageCount,
    })
    onPageChange(safePage)
  }

  const canGoPrevious = page > 1 && !loading
  const canGoNext = pageCount > 0 && page < pageCount && !loading

  return (
    <div
      className="h-full min-h-0 flex flex-col"
      style={{
        backgroundColor: document.documentElement.classList.contains('dark') ? '#09090b' : '#f4f4f5',
        color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b"
        style={{
          backgroundColor: document.documentElement.classList.contains('dark') ? '#18181b' : '#ffffff',
          borderColor: document.documentElement.classList.contains('dark') ? '#3f3f46' : '#e4e4e7',
        }}
      >
        <button
          type="button"
          disabled={!canGoPrevious}
          onClick={() => goToPage(page - 1)}
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
            Page {page}{pageCount > 0 ? ` / ${pageCount}` : ''}
          </div>
          <div className="text-[11px] opacity-60">
            {loading ? 'Chargement du manuel…' : rendering ? 'Rendu de la page…' : 'Manuel utilisateur LIM'}
          </div>
        </div>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => goToPage(page + 1)}
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
        className="min-h-0 flex-1 overflow-auto p-3"
        style={{
          backgroundColor: document.documentElement.classList.contains('dark') ? '#000000' : '#e4e4e7',
        }}
      >
        {error && (
          <div className="mx-auto max-w-xl rounded-xl bg-red-50 border border-red-200 text-red-700 p-3 text-xs">
            {error}
          </div>
        )}
        {!error && loading && (
          <div className="mx-auto max-w-xl rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 text-xs text-center">
            Chargement du manuel…
          </div>
        )}
        {!error && (
          <canvas
            ref={canvasRef}
            className="mx-auto block shadow-sm"
            style={{
              backgroundColor: '#ffffff',
              filter: applyDarkInvert && document.documentElement.classList.contains('dark')
                ? 'invert(1) hue-rotate(180deg)'
                : 'none',
            }}
          />
        )}
      </div>
    </div>
  )
}
