// src/lib/ltvPdfParser.ts
// Parse le PDF tableau LTV (format JasperReports, texte natif) pour le mode 2026.
// Retourne un NormalizedLtvFile compatible avec le pipeline LTV existant.

import * as pdfjsLib from 'pdfjs-dist'
import type { NormalizedLtvFile, ManualLtvDisplayRow } from '../components/LIM/titleBarLtvUtils'

// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl

// ── Limites x0 des colonnes (coordonnées PDF, page A4 paysage 842pt) ────────
const COL = {
  CODE_MAX:      65,
  SECTION_MAX:  187,
  VIA_MAX:      205,
  KM_INI_MAX:   237,
  KM_FIN_MAX:   267,
  SPEED_MAX:    293,
  MOTIVO_MAX:   428,
  FECHA1_MAX:   498,
  FECHA2_MAX:   575,
  VIA_CHECK_MAX:615,
  SISTEMA_MAX:  654,
  SOLO_CAB_MAX: 680,
  CSV_MAX:      700,
} as const

interface RawItem {
  str: string
  x: number  // x0 de l'item (transform[4])
  y: number  // y0 (transform[5]) — origine bas-gauche PDF
}

interface ParsedRow {
  code: string
  sectionParts: string[]   // peut s'etaler sur 2 lignes
  via: string
  kmIni: string
  kmFin: string
  speed: string
  motivo: string
  fecha1: string
  hora1: string
  fecha2: string
  hora2: string
  viaCheck: boolean
  sistema: boolean
  soloCabeza: boolean
  csv: boolean
  obsParts: string[]       // peut s'etaler sur 2 lignes
}

function columnOf(x: number): keyof typeof COL | 'observaciones' | null {
  if (x < COL.CODE_MAX)       return 'CODE_MAX'
  if (x < COL.SECTION_MAX)    return 'SECTION_MAX'
  if (x < COL.VIA_MAX)        return 'VIA_MAX'
  if (x < COL.KM_INI_MAX)     return 'KM_INI_MAX'
  if (x < COL.KM_FIN_MAX)     return 'KM_FIN_MAX'
  if (x < COL.SPEED_MAX)      return 'SPEED_MAX'
  if (x < COL.MOTIVO_MAX)     return 'MOTIVO_MAX'
  if (x < COL.FECHA1_MAX)     return 'FECHA1_MAX'
  if (x < COL.FECHA2_MAX)     return 'FECHA2_MAX'
  if (x < COL.VIA_CHECK_MAX)  return 'VIA_CHECK_MAX'
  if (x < COL.SISTEMA_MAX)    return 'SISTEMA_MAX'
  if (x < COL.SOLO_CAB_MAX)   return 'SOLO_CAB_MAX'
  if (x < COL.CSV_MAX)        return 'CSV_MAX'
  return 'observaciones'
}

function groupByRow(items: RawItem[], yTolerance = 4): RawItem[][] {
  if (!items.length) return []
  const sorted = [...items].sort((a, b) => b.y - a.y) // desc y (haut → bas)
  const rows: RawItem[][] = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    const lastY = rows[rows.length - 1][0].y
    if (Math.abs(item.y - lastY) <= yTolerance) {
      rows[rows.length - 1].push(item)
    } else {
      rows.push([item])
    }
  }
  return rows.map(r => r.sort((a, b) => a.x - b.x))
}

function isSectionHeader(row: RawItem[]): boolean {
  // Ligne entete de section = ligne large qui ne commence pas par un code LTV
  // Contient "050" ou "L?NEA" / "LINEA" / "LÍNEA" dans les premiers items
  const text = row.map(i => i.str).join(' ')
  if (row.length === 0) return false
  const firstX = row[0].x
  if (firstX > 20) return false  // doit commencer a gauche
  return (
    /\b050\b/.test(text) ||
    /L.NEA\s+050/i.test(text) ||
    /LINEA\s+050/i.test(text)
  )
}

function isLinea050Header(row: RawItem[]): boolean {
  const text = row.map(i => i.str).join(' ')
  return isSectionHeader(row) && /\b050\b/.test(text)
}

function isTableHeader(row: RawItem[]): boolean {
  const text = row.map(i => i.str.toLowerCase()).join(' ')
  return (
    (text.includes('c') && text.includes('digo')) ||  // Código → C digo avec font
    text.includes('trayecto') ||
    (text.includes('km') && text.includes('ini')) ||
    text.includes('veloc')
  )
}

function isPrimaryDataRow(row: RawItem[]): boolean {
  // Ligne principale : commence par un code entre parentheses ex. (000161596)
  if (!row.length) return false
  const first = row.find(i => i.x < COL.CODE_MAX)
  if (!first) return false
  return /^\(\d{6,12}\)$/.test(first.str.trim())
}

function extractCode(row: RawItem[]): string {
  const item = row.find(i => i.x < COL.CODE_MAX)
  if (!item) return ''
  return item.str.trim().replace(/[()]/g, '')
}

function itemsInRange(row: RawItem[], xMin: number, xMax: number): string {
  return row
    .filter(i => i.x >= xMin && i.x < xMax)
    .map(i => i.str.trim())
    .filter(Boolean)
    .join(' ')
}

function hasXInRange(row: RawItem[], xMin: number, xMax: number): boolean {
  return row.some(i => i.x >= xMin && i.x < xMax && i.str.trim().toUpperCase() === 'X')
}

