export default async function handler(req: Request): Promise<Response> {
  const url =
    "https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/2/query?f=json&resultRecordCount=1&where=1%3D1&outFields=OBJECTID&returnGeometry=false";

  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 5000);

    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

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