import type {
  AtprotoLabelerInfo,
  AtprotoLabelerInfoMap,
} from './atproto-labels';

interface AtprotoLabelerInfoCache {
  fetchedLabelers: AtprotoLabelerInfoMap;
  resolvedDids: Set<string>;
  inflightLabelers: Map<string, Promise<AtprotoLabelerInfo | undefined>>;
}

function getOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function createAtprotoLabelerInfoCache(): AtprotoLabelerInfoCache {
  return {
    fetchedLabelers: {},
    resolvedDids: new Set(),
    inflightLabelers: new Map(),
  };
}

export async function fetchCachedAtprotoLabelerInfo(
  dids: readonly string[],
  cache: AtprotoLabelerInfoCache,
  fetchLabelers: (dids: readonly string[]) => Promise<AtprotoLabelerInfoMap>,
): Promise<AtprotoLabelerInfoMap> {
  const uniqueDids = uniqueStrings(dids);
  const requests = uniqueDids.flatMap((did) => {
    if (cache.resolvedDids.has(did)) return [];
    const request = cache.inflightLabelers.get(did);
    return request ? [request] : [];
  });
  const missingDids = uniqueDids.filter(
    (did) => !cache.resolvedDids.has(did) && !cache.inflightLabelers.has(did),
  );
  if (missingDids.length) {
    const batchRequest = (async () => {
      const nextLabelers = await fetchLabelers(missingDids);
      missingDids.forEach((did) => {
        const info = getOwn(nextLabelers, did);
        if (info) cache.fetchedLabelers[did] = info;
        cache.resolvedDids.add(did);
      });
      return nextLabelers;
    })();
    missingDids.forEach((did) => {
      const request = (async () => {
        try {
          const nextLabelers = await batchRequest;
          return getOwn(nextLabelers, did);
        } finally {
          cache.inflightLabelers.delete(did);
        }
      })();
      cache.inflightLabelers.set(did, request);
      requests.push(request);
    });
  }
  if (requests.length) await Promise.allSettled(requests);
  return Object.fromEntries(
    uniqueDids.flatMap((did) => {
      const info = getOwn(cache.fetchedLabelers, did);
      return info ? [[did, info]] : [];
    }),
  );
}
