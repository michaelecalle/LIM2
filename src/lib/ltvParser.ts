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

  lastPdfForLtv = pdf
  lastPage1ForLtv = firstPage

  if (firstPage && (c.mode === "DISPLAY_DIRECT" || c.mode === "NEEDS_CROP")) {
    try {
      const { bestDataUrl, debugBands } = await buildDebugBandsForPage1(
        firstPage,
        c.mode
      )

      if (debugBands && debugBands.length > 0) {
        parsed.debugBands = debugBands
      }

      if (bestDataUrl) {
        parsed.previewImageDataUrl = bestDataUrl
      } else {
        const fallbackUrl = await renderPageTopCropAsDataURL(firstPage)

        if (fallbackUrl) {
          parsed.previewImageDataUrl = fallbackUrl
        }
      }
    } catch (err) {
      console.warn("[ltvParser] LTV image generation failed", err)
    }
  }

  console.log("[ltvParser] parsed diagnostic", {
    mode: parsed.mode,
    pages: pagesText.length,
    hasPreview: !!parsed.previewImageDataUrl,
    debugBands: parsed.debugBands?.length ?? 0,
  })

  dispatchLtvParsed(parsed)
  return parsed
}