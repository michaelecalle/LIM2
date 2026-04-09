// src/lib/testLogger.ts

export type TestLogEvent = {
  t: string // horodatage ISO
  kind: string // type d'événement (ex: 'gps:projected', 'ft:active-row')
  payload?: any // données associées (objet sérialisable)
}

let isRecording = false
let currentSessionId: string | null = null
let events: TestLogEvent[] = []

/**
 * Indique si un test est en cours d'enregistrement.
 */
export function isTestRecording(): boolean {
  return isRecording
}

/**
 * Démarre une nouvelle session de test.
 * - Réinitialise le buffer d'événements.
 * - Marque l'enregistreur comme "actif".
 */
export function startTestSession(label?: string): void {
  const now = new Date()
  const iso = now.toISOString().replace(/[:.]/g, '-')

  // id de session simple : YYYY-MM-DDTHH-MM-SS-sss + label optionnel
  currentSessionId = label ? `${iso}_${sanitizeLabel(label)}` : iso

  events = []
  isRecording = true

  // on loggue un événement spécial "start"
  logTestEvent('session:start', {
    sessionId: currentSessionId,
    label: label ?? null,
  })
}

/**
 * Arrête la session de test en cours.
 * (n'efface pas les événements : on peut encore les exporter après)
 */
export function stopTestSession(): void {
  if (!isRecording) return

  logTestEvent('session:stop', {
    sessionId: currentSessionId,
  })

  isRecording = false
}

/**
 * Ajoute un événement dans le log si une session est active.
 */
export function logTestEvent(kind: string, payload?: any): void {
  if (!isRecording) return

  const evt: TestLogEvent = {
    t: new Date().toISOString(),
    kind,
    payload,
  }

  events.push(evt)
}

/**
 * Retourne une copie des événements courants (pour debug éventuel).
 */
export function getCurrentTestEvents(): TestLogEvent[] {
  return [...events]
}

/**
 * Construit le fichier log (contenu + Blob + nom) sans déclencher de téléchargement.
 * Utile pour : upload distant au STOP, replay, etc.
 */
export function buildTestLogFile(): {
  ok: boolean
  sessionId?: string
  filename?: string
  text?: string
  blob?: Blob
} {
  if (events.length === 0) {
    return { ok: false }
  }

  const sessionId = currentSessionId ?? new Date().toISOString().replace(/[:.]/g, '-')

  const headerLines: string[] = []
  headerLines.push(`# LIM test log`)
  headerLines.push(`# sessionId=${sessionId}`)
  headerLines.push(`# startedAt=${events[0]?.t ?? ''}`)
  headerLines.push(`# endedAt=${events[events.length - 1]?.t ?? ''}`)
  headerLines.push(`# totalEvents=${events.length}`)
  headerLines.push(`# format=one-JSON-per-line (NDJSON)`)
  headerLines.push('') // ligne vide

  const bodyLines = events.map((e) => JSON.stringify(e))
  const text = headerLines.join('\n') + bodyLines.join('\n') + '\n'

  // Nom de fichier lisible pour l’exploitation
  const filename = buildFriendlyLogFilename(events, sessionId)

  // En environnement navigateur seulement
  if (typeof Blob === 'undefined') {
    return { ok: false, sessionId, filename, text }
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' })

  return { ok: true, sessionId, filename, text, blob }
}

/**
 * Exporte le log courant dans un fichier .log (téléchargement navigateur).
 * - Retourne true si un fichier a été déclenché.
 * - Retourne false si aucun événement n'est disponible.
 */
export function exportTestLog(): boolean {
  const built = buildTestLogFile()
  if (!built.ok || !built.blob || !built.filename) return false

  if (typeof document === 'undefined') {
    // environnement non navigateur (tests, etc.) -> pas de téléchargement
    return false
  }

  const url = URL.createObjectURL(built.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = built.filename

  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return true
}

/**
 * Export local "iPad-friendly":
 * - Essaie d'abord le Share Sheet iOS (navigator.share) avec un File
 * - Fallback sur le téléchargement classique (exportTestLog)
 *
 * Retourne true si un export a été déclenché.
 */
export async function exportTestLogLocal(): Promise<boolean> {
  const built = buildTestLogFile()
  if (!built.ok || !built.blob || !built.filename) return false

  try {
    // Share Sheet (iOS Safari / PWA) si dispo
    const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null
    const canShare = !!navAny?.share && !!navAny?.canShare

    if (canShare && typeof File !== 'undefined') {
      const file = new File([built.blob], built.filename, {
        type: built.blob.type || 'text/plain;charset=utf-8;',
      })

      if (navAny.canShare({ files: [file] })) {
        await navAny.share({
          files: [file],
          title: 'LIM — logs',
          text: built.filename,
        })
        return true
      }
    }
  } catch {
    // On ignore et on retombe sur le fallback download.
  }

  // Fallback : téléchargement classique
  return exportTestLog()
}

// ------------------------------
// Upload queue (IndexedDB)
// Objectif : ne jamais perdre un log si le réseau est KO.
// ------------------------------

type QueuedUpload = {
  id: string
  createdAt: number
  sessionId: string
  filename: string
  blob: Blob
  attempts: number
  lastError: string | null
}

const UPLOAD_DB_NAME = 'lim_testlog_uploads_db'
const UPLOAD_DB_STORE = 'uploads'
const UPLOAD_DB_VERSION = 1

function makeId(prefix: string) {
  const now = Date.now()
  const rnd = Math.random().toString(16).slice(2)
  return `${prefix}_${now}_${rnd}`
}

function openUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB_unavailable'))
      return
    }

    const req = indexedDB.open(UPLOAD_DB_NAME, UPLOAD_DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(UPLOAD_DB_STORE)) {
        const store = db.createObjectStore(UPLOAD_DB_STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'))
  })
}

