// src/lib/ltvParser.ts
// ltvParser v5.2 (DISPLAY_DIRECT native XObject attempt + debugBands)
//
// Rôle global :
//  - écoute lim:import-pdf
//  - extrait le texte de toutes les pages du PDF
//  - classe le document en DISPLAY_DIRECT / NEEDS_CROP / NO_LTV
//  - tente de générer une image exploitable automatiquement pour DISPLAY_DIRECT et NEEDS_CROP
//  - renvoie aussi une série de vignettes candidates (debugBands) pour inspection visuelle
//  - mémorise le dernier résultat globalement (window.__ltvLastParsed)
//  - envoie 'ltv:parsed' consommé par LTV.tsx
//
// Event detail ressemble maintenant à :
//   {
//     mode: "DISPLAY_DIRECT" | "NEEDS_CROP" | "NO_LTV",
//     previewImageDataUrl?: string,  // image choisie auto
//     debugBands?: Array<{ dataUrl: string; topPct: number; bottomPct: number; chosen: boolean }>
//   }

import * as pdfjsLib from "pdfjs-dist"

// Types dérivés localement pour rester compatibles sans importer les chemins internes de pdfjs
type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy
type PDFPageProxy = pdfjsLib.PDFPageProxy
type TextItem = { str: string }

// Worker pdf.js
// @ts-ignore - Vite bundling du worker
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

// Dernier PDF et page 1 utilisés pour LTV (pour les demandes de bandes dynamiques)
let lastPdfForLtv: PDFDocumentProxy | null = null
let lastPage1ForLtv: PDFPageProxy | null = null

// --- Types publics ---

export type LTVMode = "DISPLAY_DIRECT" | "NEEDS_CROP" | "NO_LTV"

export type LTVParseResult = {
  mode: LTVMode
  previewImageDataUrl?: string
  altPreviewImageDataUrl?: string

  // Toutes les images bitmap extraites de la page (pour pouvoir les parcourir côté UI)
  nativeImages?: {
    width: number
    height: number
    dataUrl: string
  }[]

  debugBands?: {
    dataUrl: string
    topPct: number
    bottomPct: number
    chosen: boolean
  }[]
  // rows?: ... (pour un futur OCR/texte)
}


// --- Heuristiques / normalisation texte ---

function normalizeForSearch(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "")
    .toUpperCase()
}

function hasCleanLtvMarkers(fullNorm: string): boolean {
  const structuralKeywords = [
    "COMPOSICION",
    "COMPOSICIÓN",
    "COMPOSICION LONGITUD",
    "COMPOSICIÓN LONGITUD",
    "LONGITUD (M) - MASA (T)",
    "TREN:",
    "MATERIAL: TGV",
  ]
  if (!fullNorm.includes("LTV")) return false
  return structuralKeywords.some((kw) => fullNorm.includes(kw))
}

function hasLtvIdPattern(fullRaw: string): boolean {
  return /\(\d{5,}\)/.test(fullRaw)
}

function isFullScanWithAlmostNoText(fullRaw: string): boolean {
  const asciiOnly = fullRaw.replace(/[^\x20-\x7E]/g, "")
  return asciiOnly.length < 200
}

/**
 * Heuristique glitch (historique). On la garde en debug.
 * - longDoc: texte > 2500 caractères
 * - OR manySlashTokens: plus de 300 tokens du style "/12"
 */
function hasGlitchLtvPattern(fullRaw: string): boolean {
  const len = fullRaw.length
  const slashNumMatches = fullRaw.match(/\/\d{1,2}/g)
  const tokenCount = slashNumMatches ? slashNumMatches.length : 0
  const longDoc = len > 2500
  const manySlashTokens = tokenCount > 300
  return longDoc || manySlashTokens
}

