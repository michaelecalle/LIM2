import type { VercelRequest, VercelResponse } from "@vercel/node";

type LtvEntry = {
  objectId: number;
  ligne: string;
  ligneDescription: string;
  pkDebut: number;
  pkFin: number;
  vitesse: number;
  voies: string;
  motif: string;
  debutZone: string;
  finZone: string;
};

type LtvCache = {
  fetchedAt: string;
  total: number;
  ltv: LtvEntry[];
};

const ONE_HOUR_MS = 60 * 60 * 1000;

let memoryCache: LtvCache = {
  fetchedAt: "",
  total: 0,
  ltv: [],
};

const ADIF_LTV_URL =
  "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/0/query?f=json&resultRecordCount=200&where=CODLINEA%20IN%20(%27050%27,%27066%27)&outFields=OBJECTID,CODLINEA,DESCLINEA,PKINI,PKFIN,RESTRICCIONVELOCIDAD,VIAS,MOTIVO,DESCPSINI,DESCPSFIN&returnGeometry=false";

function isCacheValid(): boolean {
  if (!memoryCache.fetchedAt) {
    return false;
  }

  const fetchedTime = new Date(memoryCache.fetchedAt).getTime();

  return Date.now() - fetchedTime < ONE_HOUR_MS;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log("LTV request start");

  if (isCacheValid()) {
    console.log("LTV cache hit");

    return res.status(200).json({
      ok: true,
      source: "cache",
      ...memoryCache,
    });
  }

  try {
    console.log("LTV cache miss - fetching ArcGIS");

    const response = await fetch(ADIF_LTV_URL);

    if (!response.ok) {
      throw new Error(`ArcGIS HTTP ${response.status}`);
    }

    const data = await response.json();

    const ltv: LtvEntry[] = data.features.map((feature: any) => ({
      objectId: feature.attributes.OBJECTID,
      ligne: feature.attributes.CODLINEA,
      ligneDescription: feature.attributes.DESCLINEA,
      pkDebut: feature.attributes.PKINI,
      pkFin: feature.attributes.PKFIN,
      vitesse: feature.attributes.RESTRICCIONVELOCIDAD,
      voies: feature.attributes.VIAS,
      motif: feature.attributes.MOTIVO,
      debutZone: feature.attributes.DESCPSINI,
      finZone: feature.attributes.DESCPSFIN,
    }));

    memoryCache = {
      fetchedAt: new Date().toISOString(),
      total: ltv.length,
      ltv,
    };

    return res.status(200).json({
      ok: true,
      source: "arcgis",
      ...memoryCache,
    });
  } catch (error) {
    console.error("LTV fetch error", error);

    if (memoryCache.total > 0) {
      return res.status(200).json({
        ok: true,
        source: "stale-cache",
        warning: "ArcGIS indisponible, données cache potentiellement périmées",
        ...memoryCache,
      });
    }

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}