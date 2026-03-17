// src/data/ligneFT.ts
// Source de vérité pour la feuille de train (FT)
//
// On gère deux sens : PAIR et IMPAIR.
// IMPORTANT : L'ordre des entrées reste en PK croissant (615.9 → 752.4).
// Même pour le sens PAIR (qui roule en PK décroissant en réel), on garde le même ordre croissant ici,
// et on encode les vitesses/vmax selon le sens PAIR ou IMPAIR directement dans FT_LIGNE_PAIR / FT_LIGNE_IMPAIR.
//
// Champs principaux utilisés par l'affichage :
// - pk: affichage Sit Km (colonne S)
// - dependencia: nom (colonne D)
//
// Remarques rouges :
// - note?: string (ancienne forme, une seule ligne rouge)
// - notes?: string[] (plusieurs lignes rouges)
// - isNoteOnly?: true si la ligne ne représente pas une dependencia classique,
//   mais uniquement des remarques rouges. (Elle est affichée AVANT la gare correspondante)
//
// Colonnes techniques :
// - bloqueo: "↓ BCA ↓" etc. (colonne B / Bloqueo)
// - radio: "◯ GSMR" etc. (colonne R / Radio)
//
// Profil de ligne (RC / Ramp Caract) :
// - rc: valeur numérique de rampe/pente en ‰ (ex: 25 / 28 / 18)
// - rc_bar: true si ce PK est une limite de changement de rampe, donc on affiche une barre horizontale
//   dans la colonne RC à cet endroit. Pas de barre aux extrémités de la fiche.
//
// Vitesse maximale (V Max) :
// - vmax: vitesse maximale en km/h à partir de ce PK (dans le sens considéré)
// - vmax_bar: true si on veut une barre horizontale dans la colonne V Max à ce PK
//   (la barre est purement graphique depuis la simplification de FT.tsx).
// - vmax_highlight: true si la vitesse était marquée avec un astérisque (*) dans la source.
//   (pour l’instant, on laisse ça de côté ; on pourra le réactiver plus tard)
//
// Autres colonnes possibles (pas encore exploitées mais réservées) :
// - etcs: niveau ETCS (colonne N). Par défaut on affichera "①" si absent.
// - hora, tecnico, conc: colonnes H / Técn / Conc
//
// NOTE IMPORTANTE :
// - Les lignes isNoteOnly reçoivent aussi rc et vmax cohérents avec leur zone,
//   mais elles sont ignorées pour les calculs de timeline.

export type FtNetwork = "RFN" | "LFP" | "ADIF";

export interface FTEntry {
  /**
   * pk = repère "chaîne" historique de la FT (actuellement ADIF 615.9 → 752.4).
   * On le conserve pour ne rien casser (tri, CSV_ZONES, timelines VMAX/RC, etc.).
   */
  pk: string;

  dependencia: string;

  // --- Multi-réseaux (préparation extension France) --------------------------
  /**
   * Réseau auquel appartient l’entrée (optionnel pour compatibilité).
   * On le renseignera progressivement lors de l’ajout Perpignan → Limite.
   */
  network?: FtNetwork;

  /**
   * PK par réseau (format libre: "PK 123.4", "123.4", "KP 123+400", etc.)
   * L’affichage décidera plus tard lequel montrer en colonne S.
   */
  pk_rfn?: string;
  pk_lfp?: string;
  pk_adif?: string;

  // PK interne continu (utilisé pour calculs: timelines, zones CSV, position)
  pk_internal?: number;

  // Remarques rouges
  note?: string;
  notes?: string[];

  isNoteOnly?: boolean;

  // Colonnes constantes
  bloqueo?: string;
  bloqueo_bar?: 1 | 2; // séparateurs Bloqueo (1=RFN↔LFPSA, 2=ADIF↔LFPSA)
  radio?: string;

  // Vitesse maximale (colonne V)
  vmax?: number;
  vmax_bar?: boolean;
  vmax_highlight?: boolean;

