// Adaptateur du normalisé 2026 vers la forme ManualTrainOption attendue par
// Mode2026Modal / startNormalizedJourneyFromTrain — même rôle que
// ligneFT.normalized.adapter.ts pour l'ancien format.
//
// ⚠️ LECTURE STATIQUE (décision 11/08) : le fichier publié par l'éditeur est
// EMBARQUÉ dans le bundle, comme l'ancien normalisé. Plus de lecture réseau :
// l'app doit fonctionner en cabine, hors couverture, y compris après un
// démarrage à froid.
import { useMemo } from 'react'
import type { ManualTrainOption, MaterielCatalogEntry } from '../components/LIM/titleBarTrainUtils'
import ligneFt2026Published from './normalized/ligneFT2026.normalized.json'

type LigneFt2026TrainMeta = {
  numeroEspagne?: unknown
  numeroFrance?: unknown
  origine?: unknown
  destination?: unknown
  categorieSNCF?: unknown
  categorieLFP?: unknown
  categorieADIF?: unknown
  materiel?: unknown
  direction?: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// Catalogue `materiels` du 2026 : { "TGV 2N2 3UH": { longueur, masse } } → tableau.
// Longueur/masse sont UNITAIRES (rame US). Les entrées incomplètes sont ignorées
// (on préfère ne rien afficher plutôt qu'une valeur inventée).
function mapMaterielCatalog(data: unknown): MaterielCatalogEntry[] {
  const doc = data as { materiels?: Record<string, { longueur?: unknown; masse?: unknown }> }
  const cat = doc?.materiels && typeof doc.materiels === 'object' ? doc.materiels : {}

  const out: MaterielCatalogEntry[] = []
  for (const [nom, spec] of Object.entries(cat)) {
    const longueur = num(spec?.longueur)
    const masse = num(spec?.masse)
    if (longueur != null && masse != null) out.push({ nom, longueur, masse })
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom))
}

function mapLigneFt2026DocToOptions(data: unknown): ManualTrainOption[] {
  const doc = data as { trains?: Record<string, { variants?: Array<{ meta?: LigneFt2026TrainMeta }> }> }
  const trains = doc?.trains && typeof doc.trains === 'object' ? doc.trains : {}
  const materielCatalog = mapMaterielCatalog(data)

  return Object.entries(trains)
    .map(([trainKey, t]) => {
      const meta = t?.variants?.[0]?.meta ?? {}
      const trainNumber = str(meta.numeroEspagne) ?? trainKey
      const origine = str(meta.origine)
      const destination = str(meta.destination)
      const option: ManualTrainOption = {
        trainNumber,
        numeroFrance: str(meta.numeroFrance),
        relation: origine && destination ? `${origine} - ${destination}` : undefined,
        // "ligne" (libellé descriptif de l'ancien format) : pas d'équivalent 2026.
        categorieEspagne: str(meta.categorieADIF),
        categorieFrance: str(meta.categorieSNCF),
        // Les 3 catégories 2026, indexées par réseau (le bloc info affiche celle du
        // réseau courant déduit du GPS : ADIF / LFP / RFN=SNCF).
        categoriesByNetwork: {
          ADIF: str(meta.categorieADIF),
          LFP: str(meta.categorieLFP),
          RFN: str(meta.categorieSNCF),
        },
        // Réseau de l'origine (pour la catégorie affichée AVANT tout signal GPS).
        // Les origines sont toujours en Espagne (sudNord) ou en France (nordSud) —
        // jamais en zone LFP (vérifié sur les 9 trains 2026).
        originNetwork: str(meta.direction) === 'nordSud' ? 'RFN' : 'ADIF',
        // "composition" (US/UM, ancien format) : pas d'équivalent 2026 (catalogue
        // matériel direct, sans notion de composition séparée).
        materiel: str(meta.materiel),
        materielCatalog,
      }
      return option
    })
    .sort((a, b) => {
      const na = Number(a.trainNumber)
      const nb = Number(b.trainNumber)
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
      return a.trainNumber.localeCompare(b.trainNumber)
    })
}

// Lecture SYNCHRONE du fichier embarqué : plus d'attente ni d'échec réseau
// possible. La forme de retour (`loading` / `error`) est conservée pour ne rien
// changer chez les appelants.
export function useLigneFt2026TrainOptions(): {
  options: ManualTrainOption[]
  loading: boolean
  error: string | null
} {
  const options = useMemo(
    () => mapLigneFt2026DocToOptions(ligneFt2026Published),
    []
  )

  return { options, loading: false, error: null }
}
