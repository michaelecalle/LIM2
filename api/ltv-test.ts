import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log("LTV test start");

  const url =
    "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/2/query?f=json&resultRecordCount=1&where=1%3D1&outFields=*&returnGeometry=false";

  try {
    console.log("Before fetch");

    const response = await fetch(url);

    console.log("After fetch");

    const data = await response.json();

    console.log("JSON parsed");

    return res.status(200).json({
      ok: true,
      mode: "one-record-all-fields",
      fetchedAt: new Date().toISOString(),
      data,
    });
  } catch (error) {
    console.error("LTV test error", error);

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}