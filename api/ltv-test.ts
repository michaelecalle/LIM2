export default async function handler(req: Request): Promise<Response> {
  const url =
    "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/2/query?f=json&resultOffset=0&resultRecordCount=1&where=FICHERO_LTV_VIGOR+LIKE+%27%25_DSLTV%25%27&orderByFields=&outFields=*&returnGeometry=false&spatialRel=esriSpatialRelIntersects";

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          error: `Erreur ArcGIS ${response.status}`,
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    return Response.json({
      ok: true,
      source: "ADIF ArcGIS LTV_2 FeatureServer/2",
      fetchedAt: new Date().toISOString(),
      data,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}