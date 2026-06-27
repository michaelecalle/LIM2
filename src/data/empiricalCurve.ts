// src/data/empiricalCurve.ts
//
// Courbe empirique de LOCALISATION pour le mode horaire.
//
// Problème résolu : sans GPS (tunnels), la position en mode horaire est calculée via les VL
// théoriques, qui supposent la vitesse max atteinte quasi instantanément. En réalité la mise en
// vitesse est progressive → la barre part trop en avance (écart mesuré jusqu'à ~584 m au départ
// Barcelone). La courbe empirique donne le temps de parcours RÉEL Δt(PK) relevé sur le terrain.
//
// ── ARCHITECTURE (validée 2026-06-27) ───────────────────────────────────────────────────────
// UNE SEULE courbe couvrant tout le parcours, sous forme de SEGMENTS mesurés. Chaque segment
// correspond à une zone où le profil réel diverge nettement du théorique (= les tunnels, là où
// le GPS est perdu). Hors segment, la courbe « ne dit rien » (retour automatique au théorique,
// qui est déjà bon à l'air libre — cf. Girona théorique ≈ réel à 16 s près).
//
// Le mécanisme est UNIFORME à chaque tunnel :
//   - à la perte du GPS, on s'ancre sur la DERNIÈRE position GPS fiable (acc ≤ 50 m) + l'heure ;
//   - pendant le souterrain, on rejoue le temps écoulé sur la FORME de la courbe à partir de
//     l'ancre :  Δt_emp(s) − Δt_emp(s_ancre) = t_courant − t_ancre  (relatif, jamais en absolu) ;
//   - dès qu'on dépasse la fin du segment (ou qu'on est hors segment), retour au théorique ;
//   - à la sortie du tunnel, le GPS reprend la main (recalage delta avec seuil 50 m).
// La courbe ne touche QUE le profil de vitesse en horaire — le delta AFFICHÉ reste géré par les
// recalages GPS aux gares.
//
// ── DONNÉES ──────────────────────────────────────────────────────────────────────────────────
// Coordonnée : PK ADIF (= pkInternal en zone ADIF). Source : relevé vidéo 9709 du 2026-06-25
// (cf. courbe_empirique_9709_barcelone.md), croisé GPS + cohérence cinématique segment par segment.
// ⚠️ Composition "bloc moteur isolé" (75 % puissance) = cas FRÉQUENT donc représentatif (écart à
//    la pleine puissance = quelques secondes). À affiner par médiane quand d'autres parcours seront
//    disponibles. Perthus : segment à ajouter dès qu'un relevé sera fait (théorique en attendant).

export type EmpiricalPoint = { pk: number; dtSec: number };
export type EmpiricalSegment = {
  /** Identifiant lisible (zone). */
  name: string;
  /** Points (PK croissant, Δt croissant) relevés sur le terrain. Δt = secondes depuis le 1er point. */
  points: EmpiricalPoint[];
};