// ---------------------------------------------------------------------------
// 🧭 Classification cabine
// ---------------------------------------------------------------------------
//
// Heuristique actuelle (v5.2) :
// - si "clean" => DISPLAY_DIRECT
// - sinon si "scanLow" => NEEDS_CROP
// - sinon => NO_LTV
//
// Notes terrain (affichage cabine) :
// - scanLow == quasi pas de texte exploitable → souvent un scan image → on propose recadrage manuel (NEEDS_CROP)
// - DISPLAY_DIRECT => souvent tableau déjà parfaitement lisible, donc on peut l'afficher tel quel
// - NO_LTV => rien d'utile
//
function classifyLtvDisplayInternal(pagesText: string[]) {
  const fullRaw = pagesText.join("\n\n")
  const fullNorm = normalizeForSearch(fullRaw)

  const totalLength = fullRaw.length
  const slashNumMatches = fullRaw.match(/\/\d{1,2}/g)
  const slashNumTokenCount = slashNumMatches ? slashNumMatches.length : 0

  const clean = hasCleanLtvMarkers(fullNorm)
  const idPattern = hasLtvIdPattern(fullRaw)
  const glitch = hasGlitchLtvPattern(fullRaw)
  const scanLow = isFullScanWithAlmostNoText(fullRaw)

  // ============================
  // Décision du mode
  // ============================

  let mode: LTVMode

  if (clean) {
    // Cas idéal : PDF "propre", texte structuré
    mode = "DISPLAY_DIRECT"
  } else if (scanLow) {
    // Très peu de texte lisible → souvent un scan image plein cadre
    mode = "NEEDS_CROP"
  } else if (glitch) {
    // Texte présent mais illisible / explosé → on tente direct
    mode = "DISPLAY_DIRECT"
  } else {
    mode = "NO_LTV"
  }

  // Debug console terrain
  try {
    console.log("[ltvParser debug classify]", {
      modeDecided: mode,
      totalLength,
      clean,
      idPattern,
      glitch,
      scanLow,
      slashNumTokenCount,
    })
  } catch {
    /* ignore */
  }

  return {
    mode,
    debug: {
      totalLength,
      slashNumTokenCount,
      hasCleanMarkers: clean,
      hasIdPattern: idPattern,
      glitchMatched: glitch,
      isFullScan: scanLow,
    },
  }
}

// ---------------------------------------------------------------------------
// Extraction texte PDF via pdf.js
// ---------------------------------------------------------------------------

async function extractAllPagesTextAndDoc(file: File): Promise<{
  pdf: PDFDocumentProxy
  pagesText: string[]
}> {
  const buf = await file.arrayBuffer()
  const pdf: PDFDocumentProxy = await pdfjsLib.getDocument({ data: buf }).promise

  const pagesText: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .filter((it: any): it is TextItem => !!(it as TextItem).str)
      .map((ti: TextItem) => ti.str)
      .join(" ")
    pagesText.push(pageText)
  }

  return { pdf, pagesText }
}

// ---------------------------------------------------------------------------
// Génération d'images candidates depuis la page 1
// ---------------------------------------------------------------------------

type DebugBand = {
  dataUrl: string
  topPct: number
  bottomPct: number
  chosen: boolean
}

// Image extraite nativement depuis la page PDF (XObject bitmap).
type ExtractedImage = {
  width: number
  height: number
  dataUrl: string
}

async function renderPageRegionAsDataURL(
  page: PDFPageProxy,
  topPct: number,
  heightPct: number
): Promise<string | undefined> {
  try {
    const scale = 2.0
    const viewport = page.getViewport({ scale })

    const fullCanvas = document.createElement("canvas")
    const fullCtx = fullCanvas.getContext("2d")
    if (!fullCtx) return undefined

    fullCanvas.width = viewport.width
    fullCanvas.height = viewport.height

    await page.render({
      canvasContext: fullCtx,
      viewport,
    }).promise

    const cropY = viewport.height * topPct
    const cropH = viewport.height * heightPct
    const cropW = viewport.width

    const safeCropY = Math.max(0, Math.min(cropY, viewport.height))
    const safeCropH = Math.max(1, Math.min(cropH, viewport.height - safeCropY))

    const bandCanvas = document.createElement("canvas")
    const bandCtx = bandCanvas.getContext("2d")
    if (!bandCtx) return undefined

    bandCanvas.width = cropW
    bandCanvas.height = safeCropH

    bandCtx.drawImage(
      fullCanvas,
      0,
      safeCropY,
      cropW,
      safeCropH,
      0,
      0,
      cropW,
      safeCropH
    )

    const dataUrl = bandCanvas.toDataURL("image/png")
    return dataUrl
  } catch {
    return undefined
  }
}

