// src/lib/deviceId.ts
// 11/11 — IDENTIFIANT D'APPAREIL anonyme pour les journaux.
//
// Généré au premier lancement (6 caractères lisibles, tirés au hasard), jamais saisi,
// jamais affiché (anonymat des testeurs voulu par l'utilisateur : le couple train/date
// suffit à identifier un conducteur ; l'identifiant sert seulement à savoir si un bug
// touche un seul appareil ou tous). Repris dans l'en-tête du journal (`# device=`),
// dans l'événement `session:start` et dans le nom du ZIP (« … [K7M2QX].zip »).
//
// Persistance : enregistré à DEUX endroits (localStorage + une petite base IndexedDB
// dédiée) ; au démarrage, celui qui manque est recopié depuis l'autre. Une mise à jour
// de l'app ne touche à aucun des deux ; seule la suppression de l'app de l'écran
// d'accueil les efface (un nouvel identifiant naît alors à la réinstallation). On demande
// aussi le stockage persistant au système, pour se protéger d'un nettoyage automatique.

const LS_KEY = 'lim:device-id'
const DB_NAME = 'lim_device_db'
const DB_VERSION = 1
const STORE = 'kv'
const ID_RE = /^[A-Z0-9]{6}$/
// Sans 0/O/1/I pour rester lisible à l'oral si jamais il faut le dicter.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

let cached: string | null = null

function generate(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function readLocal(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY)
    return v && ID_RE.test(v) ? v : null
  } catch {
    return null
  }
}

function writeLocal(id: string): void {
  try { localStorage.setItem(LS_KEY, id) } catch {}
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB_unavailable')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB_open_failed'))
  })
}

async function readIdb(): Promise<string | null> {
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('deviceId')
      req.onsuccess = () => {
        const v = req.result
        resolve(typeof v === 'string' && ID_RE.test(v) ? v : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function writeIdb(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(id, 'deviceId')
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {}
}

/**
 * Identifiant immédiatement disponible (localStorage, sinon généré sur-le-champ et
 * enregistré). Utilisé par le logger, qui est synchrone.
 */
export function getDeviceIdSync(): string {
  if (cached) return cached
  const local = readLocal()
  if (local) { cached = local; return local }
  const id = generate()
  cached = id
  writeLocal(id)
  void writeIdb(id)
  return id
}

/**
 * À appeler au démarrage de l'app : réconcilie les deux copies (celle qui manque est
 * recopiée depuis l'autre ; IndexedDB fait foi si localStorage a été vidé) et demande
 * le stockage persistant.
 */
export async function initDeviceId(): Promise<string> {
  const local = readLocal()
  const idb = await readIdb()
  let id: string
  if (idb) {
    id = idb
    if (local !== idb) writeLocal(idb)
  } else if (local) {
    id = local
    await writeIdb(local)
  } else {
    id = generate()
    writeLocal(id)
    await writeIdb(id)
  }
  cached = id
  try {
    if (navigator.storage?.persist) void navigator.storage.persist()
  } catch {}
  return id
}
