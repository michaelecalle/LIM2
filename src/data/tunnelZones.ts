// src/data/tunnelZones.ts
//
// Zones de TUNNEL de la ligne Barcelone Sants → Figueres → Perpignan, exprimées en s_km
// (distance le long du ruban, ABSOLUE et identique dans les deux sens — vérifié sur logs aller+retour).
//
// Source : 34 tunnels dictés par l'utilisateur depuis les schémas Adif + LFP (voir mémoire
// reference_tunnels_ligne), convertis PK → s_km via les logs réels 9707 (aller) et 9714 (retour).
//
// Usage : garde-fou DÉTERMINISTE anti-faux-arrêt (#20/#24). Si la position courante (s_km) est dans
// une zone tunnel, on N'ARME JAMAIS d'arrêt GPS (en tunnel le GPS peut figer une "bonne" position =
// case 3, ce qui trompait l'heuristique de vitesse). Les heuristiques (Couche 1/2) restent la 1ʳᵉ
// ligne de défense ; ceci est la ceinture+bretelles.
//
// ⚠️ Fichier d'INFRASTRUCTURE statique : NON éditable dans l'éditeur. Mettre à jour seulement si la
// ligne change (rare). Le profil de ligne (pentes/rampes, #19/#25) pourra rejoindre ce fichier un jour.

export type TunnelZone = { id: string; sKmMin: number; sKmMax: number }

// Marge ajoutée de chaque côté (km) — couvre le figeage GPS qui peut survenir juste à l'entrée.
export const TUNNEL_ZONE_MARGIN_KM = 0.15

// [sKmMin, sKmMax] log-dérivés (T1 = pk−616 car GPS perdu dès le départ Barcelone).
export const TUNNEL_ZONES: TunnelZone[] = [
  { id: "T1",  sKmMin: 0.624,   sKmMax: 10.750 },
  { id: "T2",  sKmMin: 12.375,  sKmMax: 14.026 },
  { id: "T3",  sKmMin: 15.152,  sKmMax: 15.570 },
  { id: "T4",  sKmMin: 16.173,  sKmMax: 20.137 },
  { id: "T5",  sKmMin: 23.794,  sKmMax: 24.037 },
  { id: "T6",  sKmMin: 27.093,  sKmMax: 28.406 },
  { id: "T7",  sKmMin: 29.715,  sKmMax: 30.314 },
  { id: "T8",  sKmMin: 30.392,  sKmMax: 30.517 },
  { id: "T9",  sKmMin: 32.809,  sKmMax: 33.234 },
  { id: "T10", sKmMin: 34.512,  sKmMax: 35.184 },
  { id: "T11", sKmMin: 49.834,  sKmMax: 49.943 },
  { id: "T12", sKmMin: 50.322,  sKmMax: 50.534 },
  { id: "T13", sKmMin: 50.915,  sKmMax: 51.262 },
  { id: "T14", sKmMin: 53.019,  sKmMax: 53.830 },
  { id: "T15", sKmMin: 55.279,  sKmMax: 55.653 },
  { id: "T16", sKmMin: 56.028,  sKmMax: 56.212 },
  { id: "T17", sKmMin: 67.326,  sKmMax: 67.495 },
  { id: "T18", sKmMin: 69.558,  sKmMax: 69.614 },
  { id: "T19", sKmMin: 73.931,  sKmMax: 74.096 },
  { id: "T20", sKmMin: 75.182,  sKmMax: 75.500 },
  { id: "T21", sKmMin: 80.492,  sKmMax: 80.549 },
  { id: "T22", sKmMin: 96.490,  sKmMax: 104.040 }, // Girona (gare souterraine 714.7 dedans)
  { id: "T23", sKmMin: 104.471, sKmMax: 105.178 },
  { id: "T24", sKmMin: 107.029, sKmMax: 107.750 },
  { id: "T25", sKmMin: 108.078, sKmMax: 108.722 },
  { id: "T26", sKmMin: 110.510, sKmMax: 112.236 },
  { id: "T27", sKmMin: 114.510, sKmMax: 116.157 },
  { id: "T28", sKmMin: 116.517, sKmMax: 119.496 }, // Les Cavorques
  { id: "T29", sKmMin: 132.277, sKmMax: 132.408 },
  { id: "T30", sKmMin: 132.855, sKmMax: 132.937 },
  { id: "T31", sKmMin: 134.594, sKmMax: 136.298 }, // ⭐ tunnel du bug (sortie Figueres)
  { id: "T34", sKmMin: 143.297, sKmMax: 143.463 }, // LFP (faux tunnel)
  { id: "T33", sKmMin: 145.237, sKmMax: 145.400 }, // LFP (faux tunnel)
  { id: "T32", sKmMin: 155.275, sKmMax: 163.655 }, // ⭐ Perthus (~8,4 km, tunnel frontière)
]