  // Profil de ligne (colonne RC)
  rc?: number;
  rc_bar?: boolean;

  // Autres colonnes à venir
  etcs?: string;
  hora?: string;
  tecnico?: string;
  conc?: string;
}
// -----------------------------------------------------------------------------
// CSV_ZONES : zones de baisse significative de vitesse (CSV)
// -----------------------------------------------------------------------------

export type CsvSens = "PAIR" | "IMPAIR";

export interface CsvZone {
  sens: CsvSens;
  pkFrom: number;
  pkTo: number;
  ignoreIfFirst?: boolean;
}

export const CSV_ZONES: CsvZone[] = [
  {
    sens: "PAIR",
    pkFrom: 715.5,
    pkTo: 714.7,
    // ignoreIfFirst: false par défaut
  },
  {
    // Zone 2 : même sens que la zone GIRONA
    // CSV entre PK 632.4 et 630.7 (PK croissants dans le fichier)
    sens: "PAIR",
    pkFrom: 632.4,
    pkTo: 630.7,
  },
  {
    // Zone 3 : CSV entre PK 629.4 et 627.7
    // Toujours pour les trains dans le même sens (PAIR)
    sens: "PAIR",
    pkFrom: 629.4,
    pkTo: 627.7,
  },
  {
    // Zone 4 : CSV entre PK 624.3 et 623.8
    // Même sens de marche (PAIR)
    sens: "PAIR",
    pkFrom: 624.3,
    pkTo: 623.8,
  },
  {
    // Zone 5 : CSV 30 entre PK 620.2 et 621.0 (PK croissants, sens PAIR)
    sens: "PAIR",
    pkFrom: 620.2,
    pkTo: 621.0,
  },

  {
    // Zone 5 : CSV pour le sens opposé (IMPAIR)
    // entre PK 626.7 et 627.7
    sens: "IMPAIR",
    pkFrom: 626.7,
    pkTo: 627.7,
  },
  {
    // Zone 6 : CSV pour le sens opposé (IMPAIR)
    // entre PK 709.9 et 710.7
    sens: "IMPAIR",
    pkFrom: 709.9,
    pkTo: 710.7,
  },
  {
    // Zone 7 : portion 30 km/h 620.2 → 621.0
    // sens des PK croissants (FT_LIGNE_PAIR) => sens "IMPAIR" dans notre code
    sens: "IMPAIR",
    pkFrom: 620.2,
    pkTo: 621.0,
  },
  {
    // Zone 8 : portion 30 km/h 621.7 → 621.0
    // sens des PK décroissants (FT_LIGNE_IMPAIR inversé) => sens "PAIR" dans notre code
    sens: "PAIR",
    pkFrom: 621.7,
    pkTo: 621.0,
  },
];

// -----------------------------------------------------------------------------
// FT_LIGNE_PAIR : sens PAIR
// -----------------------------------------------------------------------------

