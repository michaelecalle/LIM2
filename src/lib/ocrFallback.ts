/* src/lib/ocrFallback.ts — compat export
   Exporte trois fonctions :
   - ocrFallback(file): OCR Vision 1 page (compat avec limParser v5.1)
   - ocrFallbackMulti(file, maxPages): OCR Vision multi-pages (TEXTE SEUL, compat)
   - ocrFallbackMultiWithLayout(file, maxPages):
       OCR multi-pages avec TEXTE + LAYOUT (mots positionnés)
*/

import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

function norm(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function renderPageToBase64Jpeg(
  pdf: PDFDocumentProxy,
  pageNo: number
): Promise<string> {
  const page = await pdf.getPage(pageNo)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: ctx as any, viewport }).promise
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92)
  return dataUrl.replace(/^data:image\/jpeg;base64,/, "")
}

// === Types pour le layout OCR (mots positionnés) =====================

export type OcrWordItem = {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export type OcrLayoutByPage = {
  page: number
  items: OcrWordItem[]
}

// === Fonction interne partagée: OCR Vision multi-pages ===============
//
// Retourne:
//   - pagesText: texte brut par page (normalisé)
//   - layout:    pour chaque page, les mots + bounding boxes
//
async function ocrFallbackMultiInternal(
  file: File,
  maxPages = 2
): Promise<{ pagesText: string[]; layout: OcrLayoutByPage[] }> {
  const apiKey = import.meta.env.VITE_GOOGLE_VISION_API_KEY as
    | string
    | undefined
  if (!apiKey) {
    console.warn("[OCR ONLINE DIAG] missing VITE_GOOGLE_VISION_API_KEY")
    return { pagesText: [], layout: [] }
  }

  try {
    const ab = await file.arrayBuffer()
    const pdf: PDFDocumentProxy = await pdfjsLib.getDocument({ data: ab }).promise
    const pages = Math.min(pdf.numPages, Math.max(1, maxPages))

    const pagesText: string[] = []
    const layout: OcrLayoutByPage[] = []

    for (let i = 1; i <= pages; i++) {
      const base64 = await renderPageToBase64Jpeg(pdf, i)
      const body = {
        requests: [
          {
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            image: { content: base64 },
            imageContext: { languageHints: ["es", "fr"] },
          },
        ],
      }

      const resp = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      if (!resp.ok) {
        let bodyPreview = ""

        try {
          bodyPreview = (await resp.text()).slice(0, 500)
        } catch {
          bodyPreview = ""
        }

        console.warn("[OCR ONLINE DIAG] http-error", {
          page: i,
          status: resp.status,
          statusText: resp.statusText,
          bodyPreview,
        })

        pagesText.push("")
        layout.push({ page: i, items: [] })
        continue
      }

      const json = await resp.json()
      const response0 = json?.responses?.[0]
      const annotation = response0?.fullTextAnnotation
      const text: string | undefined = annotation?.text
      const normalizedText = text ? norm(text) : ""

      console.log("[OCR ONLINE DIAG] response", {
        page: i,
        hasError: !!response0?.error,
        error: response0?.error ?? null,
        textLength: normalizedText.length,
        textPreview: normalizedText.slice(0, 500),
      })

      pagesText.push(normalizedText)

      // ---- Récupération du layout (mots + bounding boxes) ----
      const pageAnn = annotation?.pages?.[0]
      const items: OcrWordItem[] = []

      if (pageAnn?.blocks) {
        for (const block of pageAnn.blocks) {
          const paragraphs = block.paragraphs || []
          for (const par of paragraphs) {
            const words = par.words || []
            for (const word of words) {
              const symbols = word.symbols || []
              const wordText = symbols
                .map((s: any) => (s?.text ?? "").toString())
                .join("")
                .trim()
              if (!wordText) continue

              const verts = (word.boundingBox?.vertices || []) as Array<{
                x?: number
                y?: number
              }>

              if (!verts.length) continue

              let minX = Infinity
              let maxX = -Infinity
              let minY = Infinity
              let maxY = -Infinity

              for (const v of verts) {
                const vx = typeof v.x === "number" ? v.x : 0
                const vy = typeof v.y === "number" ? v.y : 0
                if (vx < minX) minX = vx
                if (vx > maxX) maxX = vx
                if (vy < minY) minY = vy
                if (vy > maxY) maxY = vy
              }

              if (
                !isFinite(minX) ||
                !isFinite(maxX) ||
                !isFinite(minY) ||
                !isFinite(maxY)
              ) {
                continue
              }

              items.push({
                text: wordText,
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY,
              })
            }
          }
        }
      }

      layout.push({
        page: i,
        items,
      })
    }

    return { pagesText, layout }
  } catch (err) {
    console.warn("[OCR ONLINE DIAG] internal-error", err)
    return { pagesText: [], layout: [] }
  }
}

// === API publique existante: texte uniquement ========================
//
// ⚠️ Compat : la signature reste identique, on renvoie exactement ce que
// tu renvoyais déjà (texte normalisé, toutes pages concaténées).
//
export async function ocrFallbackMulti(
  file: File,
  maxPages = 2
): Promise<string> {
  const { pagesText } = await ocrFallbackMultiInternal(file, maxPages)
  return pagesText.join("\n\n")
}

// Compat: ocrFallback = 1 page (texte seul)
export async function ocrFallback(file: File): Promise<string> {
  return ocrFallbackMulti(file, 1)
}

// === Nouvelle API: texte + layout ===================================
//
// C'est celle que ftParser.ts importe maintenant.
// Elle ne casse rien côté existant.
//
export async function ocrFallbackMultiWithLayout(
  file: File,
  maxPages = 2
): Promise<{ pagesText: string[]; layout: OcrLayoutByPage[] }> {
  return ocrFallbackMultiInternal(file, maxPages)
}
