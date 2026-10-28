// src/lib/ltvCodeMatch.ts
// 28/10 — RECONSTITUTION DES LTV D'UN DHLTV REÇU EN IMAGE, PAR LES CODES.
//
// Principe (validé par l'utilisateur le 28/10) : pas de reconnaissance complète du
// tableau, trop risquée. On ne lit que la colonne « Codigo » (codes à 9 chiffres, ex.
// 000159636) et on la rapproche, code par code, du LTV normalisé PUBLIÉ dans lim-logs
// (tous conducteurs confondus — jamais le dernier import local du conducteur). Un code
// de la référence lu sur l'image = cette LTV est affichée, avec les PK/vitesse de la
// référence (une LTV modifiée change de code, confirmé par l'utilisateur). Un code de
// la référence absent de l'image = LTV levée, non affichée. Un code lu inconnu de la
// référence = LTV nouvelle, impossible à reconstituer → simple avertissement.
// Une erreur d'OCR ne peut donc produire qu'une LTV manquante, jamais une LTV fausse.
//
// Faisabilité mesurée le 28/10 sur les PNG réels (mail Outlook, 1 093 px de large) :
// colonne gauche agrandie ×4 → 17/17 et 25/25 codes en < 0,5 s par image avec
// Tesseract ; l'image entière ne donne presque rien. D'où le recadrage en colonne.
//
// Deux garde-fous pour l'AVERTISSEMENT « codes inconnus » (pas pour le rapprochement,
// qui reste sûr par construction) :
//  - les en-têtes « LÍNEA 054 … » sont lus dans la même colonne : les codes situés sous
//    une ligne étrangère à la référence (meta.line = « 050+066 ») ne sont pas signalés ;
//  - un code inconnu n'est signalé que s'il a été lu dans AU MOINS DEUX passes (trois
//    largeurs de colonne) : une lecture isolée est le plus souvent un chiffre mal lu.

import type { NormalizedLtvFile } from '../components/LIM/titleBarLtvUtils'
import { fetchReferenceLtvNormalized } from './managedDocs'
import { getOcrOnlineEnabled } from './ocrSettings'
import { logTestEvent } from './testLogger'
import { fileToDataUrl, sortLtvImageFiles } from './ltvImages'

export type LtvCodeEngine = 'vision' | 'tesseract'

export type LtvCodeExtraction = {
  /** Codes lus « proprement » (9 chiffres isolés) sous une ligne pertinente → nb de passes. */
  strictVotes: Map<string, number>
  /** Toutes les fenêtres de 9 chiffres (tolère une parenthèse lue comme un chiffre). */
  windows: Set<string>
  /** En-têtes de ligne rencontrés (ex. 050, 054). */
  linesSeen: string[]
  engine: LtvCodeEngine
  ms: number
  perImage: Array<{ name: string; engine: LtvCodeEngine; ms: number }>
}

export type LtvReconstruction = {
  data: NormalizedLtvFile
  matchedCodes: string[]
  missingCodes: string[]
  unknownCodes: string[]
  referencePublishedAt: string | null
  engine: LtvCodeEngine
  ms: number
}

// Fractions de largeur essayées pour isoler la colonne des codes (union des lectures).
const COLUMN_FRACTIONS = [0.075, 0.1, 0.13]
const UPSCALE = 4
const MIN_VOTES_UNKNOWN = 2

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })
}

function cropColumn(img: HTMLImageElement, fraction: number): HTMLCanvasElement {
  const w = Math.max(8, Math.round(img.naturalWidth * fraction))
  const cv = document.createElement('canvas')
  cv.width = w * UPSCALE
  cv.height = img.naturalHeight * UPSCALE
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponible')
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.drawImage(img, 0, 0, w, img.naturalHeight, 0, 0, cv.width, cv.height)
  return cv
}

/** Lignes de la référence (« 050+066 » → {050, 066}) ; null = tout accepter. */
function relevantLinesOf(reference: NormalizedLtvFile | null): Set<string> | null {
  const raw = reference?.meta?.line
  if (typeof raw !== 'string') return null
  const parts = raw.split(/[+,/ ]+/).map((p) => p.replace(/\D/g, '')).filter((p) => p.length === 3)
  return parts.length > 0 ? new Set(parts) : null
}