// ─── Tunnels en pkInternal (coordonnée U monotone) — pour l'AFFICHAGE exact ───
// Dérivé des PK d'origine (schémas Adif + LFP, voir reference_tunnels_ligne), conversion EXACTE :
//   - ADIF (T1-T31) : pkInternal = pk_adif
//   - LFP  (T32-T34): pkInternal = 796.8 − pk_lfp  (= A_LFP_ADIF + A_LFP_LFP − pk, cf. useTrainDist)
// Plus précis que la conversion s_km (offset variable). Usage : bandes tunnel sur la FT horizontale.
export type TunnelZonePk = { id: string; pkIntMin: number; pkIntMax: number }
export const TUNNEL_ZONES_PKINTERNAL: TunnelZonePk[] = [
  { id: "T1",  pkIntMin: 616.624, pkIntMax: 626.750 },
  { id: "T2",  pkIntMin: 628.376, pkIntMax: 629.852 },
  { id: "T3",  pkIntMin: 630.996, pkIntMax: 631.398 },
  { id: "T4",  pkIntMin: 632.032, pkIntMax: 636.002 },
  { id: "T5",  pkIntMin: 639.692, pkIntMax: 639.942 },
  { id: "T6",  pkIntMin: 642.968, pkIntMax: 644.304 },
  { id: "T7",  pkIntMin: 645.625, pkIntMax: 646.224 },
  { id: "T8",  pkIntMin: 646.285, pkIntMax: 646.431 },
  { id: "T9",  pkIntMin: 648.701, pkIntMax: 649.137 },
  { id: "T10", pkIntMin: 650.415, pkIntMax: 651.073 },
  { id: "T11", pkIntMin: 665.720, pkIntMax: 665.848 },
  { id: "T12", pkIntMin: 666.232, pkIntMax: 666.446 },
  { id: "T13", pkIntMin: 666.831, pkIntMax: 667.168 },
  { id: "T14", pkIntMin: 668.920, pkIntMax: 669.719 },
  { id: "T15", pkIntMin: 671.190, pkIntMax: 671.554 },
  { id: "T16", pkIntMin: 671.912, pkIntMax: 672.123 },
  { id: "T17", pkIntMin: 683.270, pkIntMax: 683.409 },
  { id: "T18", pkIntMin: 685.496, pkIntMax: 685.556 },
  { id: "T19", pkIntMin: 689.843, pkIntMax: 690.001 },
  { id: "T20", pkIntMin: 691.097, pkIntMax: 691.421 },
  { id: "T21", pkIntMin: 696.412, pkIntMax: 696.447 },
  { id: "T22", pkIntMin: 712.317, pkIntMax: 719.772 }, // Girona (gare 714.7 dedans)
  { id: "T23", pkIntMin: 720.195, pkIntMax: 720.896 },
  { id: "T24", pkIntMin: 722.756, pkIntMax: 723.466 },
  { id: "T25", pkIntMin: 723.805, pkIntMax: 724.412 },
  { id: "T26", pkIntMin: 726.303, pkIntMax: 727.989 },
  { id: "T27", pkIntMin: 730.300, pkIntMax: 731.846 },
  { id: "T28", pkIntMin: 732.288, pkIntMax: 735.265 }, // Les Cavorques
  { id: "T29", pkIntMin: 748.132, pkIntMax: 748.249 },
  { id: "T30", pkIntMin: 748.705, pkIntMax: 748.780 },
  { id: "T31", pkIntMin: 750.470, pkIntMax: 752.220 }, // dernier ADIF
  { id: "T32", pkIntMin: 771.211, pkIntMax: 779.599 }, // Perthus (LFP)
  { id: "T33", pkIntMin: 761.176, pkIntMax: 761.338 }, // LFP
  { id: "T34", pkIntMin: 759.228, pkIntMax: 759.402 }, // LFP
]

/** Retourne la zone tunnel contenant ce s_km (avec marge), ou null. */
export function tunnelZoneAt(sKm: number | null | undefined): TunnelZone | null {
  if (typeof sKm !== "number" || !Number.isFinite(sKm)) return null
  for (const z of TUNNEL_ZONES) {
    if (sKm >= z.sKmMin - TUNNEL_ZONE_MARGIN_KM && sKm <= z.sKmMax + TUNNEL_ZONE_MARGIN_KM) {
      return z
    }
  }
  return null
}
