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

const ADIF_LTV_LAYER_URL =
  "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/0";

const ADIF_LTV_QUERY_URL = `${ADIF_LTV_LAYER_URL}/query`;

let memoryCache: LtvCache = {
  fetchedAt: "",
  total: 0,
  ltv: [],
};

const ADIF_LTV_URL =
  `${ADIF_LTV_QUERY_URL}?f=json&resultRecordCount=200&where=CODLINEA%20IN%20(%27050%27,%27066%27)&outFields=OBJECTID,CODLINEA,DESCLINEA,PKINI,PKFIN,RESTRICCIONVELOCIDAD,VIAS,MOTIVO,DESCPSINI,DESCPSFIN&returnGeometry=false`;

function isCacheValid(): boolean {
  if (!memoryCache.fetchedAt) {
    return false;
  }

  const fetchedTime = new Date(memoryCache.fetchedAt).getTime();

  return Date.now() - fetchedTime < ONE_HOUR_MS;
}

function getQueryParam(req: VercelRequest, key: string): string | undefined {
  const value = req.query[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

async function buildLtvFieldsDebugPayload() {
  const layerResponse = await fetch(`${ADIF_LTV_LAYER_URL}?f=json`);

  if (!layerResponse.ok) {
    throw new Error(`ArcGIS layer metadata HTTP ${layerResponse.status}`);
  }

  const layerData = await layerResponse.json();

  const fields = Array.isArray(layerData.fields)
    ? layerData.fields.map((field: any) => ({
        name: field.name,
        alias: field.alias,
        type: field.type,
      }))
    : [];

  const queryUrl = new URL(ADIF_LTV_QUERY_URL);
  queryUrl.searchParams.set("f", "json");
  queryUrl.searchParams.set("resultRecordCount", "3");
  queryUrl.searchParams.set("where", "CODLINEA IN ('050','066')");
  queryUrl.searchParams.set("outFields", "*");
  queryUrl.searchParams.set("returnGeometry", "false");

  const sampleResponse = await fetch(queryUrl.toString());

  if (!sampleResponse.ok) {
    throw new Error(`ArcGIS sample query HTTP ${sampleResponse.status}`);
  }

  const sampleData = await sampleResponse.json();

  const sampleAttributes = Array.isArray(sampleData.features)
    ? sampleData.features
        .slice(0, 3)
        .map((feature: any) => feature.attributes ?? {})
    : [];

  return {
    ok: true,
    source: "arcgis-debug-fields",
    fetchedAt: new Date().toISOString(),
    layerUrl: ADIF_LTV_LAYER_URL,
    totalFields: fields.length,
    fields,
    sampleCount: sampleAttributes.length,
    sampleAttributes,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log("LTV request start");

  const debug = getQueryParam(req, "debug");

  if (debug === "fields") {
    try {
      console.log("LTV debug fields request");

      const payload = await buildLtvFieldsDebugPayload();

      return res.status(200).json(payload);
    } catch (error) {
      console.error("LTV debug fields error", error);

      return res.status(500).json({
        ok: false,
        source: "arcgis-debug-fields",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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