function normalizePk(raw: string): string {
  return raw.replace(',', '.')
}

function buildDisplayRow(parsed: ParsedRow): ManualLtvDisplayRow {
  return {
    code:         parsed.code,
    section:      parsed.sectionParts.filter(Boolean).join(' / '),
    via:          parsed.via,
    kmIni:        normalizePk(parsed.kmIni),
    kmFin:        normalizePk(parsed.kmFin),
    speed:        parsed.speed,
    motivo:       parsed.motivo,
    fecha1:       parsed.fecha1,
    hora1:        parsed.hora1,
    fecha2:       parsed.fecha2,
    hora2:        parsed.hora2,
    viaCheck:     parsed.viaCheck,
    sistema:      parsed.sistema,
    soloCabeza:   parsed.soloCabeza,
    csv:          parsed.csv,
    observaciones: parsed.obsParts.filter(Boolean).join('\n'),
  }
}

function parseDataRows(rows: RawItem[][]): ManualLtvDisplayRow[] {
  const result: ManualLtvDisplayRow[] = []
  let current: ParsedRow | null = null

  const flush = () => {
    if (current && current.code) {
      result.push(buildDisplayRow(current))
    }
    current = null
  }

  for (const row of rows) {
    if (!row.length) continue
    if (isTableHeader(row) || isSectionHeader(row)) {
      flush()
      continue
    }

    if (isPrimaryDataRow(row)) {
      flush()

      // Colonne fecha1 contient "fecha hora" : separer les deux si possible
      const fecha1Raw = itemsInRange(row, COL.FECHA1_MAX - 70, COL.FECHA1_MAX).split(/\s+/)
      const fecha2Raw = itemsInRange(row, COL.FECHA2_MAX - 77, COL.FECHA2_MAX).split(/\s+/)

      current = {
        code:      extractCode(row),
        sectionParts: [itemsInRange(row, COL.CODE_MAX, COL.SECTION_MAX)],
        via:       itemsInRange(row, COL.SECTION_MAX, COL.VIA_MAX),
        kmIni:     itemsInRange(row, COL.VIA_MAX, COL.KM_INI_MAX),
        kmFin:     itemsInRange(row, COL.KM_INI_MAX, COL.KM_FIN_MAX),
        speed:     itemsInRange(row, COL.KM_FIN_MAX, COL.SPEED_MAX),
        motivo:    itemsInRange(row, COL.SPEED_MAX, COL.MOTIVO_MAX),
        fecha1:    fecha1Raw[0] ?? '',
        hora1:     fecha1Raw[1] ?? '',
        fecha2:    fecha2Raw[0] ?? '',
        hora2:     fecha2Raw[1] ?? '',
        viaCheck:  hasXInRange(row, COL.FECHA2_MAX, COL.VIA_CHECK_MAX),
        sistema:   hasXInRange(row, COL.VIA_CHECK_MAX, COL.SISTEMA_MAX),
        soloCabeza:hasXInRange(row, COL.SISTEMA_MAX, COL.SOLO_CAB_MAX),
        csv:       hasXInRange(row, COL.SOLO_CAB_MAX, COL.CSV_MAX),
        obsParts:  [itemsInRange(row, COL.CSV_MAX, 842)],
      }
    } else if (current) {
      // Ligne de continuation (suite trayecto ou observations)
      const sectionCont = itemsInRange(row, COL.CODE_MAX, COL.SECTION_MAX)
      const obsCont     = itemsInRange(row, COL.CSV_MAX, 842)
      if (sectionCont) current.sectionParts.push(sectionCont)
      if (obsCont)     current.obsParts.push(obsCont)
    }
  }

  flush()
  return result
}

export async function parseLtvPdf2026(file: File): Promise<NormalizedLtvFile> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const doc = await loadingTask.promise
  const numPages = doc.numPages

  const allRows: ManualLtvDisplayRow[] = []
  let inLinea050 = false
  const now = new Date().toISOString()

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()

    const items: RawItem[] = (content.items as any[])
      .filter(i => typeof i.str === 'string' && i.str.trim())
      .map(i => ({
        str: i.str as string,
        x: (i.transform as number[])[4],
        y: (i.transform as number[])[5],
      }))

    const rows = groupByRow(items)

    for (const row of rows) {
      if (isSectionHeader(row)) {
        inLinea050 = isLinea050Header(row)
        continue
      }
      if (!inLinea050) continue
      // On accumule les lignes de données LÍNEA 050 pour ce parsing batch
      // (on appelle parseDataRows sur l'ensemble a la fin, par page)
    }

    if (inLinea050 || p > 1) {
      // Filtrer uniquement les lignes de la section 050 sur cette page
      const linea050Rows: RawItem[][] = []
      let capturing = inLinea050  // si on etait deja dans 050 en debut de page

      for (const row of rows) {
        if (isSectionHeader(row)) {
          capturing = isLinea050Header(row)
          continue
        }
        if (capturing) linea050Rows.push(row)
      }

      allRows.push(...parseDataRows(linea050Rows))
    }
  }

  doc.destroy()

  return {
    meta: {
      line: '050',
      publishedAt: now,
      adif: {
        source: 'pdf-2026',
        fetchedAt: now,
        sourceUpdatedAt: now,
        sourceUpdatedFile: file.name,
      },
    },
    rows: allRows,
    warnings: [],
  }
}