async function dbPutUpload(item: QueuedUpload): Promise<void> {
  const db = await openUploadDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readwrite')
    const store = tx.objectStore(UPLOAD_DB_STORE)
    store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb_put_failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb_put_aborted'))
  })
  db.close()
}

async function dbGetOldestUploads(limit: number): Promise<QueuedUpload[]> {
  const db = await openUploadDb()
  const items = await new Promise<QueuedUpload[]>((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readonly')
    const store = tx.objectStore(UPLOAD_DB_STORE)
    const idx = store.index('createdAt')

    const out: QueuedUpload[] = []
    const req = idx.openCursor()

    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(out)
        return
      }
      out.push(cursor.value as QueuedUpload)
      if (out.length >= limit) {
        resolve(out)
        return
      }
      cursor.continue()
    }
    req.onerror = () => reject(req.error ?? new Error('indexeddb_cursor_failed'))
  })
  db.close()
  return items
}

async function dbDeleteUpload(id: string): Promise<void> {
  const db = await openUploadDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readwrite')
    const store = tx.objectStore(UPLOAD_DB_STORE)
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb_delete_failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb_delete_aborted'))
  })
  db.close()
}

async function dbUpdateAttempt(id: string, attempts: number, lastError: string | null): Promise<void> {
  const db = await openUploadDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readwrite')
    const store = tx.objectStore(UPLOAD_DB_STORE)

    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const v = getReq.result as QueuedUpload | undefined
      if (!v) {
        resolve()
        return
      }
      v.attempts = attempts
      v.lastError = lastError
      store.put(v)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb_update_failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb_update_aborted'))
  })
  db.close()
}

/**
 * Ajoute le log courant dans une file d’attente d’upload (IndexedDB).
 * - Retourne l'id en queue si OK, sinon null.
 */
export async function queueCurrentTestLogForUpload(): Promise<string | null> {
  const built = buildTestLogFile()
  if (!built.ok || !built.blob || !built.filename) return null

  const sessionId = built.sessionId ?? new Date().toISOString().replace(/[:.]/g, '-')
  const item: QueuedUpload = {
    id: makeId('log'),
    createdAt: Date.now(),
    sessionId,
    filename: built.filename,
    blob: built.blob,
    attempts: 0,
    lastError: null,
  }

  await dbPutUpload(item)
  return item.id
}

export type FlushUploadOptions = {
  endpoint: string
  token: string
  maxItems?: number
  timeoutMs?: number
}

/**
 * Tente d’uploader les logs en attente (FIFO).
 * - Retourne { sent, remaining }
 * - En cas d’échec d’un item, on le garde en queue (avec attempts+1).
 */
