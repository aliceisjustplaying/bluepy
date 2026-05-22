import assert from 'node:assert/strict';
import { test } from 'bun:test';

import {
  createAtprotoLabelerInfoCache,
  fetchCachedAtprotoLabelerInfo,
} from '../src/utils/atproto-labeler-cache';
import type { AtprotoLabelerInfoMap } from '../src/utils/atproto-labels';

const labeler = {
  did: 'did:plc:labeler',
  handle: 'labels.example.com',
  displayName: 'Labels',
};

test('fetchCachedAtprotoLabelerInfo caches successful labeler lookups', async () => {
  const cache = createAtprotoLabelerInfoCache();
  const calls: string[][] = [];
  const fetchLabelers = async (
    dids: readonly string[],
  ): Promise<AtprotoLabelerInfoMap> => {
    calls.push([...dids]);
    return { [labeler.did]: labeler };
  };

  assert.deepEqual(
    await fetchCachedAtprotoLabelerInfo([labeler.did], cache, fetchLabelers),
    { [labeler.did]: labeler },
  );
  assert.deepEqual(
    await fetchCachedAtprotoLabelerInfo([labeler.did], cache, fetchLabelers),
    { [labeler.did]: labeler },
  );
  assert.deepEqual(calls, [[labeler.did]]);
});

test('fetchCachedAtprotoLabelerInfo deduplicates concurrent misses and caches negative results', async () => {
  const cache = createAtprotoLabelerInfoCache();
  const calls: string[][] = [];
  let resolveFetch: ((value: AtprotoLabelerInfoMap) => void) | undefined;
  const fetchLabelers = (
    dids: readonly string[],
  ): Promise<AtprotoLabelerInfoMap> => {
    calls.push([...dids]);
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };

  const first = fetchCachedAtprotoLabelerInfo(
    ['did:plc:missing'],
    cache,
    fetchLabelers,
  );
  const second = fetchCachedAtprotoLabelerInfo(
    ['did:plc:missing'],
    cache,
    fetchLabelers,
  );
  assert.deepEqual(calls, [['did:plc:missing']]);

  assert.ok(resolveFetch);
  resolveFetch({});
  assert.deepEqual(await first, {});
  assert.deepEqual(await second, {});
  assert.deepEqual(
    await fetchCachedAtprotoLabelerInfo(
      ['did:plc:missing'],
      cache,
      fetchLabelers,
    ),
    {},
  );
  assert.deepEqual(calls, [['did:plc:missing']]);
});

test('fetchCachedAtprotoLabelerInfo retries after failed fetches', async () => {
  const cache = createAtprotoLabelerInfoCache();
  let calls = 0;
  const fetchLabelers = async (): Promise<AtprotoLabelerInfoMap> => {
    calls += 1;
    if (calls === 1) throw new Error('network failed');
    return { [labeler.did]: labeler };
  };

  assert.deepEqual(
    await fetchCachedAtprotoLabelerInfo([labeler.did], cache, fetchLabelers),
    {},
  );
  assert.deepEqual(
    await fetchCachedAtprotoLabelerInfo([labeler.did], cache, fetchLabelers),
    { [labeler.did]: labeler },
  );
  assert.equal(calls, 2);
});
