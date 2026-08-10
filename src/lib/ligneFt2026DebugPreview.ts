// DEV UNIQUEMENT (jamais en build de prod) : va chercher le normalisé 2026
// publié et en affiche un résumé en console, pour comparer son format à
// l'ancien (déjà consommé via src/data/normalized/ligneFT.normalized.ts).
// N'alimente AUCUN rendu — reconnaissance seulement, avant migration bloc par
// bloc (info, puis FT ; LTV reste sur son pipeline actuel, indépendant).
import { fetchLigneFt2026Preview } from '../data/ligneFT2026.fetch'

if (import.meta.env.DEV) {
  void (async () => {
    const result = await fetchLigneFt2026Preview()
    if (!result) {
      console.log('[ligneFT2026 preview] indisponible (pas encore publié, ou réseau).')
      return
    }
    const { data, publishedAt } = result
    ;(window as any).__ligneFT2026Preview = data

    const doc = data as {
      formatVersion?: unknown
      trains?: Record<string, unknown>
      ligneVersions?: Record<string, { sudNord?: unknown[]; nordSud?: unknown[] }>
    }
    const trainNumbers = doc.trains ? Object.keys(doc.trains) : []
    const firstVersion = doc.ligneVersions ? Object.values(doc.ligneVersions)[0] : undefined
    const sampleRow = firstVersion?.sudNord?.[0]

    console.log(
      `[ligneFT2026 preview] formatVersion=${doc.formatVersion} publishedAt=${publishedAt} ` +
        `trains=${trainNumbers.length} (${trainNumbers.join(', ')})`
    )
    console.log('[ligneFT2026 preview] exemple de ligne (sudNord[0]) :', sampleRow)
    console.log('[ligneFT2026 preview] document complet exposé sur window.__ligneFT2026Preview')
  })()
}
