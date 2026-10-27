// src/lib/docStore.ts
// 27/10 — MAGASIN LOCAL DES DOCUMENTS (IndexedDB) : manuel, Guia, tunnels, livret FT,
// DHLTV publié (lim-logs) et DHLTV importé en session.
//
// Constat du 27/10 : chaque document était récupéré PAR LE RÉSEAU à chaque ouverture
// (option « no-store » partout, aucun PDF/JSON dans le précache du service worker).
// Sans couverture, le visualiseur restait vide — précisément là où on a besoin du
// document des tunnels. Désormais : les octets sont conservés ici, avec le SHA GitHub
// de la version téléchargée ; au démarrage, on ne retélécharge que ce qui a changé
// (cf. syncManagedDocs dans managedDocs.ts).
//
// Même mécanisme que la file d'upload des journaux (testLogger.ts). Toute défaillance
// d'IndexedDB (navigation privée, quota) est avalée : l'appelant retombe sur le réseau
// puis sur la copie livrée avec l'app.

export type DocKey =
  | 'manuel'
  | 'guia'
  | 'tuneles'
  | 'livretFt'
  | 'livretFtIndex'
  | 'ltvCurrent'
  | 'ltvSession'

export type DocRecord = {
  key: DocKey
  /** Chemin dans lim-logs (null pour le DHLTV importé en session). */
  path: string | null
  /** SHA du blob GitHub au moment du téléchargement (null si inconnu). */
  sha: string | null
  size: number
  blob: Blob
  /** Nom de fichier d'origine (DHLTV de session), sinon null. */
  name: string | null
  /** Date de récupération ou d'import (ms epoch). */
  fetchedAt: number
}

export type DocMeta = Omit<DocRecord, 'blob'>

const DB_NAME = 'lim_docs_db'
const DB_VERSION = 1
const STORE = 'docs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB_unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB_open_failed'))
    req.onblocked = () => reject(new Error('indexedDB_blocked'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = run(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('indexedDB_request_failed'))
        tx.oncomplete = () => db.close()
        tx.onabort = () => {
          db.close()
          reject(tx.error ?? new Error('indexedDB_tx_aborted'))
        }
      })
  )
}

/** Lecture d'un document stocké. null si absent ou si IndexedDB est indisponible. */
export async function getDocRecord(key: DocKey): Promise<DocRecord | null> {
  try {
    const rec = await withStore<DocRecord | undefined>('readonly', (s) => s.get(key))
    return rec && rec.blob instanceof Blob ? rec : null
  } catch (err) {
    console.warn('[docStore] lecture impossible', key, err)
    return null
  }
}

/** Écriture (remplace l'éventuelle version précédente). false si l'écriture a échoué. */
export async function putDocRecord(rec: DocRecord): Promise<boolean> {
  try {
    await withStore<IDBValidKey>('readwrite', (s) => s.put(rec))
    return true
  } catch (err) {
    console.warn('[docStore] écriture impossible', rec.key, err)
    return false
  }
}

export async function deleteDocRecord(key: DocKey): Promise<void> {
  try {
    await withStore<undefined>('readwrite', (s) => s.delete(key))
  } catch (err) {
    console.warn('[docStore] suppression impossible', key, err)
  }
}

/** Métadonnées de tous les documents stockés (sans les octets), pour le journal. */
export async function listDocMeta(): Promise<DocMeta[]> {
  try {
    const all = await withStore<DocRecord[]>('readonly', (s) => s.getAll())
    return (all ?? []).map(({ blob: _blob, ...meta }) => meta)
  } catch {
    return []
  }
}

/**
 * Demande au système de ne pas purger notre stockage sous pression mémoire.
 * Sur iOS (app installée sur l'écran d'accueil) la purge de 7 jours de Safari ne
 * s'applique pas, mais ceci reste une sécurité. null = API absente.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const st = navigator.storage
    if (!st || typeof st.persist !== 'function') return null
    if (typeof st.persisted === 'function' && (await st.persisted())) return true
    return await st.persist()
  } catch {
    return null
  }
}
