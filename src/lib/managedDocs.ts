// Récupération des documents PDF "gérés" (mis à jour via le LIM Editor) depuis lim-logs (privé).
// Si le document n'y est pas encore publié (ou pas de token / réseau), retourne null →
// l'appelant retombe alors sur le PDF statique livré avec l'app (repli, jamais de trou).
//
// 27/10 — HORS LIGNE : les documents sont désormais conservés sur l'appareil (docStore.ts,
// IndexedDB). Ordre de lecture : magasin local → réseau (puis stockage) → null.
// Au démarrage, syncManagedDocs() compare le SHA GitHub de chaque fichier avec la copie
// locale et ne retélécharge que ce qui a changé, en arrière-plan, sans jamais bloquer.

import {
  getDocRecord,
  putDocRecord,
  requestPersistentStorage,
  type DocKey,
  type DocRecord,
} from './docStore'
import { logTestEvent } from './testLogger'

type ManagedDoc = { key: DocKey; dir: string; name: string; kind: 'pdf' | 'json' }

/** Documents suivis dans lim-logs (chemin = dir/name). */
const MANAGED_DOCS: ManagedDoc[] = [
  { key: 'manuel', dir: 'documents', name: 'manuel-utilisateur.pdf', kind: 'pdf' },
  { key: 'guia', dir: 'documents', name: 'guia-bsn.pdf', kind: 'pdf' },
  // Túneles de longitud sup. 1000 metros (ADIF), ouvert par appui long sur un tunnel.
  { key: 'tuneles', dir: 'documents', name: 'tuneles.pdf', kind: 'pdf' },
  // Livret FT complet (tous les trains à la suite), pour le mode secours, + son index
  // de pages (n° de train espagnol → 1re page, 1-indexée).
  { key: 'livretFt', dir: 'documents', name: 'livret-ft.pdf', kind: 'pdf' },
  { key: 'livretFtIndex', dir: 'documents', name: 'livret-ft.pages.json', kind: 'json' },
  // PDF SOURCE LTV (DHLTV) le plus récent, déposé à côté du normalisé.
  { key: 'ltvCurrent', dir: 'ltv-normalized', name: 'current.pdf', kind: 'pdf' },
]

const docByKey = (key: string): ManagedDoc | undefined => MANAGED_DOCS.find((d) => d.key === key)
const docPath = (d: ManagedDoc) => `${d.dir}/${d.name}`

/** Index du livret FT : numéro de train (n° espagnol) → 1re page (1-indexée). */
export type LivretFtPageIndex = Record<string, number>

function github(): { token: string; owner: string; repo: string } | null {
  const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
  if (!token) return null
  const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
  const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
  return { token, owner, repo }
}

type DirEntry = { sha: string; size: number }

