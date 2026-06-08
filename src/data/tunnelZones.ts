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