export const FT_LIGNE_PAIR: FTEntry[] = [
  {
    pk: "615.9",
    dependencia: "CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: false, // pas de barre au tout début
  },
  {
    pk: "616.0",
    dependencia: "BIF CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 95,
    vmax_bar: true,
  },
  {
    pk: "618.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 85,
    vmax_bar: true,
  },
  {
    pk: "619.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 60,
    vmax_bar: true,
  },
  {
    pk: "620.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "621.0",
    dependencia: "BARCELONA SANTS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: true, // changement 25→28
    vmax: 30,
  },
  {
    pk: "621.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "623.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 80,
    vmax_bar: true,
  },
  {
    pk: "624.3",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "626.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },

  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["35 VIAS ESTACIONAM. V11, V19 Y V10, V18"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },

  {
    pk: "627.7",
    dependencia: "LA SAGRERA AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },
  {
    pk: "629.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 110,
    vmax_bar: true,
  },
  {
    pk: "630.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 130,
    vmax_bar: true,
  },
  {
    pk: "632.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },
  {
    pk: "634.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "636.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "639.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 185,
    vmax_bar: true,
  },
  {
    pk: "640.9",
    dependencia: "BIF. MOLLET",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "641.3",
    dependencia: "BIF. MOLLET-AGUJA KM. 641,3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: true,
  },
  {
    pk: "641.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 195,
    vmax_bar: true,
  },
  {
    pk: "643.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },
  {
    pk: "644.3",
    dependencia: "BIF. MOLLET-AG.KM. 644.3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "654.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "655.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "655.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "660.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "661.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "662.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "662.5",
    dependencia: "LLINARS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "673.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "679.3",
    dependencia: "RIELLS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "680.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "682.0",
    dependencia: "BASE MTO. RIELLS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "684.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "703.5",
    dependencia: "VILOBI D'ONYAR",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "707.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "709.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 125,
    vmax_bar: true,
  },

  {
    pk: "710.7",
    dependencia: "BIF. GIRONA-MERCADERIES",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 125,
    vmax_bar: true,
  },

  {
    pk: "713.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 120,
    vmax_bar: true,
  },

  {
    pk: "714.7",
    dependencia: "GIRONA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "715.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 165,
    vmax_bar: true,
  },

  {
    pk: "716.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "720.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "723.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["80 AL PASO VIAS 3, 4 Y 6", "50 AL PASO VIA 7"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

{
  pk: "749.6",
  dependencia: "FIGUERES-VILAFANT",
  bloqueo: "↓ BCA ↓",
  radio: "◯ GSMR",
  rc: 18,
  rc_bar: false,
},

{
  pk: "752.4",
  dependencia: "LIMITE ADIF - LFPSA",
  network: "ADIF",
  pk_adif: "752.4",
  pk_lfp: "44.4",
  pk_internal: 752.4,

  // ✅ BARRE 2
  bloqueo_bar: 2,

  radio: "◯ GSMR",
  rc: 18,
  rc_bar: false,

  // ✅ IMPAIR : barre VMAX + début segment 300
  vmax: 300,
  vmax_bar: true,
},

{
  pk: "771.2",
  dependencia: "TETE SUD TUNNEL",
  network: "LFP",
  pk_lfp: "25.6",
  pk_internal: 771.2,

  // ✅ Entre barre 1 et barre 2
  bloqueo: "ERTMS Niv. 1",

  radio: "◯ GSMR",
  rc: 18,
  rc_bar: false,
  vmax_bar: false,
},
{
  pk: "772.2",
  dependencia: "FRONTIERE",
  network: "LFP",
  pk_lfp: "24.6",
  pk_internal: 772.2,

  // ✅ Entre barre 1 et barre 2
  bloqueo: "ERTMS Niv. 1",

  radio: "◯ GSMR",
  rc: 18,
  rc_bar: false,
  vmax_bar: false,
},
{
  pk: "779.7",
  dependencia: "TETE NORD TUNNEL",
  network: "LFP",
  pk_lfp: "17.1",
  pk_internal: 779.7,

  // ✅ Entre barre 1 et barre 2
  bloqueo: "ERTMS Niv. 1",

  radio: "◯ GSMR",
  rc: 12,
  rc_bar: true, // ✅ barre à 779.7 (début segment 12)
  vmax_bar: false,
},
{
  pk: "783.9",
  dependencia: "SAUT DE MOUTON",
  network: "LFP",
  pk_lfp: "12.9",
  pk_internal: 783.9,

  // ✅ Entre barre 1 et barre 2
  bloqueo: "ERTMS Niv. 1",

  radio: "◯ GSMR",
  rc: 12,
  rc_bar: false,
  vmax_bar: false,
},

{
  pk: "799.7",
  dependencia: "LIMITE RFN - LFPSA",
  network: "RFN",
  pk_rfn: "473.3",
  pk_internal: 799.7,

  // ✅ BARRE 1
  bloqueo_bar: 1,

  radio: "◯ GSMR",
  rc: 0,
  rc_bar: true, // ✅ barre à 799.7 (début segment 0)

  // ✅ IMPAIR : barre VMAX + début segment 160
  vmax: 160,
  vmax_bar: true,
},

{
  pk: "802.0",
  dependencia: "LIMITE RAC - LFP-FRR",
  network: "RFN",
  pk_rfn: "471.0",
  pk_internal: 802.0,

  // ✅ Au-dessus de la barre 1
  bloqueo: "BAL KVB",

  radio: "◯ GSMR",
  rc: 0,
  rc_bar: false,
  vmax: 160,
  vmax_bar: false,
},

{
  pk: "805.5",
  dependencia: "PERPIGNAN",
  network: "RFN",
  pk_rfn: "467.5",
  pk_internal: 805.5,

  // ✅ Au-dessus de la barre 1
  bloqueo: "BAL KVB",

  radio: "◯ GSMR",
  rc: 0,
  rc_bar: false,
  vmax: 160,
  vmax_bar: false,
},
];

// -----------------------------------------------------------------------------
// FT_LIGNE_IMPAIR : sens IMPAIR
// -----------------------------------------------------------------------------

export const FT_LIGNE_IMPAIR: FTEntry[] = [
  {
    pk: "615.9",
    dependencia: "CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: false,
  },
  {
    pk: "616.0",
    dependencia: "BIF CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "618.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 95,
    vmax_bar: true,
  },
  {
    pk: "619.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 85,
    vmax_bar: true,
  },
  {
    pk: "620.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 60,
    vmax_bar: true,
  },
  {
    pk: "621.0",
    dependencia: "BARCELONA SANTS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: true,
    vmax: 30,
  },
  {
    pk: "621.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "623.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "624.3",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 80,
    vmax_bar: true,
  },
  {
    pk: "626.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },

  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["35 VIAS ESTACIONAMM. V11, V19 Y V10, V18"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },

  {
    pk: "627.7",
    dependencia: "LA SAGRERA AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },
  {
    pk: "629.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },
  {
    pk: "630.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 110,
    vmax_bar: true,
  },
  {
    pk: "632.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 130,
    vmax_bar: true,
  },
  {
    pk: "634.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "636.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "639.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "640.9",
    dependencia: "BIF. MOLLET",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
  },
  {
    pk: "641.3",
    dependencia: "BIF. MOLLET-AGUJA KM. 641,3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: true,
  },
  {
    pk: "641.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 185,
    vmax_bar: true,
  },
  {
    pk: "643.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 195,
    vmax_bar: true,
  },
  {
    pk: "644.3",
    dependencia: "BIF. MOLLET-AG.KM. 644.3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "654.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "655.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "655.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "660.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "661.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "662.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "662.5",
    dependencia: "LLINARS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "673.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "679.3",
    dependencia: "RIELLS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "680.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "682.0",
    dependencia: "BASE MTO. RIELLS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "684.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "703.5",
    dependencia: "VILOBI D'ONYAR",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "707.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "709.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "710.7",
    dependencia: "BIF. GIRONA-MERCADERIES",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "713.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 125,
    vmax_bar: true,
  },

  {
    pk: "714.7",
    dependencia: "GIRONA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 120,
    vmax_highlight: true,
    vmax_bar: true,
  },

  {
    pk: "715.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 120,
    vmax_highlight: true,
    vmax_bar: true,
  },

  {
    pk: "716.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 165,
    vmax_bar: true,
  },

  {
    pk: "720.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },
  {
    pk: "723.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["80 AL PASO VIAS 3, 4 Y 6", "50 AL PASO VIA 7"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

   {
    pk: "749.6",
    dependencia: "FIGUERES-VILAFANT",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: true, // ✅ BARRE RC 3 (748.9)
  },

  {
    pk: "752.4",
    dependencia: "LIMITE ADIF - LFPSA",
    network: "ADIF",
    pk_adif: "752.4",
    pk_lfp: "44.4",
    pk_internal: 752.4,

    // ✅ BARRE 2
    bloqueo_bar: 2,

    radio: "◯ GSMR",
    rc: 13,         // ✅ segment 13 (entre 779.7 et 748.9)
    rc_bar: false,

    // ✅ En dessous de la barre 2 : on garde 200
    vmax: 200,
    vmax_bar: true,
  },
  {
    pk: "771.2",
    dependencia: "TETE SUD TUNNEL",
    network: "LFP",
    pk_lfp: "25.6",
    pk_internal: 771.2,

    // ✅ Entre barre 1 et barre 2
    bloqueo: "ERTMS Niv. 1",

    radio: "◯ GSMR",
    rc: 13,         // ✅ segment 13
    rc_bar: false,

    // ✅ Entre les barres : 300
    vmax: 300,
    vmax_bar: false,
  },
  {
    pk: "772.2",
    dependencia: "FRONTIERE",
    network: "LFP",
    pk_lfp: "24.6",
    pk_internal: 772.2,

    // ✅ Entre barre 1 et barre 2
    bloqueo: "ERTMS Niv. 1",

    radio: "◯ GSMR",
    rc: 13,         // ✅ segment 13
    rc_bar: false,

    // ✅ Entre les barres : 300
    vmax: 300,
    vmax_bar: false,
  },
  {
    pk: "779.7",
    dependencia: "TETE NORD TUNNEL",
    network: "LFP",
    pk_lfp: "17.1",
    pk_internal: 779.7,

    // ✅ Entre barre 1 et barre 2
    bloqueo: "ERTMS Niv. 1",

    radio: "◯ GSMR",
    rc: 18,         // ✅ segment 18 (entre 799.7 et 779.7)
    rc_bar: true,   // ✅ BARRE RC 2 (779.7)

    // ✅ Entre les barres : 300
    vmax: 300,
    vmax_bar: false,
  },
  {
    pk: "783.9",
    dependencia: "SAUT DE MOUTON",
    network: "LFP",
    pk_lfp: "12.9",
    pk_internal: 783.9,

    // ✅ Entre barre 1 et barre 2
    bloqueo: "ERTMS Niv. 1",

    radio: "◯ GSMR",
    rc: 18,         // ✅ segment 18
    rc_bar: false,

    // ✅ Entre les barres : 300
    vmax: 300,
    vmax_bar: false,
  },

  {
    pk: "799.7",
    dependencia: "LIMITE RFN - LFPSA",
    network: "RFN",
    pk_rfn: "473.3",
    pk_internal: 799.7,

    // ✅ BARRE 1
    bloqueo_bar: 1,

    radio: "◯ GSMR",
    rc: 10,         // ✅ segment 10 (au-dessus de 799.7)
    rc_bar: true,   // ✅ BARRE RC 1 (799.7)

    // ✅ La barre 1 marque l'entrée dans la zone 300
    vmax: 300,
    vmax_bar: true,
  },

  {
    pk: "802.0",
    dependencia: "LIMITE RAC - LFP-FRR",
    network: "RFN",
    pk_rfn: "471.0",
    pk_internal: 802.0,

    // ✅ Au-dessus de la barre 1
    bloqueo: "BAL KVB",

    radio: "◯ GSMR",
    rc: 10,       // ✅ segment 10
    rc_bar: false,

    // ✅ Au-dessus de la barre 1 : 160
    vmax: 160,
    vmax_bar: false,
  },

  {
    pk: "805.5",
    dependencia: "PERPIGNAN",
    network: "RFN",
    pk_rfn: "467.5",
    pk_internal: 805.5,

    // ✅ Au-dessus de la barre 1
    bloqueo: "BAL KVB",

    radio: "◯ GSMR",
    rc: 10,       // ✅ segment 10
    rc_bar: false,

    // ✅ Au-dessus de la barre 1 : 160
    vmax: 160,
    vmax_bar: false,
  },

 ];