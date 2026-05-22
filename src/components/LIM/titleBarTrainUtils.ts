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

export type ManualTrainOption = {
  trainNumber: string
  numeroFrance?: string
  relation?: string
  ligne?: string
  categorieEspagne?: string
  categorieFrance?: string
  composition?: string
  materiel?: string
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

export function getCompositionMetrics(composition?: string): {
  lengthMeters?: number
  massTons?: number
} {
  const value = String(composition ?? '').trim().toUpperCase()
  if (value === 'US') return { lengthMeters: 200, massTons: 433 }
  if (value === 'UM') return { lengthMeters: 400, massTons: 866 }
  return {}
}

export function buildManualParsedFields(train: ManualTrainOption): LIMFields & Record<string, any> {
  const today = formatTodayForManualImport()
  const metrics = getCompositionMetrics(train.composition)
  return {
    train: train.trainNumber,
    tren: train.trainNumber,
    trenPadded: train.trainNumber,
    type: train.categorieEspagne,
    relation: train.relation,
    origenDestino: train.relation,
    rawDate: today,
    fecha: today,
    fechaRaw: today,
    unit: train.composition,
    composicion: train.composition,
    material: train.materiel,
    linea: train.ligne,
    line: train.ligne,
    lengthMeters: metrics.lengthMeters,
    longitud: metrics.lengthMeters,
    massTons: metrics.massTons,
    masa: metrics.massTons,
    operador: 'OUIGO',
    operadorLogo: '/ouigo.svg',
    ouigoLogoUrl: '/ouigo.svg',
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
