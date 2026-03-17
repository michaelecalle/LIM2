// src/lib/ancres_lfp.ts
export type AnchorLFP = {
  pk_lfp: number
  s_km: number
  lat: number
  lon: number
  index_ruban: number
  label: string
}


export const ANCRES_LFP: AnchorLFP[] = [

  {
  pk_lfp: 44.353,
  s_km: 136.442302,
  lat: 42.2873328,
  lon: 2.9331729,
  index_ruban: 5460,
  label: 'LIMITE ADIF-LFPSA',
},

  {
    pk_lfp: 42.949,
    s_km: 137.092765,
    lat: 42.2929145,
    lon: 2.9308066,
    index_ruban: 5486,
    label: 'LLERS',
  },
  {
    pk_lfp: 29.735,
    s_km: 151.224504,
    lat: 42.4099208,
    lon: 2.86845,
    index_ruban: 6051,
    label: 'AIGUILLES JONQUERA SUD',
  },
  {
    pk_lfp: 28.911,
    s_km: 151.875081,
    lat: 42.4156749,
    lon: 2.8670154,
    index_ruban: 6077,
    label: 'AIGUILLES JONQUERA NORD',
  },
  {
    pk_lfp: 25.589,
    s_km: 155.278283,
    lat: 42.4459642,
    lon: 2.861992,
    index_ruban: 6213,
    label: 'TETE SUD DU TUNNEL',
  },
  {
    pk_lfp: 24.579,
    s_km: 156.329348,
    lat: 42.4554166,
    lon: 2.8619543,
    index_ruban: 6255,
    label: 'FRONTIERE',
  },
  {
    pk_lfp: 17.201,
    s_km: 163.686638,
    lat: 42.5214816,
    lon: 2.859137,
    index_ruban: 6549,
    label: 'TETE NORD DU TUNNEL',
  },
  {
    pk_lfp: 16.297,
    s_km: 164.587451,
    lat: 42.5294777,
    lon: 2.8573721,
    index_ruban: 6585,
    label: 'AIGUILLES TRESSERES SUD',
  },
  {
    pk_lfp: 14.608,
    s_km: 166.213922,
    lat: 42.5439144,
    lon: 2.8541787,
    index_ruban: 6650,
    label: 'AIGUILLES TRESSERES NORD',
  },
  {
    pk_lfp: 12.920,
    s_km: 167.940515,
    lat: 42.5592851,
    lon: 2.8512218,
    index_ruban: 6719,
    label: 'SAUT DE MOUTON',
  },
  {
    pk_lfp: 0.0,
    s_km: 180.849045,
    lat: 42.6703533,
    lon: 2.8149884,
    index_ruban: 7235,
    label: 'ORIGINE LFP',
  },
]