async function buildDebugBandsForPage1(
  page: PDFPageProxy,
  modeHint: LTVMode
): Promise<{
  bestDataUrl?: string
  debugBands: DebugBand[]
}> {
  let windows: Array<{ topPct: number; heightPct: number }> = []
  let bestIndex = 0

  if (modeHint === "DISPLAY_DIRECT") {
    // Même fenêtre que NEEDS_CROP : bande 20–40 % de la hauteur
    windows = [{ topPct: 0.2, heightPct: 0.2 }]
    bestIndex = 0
  } else {
    windows = [{ topPct: 0.2, heightPct: 0.2 }]
    bestIndex = 0
  }


  const debugBands: DebugBand[] = []
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const dataUrl = await renderPageRegionAsDataURL(page, w.topPct, w.heightPct)

    debugBands.push({
      dataUrl: dataUrl || "",
      topPct: w.topPct * 100,
      bottomPct: (w.topPct + w.heightPct) * 100,
      chosen: i === bestIndex,
    })
  }

  const bestDataUrl =
    (debugBands[bestIndex] && debugBands[bestIndex].dataUrl) ||
    debugBands.find((b) => b.dataUrl)?.dataUrl

  return { bestDataUrl, debugBands }
}

async function renderPageTopCropAsDataURL(
  page: PDFPageProxy
): Promise<string | undefined> {
  return renderPageRegionAsDataURL(page, 0.2, 0.2)
}

// ---------------------------------------------------------------------------
// Extraction bitmap "native" via pdf.js OperatorList
// ---------------------------------------------------------------------------

const { OPS } = pdfjsLib as any

