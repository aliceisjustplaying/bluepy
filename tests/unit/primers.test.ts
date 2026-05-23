import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppBskyEmbedRecordWithMedia, type AppBskyFeedDefs } from '@atproto/api';

import {
  getCachedPostUris,
  getCachedProfileDids,
  primePosts,
  primeProfiles,
} from '../../src/data/_internal/prime';
import { appviewKey, keys, stableHash } from '../../src/data/keys';
import { createQueryClient } from '../../src/data/query-client';

const fixtureDir = join(import.meta.dir, '../fixtures/atproto');

const viewerScope = [
  'public',
  appviewKey('did:web:api.bsky.app', 'https://public.api.bsky.app'),
  stableHash([]),
] as const;

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as T;
}

describe('primePosts', () => {
  test('getTimeline.feed-mixed primes reply parent and root URIs', () => {
    const qc = createQueryClient();
    const fixture = loadFixture<{ feed: unknown[] }>(
      'getTimeline.feed-mixed.json',
    );
    primePosts(qc, viewerScope, fixture);

    const expectedUris = [
      'at://did:plc:fixture006/app.bsky.feed.post/3mmk5jiyl4k2w',
      'at://did:plc:fixture006/app.bsky.feed.post/3mmgfz4k25s2v',
      'at://did:plc:fixture008/app.bsky.feed.post/3mmk4lur3vs2o',
    ];
    const cached = getCachedPostUris(qc, viewerScope);
    for (const uri of expectedUris) {
      expect(cached).toContain(uri);
      expect(qc.getQueryData(keys.post(viewerScope, uri))).toBeTruthy();
    }
    expect(cached.length).toBeGreaterThanOrEqual(90);
  });

  test('recordWithMedia quotes are primed and reshaped to viewRef', () => {
    const qc = createQueryClient();
    const parentUri =
      'at://did:plc:fixture126/app.bsky.feed.post/3mmk5flpzok2s';
    const quotedUri =
      'at://did:plc:fixture127/app.bsky.feed.post/3mmk4rgucvs2e';
    primePosts(qc, viewerScope, loadFixture('searchPosts.json'));

    const parent = qc.getQueryData<AppBskyFeedDefs.PostView>(
      keys.post(viewerScope, parentUri),
    );
    expect(parent).toBeTruthy();
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(
        keys.post(viewerScope, quotedUri),
      ),
    ).toBeTruthy();

    const embed = parent?.embed;
    expect(AppBskyEmbedRecordWithMedia.isView(embed)).toBe(true);
    if (AppBskyEmbedRecordWithMedia.isView(embed)) {
      const recordWrapper = embed.record as {
        record?: { $type?: string; uri?: string };
      };
      expect(recordWrapper.record?.$type).toBe(
        'app.bsky.embed.record#viewRef',
      );
      expect(recordWrapper.record?.uri).toBe(quotedUri);
    }
  });

  test('getPostThread.deep primes nested replies', () => {
    const qc = createQueryClient();
    primePosts(qc, viewerScope, loadFixture('getPostThread.deep.json'));
    expect(getCachedPostUris(qc, viewerScope).length).toBeGreaterThan(3);
  });
});

describe('primeProfiles', () => {
  test('getProfile.basic primes profileByDid', () => {
    const qc = createQueryClient();
    const fixture = loadFixture<{ did: string }>('getProfile.basic.json');
    primeProfiles(qc, viewerScope, fixture);
    expect(getCachedProfileDids(qc, viewerScope)).toContain(fixture.did);
  });
});
