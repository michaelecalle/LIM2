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
  /** Codes stricts dans l'ordre de lecture, une liste par passe (encadrement par les voisins). */
  sequences: string[][]
  /** Vision non tentée : OCR en ligne désactivé / hors ligne ; null = tentée. */
  visionSkipped: 'setting-off' | 'offline' | null
  /** Tentatives Vision échouées (repli Tesseract), une entrée par image. */
  visionFailed: Array<{ name: string; reason: string; ms: number }>
  /** Toutes les fenêtres de 9 chiffres (tolère une parenthèse lue comme un chiffre). */
  windows: Set<string>
  /** En-têtes de ligne rencontrés (ex. 050, 054). */
  linesSeen: string[]
  engine: LtvCodeEngine
  ms: number
  perImage: Array<{ name: string; engine: LtvCodeEngine; ms: number }>
  /** En-tête « LÍNEA 050 » : index de l'image (ordre des noms) et ordonnée en px natifs. */
  header050: { imageIndex: number; y: number } | null
}

/** Code inconnu de la référence, encadré par les PK de ses voisins connus (tableau trié
 *  par PK décroissant dans chaque ligne). pkHi/pkLo = ±Infinity sans voisin de ce côté. */
export type LtvUnknownCode = { code: string; pkHi: number; pkLo: number }

export type LtvReconstruction = {
  data: NormalizedLtvFile
  matchedCodes: string[]
  missingCodes: string[]
  unknownCodes: string[]
  unknown: LtvUnknownCode[]
  referencePublishedAt: string | null
  engine: LtvCodeEngine
  ms: number
  header050: { imageIndex: number; y: number } | null
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
const HEADER_050_RE = /L[ÍI]NEA\s*0*50\b/i

/** Résultat d'une passe OCR : texte + ordonnée (px du canvas) de l'en-tête LÍNEA 050. */
type OcrPass = { text: string; header050Y: number | null }

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
  linesSeen: Set<string>,
  sequences: string[][]
) {
  let currentLine: string | null = null
  const strictThisPass = new Set<string>()
  const sequence: string[] = []
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
      if (strict && accept) {
        strictThisPass.add(strict)
        if (sequence[sequence.length - 1] !== strict) sequence.push(strict)
      }
      if (run.length >= 9) for (let i = 0; i + 9 <= run.length; i++) windows.add(run.slice(i, i + 9))
    }
  }
  for (const c of strictThisPass) strictVotes.set(c, (strictVotes.get(c) ?? 0) + 1)
  if (sequence.length > 0) sequences.push(sequence)
}

async function ocrTesseract(canvases: HTMLCanvasElement[]): Promise<OcrPass[]> {
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
    const passes: OcrPass[] = []
    for (const cv of canvases) {
      const res = await Promise.race([
        w.recognize(cv, {}, { text: true, blocks: true }),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('recognize timeout')), 25_000)
        ),
      ])
      const data: any = res?.data ?? {}
      let header050Y: number | null = null
      for (const b of data.blocks ?? []) {
        for (const para of b.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            if (header050Y == null && HEADER_050_RE.test(String(line.text ?? ''))) {
              header050Y = Number(line.bbox?.y0 ?? 0)
            }
          }
        }
      }
      passes.push({ text: data.text ?? '', header050Y })
    }
    return passes
  } finally {
    // Le worker est partagé avec l'OCR des fiches train : on rend les réglages par défaut.
    await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO })
  }
}

async function ocrVision(canvases: HTMLCanvasElement[]): Promise<OcrPass[]> {
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
  return canvases.map((_, i) => {
    const ann = responses[i]?.fullTextAnnotation
    let header050Y: number | null = null
    for (const page of ann?.pages ?? []) {
      for (const block of page.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          const words = (para.words ?? []).map((w: any) =>
            (w.symbols ?? []).map((sy: any) => String(sy.text ?? '')).join('')
          )
          const txt = words.join(' ')
          if (header050Y == null && HEADER_050_RE.test(txt)) {
            const ys = (para.boundingBox?.vertices ?? []).map((v: any) => Number(v.y ?? 0))
            if (ys.length) header050Y = Math.min(...ys)
          }
        }
      }
    }
    return { text: String(ann?.text ?? ''), header050Y }
  })
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
  const sequences: string[][] = []
  const relevant = relevantLinesOf(reference)
  const perImage: LtvCodeExtraction['perImage'] = []
  let header050: LtvCodeExtraction['header050'] = null
  let engineUsed: LtvCodeEngine = 'tesseract'
  // 28/10 — Pourquoi Vision n'a pas servi : journalisé (constat du 9709 à Sants, sans
  // réseau : Tesseract 98 s sans que le journal dise pourquoi).
  const onLine = typeof navigator === 'undefined' || navigator.onLine !== false
  const visionSkipped: 'setting-off' | 'offline' | null = !getOcrOnlineEnabled()
    ? 'setting-off'
    : !onLine
      ? 'offline'
      : null
  const preferVision = visionSkipped == null
  const visionFailed: Array<{ name: string; reason: string; ms: number }> = []

  const ordered = sortLtvImageFiles(files)
  for (let idx = 0; idx < ordered.length; idx++) {
    const file = ordered[idx]
    const ti = Date.now()
    const img = await loadImage(await fileToDataUrl(file))
    const canvases = COLUMN_FRACTIONS.map((f) => cropColumn(img, f))
    let passes: OcrPass[] = []
    let engine: LtvCodeEngine = 'tesseract'
    if (preferVision) {
      const tv = Date.now()
      try {
        passes = await ocrVision(canvases)
        engine = 'vision'
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.warn('[ltvCodeMatch] Vision indisponible, repli Tesseract', err)
        visionFailed.push({ name: file.name, reason, ms: Date.now() - tv })
        logTestEvent('ltv:image-match:vision-failed', {
          image: file.name,
          reason,
          ms: Date.now() - tv,
          onLine: typeof navigator === 'undefined' ? null : navigator.onLine,
        })
      }
    }
    if (engine !== 'vision') passes = await ocrTesseract(canvases)
    engineUsed = engine
    for (const pass of passes) {
      parseColumnText(pass.text, relevant, strictVotes, windows, linesSeen, sequences)
      // Position de l'en-tête LÍNEA 050 (première image où il est vu) : les passes sont
      // des colonnes partant de x = 0, agrandies ×UPSCALE → y natif = y / UPSCALE.
      if (header050 == null && pass.header050Y != null) {
        header050 = { imageIndex: idx, y: pass.header050Y / UPSCALE }
      }
    }
    perImage.push({ name: file.name, engine, ms: Date.now() - ti })
  }
  return {
    strictVotes,
    sequences,
    visionSkipped,
    visionFailed,
    windows,
    linesSeen: Array.from(linesSeen),
    engine: engineUsed,
    ms: Date.now() - t0,
    perImage,
    header050,
  }
}

