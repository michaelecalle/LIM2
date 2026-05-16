import type { VercelRequest, VercelResponse } from "@vercel/node";

type LtvEntry = {
  objectId: number;
  ltvId: number | null;
  ligne: string;
  ligneDescription: string;
  pkDebut: number;
  pkFin: number;
  vitesse: number;
  voies: string;
  motif: string;
  debutZone: string;
  finZone: string;

  csv: string | null;
  calendrier: string | null;
  dateDebutVigueur: number | null;
  heureDebutVigueur: string | null;
  dateFinPrevue: number | null;
  heureFinPrevue: string | null;
  horaire: string | null;
  nonSignaleeSysteme: string | null;
  nonSignaleeVoie: string | null;
  observations: string | null;
  vehiculeTete: string | null;
  typeTrain: string | null;
  typeTrainObs: string | null;
};

type LtvCache = {
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  sourceUpdatedFile: string | null;
  total: number;
  ltv: LtvEntry[];
};

const ONE_HOUR_MS = 60 * 60 * 1000;

function applyCorsHeaders(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

const ADIF_LTV_LAYER_URL =
  "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/0";

const ADIF_LTV_VERSION_LAYER_URL =
  "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/2";

const ADIF_LTV_QUERY_URL = `${ADIF_LTV_LAYER_URL}/query`;
const ADIF_LTV_VERSION_QUERY_URL = `${ADIF_LTV_VERSION_LAYER_URL}/query`;

let memoryCache: LtvCache = {
  fetchedAt: "",
  sourceUpdatedAt: null,
  sourceUpdatedFile: null,
  total: 0,
  ltv: [],
};

const LTV_OUT_FIELDS = [
  "OBJECTID",
  "LTVID",
  "CODLINEA",
  "DESCLINEA",
  "PKINI",
  "PKFIN",
  "RESTRICCIONVELOCIDAD",
  "VIAS",
  "MOTIVO",
  "DESCPSINI",
  "DESCPSFIN",
  "CSV",
  "CALENDARIO",
  "FECHAVIGORLTV",
  "HORAVIGORLTV",
  "FECHAFINPREV",
  "HORAFINPREV",
  "HORARIO",
  "NOSENIALIZADASISTEMA",
  "NOSENIALIZADAVIA",
  "OBSERVACIONES",
  "VEHICULOCABEZA",
  "TIPOTREN",
  "TIPOTRENOBS",
].join(",");

const ADIF_LTV_URL = (() => {
  const queryUrl = new URL(ADIF_LTV_QUERY_URL);

  queryUrl.searchParams.set("f", "json");
  queryUrl.searchParams.set("resultRecordCount", "200");
  queryUrl.searchParams.set("where", "CODLINEA IN ('050','066')");
  queryUrl.searchParams.set("outFields", LTV_OUT_FIELDS);
  queryUrl.searchParams.set("returnGeometry", "false");

  return queryUrl.toString();
})();

const ADIF_LTV_VERSION_URL = (() => {
  const queryUrl = new URL(ADIF_LTV_VERSION_QUERY_URL);

  queryUrl.searchParams.set("f", "json");
  queryUrl.searchParams.set(
    "where",
    "FICHERO_LTV_VIGOR LIKE '%_DSLTV%'"
  );
  queryUrl.searchParams.set(
    "outFields",
    "FECHA_LTV_VIGOR,FICHERO_LTV_VIGOR"
  );
  queryUrl.searchParams.set("returnGeometry", "false");
  queryUrl.searchParams.set("resultRecordCount", "1");

  return queryUrl.toString();
})();

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

async function fetchLtvSourceVersion(): Promise<{
  sourceUpdatedAt: string | null;
  sourceUpdatedFile: string | null;
}> {
  const response = await fetch(ADIF_LTV_VERSION_URL);

  if (!response.ok) {
    throw new Error(`ArcGIS version HTTP ${response.status}`);
  }

  const data = await response.json();
  const attrs = data.features?.[0]?.attributes ?? {};

  const rawDate = attrs.FECHA_LTV_VIGOR;
  const sourceUpdatedFile =
    typeof attrs.FICHERO_LTV_VIGOR === "string"
      ? attrs.FICHERO_LTV_VIGOR
      : null;

  const sourceUpdatedAt =
    typeof rawDate === "number" && Number.isFinite(rawDate)
      ? new Date(rawDate).toISOString()
      : null;

  return {
    sourceUpdatedAt,
    sourceUpdatedFile,
  };
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
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

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

    const [response, sourceVersion] = await Promise.all([
      fetch(ADIF_LTV_URL),
      fetchLtvSourceVersion(),
    ]);

    if (!response.ok) {
      throw new Error(`ArcGIS HTTP ${response.status}`);
    }

    const data = await response.json();

    const ltv: LtvEntry[] = data.features.map((feature: any) => {
      const attrs = feature.attributes ?? {};

      return {
        objectId: attrs.OBJECTID,
        ltvId: attrs.LTVID ?? null,
        ligne: attrs.CODLINEA,
        ligneDescription: attrs.DESCLINEA,
        pkDebut: attrs.PKINI,
        pkFin: attrs.PKFIN,
        vitesse: attrs.RESTRICCIONVELOCIDAD,
        voies: attrs.VIAS,
        motif: attrs.MOTIVO,
        debutZone: attrs.DESCPSINI,
        finZone: attrs.DESCPSFIN,

        csv: attrs.CSV ?? null,
        calendrier: attrs.CALENDARIO ?? null,
        dateDebutVigueur: attrs.FECHAVIGORLTV ?? null,
        heureDebutVigueur: attrs.HORAVIGORLTV ?? null,
        dateFinPrevue: attrs.FECHAFINPREV ?? null,
        heureFinPrevue: attrs.HORAFINPREV ?? null,
        horaire: attrs.HORARIO ?? null,
        nonSignaleeSysteme: attrs.NOSENIALIZADASISTEMA ?? null,
        nonSignaleeVoie: attrs.NOSENIALIZADAVIA ?? null,
        observations: attrs.OBSERVACIONES ?? null,
        vehiculeTete: attrs.VEHICULOCABEZA ?? null,
        typeTrain: attrs.TIPOTREN ?? null,
        typeTrainObs: attrs.TIPOTRENOBS ?? null,
      };
    });

    memoryCache = {
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: sourceVersion.sourceUpdatedAt,
      sourceUpdatedFile: sourceVersion.sourceUpdatedFile,
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
