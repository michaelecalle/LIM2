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

async function handleRedPdf(file: File) {
  try {
    const buf = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: buf })
    const pdf: PDFDocumentProxy = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => { loadingTask.destroy(); reject(new Error('PDF worker timeout')) }, 15_000)
      ),
    ])

    const images: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const dataUrl = await renderPageToDataUrl(page, 1.6)
      if (dataUrl) images.push(dataUrl)
    }

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
