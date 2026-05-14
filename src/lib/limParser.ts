/* limParser.ts — v5.4.3 (FECHA + COMPOSICIÓN patch, title update)
   - Train: exactly 5 digits from PDF content (never filename), zeros kept.
   - Origen/Destino: detect canonical strings; fallback by train rules; sets `relation` & `origenDestino`.
   - FECHA: capture strictly the date token (numeric or textual), avoids swallowing following text.
   - COMPOSICIÓN: supports UM/US/DU/SOLO/SIMPLE/1UM/2UM, including patterns like "US 200m - 433t".
   - PDF page1 via pdf.js + OCR fallback; dispatches "lim:parsed"; updates document.title = "LIM <tren>".
*/
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api"
// @ts-ignore
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

// on NE charge PLUS l’OCR ici en statique
let ocrFallbackFn: null | ((file: File) => Promise<string>) = null

// ✅ garde-fou OCR : évite un blocage infini (offline/worker/lang, etc.)
const OCR_TIMEOUT_MS = 20_000

export type Fields = {
  tren?: string
  trenPadded?: string
  type?: string
  relation?: string
  origenDestino?: string
  fecha?: string
  fechaRaw?: string
  composicion?: string
  material?: string
  linea?: string
  longitud?: number | string
  masa?: number | string
  operador?: string
  operadorLogo?: string
  [k: string]: any
}

// -------------- helpers --------------
function cleanNumber(v?: string | number | null): number | undefined {
  if (v == null || v === "") return undefined
  const s = String(v).replace(/\s+/g, "").replace(",", ".")
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : undefined
}