async function extractPageBitmapImages(
  page: PDFPageProxy
): Promise<ExtractedImage[]> {
  const results: ExtractedImage[] = []

  try {
    const opList = await (page as any).getOperatorList()

    const scale = 2.0
    const viewport = page.getViewport({ scale })
    const offCanvas = document.createElement("canvas")
    const offCtx = offCanvas.getContext("2d")
    if (!offCtx) {
      console.warn("[ltvParser] extractPageBitmapImages: pas de 2d context")
      return results
    }

    offCanvas.width = viewport.width
    offCanvas.height = viewport.height

    await page.render({
      canvasContext: offCtx,
      viewport,
    }).promise

    let imgOpCount = 0

    for (let idx = 0; idx < opList.fnArray.length; idx++) {
      const fnId = opList.fnArray[idx]

      const isPaintImage =
        fnId === OPS.paintImageXObject ||
        fnId === OPS.paintInlineImageXObject ||
        fnId === OPS.paintImageXObjectRepeat

      if (!isPaintImage) continue
      imgOpCount++

      const args = opList.argsArray[idx]
      const rawId = args && args.length > 0 ? args[0] : undefined

      let objData: any = undefined
      try {
        if (rawId !== undefined && (page as any).objs) {
          objData = (page as any).objs.get(rawId)
        }
      } catch {
        /* ignore */
      }

      let w: number | undefined
      let h: number | undefined
      let dataLen: number | undefined
      let hasBitmap = false
      let hasDataField = false
      let objKeys: string[] = []
      let kindVal: any = undefined

      if (objData && typeof objData === "object") {
        try {
          if ("bitmap" in objData && objData.bitmap) {
            hasBitmap = true
            const bmp = objData.bitmap
            if (bmp && typeof bmp === "object") {
              w = (bmp.width as number) ?? w
              h = (bmp.height as number) ?? h
            }
          }
          if ("data" in objData && objData.data) {
            hasDataField = true
            if (objData.data instanceof Uint8ClampedArray) {
              dataLen = objData.data.length
            } else if (objData.data instanceof Uint8Array) {
              dataLen = objData.data.length
            }
          }
          objKeys = Object.keys(objData)
          // @ts-ignore
          kindVal = objData.kind ?? undefined
        } catch {
          /* ignore */
        }
      }

      console.log(
        "[ltvParser] IMAGE_OP",
        `rawId=${rawId}`,
        `size=${w}x${h}`,
        `dataLen=${dataLen}`,
        `bitmap?=${hasBitmap}`,
        `hasData?=${hasDataField}`,
        `kind=${kindVal}`,
        objKeys
      )

      if (hasBitmap && objData && objData.bitmap) {
        try {
          // @ts-ignore
          const bmp: ImageBitmap = objData.bitmap
          const singleCanvas = document.createElement("canvas")
          const singleCtx = singleCanvas.getContext("2d")

          if (singleCtx) {
            singleCanvas.width = w as number
            singleCanvas.height = h as number

            singleCtx.drawImage(bmp, 0, 0)

            const pngUrl = singleCanvas.toDataURL("image/png")

            console.log(
              "[ltvParser] IMAGE_OP_CANVAS_OK",
              `rawId=${rawId}`,
              `urlLength=${pngUrl.length}`,
              `finalW=${w}`,
              `finalH=${h}`
            )

            results.push({
              width: w as number,
              height: h as number,
              dataUrl: pngUrl,
            })
          } else {
            console.warn("[ltvParser] IMAGE_OP_CANVAS_FAIL_CTX", `rawId=${rawId}`)
          }
        } catch (errPut) {
          console.warn("[ltvParser] IMAGE_OP_CANVAS_ERR", `rawId=${rawId}`, errPut)
        }
      } else {
        console.log(
          "[ltvParser] IMAGE_OP_NO_BITMAP_EXPORT",
          `rawId=${rawId}`,
          `w=${w}`,
          `h=${h}`,
          `hasBitmap=${hasBitmap}`,
          `hasData=${hasDataField}`
        )
      }
    }

    console.log("[ltvParser] extractPageBitmapImages ops détectés:", imgOpCount)
  } catch (err) {
    console.warn("[ltvParser] extractPageBitmapImages erreur", err)
  }

  return results
}

// ---------------------------------------------------------------------------
// Diffusion du résultat dans l’UI React
// ---------------------------------------------------------------------------

function dispatchLtvParsed(result: LTVParseResult) {
  ;(window as any).__ltvLastParsed = result

  try {
    console.log(
      "[ltvParser v5.2]",
      "mode détecté:",
      result.mode,
      result.previewImageDataUrl ? "(+img)" : "",
      result.debugBands ? `(debugBands=${result.debugBands.length})` : ""
    )
  } catch {
    /* ignore */
  }

  const evt = new CustomEvent("ltv:parsed", {
    detail: result,
  })
  window.dispatchEvent(evt)
}

// ---------------------------------------------------------------------------
// Traitement principal : handleFileForLtv()
// ---------------------------------------------------------------------------

