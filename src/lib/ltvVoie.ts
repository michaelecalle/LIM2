// src/lib/ltvVoie.ts
//
// Voie(s) concernée(s) par une LTV, COMMUN aux vues verticale (FT.tsx) et
// horizontale (FTHorizontal.tsx) pour qu'elles ne divergent jamais (26/10).
//
// Codes ADIF du champ `via` : l / ll = voie I / II (lus « l » au lieu de « I »),
// A = ambas (toutes les voies), E = estación (voies de gare citées dans les
// observations, sinon toutes), autre (ex. G1) = voies citées, sinon toutes.
// Un numéro collé à une lettre (« G1 » de « 9-G1 ») n'est pas un numéro de voie.
// Inscription = lettres du DOCUMENT SOURCE (A, E, I, II), jamais une traduction
// (demande utilisateur : pas « Gare »).

export type LtvVoieRow = { via?: string; observaciones?: string }
export type LtvCote = 'pair' | 'impair'

export function ltvVoies(row: LtvVoieRow): { cotes: LtvCote[]; label: string } {
  const code = String(row.via ?? '').trim()
  if (/^(l|I|1)$/.test(code)) return { cotes: ['impair'], label: 'I' }
  if (/^(ll|II|2)$/.test(code)) return { cotes: ['pair'], label: 'II' }
  if (/^A$/i.test(code)) return { cotes: ['pair', 'impair'], label: 'A' }
  const obs = String(row.observaciones ?? '')
  const m = obs.match(/v[íi]as?\b([^\n]*)/i)
  const nums = m ? (m[1].match(/(?<![A-Za-z])\d+/g) ?? []).map(Number) : []
  const estacion = /^E$/i.test(code)
  if (nums.length === 0) return { cotes: ['pair', 'impair'], label: code || '?' }
  const cotes = new Set<LtvCote>(nums.map((n) => (n % 2 === 0 ? 'pair' : 'impair')))
  // E : lettre + voies citées (« E 4-6 ») ; autre code : la voie telle qu'écrite
  // dans l'observation (« 9-G1 » à La Sagrera).
  const brut = obs.match(/v[íi]as?\s+(\d+(?:-[A-Za-z0-9]+)?)/i)?.[1]
  const label = estacion ? `E ${nums.join('-')}` : brut ?? nums.join('-')
  return { cotes: [...cotes], label }
}

// Regroupe les inscriptions de plusieurs LTV de même plage et même vitesse :
// « I » + « II » → « I-II » ; « E 4 » + « E 6 » → « E 4-6 ».
export function regrouperVoies(labels: string[]): string {
  const uniques = [...new Set(labels.filter(Boolean))]
  if (uniques.length <= 1) return uniques[0] ?? ''
  if (uniques.every((l) => /^E \S+$/.test(l))) {
    const voies = [...new Set(uniques.flatMap((l) => l.slice(2).split('-')))]
    return `E ${voies.join('-')}`
  }
  return uniques.join('-')
}