const HEADER_RE = /L[ÍI]NEA\s*0*(\d{3})/i

/**
 * Parcourt le texte d'UNE passe (une colonne), ligne par ligne : les en-têtes
 * « LÍNEA nnn » changent la ligne courante ; les codes sont comptés comme « stricts »
 * seulement sous une ligne pertinente (ou avant tout en-tête : suite de page).
 */
function parseColumnText(
  text: string,
  relevant: Set<string> | null,
  strictVotes: Map<string, number>,
  windows: Set<string>,
  linesSeen: Set<string>
) {
  let currentLine: string | null = null
  const strictThisPass = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const h = rawLine.match(HEADER_RE)
    if (h) {
      currentLine = h[1]
      linesSeen.add(h[1])
      continue
    }
    const accept = relevant == null || currentLine == null || relevant.has(currentLine)
    const runs = rawLine.match(/\d+/g) ?? []
    for (const run of runs) {
      let strict: string | null = null
      if (run.length === 9) strict = run
      // « (000177519) » lu « 1000177519) » : la parenthèse devient un 1 de tête.
      else if (run.length === 10 && run.startsWith('1') && run.slice(1).startsWith('00')) strict = run.slice(1)
      if (strict && accept) strictThisPass.add(strict)
      if (run.length >= 9) for (let i = 0; i + 9 <= run.length; i++) windows.add(run.slice(i, i + 9))
    }
  }
  for (const c of strictThisPass) strictVotes.set(c, (strictVotes.get(c) ?? 0) + 1)
}

async function ocrTesseract(canvases: HTMLCanvasElement[]): Promise<string[]> {
  const mod = await import('./ocrLocalFallback')
  const w = await mod.getLocalOcrWorker()
  const { PSM } = await import('tesseract.js')
  await w.setParameters({
    // chiffres + parenthèses + lettres des en-têtes « LÍNEA » (Í souvent lu I)
    tessedit_char_whitelist: '0123456789()LÍINEA',
    tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
    user_defined_dpi: '300',
  })
  try {
    const texts: string[] = []
    for (const cv of canvases) {
      const res = await Promise.race([
        w.recognize(cv),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('recognize timeout')), 25_000)
        ),
      ])
      texts.push(res?.data?.text ?? '')
    }
    return texts
  } finally {
    // Le worker est partagé avec l'OCR des fiches train : on rend les réglages par défaut.
    await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO })
  }
}

async function ocrVision(canvases: HTMLCanvasElement[]): Promise<string[]> {
  const apiKey = import.meta.env.VITE_GOOGLE_VISION_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GOOGLE_VISION_API_KEY absente')
  const requests = canvases.map((cv) => ({
    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
    image: { content: cv.toDataURL('image/png').replace(/^data:image\/png;base64,/, '') },
  }))
  const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!resp.ok) throw new Error(`Vision HTTP ${resp.status}`)
  const json = await resp.json()
  const responses = Array.isArray(json?.responses) ? json.responses : []
  return canvases.map((_, i) => String(responses[i]?.fullTextAnnotation?.text ?? ''))
}

/**
 * Lit les codes de la colonne « Codigo » sur chaque image. Moteur : Google Vision si
 * l'OCR en ligne est activé ET que l'appareil est en ligne, sinon (ou en cas d'échec)
 * Tesseract embarqué (fichiers hébergés dans /tess, précachés → vrai hors ligne).
 */
export async function extractLtvCodesFromImages(
  files: File[],
  reference: NormalizedLtvFile | null
): Promise<LtvCodeExtraction> {
  const t0 = Date.now()
  const strictVotes = new Map<string, number>()
  const windows = new Set<string>()
  const linesSeen = new Set<string>()
  const relevant = relevantLinesOf(reference)
  const perImage: LtvCodeExtraction['perImage'] = []
  let engineUsed: LtvCodeEngine = 'tesseract'
  const preferVision =
    getOcrOnlineEnabled() && (typeof navigator === 'undefined' || navigator.onLine !== false)

  for (const file of sortLtvImageFiles(files)) {
    const ti = Date.now()
    const img = await loadImage(await fileToDataUrl(file))
    const canvases = COLUMN_FRACTIONS.map((f) => cropColumn(img, f))
    let texts: string[] = []
    let engine: LtvCodeEngine = 'tesseract'
    if (preferVision) {
      try {
        texts = await ocrVision(canvases)
        engine = 'vision'
      } catch (err) {
        console.warn('[ltvCodeMatch] Vision indisponible, repli Tesseract', err)
      }
    }
    if (engine !== 'vision') texts = await ocrTesseract(canvases)
    engineUsed = engine
    for (const t of texts) parseColumnText(t, relevant, strictVotes, windows, linesSeen)
    perImage.push({ name: file.name, engine, ms: Date.now() - ti })
  }
  return {
    strictVotes,
    windows,
    linesSeen: Array.from(linesSeen),
    engine: engineUsed,
    ms: Date.now() - t0,
    perImage,
  }
}

