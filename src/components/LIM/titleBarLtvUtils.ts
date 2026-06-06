// src/components/LIM/titleBarLtvUtils.ts
// Fonctions utilitaires d’accès et de mapping des données LTV,
// extraites de TitleBar.tsx pour alléger ce fichier.

import LTV_NORMALIZED from '../../data/ltv.normalized.json'

export type ManualLtvApiEntry = {
  objectId: number
  ltvId: number | null
  ligne: string
  ligneDescription: string
  pkDebut: number
  pkFin: number
  vitesse: number
  voies: string
  motif: string
  debutZone: string
  finZone: string
  csv: string | null
  calendrier: string | null
  dateDebutVigueur: number | null
  heureDebutVigueur: string | null
  dateFinPrevue: number | null
  heureFinPrevue: string | null
  horaire: string | null
  nonSignaleeSysteme: string | null
  nonSignaleeVoie: string | null
  observations: string | null
  vehiculeTete: string | null
  typeTrain: string | null
  typeTrainObs: string | null
}

export type ManualLtvApiResponse = {
  ok: boolean
  source?: string
  fetchedAt?: string
  sourceUpdatedAt?: string
  total?: number
  ltv?: ManualLtvApiEntry[]
  error?: string
}

export type ManualLtvDisplayRow = {
  code: string
  section: string
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
  observaciones: string
}

export type ManualLtvRowsResult = {
  rows: ManualLtvDisplayRow[]
  meta: {
    fetchedAt?: string
    sourceUpdatedAt?: string
    source?: string
    total?: number
    displayedCount: number
  }
}

export type NormalizedLtvFile = {
  meta?: {
    line?: string
    publishedAt?: string
    adif?: {
      source?: string
      fetchedAt?: string
      sourceUpdatedAt?: string
      sourceUpdatedFile?: string
    }
  }
  rows?: Array<Partial<ManualLtvDisplayRow> & Record<string, unknown>>
  warnings?: unknown[]
}

export type ManualFtRoutePkRange = {
  trainNumber: number
  routeStart?: string
  routeEnd?: string
  firstPk: number
  lastPk: number
  minPk: number
  maxPk: number
  source?: string
}

export function getManualLtvApiUrl(): string {
  if (typeof window === 'undefined') return '/api/ltv'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'https://lim2.vercel.app/api/ltv'
  }
  return '/api/ltv'
}

export function formatManualLtvPk(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const text = value.toFixed(3).replace(/\.?0+$/, '')
  return text.replace('.', ',')
}

export function formatManualLtvDate(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

export function isManualLtvYes(value: string | null | undefined): boolean {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'si' || text === 'sí' || text === 'oui' || text === 'true' || text === '1'
}

export function mapManualLtvEntryToDisplayRow(entry: ManualLtvApiEntry): ManualLtvDisplayRow {
  const code = String(entry.ltvId ?? entry.objectId ?? '').trim()
  const section =
    [entry.debutZone, entry.finZone]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' - ') || String(entry.ligneDescription ?? '').trim()
  const observacionesParts = [entry.observations, entry.typeTrainObs]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  return {
    code,
    section,
    via: String(entry.voies ?? ''),
    kmIni: formatManualLtvPk(entry.pkDebut),
    kmFin: formatManualLtvPk(entry.pkFin),
    speed: String(entry.vitesse ?? ''),
    motivo: String(entry.motif ?? ''),
    fecha1: formatManualLtvDate(entry.dateDebutVigueur),
    hora1: entry.heureDebutVigueur ?? '',
    fecha2: formatManualLtvDate(entry.dateFinPrevue),
    hora2: entry.heureFinPrevue ?? '',
    viaCheck: isManualLtvYes(entry.nonSignaleeVoie),
    sistema: isManualLtvYes(entry.nonSignaleeSysteme),
    soloCabeza: isManualLtvYes(entry.vehiculeTete),
    csv: isManualLtvYes(entry.csv),
    observaciones: observacionesParts.join('\n'),
  }
}

export function getManualLtvPkSpan(
  entry: ManualLtvApiEntry
): { minPk: number; maxPk: number } | null {
  const pkDebut =
    typeof entry.pkDebut === 'number' && Number.isFinite(entry.pkDebut) ? entry.pkDebut : null
  const pkFin =
    typeof entry.pkFin === 'number' && Number.isFinite(entry.pkFin) ? entry.pkFin : null
  if (pkDebut === null || pkFin === null) return null
  return { minPk: Math.min(pkDebut, pkFin), maxPk: Math.max(pkDebut, pkFin) }
}

