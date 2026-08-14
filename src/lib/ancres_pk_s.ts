// src/lib/ancres_pk_s.ts

export type AnchorPkS = {
  pk: number
  s_km: number
  lat: number
  lon: number
  index_ruban: number
  label: string
}

export const ANCRES_PK_S: AnchorPkS[] = [
  {
    pk: 752.355,
    s_km: 136.442302,
    lat: 42.2873328,
    lon: 2.9331729,
    index_ruban: 5460,
    label: 'LIMITE ADIF-LFPSA',
  },
  {
    pk: 749.618,
    s_km: 133.765372,
    lat: 42.2643504,
    lon: 2.9428601,
    index_ruban: 5353,
    label: 'FIGUERES-VILAFANT',
  },
  // ── Ancres PCA (14/08) — PK OFFICIELS lus dans « L50 FGV - BSN.pdf »
  // (valeur du POSTE, pas de la caseta ; le normalisé arrondit aux 100 m).
  // Positions dérivées de l'interpolation existante puis calées au point de
  // ruban le plus proche (écart ≤ 5 m) : NEUTRES tant que non contrôlées sur
  // le terrain — à vérifier en roulant, puis affiner si besoin.
  {
    pk: 738.165,
    s_km: 122.359062,
    lat: 42.1691567,
    lon: 2.9132258,
    index_ruban: 4897,
    label: 'PCA PONTOS',
  },
  {
    pk: 726.157,
    s_km: 110.406857,
    lat: 42.0737160,
    lon: 2.8493313,
    index_ruban: 4419,
    label: 'PCA VILADEMULS',
  },
  {
    pk: 714.748,
    s_km: 99.051602,
    lat: 41.9797786,
    lon: 2.8160019,
    index_ruban: 3965,
    label: 'GIRONA',
  },
  {
    pk: 710.655,
    s_km: 94.774317,
    lat: 41.9440379,
    lon: 2.7994688,
    index_ruban: 3794,
    label: 'BIF. GIRONA MERCADERIES',
  },
  {
    pk: 703.510,
    s_km: 87.646222,
    lat: 41.8855810,
    lon: 2.7660632,
    index_ruban: 3509,
    label: "VILOBI D'ONYAR",
  },
  {
    pk: 691.880,
    s_km: 75.968596,
    lat: 41.7940621,
    lon: 2.6999768,
    index_ruban: 3042,
    label: 'PCA RIUDARENES',
  },
  {
    pk: 682.015,
    s_km: 66.072167,
    lat: 41.7402867,
    lon: 2.6105312,
    index_ruban: 2645,
    label: 'BASE MTO. RIELLS',
  },
 {
  pk: 679.275,
  s_km: 63.352320,
  lat: 41.7298576,
  lon: 2.5811564,
  index_ruban: 2536,
  label: 'RIELLS-A. V.',
},
  {
    pk: 670.544,
    s_km: 54.643267,
    lat: 41.6957312,
    lon: 2.4883191,
    index_ruban: 2187,
    label: 'PCA SANT CELONI',
  },
  {
    pk: 662.641,
    s_km: 46.749753,
    lat: 41.6494339,
    lon: 2.4219488,
    index_ruban: 1871,
    label: 'LLINARS-A. V.',
  },
  {
    pk: 654.100,
    s_km: 38.210214,
    lat: 41.6037968,
    lon: 2.3411087,
    index_ruban: 1529,
    label: 'PCA LA ROCA',
  },
{
  pk: 640.547,
  s_km: 24.650036,
  lat: 41.5301207,
  lon: 2.2194426,
  index_ruban: 986,
  label: 'BIF. MOLLET',
},
  {
    pk: 627.739,
    s_km: 11.918290,
    lat: 41.4245554,
    lon: 2.1956843,
    index_ruban: 477,
    label: 'LA SAGRERA AV',
  },
  {
    pk: 621.052,
    s_km: 4.923695,
    lat: 41.3792115,
    lon: 2.1399158,
    index_ruban: 197,
    label: 'BARCELONA SANTS',
  },
  {
    pk: 616.0,
    s_km: 0.075089,
    lat: 41.3453334,
    lon: 2.1147458,
    index_ruban: 3,
    label: 'BIF. CAN TUNIS-A. V.',
  },
  {
    pk: 615.9,
    s_km: 0.0,
    lat: 41.344667,
    lon: 2.1148913,
    index_ruban: 0,
    label: 'CAN TUNIS-A. V.',
  },
]
