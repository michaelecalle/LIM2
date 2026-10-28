// src/lib/ltvImages.ts
// 28/10 — DHLTV REÇU EN IMAGE (PNG/JPEG) au lieu du PDF.
// Il arrive, rarement, que le DHLTV arrive par mail sous forme d'images (une par page,
// « image001.png », « image002.png »…). Pas de parseur possible : on ne fait que les
// AFFICHER — recadrage manuel dans le bloc LTV (ancien mode NEEDS_CROP) et pages du mode
// secours — sans aucune LTV sur la fiche train (reconstitution par les codes : lot 2).

/** Vrai si le fichier est une image affichable (PNG, JPEG, WebP, GIF, HEIC refusé). */
export function isLtvImageFile(file: File): boolean {
  const t = (file.type || '').toLowerCase()
  if (t.startsWith('image/')) return t !== 'image/heic' && t !== 'image/heif'
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}

/** Ordre des pages = ordre alphabétique naturel des noms (image001, image002…). */
export function sortLtvImageFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('FileReader'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })
}

export type LtvImageComposite = {
  dataUrl: string
  blob: Blob
  width: number
  height: number
  pages: number
}

/**
 * Empile les pages verticalement en UNE image (le recadrage du bloc LTV ne connaît
 * qu'une image). Toutes les pages sont ramenées à la largeur de la plus large.
 * Sortie JPEG q=0,92 : les images de mail sont petites (≈1 100 px de large), le poids
 * reste faible et iOS plafonne la taille des canvas (~16 Mpx).
 */
export async function buildLtvImageComposite(files: File[]): Promise<LtvImageComposite> {
  const ordered = sortLtvImageFiles(files)
  const imgs: HTMLImageElement[] = []
  for (const f of ordered) imgs.push(await loadImage(await fileToDataUrl(f)))
  const width = Math.max(1, ...imgs.map((i) => i.naturalWidth))
  const heights = imgs.map((i) => Math.round((i.naturalHeight * width) / Math.max(1, i.naturalWidth)))
  const gap = 8
  const height = heights.reduce((a, h) => a + h, 0) + gap * Math.max(0, imgs.length - 1)
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponible')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  let y = 0
  imgs.forEach((img, i) => {
    ctx.drawImage(img, 0, y, width, heights[i])
    y += heights[i] + gap
  })
  const dataUrl = cv.toDataURL('image/jpeg', 0.92)
  const blob = await new Promise<Blob>((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.92)
  )
  return { dataUrl, blob, width, height, pages: imgs.length }
}
