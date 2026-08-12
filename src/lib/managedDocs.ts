// Récupération des documents PDF "gérés" (mis à jour via le LIM Editor) depuis lim-logs (privé).
// Si le document n'y est pas encore publié (ou pas de token / réseau), retourne null →
// l'appelant retombe alors sur le PDF statique livré avec l'app (repli, jamais de trou).

const DOC_LOGS_PATH: Record<string, string> = {
  manuel: 'documents/manuel-utilisateur.pdf',
  guia: 'documents/guia-bsn.pdf',
  // Livret FT complet (tous les trains à la suite), pour le mode secours.
  // Déposé par l'éditeur, accompagné de son index de pages (cf. plus bas).
  livretFt: 'documents/livret-ft.pdf',
}

/** Index du livret FT : numéro de train (n° espagnol) → 1re page (1-indexée). */
export type LivretFtPageIndex = Record<string, number>

const LIVRET_FT_INDEX_PATH = 'documents/livret-ft.pages.json'

/**
 * Tente de charger un document géré depuis lim-logs et renvoie une object-URL (blob PDF).
 * Renvoie null si indisponible. ⚠️ L'appelant doit révoquer l'URL (URL.revokeObjectURL) au démontage.
 */
export async function fetchManagedDocBlobUrl(docKey: string): Promise<string | null> {
  const path = DOC_LOGS_PATH[docKey]
  if (!path) return null

  const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
  if (!token) return null
  const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
  const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?t=${Date.now()}`,
      {
        // média "raw" → octets directs (pas de limite "inline" de 1 Mo)
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      }
    )
    if (!res.ok) return null // 404 = pas encore publié → repli statique
    const blob = await res.blob()
    const pdfBlob =
      blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
    return URL.createObjectURL(pdfBlob)
  } catch {
    return null
  }
}

/**
 * Charge l'index de pages du livret FT depuis lim-logs.
 * Renvoie null si indisponible (pas encore publié, pas de token, réseau absent) →
 * l'appelant affiche alors le livret depuis la page 1 plutôt que rien.
 *
 * ⚠️ Les clés sont les numéros de train ESPAGNOLS, sous forme de chaînes.
 */
export async function fetchLivretFtPageIndex(): Promise<LivretFtPageIndex | null> {
  const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
  if (!token) return null
  const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
  const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${LIVRET_FT_INDEX_PATH}?t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      }
    )
    if (!res.ok) return null // 404 = pas encore publié

    const raw = JSON.parse(await res.text()) as unknown
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
 * Charge les OCTETS du PDF SOURCE LTV le plus récent (déposé dans lim-logs à côté du
 * normalisé, par LIM / l'éditeur / le visualisateur). Renvoie null si indisponible.
 * On renvoie les octets (et non une iframe/URL) car le mode secours doit RENDRE le PDF
 * en images : une iframe PDF n'affiche que le haut de la 1re page sur iOS.
 */
export async function fetchLtvSourcePdfBytes(): Promise<ArrayBuffer | null> {
  const token = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
  if (!token) return null
  const owner = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
  const repo = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
  const path = 'ltv-normalized/current.pdf'

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      }
    )
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}