export async function flushQueuedTestLogUploads(
  opts: FlushUploadOptions
): Promise<{ sent: number; remaining: number }> {
  const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 3
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 12_000

  const batch = await dbGetOldestUploads(maxItems)
  let sent = 0

  for (const item of batch) {
    const controller = new AbortController()

    const setTimeoutFn =
      typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
        ? globalThis.setTimeout
        : setTimeout

    const clearTimeoutFn =
      typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function'
        ? globalThis.clearTimeout
        : clearTimeout

    const t = setTimeoutFn(() => controller.abort(), timeoutMs)

    try {
      const form = new FormData()
      form.append('token', opts.token)
      form.append('logId', item.sessionId)
      form.append('file', item.blob, item.filename)

      const res = await fetch(opts.endpoint, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })

      const json = await res.json().catch(() => null)

      if (json?.ok && json?.remoteUrl) {
        await dbDeleteUpload(item.id)
        sent += 1
      } else {
        const reason = json?.error ?? 'bad_response'
        await dbUpdateAttempt(item.id, item.attempts + 1, reason)
      }
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message ?? String(err))
      await dbUpdateAttempt(item.id, item.attempts + 1, reason)
    } finally {
      clearTimeoutFn(t as any)
    }
  }

  // remaining (approx) : on relit une petite tranche
  const remaining = (await dbGetOldestUploads(9999)).length
  return { sent, remaining }
}

export type CurrentTestExportNaming = {
  trainNumber: string
  datePart: string
  timePart: string
  logFilename: string
  pdfFilename: string
  zipFilename: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function normalizeTrainNumberForFilename(raw: unknown): string | null {
  if (raw == null) return null

  const m = String(raw).match(/\d+/)
  if (!m) return null

  const n = parseInt(m[0], 10)
  if (!Number.isFinite(n)) return null

  return String(n)
}

function extractTrainNumberFromEvents(events: TestLogEvent[]): string | null {
  for (const evt of events) {
    const p = evt?.payload

    const candidates = [
      p?.train,
      p?.trainNumber,
      p?.trainNumberEs,
      p?.displayedNumber,
    ]

    for (const candidate of candidates) {
      const normalized = normalizeTrainNumberForFilename(candidate)
      if (normalized) return normalized
    }
  }

  return null
}

function formatLocalDateForFilename(d: Date): string {
  if (isNaN(d.getTime())) return 'date_inconnue'
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatLocalTimeForFilename(d: Date): string {
  if (isNaN(d.getTime())) return 'heure_inconnue'
  return `${pad2(d.getHours())}h${pad2(d.getMinutes())}`
}

function buildFriendlyExportNaming(
  events: TestLogEvent[],
  sessionId: string
): CurrentTestExportNaming {
  const startedAt = events[0]?.t ?? null
  const startedDate = startedAt ? new Date(startedAt) : new Date()

  if (isNaN(startedDate.getTime())) {
    return {
      trainNumber: 'train_inconnu',
      datePart: 'date_inconnue',
      timePart: 'heure_inconnue',
      logFilename: `LIM_testlog_${sessionId}.log`,
      pdfFilename: `PDF_utilise_${sessionId}.pdf`,
      zipFilename: `LIM_export_${sessionId}.zip`,
    }
  }

  const trainNumber = extractTrainNumberFromEvents(events) ?? 'train_inconnu'
  const datePart = formatLocalDateForFilename(startedDate)
  const timePart = formatLocalTimeForFilename(startedDate)

  return {
    trainNumber,
    datePart,
    timePart,
    logFilename: `${trainNumber} du ${datePart} - ${timePart}.log`,
    pdfFilename: `${trainNumber} du ${datePart}.pdf`,
    zipFilename: `${trainNumber} du ${datePart} - ${timePart}.zip`,
  }
}

export function getCurrentTestExportNaming(): CurrentTestExportNaming | null {
  if (events.length === 0) return null

  const sessionId =
    currentSessionId ?? new Date().toISOString().replace(/[:.]/g, '-')

  return buildFriendlyExportNaming(events, sessionId)
}

function buildFriendlyLogFilename(events: TestLogEvent[], sessionId: string): string {
  return buildFriendlyExportNaming(events, sessionId).logFilename
}

/**
 * Nettoie le label pour qu'il soit compatible avec un nom de fichier.
 */
function sanitizeLabel(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 40)
}
