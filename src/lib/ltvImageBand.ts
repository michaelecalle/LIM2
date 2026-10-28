// src/lib/ltvImageBand.ts
// 28/10 — BANDE DE RECADRAGE POUR UN DHLTV REÇU EN IMAGE.
//
// L'ancien mode ne montrait jamais la page entière dans le bloc LTV : le parseur rendait
// une BANDE (20 % de la hauteur de la page) et répondait aux flèches haut/bas du bloc
// (événement `ltv:request-band` → réponse `ltv:band-update`). Avec une image, personne
// ne répondait plus : la composite entière (presque carrée) débordait de l'écran, le bord
// bas du cadre hors de portée (capture du 28/10). Ce module rejoue le rôle du parseur à
// partir de la composite des pages. Rien ne change dans LTV.tsx.

let source: HTMLImageElement | null = null
let sourceUrl: string | null = null
let currentBand: { dataUrl: string; topPct: number; heightPct: number } | null = null

const DEFAULT_HEIGHT_PCT = 0.2
/** Plancher : une bande d'au moins un cinquième de la largeur (image d'une seule page). */
const MIN_HEIGHT_TO_WIDTH = 0.2

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })
}

/** Fixe (ou retire, null) la composite servant de source aux bandes. */
export async function setLtvImageBandSource(dataUrl: string | null): Promise<void> {
  currentBand = null
  if (!dataUrl) {
    source = null
    sourceUrl = null
    return
  }
  sourceUrl = dataUrl
  const img = await loadImage(dataUrl)
  if (sourceUrl === dataUrl) source = img // sinon remplacée entre-temps
}

export function hasLtvImageBandSource(): boolean {
  return source != null
}

/** Dernière bande servie (data URL), pour les diffusions `ltv:parsed` qui suivent. */
export function getLtvImageCurrentBand(): string | null {
  return currentBand?.dataUrl ?? null
}

/** Découpe la bande [topPct, topPct+heightPct] de la composite. null sans source. */
export function renderLtvImageBand(topPct: number, heightPct = DEFAULT_HEIGHT_PCT): string | null {
  if (!source) return null
  const W = source.naturalWidth
  const H = source.naturalHeight
  const hFrac = Math.max(heightPct, (W * MIN_HEIGHT_TO_WIDTH) / H)
  const h = Math.min(H, Math.max(8, Math.round(H * hFrac)))
  const top = Math.min(Math.max(0, Math.round(H * topPct)), H - h)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, h)
  ctx.drawImage(source, 0, top, W, h, 0, 0, W, h)
  const dataUrl = cv.toDataURL('image/jpeg', 0.92)
  currentBand = { dataUrl, topPct: top / H, heightPct: h / H }
  return dataUrl
}

/**
 * Sert une bande au bloc LTV (`ltv:band-update`, même contrat que le parseur : topPct et
 * bottomPct en POURCENTS). Le bloc remplace l'image de recadrage et mémorise topPct.
 */
export function publishLtvImageBand(topPct: number, heightPct = DEFAULT_HEIGHT_PCT): string | null {
  const dataUrl = renderLtvImageBand(topPct, heightPct)
  if (!dataUrl || !currentBand) return null
  window.dispatchEvent(
    new CustomEvent('ltv:band-update', {
      detail: {
        dataUrl,
        topPct: currentBand.topPct * 100,
        bottomPct: (currentBand.topPct + currentBand.heightPct) * 100,
      },
    })
  )
  return dataUrl
}

function onRequestBand(e: Event) {
  if (!source) return // pas de DHLTV image : l'ancien parseur (PDF) répond, ou personne
  const d = (e as CustomEvent).detail ?? {}
  const topPct = typeof d.topPct === 'number' ? d.topPct : 0.2
  const heightPct = typeof d.heightPct === 'number' ? d.heightPct : DEFAULT_HEIGHT_PCT
  try {
    publishLtvImageBand(topPct, heightPct)
  } catch (err) {
    console.warn('[ltvImageBand] bande impossible', err)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('ltv:request-band', onRequestBand as EventListener)
}
