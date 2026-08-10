// Lecture du normalisé 2026 PUBLIÉ (repo lim-editor, route serverless dédiée —
// pas de token GitHub côté LIM2, contrairement au pattern lim-logs existant
// pour LTV/docs). Chantier de reconnaissance (comparer l'ancien format déjà
// consommé par LIM2 au nouveau) : ce module n'alimente ENCORE aucun rendu.
const LIGNE_EDITOR_CURRENT_URL = 'https://lim-editor-squelette.vercel.app/api/ligneft2026/current'

export type LigneFt2026FetchResult = {
  data: unknown
  publishedAt: string | null
} | null

export async function fetchLigneFt2026Preview(): Promise<LigneFt2026FetchResult> {
  try {
    const res = await fetch(LIGNE_EDITOR_CURRENT_URL, { cache: 'no-store' })
    const payload = (await res.json()) as { ok?: boolean; data?: unknown; publishedAt?: string | null }
    if (!res.ok || !payload || payload.ok !== true) return null
    return { data: payload.data, publishedAt: payload.publishedAt ?? null }
  } catch {
    return null
  }
}
