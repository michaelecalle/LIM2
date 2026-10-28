// src/lib/ocrLocalFallback.ts
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api"
// @ts-ignore
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

// Tesseract (offline)
import { createWorker, type Worker } from "tesseract.js"

;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

type MultiResult = {
  pagesText: string[]
  layout: Array<{ page: number; items: any[] }>
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      console.log("[ocrLocalFallback] createWorker(spa) start")

      // garde-fou : si createWorker se bloque (assets/worker), on coupe
      const CREATE_WORKER_TIMEOUT_MS = 20_000

      // 28/10 — fichiers HÉBERGÉS DANS L'APP (public/tess, précachés par le service
      // worker) : avant, worker, noyau wasm et données de langue venaient d'un CDN au
      // premier appel → le moteur « hors ligne » ne démarrait pas sans réseau.
      // Le worker choisit lui-même /tess/tesseract-core-{relaxedsimd|simd|}-lstm.wasm.js.
      const w = await Promise.race([
        createWorker("spa", 1, {
          workerPath: "/tess/worker.min.js",
          corePath: "/tess",
          langPath: "/tess",
          gzip: true,
        }),
        new Promise<Worker>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("createWorker timeout (offline assets?)")),
            CREATE_WORKER_TIMEOUT_MS
          )
        ),
      ])

      console.log("[ocrLocalFallback] createWorker(spa) OK")
      return w
    })()
  }
  return workerPromise
}


/** Worker Tesseract partagé (fiches train scannées, codes LTV). */
export async function getLocalOcrWorker(): Promise<Worker> {
  return getWorker()
}

async function renderPageToCanvas(page: any, scale = 2.0): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D context")

  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

function normalizeText(txt: string): string {
  return (txt ?? "").replace(/\s+/g, " ").trim()
}

function ocrWordsToLayoutItems(words: any[], canvasW: number, canvasH: number, scale: number) {
  // Convertit bbox pixel (origine haut-gauche) -> coords type PDF (origine bas-gauche)
  // ftParser attend des items { text, x, y, w, h }
  return (words || [])
    .filter((w: any) => w && w.text && String(w.text).trim().length > 0 && w.bbox)
    .map((w: any) => {
      const x0 = Number(w.bbox.x0) || 0
      const y0 = Number(w.bbox.y0) || 0
      const x1 = Number(w.bbox.x1) || 0
      const y1 = Number(w.bbox.y1) || 0

      const pxW = Math.max(0, x1 - x0)
      const pxH = Math.max(0, y1 - y0)

      // PDF-like:
      const x = x0 / scale
      const y = (canvasH - y1) / scale
      const ww = pxW / scale
      const hh = pxH / scale

      return {
        text: String(w.text),
        x,
        y,
        w: ww,
        h: hh,
      }
    })
}

export async function ocrFallback(file: File): Promise<string> {
  const ab = await file.arrayBuffer()
  const pdf: PDFDocumentProxy = await (pdfjsLib as any).getDocument({ data: ab }).promise
  const page1 = await pdf.getPage(1)

  const scale = 2.0
  const canvas = await renderPageToCanvas(page1, scale)

  const w = await getWorker()

  console.log("[ocrLocalFallback] recognize(page=1) start")
  const RECOGNIZE_TIMEOUT_MS = 25_000

  const res = await Promise.race([
    w.recognize(canvas),
    new Promise<any>((_, reject) =>
      window.setTimeout(() => reject(new Error("recognize timeout")), RECOGNIZE_TIMEOUT_MS)
    ),
  ])

  console.log("[ocrLocalFallback] recognize(page=1) OK")

  const text = normalizeText(res?.data?.text ?? "")
  return text
}

export async function ocrFallbackMultiWithLayout(
  file: File,
  pageCount: number
): Promise<MultiResult> {
  const ab = await file.arrayBuffer()
  const pdf: PDFDocumentProxy = await (pdfjsLib as any).getDocument({ data: ab }).promise

  const w = await getWorker()

  const pagesText: string[] = []
  const layout: Array<{ page: number; items: any[] }> = []

  const scale = 2.0

  const maxPages = Math.min(pageCount || pdf.numPages, pdf.numPages)

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const canvas = await renderPageToCanvas(page, scale)

    console.log(`[ocrLocalFallback] recognize(page=${i}) start`)
    const RECOGNIZE_TIMEOUT_MS = 25_000

    const res = await Promise.race([
      w.recognize(canvas),
      new Promise<any>((_, reject) =>
        window.setTimeout(
          () => reject(new Error(`recognize timeout page=${i}`)),
          RECOGNIZE_TIMEOUT_MS
        )
      ),
    ])

    console.log(`[ocrLocalFallback] recognize(page=${i}) OK`)

    const text = normalizeText(res?.data?.text ?? "")
    pagesText.push(text)

    const words = res?.data?.words ?? []
    const items = ocrWordsToLayoutItems(words, canvas.width, canvas.height, scale)

    layout.push({ page: i, items })
  }

  return { pagesText, layout }
}
