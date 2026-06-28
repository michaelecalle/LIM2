// Récupération des documents PDF "gérés" (mis à jour via le LIM Editor) depuis lim-logs (privé).
// Si le document n'y est pas encore publié (ou pas de token / réseau), retourne null →
// l'appelant retombe alors sur le PDF statique livré avec l'app (repli, jamais de trou).

const DOC_LOGS_PATH: Record<string, string> = {
  manuel: 'documents/manuel-utilisateur.pdf',
  guia: 'documents/guia-bsn.pdf',
}

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