async function handleFileForLtv(file: File) {
  const { pdf, pagesText } = await extractAllPagesTextAndDoc(file)
  const c = classifyLtvDisplayInternal(pagesText)

  const parsed: LTVParseResult = {
    mode: c.mode,
  }

  let firstPage: PDFPageProxy | null = null
  try {
    firstPage = await pdf.getPage(1)
  } catch {
    firstPage = null
  }

  // Mémorise la page 1 pour les futures demandes de bandes (ltv:request-band)
  if (firstPage) {
    lastPdfForLtv = pdf
    lastPage1ForLtv = firstPage
  } else {
    lastPdfForLtv = null
    lastPage1ForLtv = null
  }

  if (firstPage) {
    if (c.mode === "DISPLAY_DIRECT") {
      let bestNativeUrl: string | undefined = undefined
      let secondNativeUrl: string | undefined = undefined


      // Désactivé provisoirement : sur iPad, l'extraction native XObject
      // semble pouvoir bloquer ou dépasser le garde-fou de traitement PDF.
      // On conserve le fallback plus simple par bande canvas juste en dessous.
      console.log("[ltvParser] native XObject extract skipped")

      const { bestDataUrl, debugBands } = await buildDebugBandsForPage1(
        firstPage,
        "DISPLAY_DIRECT"
      )

      if (debugBands && debugBands.length > 0) {
        parsed.debugBands = debugBands
      }

      if (bestNativeUrl) {
        parsed.previewImageDataUrl = bestNativeUrl
      } else if (bestDataUrl) {
        parsed.previewImageDataUrl = bestDataUrl
      } else {
        try {
          const fallbackUrl = await renderPageTopCropAsDataURL(firstPage)
          if (fallbackUrl) {
            parsed.previewImageDataUrl = fallbackUrl
          }
        } catch {
          /* ignore */
        }
      }

      if (secondNativeUrl && secondNativeUrl !== parsed.previewImageDataUrl) {
        parsed.altPreviewImageDataUrl = secondNativeUrl
      } else if (bestDataUrl && bestDataUrl !== parsed.previewImageDataUrl) {
        parsed.altPreviewImageDataUrl = bestDataUrl
      }
    } else if (c.mode === "NEEDS_CROP") {

      const { bestDataUrl, debugBands } = await buildDebugBandsForPage1(
        firstPage,
        "NEEDS_CROP"
      )

      if (debugBands && debugBands.length > 0) {
        parsed.debugBands = debugBands
      }

      if (bestDataUrl) {
        parsed.previewImageDataUrl = bestDataUrl
      } else {
        try {
          const fallbackUrl = await renderPageTopCropAsDataURL(firstPage)
          if (fallbackUrl) {
            parsed.previewImageDataUrl = fallbackUrl
          }
        } catch {
          /* ignore */
        }
      }
    } else {
      // NO_LTV → pas d'image.
    }
  }

  dispatchLtvParsed(parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Setup module
// ---------------------------------------------------------------------------

function setup() {
  console.log("[ltvParser v5.2] module loaded")

  const onImport = (e: Event) => {
    const ce = e as CustomEvent<{ file?: File }>
    const file = ce.detail?.file
    if (file) {
      void handleFileForLtv(file)
    }
  }

  // Demande d'une nouvelle bande verticale sur la page 1 (scroll simulé)
  const onRequestBand = (e: Event) => {
    const ce = e as CustomEvent<{ topPct?: number; heightPct?: number }>
    const topPctRaw = ce.detail?.topPct
    const heightPctRaw = ce.detail?.heightPct

    if (!lastPage1ForLtv) {
      console.warn("[ltvParser] ltv:request-band ignoré : aucune page mémorisée")
      return
    }

    const topPct = typeof topPctRaw === "number" ? topPctRaw : 0.2
    const heightPct = typeof heightPctRaw === "number" ? heightPctRaw : 0.2

    void (async () => {
      try {
        const dataUrl = await renderPageRegionAsDataURL(
          lastPage1ForLtv as PDFPageProxy,
          topPct,
          heightPct
        )

        const bandEvt = new CustomEvent("ltv:band-update", {
          detail: {
            dataUrl: dataUrl || "",
            topPct: topPct * 100,
            bottomPct: (topPct + heightPct) * 100,
          },
        })
        window.dispatchEvent(bandEvt)
      } catch (err) {
        console.warn("[ltvParser] erreur sur ltv:request-band", err)
      }
    })()
  }

  window.addEventListener("lim:import-pdf", onImport as EventListener)
  window.addEventListener("ltv:import-pdf-only", onImport as EventListener)
  window.addEventListener("ltv:request-band", onRequestBand as EventListener)
}


setup()

// ---------------------------------------------------------------------------
// API debug
// ---------------------------------------------------------------------------

export function getLastLTV(): LTVParseResult | null {
  return (window as any).__ltvLastParsed ?? null
}

export function classifyLtvDisplayForDebug(pagesText: string[]) {
  return classifyLtvDisplayInternal(pagesText)
}