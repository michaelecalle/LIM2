// src/data/ligneFT_FR.ts
// Bloc FRANCE : PERPIGNAN ↔ LIMITE LFP/ADIF (données fixes, non lues du PDF)

import type { FTEntry } from "./ligneFT";

// Sens France → Espagne : bloc France doit apparaître EN HAUT (avant la limite)
export const FT_FR_BLOC_VERS_ESPAGNE: FTEntry[] = [
  {
    // PERPIGNAN (PK RFN 467.500)
    pk: "467.500",
    dependencia: "PERPIGNAN",
    network: "RFN",
    pk_rfn: "467.500",
    // pk_internal ici n'est PAS utilisé comme ordre d'affichage pour le moment
    pk_internal: 805.5,

    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: false,
  },
  {
    // Limite RFN ↔ LFP (PK RFN 473.300)
    pk: "473.300",
    dependencia: "LIMITE RFN - LFPSA",
    network: "RFN",
    pk_rfn: "473.300",
    pk_internal: 799.7,

    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: false,
  },
  {
    // PK interne continu (virtuel) : correspond au PK LFP 0.0
    pk: "0.0",
    dependencia: "LFP PK 0 (POINT TECHNIQUE)",
    network: "LFP",
    pk_lfp: "0.0",
    pk_internal: 796.8,

    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: false,
  },
];

export const FT_FR_BLOC_VERS_FRANCE: FTEntry[] = [...FT_FR_BLOC_VERS_ESPAGNE].reverse();
