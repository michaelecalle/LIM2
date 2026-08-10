// Adaptateur du normalisé 2026 (fichier PUBLIÉ par lim-editor, cf.
// ligneFT2026.fetch.ts) vers la forme ManualTrainOption attendue par
// Mode2026Modal / startNormalizedJourneyFromTrain — même rôle que
// ligneFT.normalized.adapter.ts pour l'ancien format, mais en LECTURE
// RÉSEAU (pas de fichier statique embarqué).
//
// Mapping volontairement best-effort : certains champs de l'ancien format
// n'ont pas d'équivalent direct dans le 2026 (ligne, composition US/UM) —
// laissés vides plutôt qu'inventés, pour que les écarts soient visibles
// (chantier d'adaptation du bloc info, pas encore fait).
import { useEffect, useState } from 'react'
import type { ManualTrainOption } from '../components/LIM/titleBarTrainUtils'
import { fetchLigneFt2026Preview } from './ligneFT2026.fetch'

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

function mapLigneFt2026DocToOptions(data: unknown): ManualTrainOption[] {
  const doc = data as { trains?: Record<string, { variants?: Array<{ meta?: LigneFt2026TrainMeta }> }> }
  const trains = doc?.trains && typeof doc.trains === 'object' ? doc.trains : {}

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

export function useLigneFt2026TrainOptions(): {
  options: ManualTrainOption[]
  loading: boolean
  error: string | null
} {
  const [options, setOptions] = useState<ManualTrainOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchLigneFt2026Preview().then((result) => {
      if (cancelled) return
      if (!result) {
        setError('Fichier 2026 indisponible (réseau, ou pas encore publié).')
        setLoading(false)
        return
      }
      setOptions(mapLigneFt2026DocToOptions(result.data))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { options, loading, error }
}