function rowCode(row: Record<string, unknown>): string | null {
  const raw = row.code ?? row.codigo ?? row.Codigo
  if (raw == null) return null
  const digits = String(raw).replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

/**
 * Rapproche les codes lus de la référence. Renvoie le fichier normalisé réduit aux LTV
 * reconnues, avec le détail dans meta.reconstructed.
 */
export function matchLtvCodes(
  extraction: LtvCodeExtraction,
  reference: NormalizedLtvFile
): Omit<LtvReconstruction, 'engine' | 'ms'> {
  const rows = Array.isArray(reference.rows) ? reference.rows : []
  const matchedRows: typeof rows = []
  const matchedCodes: string[] = []
  const missingCodes: string[] = []
  const known = new Set<string>()
  for (const row of rows) {
    const code = rowCode(row as Record<string, unknown>)
    if (!code) continue
    known.add(code)
    if (extraction.windows.has(code)) {
      matchedRows.push(row)
      matchedCodes.push(code)
    } else {
      missingCodes.push(code)
    }
  }
  // Codes lus proprement, sous une ligne pertinente, dans ≥ 2 passes, à zéros de tête,
  // inconnus de la référence = LTV nouvelles (ou modifiées : nouveau code).
  const unknownCodes = Array.from(extraction.strictVotes.entries())
    .filter(([c, votes]) => votes >= MIN_VOTES_UNKNOWN && c.startsWith('00') && !known.has(c))
    .map(([c]) => c)
  const referencePublishedAt =
    typeof reference.meta?.publishedAt === 'string' ? reference.meta.publishedAt : null
  const data: NormalizedLtvFile = {
    ...reference,
    rows: matchedRows,
    meta: {
      ...(reference.meta ?? {}),
      // Lu par la légende du bloc LTV (« Reconstituées d'après le PDF du … »).
      reconstructed: {
        from: 'image',
        referencePublishedAt,
        matched: matchedCodes.length,
        missing: missingCodes.length,
        unknownCodes,
      },
    } as NormalizedLtvFile['meta'],
  }
  return { data, matchedCodes, missingCodes, unknownCodes, referencePublishedAt }
}

/**
 * Chaîne complète : référence publiée (lim-logs, copie locale à défaut) → OCR des codes
 * → rapprochement. null si pas de référence ou aucune LTV reconnue.
 */
export async function reconstructLtvFromImages(files: File[]): Promise<LtvReconstruction | null> {
  const t0 = Date.now()
  const reference = await fetchReferenceLtvNormalized()
  if (!reference || !Array.isArray(reference.rows) || reference.rows.length === 0) {
    logTestEvent('ltv:image-match:no-reference', { files: files.map((f) => f.name) })
    return null
  }
  const extraction = await extractLtvCodesFromImages(files, reference)
  const m = matchLtvCodes(extraction, reference)
  const result: LtvReconstruction = { ...m, engine: extraction.engine, ms: Date.now() - t0 }
  logTestEvent('ltv:image-match', {
    engine: extraction.engine,
    ocrMs: extraction.ms,
    totalMs: result.ms,
    perImage: extraction.perImage,
    referencePublishedAt: m.referencePublishedAt,
    referenceLine: reference.meta?.line ?? null,
    referenceRows: reference.rows.length,
    linesSeen: extraction.linesSeen,
    strictCodesRead: extraction.strictVotes.size,
    matched: m.matchedCodes,
    missing: m.missingCodes,
    unknown: m.unknownCodes,
  })
  return m.matchedCodes.length > 0 ? result : null
}
