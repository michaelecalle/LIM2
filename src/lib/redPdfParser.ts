// src/lib/redPdfParser.ts
//
// Rôle : dédié au MODE ROUGE
// - écoute l'événement "lim:pdf-raw" (PDF brut envoyé par App/TitleBar)
// - ouvre le PDF avec pdf.js
// - génère une image (dataURL) pour chaque page
// - renvoie tout ça dans un event "lim:pdf-page-images" consommé par App.tsx
//
// Important : on ne touche pas au ltvParser, c’est séparé.

import * as pdfjsLib from "pdfjs-dist"

// @ts-ignore – même principe que dans ltvParser
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy
type PDFPageProxy = pdfjsLib.PDFPageProxy

async function renderPageToDataUrl(page: PDFPageProxy, scale = 1.5): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  canvas.width = viewport.width
  canvas.height = viewport.height
  if (!ctx) return ""
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL("image/png")
}

// Rend un PDF (octets) en une image (dataURL) par page. Réutilisable hors mode rouge
// (ex. affichage du LTV en mode secours, qui ne peut PAS passer par une iframe sur iOS).
export async function renderPdfDataToImages(data: ArrayBuffer, scale = 1.6): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument({ data })
  const pdf: PDFDocumentProxy = await Promise.race([
    loadingTask.promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => { loadingTask.destroy(); reject(new Error('PDF worker timeout')) }, 15_000)
    ),
  ])

  const images: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const dataUrl = await renderPageToDataUrl(page, scale)
    if (dataUrl) images.push(dataUrl)
  }
  return images
}

/**
 * Localise la section « LÍNEA 050 » dans un PDF LTV (demande du 12/08 : ouvrir
 * le mode secours directement sur la partie utile, pas sur la page 1).
 *
 * Réutilise EXACTEMENT le motif éprouvé du parseur LTV (`ltvPdfParser.ts`) :
 * `L.{0,4}NEA\s+050`, volontairement tolérant car pdf.js restitue « LÍNEA » de
 * façon variable selon l'encodage.
 *
 * Renvoie la page (1-indexée) et la position VERTICALE en FRACTION de la hauteur
 * de page (0 = haut, 1 = bas) — pas en pixels : les pages sont affichées en
 * largeur fluide, donc leur hauteur à l'écran varie. Null si non trouvée.
 */
export async function findLinea050Anchor(
  data: ArrayBuffer
): Promise<{ page: number; yRatio: number } | null> {
  const loadingTask = pdfjsLib.getDocument({ data })
  try {
    const pdf: PDFDocumentProxy = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => { loadingTask.destroy(); reject(new Error('PDF worker timeout')) }, 15_000)
      ),
    ])

    const RE_LINEA_050 = /L.{0,4}NEA\s*050/i

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const height = page.getViewport({ scale: 1 }).height

      for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
        const txt = (item?.str ?? '').trim()
        if (!txt || !RE_LINEA_050.test(txt)) continue

        // transform[5] = y en repère PDF (origine EN BAS) → fraction depuis le HAUT.
        const y = Array.isArray(item.transform) ? item.transform[5] : null
        const yRatio =
          typeof y === 'number' && Number.isFinite(y) && height > 0
            ? Math.min(1, Math.max(0, (height - y) / height))
            : 0
        return { page: p, yRatio }
      }
    }
    return null
  } catch {
    return null
  }
}

async function handleRedPdf(file: File) {
  try {
    const buf = await file.arrayBuffer()
    const images = await renderPdfDataToImages(buf, 1.6)

    // on garde la compat avec ce qu’écoute App.tsx
    const evt = new CustomEvent("lim:pdf-page-images", {
      detail: { images },
    })
    window.dispatchEvent(evt)

    console.log("[redPdfParser] PDF rendu en images =", images.length, "page(s)")
  } catch (err) {
    console.warn("[redPdfParser] erreur de rendu PDF rouge", err)
    const evt = new CustomEvent("lim:pdf-page-images", {
      detail: { images: [] },
    })
    window.dispatchEvent(evt)
  }
}

function setup() {
  console.log("[redPdfParser] module loaded / écoute lim:pdf-raw")

  const onRaw = (e: Event) => {
    const ce = e as CustomEvent<{ file?: File }>
    const file = ce.detail?.file
    if (file) {
      void handleRedPdf(file)
    }
  }

  window.addEventListener("lim:pdf-raw", onRaw as EventListener)
}

setup()
