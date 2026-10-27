// src/lib/trainPosition.ts
// 27/10 — Position courante du train (pk_internal), lue à la demande par ce qui
// n'est pas une vue FT (ex. menu Paramètres → Tunnels).
//
// Les deux vues (verticale FT, horizontale FTHorizontal) restent montées en
// permanence et calculent chacune la position à leur façon (GPS ou estimation
// horaire). Chacune s'enregistre ici ; on lit celle de la vue AFFICHÉE, la vue
// masquée (display: none) n'ayant pas de géométrie fiable.

export type TrainPkProvider = {
  isVisible: () => boolean
  /** pk_internal du train, ou null si la position n'est pas déterminée. */
  getPkInternal: () => number | null
}

const providers = new Set<TrainPkProvider>()

export function registerTrainPkProvider(p: TrainPkProvider): () => void {
  providers.add(p)
  return () => { providers.delete(p) }
}

export function getCurrentTrainPkInternal(): number | null {
  for (const p of providers) {
    if (!p.isVisible()) continue
    const pk = p.getPkInternal()
    if (typeof pk === 'number' && Number.isFinite(pk)) return pk
  }
  return null
}