function rowPkRange(row: Record<string, unknown>): { hi: number; lo: number } | null {
  const a = parseFloat(String(row.kmIni ?? '').replace(',', '.'))
  const b = parseFloat(String(row.kmFin ?? '').replace(',', '.'))
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null
  const vals = [a, b].filter((v) => Number.isFinite(v))
  return { hi: Math.max(...vals), lo: Math.min(...vals) }
}

/**
 * Encadre chaque code inconnu par les PK de ses voisins connus dans l'ordre de lecture
 * (le DHLTV est trié par PK décroissant à l'intérieur d'une ligne). Sans voisin d'un
 * côté : borne infinie (prudence : le code reste « possiblement sur le parcours »).
 */
function bracketUnknownCodes(
  unknownCodes: string[],
  sequences: string[][],
  pkByCode: Map<string, { hi: number; lo: number }>
): LtvUnknownCode[] {
  return unknownCodes.map((code) => {
    let pkHi = Number.POSITIVE_INFINITY
    let pkLo = Number.NEGATIVE_INFINITY
    let found = false
    for (const seq of sequences) {
      const i = seq.indexOf(code)
      if (i < 0) continue
      let before: { hi: number; lo: number } | undefined
      for (let j = i - 1; j >= 0 && !before; j--) before = pkByCode.get(seq[j])
      let after: { hi: number; lo: number } | undefined
      for (let j = i + 1; j < seq.length && !after; j++) after = pkByCode.get(seq[j])
      const hi = before ? before.hi : Number.POSITIVE_INFINITY
      const lo = after ? after.lo : Number.NEGATIVE_INFINITY
      // plusieurs passes : on garde l'encadrement le plus serré
      if (!found) {
        pkHi = hi
        pkLo = lo
        found = true
      } else {
        pkHi = Math.min(pkHi, hi)
        pkLo = Math.max(pkLo, lo)
      }
    }
    return { code, pkHi, pkLo }
  })
}

/** Codes inconnus dont l'encadrement croise la plage de PK du parcours (marge 2 km). */
export function filterUnknownForRoute(
  unknown: LtvUnknownCode[],
  range: { minPk: number; maxPk: number } | null,
  marginKm = 2
): LtvUnknownCode[] {
  if (!range || !Number.isFinite(range.minPk)) return unknown
  const lo = range.minPk - marginKm
  const hi = (Number.isFinite(range.maxPk) ? range.maxPk : Number.POSITIVE_INFINITY) + marginKm
  return unknown.filter((u) => u.pkHi >= lo && u.pkLo <= hi)
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
  const pkByCode = new Map<string, { hi: number; lo: number }>()
  for (const row of rows) {
    const code = rowCode(row as Record<string, unknown>)
    if (!code) continue
    known.add(code)
    const pk = rowPkRange(row as Record<string, unknown>)
    if (pk) pkByCode.set(code, pk)
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
  const unknown = bracketUnknownCodes(unknownCodes, extraction.sequences, pkByCode)
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
  return { data, matchedCodes, missingCodes, unknownCodes, unknown, referencePublishedAt }
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
  const result: LtvReconstruction = {
    ...m,
    engine: extraction.engine,
    ms: Date.now() - t0,
    header050: extraction.header050,
  }
  logTestEvent('ltv:image-match', {
    engine: extraction.engine,
    visionSkipped: extraction.visionSkipped,
    visionFailed: extraction.visionFailed,
    ocrMs: extraction.ms,
    totalMs: result.ms,
    perImage: extraction.perImage,
    referencePublishedAt: m.referencePublishedAt,
    referenceLine: reference.meta?.line ?? null,
    referenceRows: reference.rows.length,
    linesSeen: extraction.linesSeen,
    header050: extraction.header050,
    strictCodesRead: extraction.strictVotes.size,
    matched: m.matchedCodes,
    missing: m.missingCodes,
    unknown: m.unknown,
  })
  return result
}