function normalize(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/[\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function pickTrain(s: string): string | undefined {
  const up = s.toUpperCase()
  const re = /\b(\d{5})\b/g
  let m: RegExpExecArray | null
  let best: { num: string; idx: number; score: number } | null = null
  while ((m = re.exec(up))) {
    const idx = m.index
    const window = up.slice(Math.max(0, idx - 50), Math.min(up.length, idx + 50))
    const score = /(TREN|LIM)/.test(window) ? 0 : 1
    if (!best || score < best.score || (score === best.score && idx < best.idx)) {
      best = { num: m[1], idx, score }
    }
  }
  return best?.num
}

function detectRelation(txt: string, trenPadded?: string): string | undefined {
  const s = normalize(txt)

  const p1 = /Limite\s+ADIF\s*[-–]?\s*LFPSA\s*[-–]?\s*Barcelona\s+Sants/i
  const p2 = /Barcelona\s+Sants\s*[-–]?\s*Limite\s+ADIF\s*[-–]?\s*LFPSA/i
  const p3 = /Can\s+Tunis\s+AV\s*[-–]?\s*Barcelona\s+Sants/i
  const p4 = /Barcelona\s+Sants\s*[-–]?\s*Can\s+Tunis\s+AV/i
  if (p1.test(s)) return "Limite ADIF-LFPSA - Barcelona Sants"
  if (p2.test(s)) return "Barcelona Sants - Limite ADIF-LFPSA"
  if (p3.test(s)) return "Can Tunis AV - Barcelona Sants"
  if (p4.test(s)) return "Barcelona Sants - Can Tunis AV"

  if (trenPadded && /^\d{5}$/.test(trenPadded)) {
    const first = trenPadded[0]
    const num = parseInt(trenPadded, 10)
    const odd = num % 2 === 1
    if (first === "0") {
      return odd
        ? "Barcelona Sants - Limite ADIF-LFPSA"
        : "Limite ADIF-LFPSA - Barcelona Sants"
    }
    if (first === "3") {
      return odd ? "Can Tunis AV - Barcelona Sants" : "Barcelona Sants - Can Tunis AV"
    }
  }
  return undefined
}

function extractFechaRaw(s: string): string | undefined {
  const S = s
  const mLblNum = S.match(
    /\b(?:FECHA|DATE)\b[^\d\r\n]{0,20}([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{2}|\d{4}))/i
  )
  if (mLblNum) return mLblNum[1]

  const mLblTxt = S.match(
    /\b(?:FECHA|DATE)\b[^\dA-Za-z\u00C0-\u017F\r\n]{0,20}(\d{1,2}\s+[A-Za-z\u00C0-\u017F\-]+\s+\d{4})/i
  )
  if (mLblTxt) return mLblTxt[1]

  const head = S.slice(0, 600)
  const mNum = head.match(/\b([0-3]?\d)[\/.\-]([01]?\d)[\/.\-](\d{2}|\d{4})\b/)
  if (mNum) return `${mNum[1]}/${mNum[2]}/${mNum[3]}`

  const mTxt = head.match(/\b(\d{1,2})\s+([A-Za-z\u00C0-\u017F\-]+)\s+(\d{4})\b/)
  if (mTxt) return `${mTxt[1]} ${mTxt[2]} ${mTxt[3]}`

  return undefined
}

function extractComposicion(s: string): string | undefined {
  const mLbl = s
    .match(/\b(?:COMPOSICI[ÓO]N|COMPOSICION)\b\s*[:\-–]?\s*([A-Z0-9]{1,4})\b/i)?.[1]
  if (mLbl) return mLbl.toUpperCase()

  const mLong = s.match(/\b(2UM|1UM|UM|US|DU|SOLO|SIMPLE)\b\s+\d{2,4}\s*m\b/i)?.[1]
  if (mLong) return mLong.toUpperCase()

  const mAny = s.match(/\b(2UM|1UM|UM|US|DU|SOLO|SIMPLE)\b/i)?.[1]
  if (mAny) return mAny.toUpperCase()

  return undefined
}

export function extractFields(text: string): Fields {
  const s = normalize(text || "")

  const trenPadded = pickTrain(s)
  const tren = trenPadded ?? undefined

  const type =
    s.match(/\b(?:TYPE|TIPO(?:\s+(?:DE\s+TREN|TREN))?)\s*[:\-–]?\s*([A-Z]\d{2,3})\b/i)?.[1] ??
    s.match(/\bT\d{2,3}\b/)?.[0]

  const relation = detectRelation(s, trenPadded)

  const fechaRaw = extractFechaRaw(s)
  const fecha = fechaRaw

  const material = "TGV 2N2"
  const linea =
    s.match(/\b(?:LINEA|L[ÍI]NEA|LINEAS|L[ÍI]NEAS)\b\s*[:\-–]?\s*([0-9]{2,4}(?:\s*[-–]\s*[0-9]{2,4})?)/i)?.[1] ??
    undefined

  const lengthMeters =
    cleanNumber(s.match(/(\d{2,4})(?=\s*m\b)/i)?.[1] || s.match(/(\d{2,4})(?=m\b)/i)?.[1]) ?? undefined
  const massTons =
    cleanNumber(s.match(/(\d{2,4})(?=\s*t\b)/i)?.[1] || s.match(/(\d{2,4})(?=t\b)/i)?.[1]) ?? undefined

  const composicion = extractComposicion(s)

  const out: Fields = {
    tren,
    trenPadded,
    type,
    relation,
    origenDestino: relation,
    fecha,
    fechaRaw,
    composicion,
    material,
    linea,
    longitud: lengthMeters,
    masa: massTons,
    operador: "OUIGO",
    operadorLogo: "/ouigo.svg",
  }
  return out
}

export async function readPdfFirstPageText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const loading = await (pdfjsLib as any).getDocument({ data: buf })
  const doc: PDFDocumentProxy = await loading.promise
  const page = await doc.getPage(1)
  const textContent = await page.getTextContent()
  const items = textContent.items as TextItem[]
  const text = items.map((it) => (it as any).str || "").join("\n")
  return text
}

function textLooksUsable(hay: string): boolean {
  const patterns = [
    /\bTREN\b/i,
    /\bCOMPOSIC/i,
    /\bFECHA\b/i,
    /\bLINEA/i,
    /\d{2,4}\s*m\b/i,
    /\d{2,4}\s*t\b/i,
  ]
  return patterns.some((re) => re.test(hay))
}

function mergePreferA(a: any, b: any) {
  const out: any = { ...a }
  for (const k of Object.keys(b)) {
    const vA = a[k],
      vB = b[k]
    if (vA == null || vA === "" || (typeof vA === "number" && !Number.isFinite(vA))) {
      if (vB != null && vB !== "") out[k] = vB
    }
  }
  return out
}

export async function handleFile(file: File): Promise<Fields> {
  const textA = await readPdfFirstPageText(file)
  const fieldsA = extractFields(textA || "")

  const needsOCR =
    !textLooksUsable(textA || "") ||
    (!fieldsA.type ||
      !fieldsA.fecha ||
      !fieldsA.composicion ||
      !fieldsA.longitud ||
      !fieldsA.trenPadded ||
      !fieldsA.origenDestino)

  let fields = fieldsA

  if (needsOCR) {
    try {
      if (!ocrFallbackFn) {
        const mod = await import("./ocrRouter")
        ocrFallbackFn = mod.ocrFallback
      }

      // ✅ garde-fou : si l'OCR se bloque (offline), on coupe au bout de OCR_TIMEOUT_MS
      const textB = await Promise.race([
        ocrFallbackFn(file),
        new Promise<string>((_, reject) =>
          window.setTimeout(() => reject(new Error("OCR timeout")), OCR_TIMEOUT_MS)
        ),
      ])

      const fieldsB = extractFields(textB || "")
      fields = mergePreferA(fieldsA, fieldsB)
    } catch (err) {
      console.warn("[limParser] OCR fallback failed, keeping PDF fields only", err)
    }
  }

  window.dispatchEvent(new CustomEvent("lim:parsed", { detail: fields }))

  try {
    const t = fields.trenPadded ?? fields.tren
    if (t && typeof document !== "undefined") {
      if (!/^\s*LIM\b/.test(document.title)) {
        document.title = `LIM ${t}`
      } else {
        document.title = document.title.replace(/^LIM\s+\S+/, `LIM ${t}`)
      }
    }
  } catch {}

  return fields
}

function setup() {
  // ✅ Singleton global : empêche d'installer plusieurs fois le listener (HMR / double import / etc.)
  const w = window as any
  if (w.__limParserImportListenerInstalled) {
    console.warn("[limParser] listener already installed, skipping setup()")
    return
  }
  w.__limParserImportListenerInstalled = true

  // ✅ anti-double import : mémoire globale partagée (même si le module est chargé 2 fois)
  if (!w.__limParserLastImport) {
    w.__limParserLastImport = { fp: null as string | null, atMs: 0 }
  }

  const onImport = (e: Event) => {
    const ce = e as CustomEvent
    const file: File | undefined = ce.detail?.file
    if (!file) return

    const fp = `${file.name}|${file.size}|${file.lastModified}`
    const now = Date.now()

    const last = w.__limParserLastImport as { fp: string | null; atMs: number }

    // Si même fichier reçu très rapidement => on ignore le doublon
    if (fp === last.fp && now - last.atMs < 2000) {
      console.warn("[limParser] Duplicate lim:import-pdf ignored (global)", fp)
      return
    }

    last.fp = fp
    last.atMs = now

    void handleFile(file)
  }

  window.addEventListener("lim:import-pdf", onImport as EventListener)
  console.log("[limParser] listener installed (singleton)")
}
setup()