// Chaque segment : PK officiels (signaux/TIV/pancartes) + heures vidéo (précises à la seconde).
export const EMPIRICAL_SEGMENTS: EmpiricalSegment[] = [
  {
    name: "barcelona-depart",
    points: [
      { pk: 621.000, dtSec: 0 },
      { pk: 621.072, dtSec: 43 },
      { pk: 621.700, dtSec: 125 },
      { pk: 621.873, dtSec: 149 },
      { pk: 622.782, dtSec: 209 },
      { pk: 624.300, dtSec: 275 },
      { pk: 624.978, dtSec: 306 },
      { pk: 626.700, dtSec: 396 },
      { pk: 626.900, dtSec: 416 },
      { pk: 627.124, dtSec: 447 },
      { pk: 627.200, dtSec: 458 },
      { pk: 627.300, dtSec: 471 },
      { pk: 627.400, dtSec: 484 },
      { pk: 627.500, dtSec: 494 },
      { pk: 627.685, dtSec: 511 },
      { pk: 627.700, dtSec: 512 },
      { pk: 628.184, dtSec: 555 },
      { pk: 629.400, dtSec: 656 },
      { pk: 629.700, dtSec: 681 },
      { pk: 630.114, dtSec: 712 },
      { pk: 630.222, dtSec: 718 },
    ],
  },
  {
    name: "girona-depart",
    // Sortie standby Girona → récup GPS après tunnel Montagut. Points fiables uniquement
    // (PK officiels + heures vidéo ; signaux à revers et estimations caméra écartés).
    points: [
      { pk: 714.700, dtSec: 0 },   // Girona (sortie standby)
      { pk: 715.000, dtSec: 59 },  // Pancarte PK 715
      { pk: 716.518, dtSec: 109 }, // Signal 7165
      { pk: 716.800, dtSec: 119 }, // TIV 200
      { pk: 719.772, dtSec: 187 }, // Sortie tunnel Girona (T22)
      { pk: 720.017, dtSec: 192 }, // Pancarte PK 720,017
      { pk: 720.700, dtSec: 211 }, // Récup GPS (sortie tunnel Montagut)
    ],
  },
  // Perthus : pas encore de relevé → repli théorique. Ajouter un segment ici le moment venu.
];

/** Segment couvrant ce PK (ou null si hors de tout segment → repli théorique). */
function segmentForPk(pk: number | null | undefined): EmpiricalSegment | null {
  if (typeof pk !== "number" || !Number.isFinite(pk)) return null;
  for (const seg of EMPIRICAL_SEGMENTS) {
    const lo = seg.points[0].pk;
    const hi = seg.points[seg.points.length - 1].pk;
    if (pk >= lo && pk <= hi) return seg;
  }
  return null;
}

/** Vrai si ce PK tombe dans un segment empirique mesuré. */
export function isInEmpiricalZone(pk: number | null | undefined): boolean {
  return segmentForPk(pk) != null;
}

/** Δt (s) au PK donné DANS un segment (interpolation PK → Δt). */
function dtAtPkInSegment(seg: EmpiricalSegment, pk: number): number {
  const pts = seg.points;
  if (pk <= pts[0].pk) return pts[0].dtSec;
  if (pk >= pts[pts.length - 1].pk) return pts[pts.length - 1].dtSec;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (pk >= a.pk && pk <= b.pk) {
      const f = b.pk === a.pk ? 0 : (pk - a.pk) / (b.pk - a.pk);
      return a.dtSec + f * (b.dtSec - a.dtSec);
    }
  }
  return pts[pts.length - 1].dtSec;
}

/**
 * Position (PK) après `dtSec` secondes écoulées DEPUIS L'ANCRE.
 * `anchorPk` = dernière position GPS fiable au moment de la bascule en horaire.
 * On suit la FORME de la courbe à partir de l'ancre (temps relatif) → aucun saut à la bascule,
 * indépendant du retard/avance absolu.
 * Retourne null si l'ancre est hors segment OU si le temps écoulé dépasse la fin du segment
 * (dans les deux cas, l'appelant bascule sur le calcul théorique normal).
 */
export function empiricalPkAtElapsed(anchorPk: number, dtSec: number): number | null {
  const seg = segmentForPk(anchorPk);
  if (!seg) return null;

  const anchorDt = dtAtPkInSegment(seg, anchorPk);
  const targetDt = anchorDt + Math.max(0, dtSec);

  const pts = seg.points;
  const maxDt = pts[pts.length - 1].dtSec;
  // Au-delà de la fin du segment : on a quitté la zone mesurée → théorique (et GPS au retour).
  if (targetDt > maxDt) return null;

  // Interpolation inverse Δt → PK dans le segment.
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (targetDt >= a.dtSec && targetDt <= b.dtSec) {
      const f = b.dtSec === a.dtSec ? 0 : (targetDt - a.dtSec) / (b.dtSec - a.dtSec);
      return a.pk + f * (b.pk - a.pk);
    }
  }
  return pts[pts.length - 1].pk;
}
