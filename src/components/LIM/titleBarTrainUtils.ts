// src/components/LIM/titleBarTrainUtils.ts
// Fonctions utilitaires de détection et normalisation du numéro de train,
// extraites de TitleBar.tsx pour alléger ce fichier.

export type LIMFields = {
  tren?: string
  trenPadded?: string
  type?: string
  composicion?: string
  unit?: string
}

export type CategoriesByNetwork = {
  ADIF?: string
  LFP?: string
  RFN?: string
}

// Un matériel du catalogue `materiels` du normalisé 2026. Longueur/masse sont
// UNITAIRES (rame US) : on les double quand la composition est UM.
export type MaterielCatalogEntry = {
  nom: string
  longueur: number
  masse: number
}

export type ManualTrainOption = {
  trainNumber: string
  numeroFrance?: string
  relation?: string
  ligne?: string
  categorieEspagne?: string
  categorieFrance?: string
  // Catégories 2026 indexées par réseau (ADIF / LFP / RFN=SNCF). Le bloc info affiche
  // celle du réseau courant déduit du GPS. Absent pour l'ancien format.
  categoriesByNetwork?: CategoriesByNetwork
  // Réseau de l'origine du train (catégorie affichée avant tout signal GPS).
  originNetwork?: 'ADIF' | 'LFP' | 'RFN'
  composition?: string
  materiel?: string
  // Catalogue complet des matériels du normalisé 2026 : sert à afficher
  // longueur/masse (× 2 si UM) et à cycler entre matériels (appui long).
  materielCatalog?: MaterielCatalogEntry[]
}

export type MixedTrainIdentificationMethod =
  | 'filename'
  | 'pdf_first_page_fields'
  | 'pdf_first_page_text'
  | 'pdf_first_page_ocr_fields'
  | 'pdf_first_page_ocr_text'

export const MIXED_TRAIN_OCR_TIMEOUT_MS = 60_000

export type MixedTrainIdentificationResult = {
  train: ManualTrainOption
  method: MixedTrainIdentificationMethod
}

export function toTitleNumber(s?: string | null): string | undefined {
  if (!s) return undefined
  const m = String(s).match(/\d{1,}/)
  if (!m) return undefined
  const n = parseInt(m[0], 10)
  if (!Number.isFinite(n)) return undefined
  return String(n)
}

export function formatTodayForManualImport(): string {
  const d = new Date()
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// Longueur/masse AFFICHÉES = spec UNITAIRE du matériel (catalogue du normalisé 2026)
// × 2 si la composition est UM. Renvoie {} si le matériel est absent du catalogue :
// on n'affiche alors rien plutôt que d'inventer une valeur (décision 10/08). Remplace
// les anciennes constantes en dur (US 200/433 · UM 400/866).
export function getMaterielMetrics(
  materiel: string | undefined,
  composition: string | undefined,
  catalog: MaterielCatalogEntry[] | undefined
): { lengthMeters?: number; massTons?: number } {
  const spec = (catalog ?? []).find((m) => m.nom === materiel)
  if (!spec) return {}
  const factor = String(composition ?? '').trim().toUpperCase() === 'UM' ? 2 : 1
  return { lengthMeters: spec.longueur * factor, massTons: spec.masse * factor }
}

export function buildManualParsedFields(train: ManualTrainOption): LIMFields & Record<string, any> {
  const today = formatTodayForManualImport()
  // Composition : elle NE VIENT PLUS du normalisé (décision 07/08 — hors normalisé).
  // Défaut US ; le conducteur bascule en UM manuellement (appui long sur la tuile).
  const composition = train.composition ?? 'US'
  const metrics = getMaterielMetrics(train.materiel, composition, train.materielCatalog)
  return {
    train: train.trainNumber,
    tren: train.trainNumber,
    trenPadded: train.trainNumber,
    type: train.categorieEspagne,
    // Catégories 2026 par réseau, transportées jusqu'au bloc info (case catégorie).
    categoriesByNetwork: train.categoriesByNetwork,
    originNetwork: train.originNetwork,
    relation: train.relation,
    origenDestino: train.relation,
    rawDate: today,
    fecha: today,
    fechaRaw: today,
    unit: composition,
    composicion: composition,
    material: train.materiel,
    // Catalogue transporté jusqu'au bloc info : longueur/masse + cycle appui long.
    materielCatalog: train.materielCatalog,
    linea: train.ligne,
    line: train.ligne,
    lengthMeters: metrics.lengthMeters,
    longitud: metrics.lengthMeters,
    massTons: metrics.massTons,
    masa: metrics.massTons,
    operador: 'INOUI',
    operadorLogo: '/inoui.png',
    ouigoLogoUrl: '/inoui.png',
    source: 'manual_import',
  }
}

export function normalizeKnownTrainNumber(value?: string | null): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return null
  const normalized = digits.replace(/^0+/, '')
  return normalized || null
}

export function buildDetectedTrainTokenVariants(value: string): string[] {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return []
  const variants = new Set<string>()
  variants.add(digits)
  const withoutLeadingZeros = digits.replace(/^0+/, '')
  if (withoutLeadingZeros) variants.add(withoutLeadingZeros)
  const withoutAllZeros = digits.replace(/0/g, '')
  if (withoutAllZeros) variants.add(withoutAllZeros)
  // Cas observé/anticipé : 090715 doit pouvoir correspondre à 9715.
  if (/^09\d{4}$/.test(digits)) {
    variants.add(`${digits[1]}${digits.slice(3)}`)
  }
  return Array.from(variants).filter(Boolean)
}

export function detectedTokenMatchesKnownTrain(
  detectedToken: string,
  knownTrainNumber?: string
): boolean {
  const normalizedKnown = normalizeKnownTrainNumber(knownTrainNumber)
  if (!normalizedKnown) return false
  return buildDetectedTrainTokenVariants(detectedToken).some(
    (variant) => normalizeKnownTrainNumber(variant) === normalizedKnown
  )
}

export function findUniqueTrainInText(
  text: string,
  trainOptions: ManualTrainOption[]
): ManualTrainOption | null {
  const tokens = String(text ?? '').match(/\d{4,8}/g) ?? []
  const matches = new Map<string, ManualTrainOption>()
  for (const token of tokens) {
    for (const train of trainOptions) {
      const candidateNumbers = [train.trainNumber, train.numeroFrance].filter(
        (value): value is string => typeof value === 'string' && value.trim() !== ''
      )
      const match = candidateNumbers.some((knownNumber) =>
        detectedTokenMatchesKnownTrain(token, knownNumber)
      )
      if (match) matches.set(train.trainNumber, train)
    }
  }
  if (matches.size !== 1) return null
  return Array.from(matches.values())[0] ?? null
}
