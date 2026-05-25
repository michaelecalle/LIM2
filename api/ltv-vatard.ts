import type { VercelRequest, VercelResponse } from "@vercel/node";

const VATARD_URL = "https://limitacions.vatard.com/api/data";

const ONE_HOUR_MS = 60 * 60 * 1000;

type VatardCache = {
  fetchedAt: string;
  raw: unknown[];
};

let memoryCache: VatardCache = {
  fetchedAt: "",
  raw: [],
};

function isCacheValid(): boolean {
  if (!memoryCache.fetchedAt) return false;
  return Date.now() - new Date(memoryCache.fetchedAt).getTime() < ONE_HOUR_MS;
}

function applyCorsHeaders(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (isCacheValid()) {
    return res.status(200).json({
      ok: true,
      source: "cache",
      fetchedAt: memoryCache.fetchedAt,
      total: memoryCache.raw.length,
      raw: memoryCache.raw,
    });
  }

  try {
    const response = await fetch(VATARD_URL, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "lim2-proxy/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Vatard HTTP ${response.status}`);
    }

    const data = await response.json();
    const raw = Array.isArray(data.raw) ? data.raw : [];

    memoryCache = {
      fetchedAt: new Date().toISOString(),
      raw,
    };

    return res.status(200).json({
      ok: true,
      source: "vatard",
      fetchedAt: memoryCache.fetchedAt,
      total: raw.length,
      raw,
    });
  } catch (error) {
    console.error("Vatard fetch error", error);

    if (memoryCache.raw.length > 0) {
      return res.status(200).json({
        ok: true,
        source: "stale-cache",
        warning: "Vatard indisponible, données cache potentiellement périmées",
        fetchedAt: memoryCache.fetchedAt,
        total: memoryCache.raw.length,
        raw: memoryCache.raw,
      });
    }

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
