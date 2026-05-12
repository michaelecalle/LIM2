export type LtvEntry = {
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

export type LtvCache = {
  fetchedAt: string;
  total: number;
  ltv: LtvEntry[];
};

export const emptyLtvCache: LtvCache = {
  fetchedAt: "",
  total: 0,
  ltv: [],
};

export let memoryCache: LtvCache = emptyLtvCache;

export function isCacheValid(maxAgeMs: number): boolean {
  if (!memoryCache.fetchedAt) {
    return false;
  }

  const fetchedTime = new Date(memoryCache.fetchedAt).getTime();

  return Date.now() - fetchedTime < maxAgeMs;
}

export function setMemoryCache(cache: LtvCache) {
  memoryCache = cache;
}