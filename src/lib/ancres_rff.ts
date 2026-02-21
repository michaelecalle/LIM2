// src/lib/ancres_rff.ts
export type AnchorRFF = {
  pk_rff: number
  s_km: number
  lat: number
  lon: number
  index_ruban: number
  label: string
}

export const ANCRES_RFF: AnchorRFF[] = [
  {
    pk_rff: 467.5,
    s_km: 187.710919,
    lat: 42.6959852,
    lon: 2.8792235,
    index_ruban: 7510,
    label: 'GARE DE PERPIGNAN',
  },
  {
    pk_rff: 468.0,
    s_km: 187.161298,
    lat: 42.6912134,
    lon: 2.8804617,
    index_ruban: 7488,
    label: 'PRCI',
  },
  {
    pk_rff: 470.3,
    s_km: 184.916944,
    lat: 42.6861403,
    lon: 2.8545419,
    index_ruban: 7398,
    label: 'C801C803',
  },
  {
    pk_rff: 471.1,
    s_km: 184.119007,
    lat: 42.6850004,
    lon: 2.8449038,
    index_ruban: 7366,
    label: 'ORIGINE VOIE BANALISEE',
  },
  {
    pk_rff: 473.3,
    s_km: 182.972053,
    lat: 42.6839023,
    lon: 2.8309709,
    index_ruban: 7320,
    label: 'LIMITE RFN-LFP',
  },
]