/** Liste un dossier de lim-logs : nom → { sha, size }. null si injoignable. */
async function listDir(dir: string): Promise<Map<string, DirEntry> | null> {
  const gh = github()
  if (!gh) return null
  try {
    const res = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${dir}?t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${gh.token}` }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const raw = (await res.json()) as unknown
    if (!Array.isArray(raw)) return null
    const out = new Map<string, DirEntry>()
    for (const it of raw as Array<Record<string, unknown>>) {
      if (it && typeof it.name === 'string' && typeof it.sha === 'string') {
        out.set(it.name, { sha: it.sha, size: typeof it.size === 'number' ? it.size : 0 })
      }
    }
    return out
  } catch {
    return null
  }
}

/** Octets d'un fichier de lim-logs (média « raw » → pas de limite de 1 Mo). null si indisponible. */
async function downloadRaw(path: string): Promise<Blob | null> {
  const gh = github()
  if (!gh) return null
  try {
    const res = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${path}?t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      }
    )
    if (!res.ok) return null // 404 = pas encore publié → repli statique
    return await res.blob()
  } catch {
    return null
  }
}

// Un seul téléchargement à la fois par document (le préchargement du livret au montage
// et la synchronisation de démarrage peuvent viser le même fichier).
const inflight = new Map<DocKey, Promise<DocRecord | null>>()

/** Télécharge puis stocke un document. sha = celui du listing (null si inconnu). */
function downloadAndStore(doc: ManagedDoc, sha: string | null): Promise<DocRecord | null> {
  const pending = inflight.get(doc.key)
  if (pending) return pending
  const p = (async () => {
    const blob = await downloadRaw(docPath(doc))
    if (!blob) return null
    const typed =
      doc.kind === 'pdf' && blob.type !== 'application/pdf'
        ? new Blob([blob], { type: 'application/pdf' })
        : blob
    const rec: DocRecord = {
      key: doc.key,
      path: docPath(doc),
      sha,
      size: typed.size,
      blob: typed,
      name: doc.name,
      fetchedAt: Date.now(),
    }
    await putDocRecord(rec) // échec d'écriture = on sert quand même la copie en mémoire
    return rec
  })()
  inflight.set(doc.key, p)
  p.finally(() => inflight.delete(doc.key)).catch(() => {})
  return p
}

/** Magasin local d'abord ; sinon réseau (listing pour le SHA, puis octets) et stockage. */
async function ensureDoc(doc: ManagedDoc): Promise<DocRecord | null> {
  const local = await getDocRecord(doc.key)
  if (local) return local
  const listing = await listDir(doc.dir)
  if (!listing) return null // hors ligne ou sans token : rien à faire
  const entry = listing.get(doc.name)
  if (!entry) return null // pas encore publié → repli statique
  return downloadAndStore(doc, entry.sha)
}

/**
 * Charge un document géré et renvoie une object-URL (blob PDF), depuis le magasin local
 * ou, à défaut, depuis lim-logs (puis stocké). Renvoie null si indisponible.
 * ⚠️ L'appelant doit révoquer l'URL (URL.revokeObjectURL) au démontage.
 */
export async function fetchManagedDocBlobUrl(docKey: string): Promise<string | null> {
  const doc = docByKey(docKey)
  if (!doc || doc.kind !== 'pdf') return null
  const rec = await ensureDoc(doc)
  if (!rec) return null
  const pdfBlob =
    rec.blob.type === 'application/pdf' ? rec.blob : new Blob([rec.blob], { type: 'application/pdf' })
  return URL.createObjectURL(pdfBlob)
}

/**
 * Charge l'index de pages du livret FT (magasin local, sinon lim-logs).
 * Renvoie null si indisponible (pas encore publié, pas de token, réseau absent) →
 * l'appelant affiche alors le livret depuis la page 1 plutôt que rien.
 *
 * ⚠️ Les clés sont les numéros de train ESPAGNOLS, sous forme de chaînes.
 */
export async function fetchLivretFtPageIndex(): Promise<LivretFtPageIndex | null> {
  const doc = docByKey('livretFtIndex')
  if (!doc) return null
  const rec = await ensureDoc(doc)
  if (!rec) return null
  try {
    const raw = JSON.parse(await rec.blob.text()) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

    // On ne garde que les entrées exploitables : page entière ≥ 1.
    const out: LivretFtPageIndex = {}
    for (const [train, page] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof page === 'number' ? page : parseInt(String(page), 10)
      if (Number.isFinite(n) && n >= 1) out[String(train).trim()] = Math.trunc(n)
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

/**
 * Conserve sur l'appareil le DHLTV importé par l'utilisateur dans la session courante,
 * pour que le mode secours le retrouve après un rechargement de l'app hors ligne.
 */
export async function storeSessionLtvPdf(file: File): Promise<void> {
  const ok = await putDocRecord({
    key: 'ltvSession',
    path: null,
    sha: null,
    size: file.size,
    blob: file,
    name: file.name,
    fetchedAt: Date.now(),
  })
  logTestEvent('docs:ltv-session:stored', { name: file.name, size: file.size, ok })
}

/**
 * Charge les OCTETS du PDF SOURCE LTV pour le mode secours. Renvoie null si indisponible.
 * Ordre : le plus récent entre le DHLTV importé en session (stocké) et le DHLTV publié
 * dans lim-logs (stocké à la synchronisation) ; à défaut, lim-logs par le réseau.
 * On renvoie les octets (et non une iframe/URL) car le mode secours doit RENDRE le PDF
 * en images : une iframe PDF n'affiche que le haut de la 1re page sur iOS.
 */
export async function fetchLtvSourcePdfBytes(): Promise<ArrayBuffer | null> {
  const [session, current] = await Promise.all([
    getDocRecord('ltvSession'),
    getDocRecord('ltvCurrent'),
  ])
  let chosen: DocRecord | null
  if (session && current) chosen = session.fetchedAt >= current.fetchedAt ? session : current
  else chosen = session ?? current
  if (!chosen) {
    const doc = docByKey('ltvCurrent')
    chosen = doc ? await ensureDoc(doc) : null
  }
  if (!chosen) return null
  logTestEvent('docs:ltv-fallback:source', {
    key: chosen.key,
    name: chosen.name,
    fetchedAt: new Date(chosen.fetchedAt).toISOString(),
  })
  return chosen.blob.arrayBuffer()
}

let syncRunning: Promise<void> | null = null

/**
 * SYNCHRONISATION EN ARRIÈRE-PLAN (au démarrage, après le premier rendu).
 * Un listing par dossier (le SHA de chaque fichier sans télécharger le contenu) ; on ne
 * retélécharge que les documents dont le SHA diffère de la copie locale. Toute panne
 * réseau est silencieuse : l'app démarre normalement, un événement est journalisé.
 */
export function syncManagedDocs(opts?: { reason?: string }): Promise<void> {
  if (syncRunning) return syncRunning
  syncRunning = (async () => {
    const t0 = Date.now()
    const reason = opts?.reason ?? 'manual'
    const persisted = await requestPersistentStorage()
    const result = {
      reason,
      persisted,
      downloaded: [] as string[],
      upToDate: [] as string[],
      unpublished: [] as string[],
      failed: [] as string[],
      unreachable: [] as string[],
      ms: 0,
    }
    if (!github()) {
      result.unreachable.push('no-token')
    } else {
      const dirs = Array.from(new Set(MANAGED_DOCS.map((d) => d.dir)))
      const listings = new Map<string, Map<string, DirEntry> | null>()
      await Promise.all(dirs.map(async (dir) => listings.set(dir, await listDir(dir))))
      for (const doc of MANAGED_DOCS) {
        const listing = listings.get(doc.dir)
        if (!listing) {
          if (!result.unreachable.includes(doc.dir)) result.unreachable.push(doc.dir)
          continue
        }
        const entry = listing.get(doc.name)
        if (!entry) {
          result.unpublished.push(doc.key)
          continue
        }
        const local = await getDocRecord(doc.key)
        if (local && local.sha === entry.sha) {
          result.upToDate.push(doc.key)
          continue
        }
        const rec = await downloadAndStore(doc, entry.sha)
        ;(rec ? result.downloaded : result.failed).push(doc.key)
      }
    }
    result.ms = Date.now() - t0
    console.log('[docs:sync]', result)
    logTestEvent('docs:sync', result)
  })()
    .catch((err) => console.warn('[docs:sync] échec inattendu', err))
    .finally(() => {
      syncRunning = null
    })
  return syncRunning
}
