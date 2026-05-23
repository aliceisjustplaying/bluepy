import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedDefs,
  type AppBskyFeedDefs as FeedDefs,
} from '@atproto/api';

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

function makePostWithEmbed(
  embed: AppBskyFeedDefs.PostView['embed'],
): AppBskyFeedDefs.PostView {
  return {
    uri: 'at://did:plc:fixture-parent/app.bsky.feed.post/parent',
    cid: 'bafyparent',
    author: {
      did: 'did:plc:fixture-parent',
      handle: 'parent.test',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'parent post',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    indexedAt: '2026-01-01T00:00:00.000Z',
    embed,
  };
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

  test('viewNotFound embed passes through unchanged', () => {
    const qc = createQueryClient();
    const embed = {
      $type: 'app.bsky.embed.record#viewNotFound',
      uri: 'at://did:plc:missing/app.bsky.feed.post/missing',
      notFound: true,
    };
    const post = makePostWithEmbed(embed);
    primePosts(qc, viewerScope, { feed: [{ post }] });

    const cached = qc.getQueryData<FeedDefs.PostView>(
      keys.post(viewerScope, post.uri),
    );
    expect(cached?.embed).toEqual(embed);
    expect(getCachedPostUris(qc, viewerScope)).not.toContain(embed.uri);
  });

  test('viewBlocked embed passes through unchanged', () => {
    const qc = createQueryClient();
    const embed = {
      $type: 'app.bsky.embed.record#viewBlocked',
      uri: 'at://did:plc:blocked/app.bsky.feed.post/blocked',
      blocked: true,
      author: { did: 'did:plc:blocked' },
    };
    const post = makePostWithEmbed(embed);
    primePosts(qc, viewerScope, { feed: [{ post }] });

    const cached = qc.getQueryData<FeedDefs.PostView>(
      keys.post(viewerScope, post.uri),
    );
    expect(cached?.embed).toEqual(embed);
  });

  test('viewDetached embed passes through unchanged', () => {
    const qc = createQueryClient();
    const embed = {
      $type: 'app.bsky.embed.record#viewDetached',
      uri: 'at://did:plc:detached/app.bsky.feed.post/detached',
      detached: true,
    };
    const post = makePostWithEmbed(embed);
    primePosts(qc, viewerScope, { feed: [{ post }] });

    const cached = qc.getQueryData<FeedDefs.PostView>(
      keys.post(viewerScope, post.uri),
    );
    expect(cached?.embed).toEqual(embed);
  });

  test('non-post record embed passes through unchanged', () => {
    const qc = createQueryClient();
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.feed.defs#generatorView',
        uri: 'at://did:plc:feed/app.bsky.feed.generator/custom',
        cid: 'bafyfeed',
        creator: {
          did: 'did:plc:feed',
          handle: 'feed.test',
        },
        displayName: 'Custom feed',
      },
    };
    const post = makePostWithEmbed(embed);
    primePosts(qc, viewerScope, { feed: [{ post }] });

    const cached = qc.getQueryData<FeedDefs.PostView>(
      keys.post(viewerScope, post.uri),
    );
    expect(AppBskyEmbedRecord.isView(cached?.embed)).toBe(true);
    if (AppBskyEmbedRecord.isView(cached?.embed)) {
      expect(cached.embed.record).toEqual(embed.record);
    }
    expect(getCachedPostUris(qc, viewerScope)).toHaveLength(1);
  });

  test('unknown embed record variant passes through unchanged', () => {
    const qc = createQueryClient();
    const embed = {
      $type: 'app.bsky.embed.record#someFutureVariant',
      uri: 'at://did:plc:future/app.bsky.feed.post/future',
      futureField: 'fixture',
    };
    const post = makePostWithEmbed(embed);
    primePosts(qc, viewerScope, { feed: [{ post }] });

    const cached = qc.getQueryData<FeedDefs.PostView>(
      keys.post(viewerScope, post.uri),
    );
    expect(cached?.embed).toEqual(embed);
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