export function manualLtvOverlapsRoute(
  entry: ManualLtvApiEntry,
  routePkRange: ManualFtRoutePkRange
): boolean {
  const ltvSpan = getManualLtvPkSpan(entry)
  if (!ltvSpan) return false
  return ltvSpan.maxPk >= routePkRange.minPk && ltvSpan.minPk <= routePkRange.maxPk
}

export function waitForFtRoutePkRange(
  trainNumber: string,
  timeoutMs = 1500
): Promise<ManualFtRoutePkRange | null> {
  const expectedTrainNumber = Number(trainNumber)
  const existing = (window as any).__limLastFtRoutePkRange as ManualFtRoutePkRange | undefined
  if (
    existing &&
    Number(existing.trainNumber) === expectedTrainNumber &&
    typeof existing.minPk === 'number' &&
    Number.isFinite(existing.minPk) &&
    typeof existing.maxPk === 'number' &&
    Number.isFinite(existing.maxPk)
  ) {
    return Promise.resolve(existing)
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (value: ManualFtRoutePkRange | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.removeEventListener('ft:route-pk-range', onRange as EventListener)
      resolve(value)
    }
    const onRange = (event: Event) => {
      const ce = event as CustomEvent<ManualFtRoutePkRange>
      const detail = ce.detail
      if (!detail) return
      if (Number(detail.trainNumber) !== expectedTrainNumber) return
      if (
        typeof detail.minPk !== 'number' ||
        !Number.isFinite(detail.minPk) ||
        typeof detail.maxPk !== 'number' ||
        !Number.isFinite(detail.maxPk)
      ) return
      finish(detail)
    }
    const timer = window.setTimeout(() => {
      const latest = (window as any).__limLastFtRoutePkRange as ManualFtRoutePkRange | undefined
      if (
        latest &&
        Number(latest.trainNumber) === expectedTrainNumber &&
        typeof latest.minPk === 'number' &&
        Number.isFinite(latest.minPk) &&
        typeof latest.maxPk === 'number' &&
        Number.isFinite(latest.maxPk)
      ) {
        finish(latest)
        return
      }
      finish(null)
    }, timeoutMs)
    window.addEventListener('ft:route-pk-range', onRange as EventListener)
  })
}

export async function fetchManualLtvRows(
  routePkRange: ManualFtRoutePkRange | null
): Promise<ManualLtvRowsResult> {
  const response = await fetch(getManualLtvApiUrl(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`API LTV HTTP ${response.status}`)
  const payload = (await response.json()) as ManualLtvApiResponse
  if (!payload.ok) throw new Error(payload.error ?? 'Réponse API LTV invalide')
  const entries = Array.isArray(payload.ltv) ? payload.ltv : []
  const filteredEntries = routePkRange
    ? entries.filter((entry) => manualLtvOverlapsRoute(entry, routePkRange))
    : entries
  console.log('[TitleBar] LTV filtre PK route', {
    routePkRange,
    totalRows: entries.length,
    filteredRows: filteredEntries.length,
  })
  const rows = filteredEntries.map(mapManualLtvEntryToDisplayRow)
  return {
    rows,
    meta: {
      fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : undefined,
      sourceUpdatedAt:
        typeof payload.sourceUpdatedAt === 'string' ? payload.sourceUpdatedAt : undefined,
      source: typeof payload.source === 'string' ? payload.source : undefined,
      total:
        typeof payload.total === 'number' && Number.isFinite(payload.total)
          ? payload.total
          : entries.length,
      displayedCount: rows.length,
    },
  }
}

function readNormalizedLtvString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function readNormalizedLtvBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  return (
    text === 'true' || text === '1' || text === 'si' || text === 'sí' ||
    text === 'oui' || text === 'x' || text === '✓'
  )
}

function parseNormalizedLtvPk(value: unknown): number | null {
  const text = String(value ?? '').trim().replace(',', '.')
  if (!text) return null
  const match = text.match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function normalizedLtvOverlapsRoute(
  row: ManualLtvDisplayRow,
  routePkRange: ManualFtRoutePkRange | null
): boolean {
  if (!routePkRange) return true
  const pkIni = parseNormalizedLtvPk(row.kmIni)
  const pkFin = parseNormalizedLtvPk(row.kmFin)
  // Si une LTV normalisée a un PK illisible, on préfère l’afficher plutôt que la masquer.
  if (pkIni === null || pkFin === null) return true
  const minPk = Math.min(pkIni, pkFin)
  const maxPk = Math.max(pkIni, pkFin)
  return maxPk >= routePkRange.minPk && minPk <= routePkRange.maxPk
}

function mapNormalizedLtvRowToDisplayRow(
  row: Partial<ManualLtvDisplayRow> & Record<string, unknown>
): ManualLtvDisplayRow {
  return {
    code: readNormalizedLtvString(row.code),
    section: readNormalizedLtvString(row.section),
    via: readNormalizedLtvString(row.via),
    kmIni: readNormalizedLtvString(row.kmIni),
    kmFin: readNormalizedLtvString(row.kmFin),
    speed: readNormalizedLtvString(row.speed),
    motivo: readNormalizedLtvString(row.motivo),
    fecha1: readNormalizedLtvString(row.fecha1),
    hora1: readNormalizedLtvString(row.hora1),
    fecha2: readNormalizedLtvString(row.fecha2),
    hora2: readNormalizedLtvString(row.hora2),
    viaCheck: readNormalizedLtvBoolean(row.viaCheck),
    sistema: readNormalizedLtvBoolean(row.sistema),
    soloCabeza: readNormalizedLtvBoolean(row.soloCabeza),
    csv: readNormalizedLtvBoolean(row.csv),
    observaciones: readNormalizedLtvString(row.observaciones),
  }
}

// Charge les LTV depuis un NormalizedLtvFile en memoire (mode 2026 : données issues du PDF LTV).
// Meme pipeline que loadNormalizedLtvRows mais source injectable.
export function loadPdfLtvRows(
  data: NormalizedLtvFile,
  routePkRange: ManualFtRoutePkRange | null
): ManualLtvRowsResult {
  const rawRows = Array.isArray(data.rows) ? data.rows : []
  const mappedRows = rawRows.map(mapNormalizedLtvRowToDisplayRow)
  const rows = mappedRows.filter((row) => normalizedLtvOverlapsRoute(row, routePkRange))
  const publishedAt =
    typeof data.meta?.publishedAt === 'string' && data.meta.publishedAt.trim().length > 0
      ? data.meta.publishedAt
      : undefined
  return {
    rows,
    meta: {
      fetchedAt: publishedAt,
      sourceUpdatedAt: publishedAt,
      source: 'pdf-ltv',
      total: mappedRows.length,
      displayedCount: rows.length,
    },
  }
}

// Lit le dernier normalisé LTV connu (uploadé par l’app à chaque mission réelle)
// depuis lim-logs (privé). Sert de SECOURS si le conducteur n’a pas son PDF LTV.
// Retourne null si indisponible (pas de token, réseau, fichier absent…).
export async function fetchStoredLtvNormalized(): Promise<NormalizedLtvFile | null> {
  const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
  if (!token) return null
  const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
  const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/ltv-normalized/current.json?t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      }
    )
    if (!res.ok) return null
    return (await res.json()) as NormalizedLtvFile
  } catch {
    return null
  }
}

export function loadNormalizedLtvRows(
  routePkRange: ManualFtRoutePkRange | null
): ManualLtvRowsResult {
  const payload = LTV_NORMALIZED as NormalizedLtvFile
  const rawRows = Array.isArray(payload.rows) ? payload.rows : []
  const mappedRows = rawRows.map(mapNormalizedLtvRowToDisplayRow)
  const rows = mappedRows.filter((row) => normalizedLtvOverlapsRoute(row, routePkRange))
  const publishedAt =
    typeof payload.meta?.publishedAt === 'string' && payload.meta.publishedAt.trim().length > 0
      ? payload.meta.publishedAt
      : undefined
  return {
    rows,
    meta: {
      fetchedAt: publishedAt,
      sourceUpdatedAt: publishedAt,
      source: 'normalized',
      total: mappedRows.length,
      displayedCount: rows.length,
    },
  }
}
