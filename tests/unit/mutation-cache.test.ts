import { describe, expect, test } from 'bun:test';

import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import { QueryClient } from '@tanstack/react-query';

import {
  patchCachedPostForViewer,
  patchCachedThreadPostsForViewer,
  patchCachedProfileForViewer,
} from '../../src/data/_internal/mutation-cache';
import {
  patchPostLike,
  patchProfileFollow,
} from '../../src/data/_internal/patchers';
import { keys } from '../../src/data/keys';

const scopeA = ['did:plc:viewer', 'appview-a', 'labels-a'] as const;
const scopeB = ['did:plc:viewer', 'appview-b', 'labels-b'] as const;
const otherViewer = ['did:plc:other', 'appview-a', 'labels-a'] as const;

function post(uri: string): AppBskyFeedDefs.PostView {
  return {
    uri,
    cid: 'bafyreicid',
    author: {
      did: 'did:plc:author',
      handle: 'author.test',
      displayName: 'Author',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'hello',
      createdAt: '2026-05-24T00:00:00.000Z',
    },
    indexedAt: '2026-05-24T00:00:00.000Z',
    likeCount: 0,
    viewer: {},
  };
}

function replyPost(uri: string, rootUri: string): AppBskyFeedDefs.PostView {
  return {
    ...post(uri),
    record: {
      $type: 'app.bsky.feed.post',
      text: 'reply',
      createdAt: '2026-05-24T00:00:00.000Z',
      reply: {
        root: { uri: rootUri, cid: 'bafyreiroot' },
        parent: { uri: rootUri, cid: 'bafyreiroot' },
      },
    },
  };
}

function profile(did: string): AppBskyActorDefs.ProfileViewDetailed {
  return {
    did,
    handle: 'author.test',
    displayName: 'Author',
    viewer: {},
  };
}

describe('mutation cache helpers', () => {
  test('post patching reaches every same-viewer canonical scope only', async () => {
    const qc = new QueryClient();
    const uri = 'at://did:plc:author/app.bsky.feed.post/rkey';
    qc.setQueryData(keys.post(scopeA, uri), post(uri));
    qc.setQueryData(keys.post(scopeB, uri), post(uri));
    qc.setQueryData(keys.post(otherViewer, uri), post(uri));

    const rollback = await patchCachedPostForViewer(qc, scopeA, uri, (item) =>
      patchPostLike(item, true),
    );

    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeA, uri))?.viewer
        ?.like,
    ).toBe(uri);
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeB, uri))?.viewer
        ?.like,
    ).toBe(uri);
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(otherViewer, uri))
        ?.viewer?.like,
    ).toBeUndefined();

    rollback();
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeA, uri))?.viewer
        ?.like,
    ).toBeUndefined();
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeB, uri))?.viewer
        ?.like,
    ).toBeUndefined();
  });

  test('profile patching reaches every same-viewer canonical scope only', async () => {
    const qc = new QueryClient();
    const did = 'did:plc:author';
    qc.setQueryData(keys.profileByDid(scopeA, did), profile(did));
    qc.setQueryData(keys.profileByDid(scopeB, did), profile(did));
    qc.setQueryData(keys.profileByDid(otherViewer, did), profile(did));

    await patchCachedProfileForViewer(qc, scopeA, did, (item) =>
      patchProfileFollow(
        item,
        true,
        'at://did:plc:viewer/app.bsky.graph.follow/rkey',
      ),
    );

    expect(
      qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
        keys.profileByDid(scopeA, did),
      )?.viewer?.following,
    ).toBe('at://did:plc:viewer/app.bsky.graph.follow/rkey');
    expect(
      qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
        keys.profileByDid(scopeB, did),
      )?.viewer?.following,
    ).toBe('at://did:plc:viewer/app.bsky.graph.follow/rkey');
    expect(
      qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
        keys.profileByDid(otherViewer, did),
      )?.viewer?.following,
    ).toBeUndefined();
  });

  test('thread post patching reaches cached replies for same viewer only', async () => {
    const qc = new QueryClient();
    const rootUri = 'at://did:plc:author/app.bsky.feed.post/root';
    const replyUri = 'at://did:plc:author/app.bsky.feed.post/reply';
    qc.setQueryData(keys.post(scopeA, rootUri), post(rootUri));
    qc.setQueryData(keys.post(scopeA, replyUri), replyPost(replyUri, rootUri));
    qc.setQueryData(keys.post(otherViewer, replyUri), replyPost(replyUri, rootUri));

    const rollback = await patchCachedThreadPostsForViewer(
      qc,
      scopeA,
      rootUri,
      (item) => ({
        ...item,
        viewer: { ...item.viewer, threadMuted: true },
      }),
    );

    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeA, rootUri))
        ?.viewer?.threadMuted,
    ).toBe(true);
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeA, replyUri))
        ?.viewer?.threadMuted,
    ).toBe(true);
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(otherViewer, replyUri))
        ?.viewer?.threadMuted,
    ).toBeUndefined();

    rollback();
    expect(
      qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scopeA, replyUri))
        ?.viewer?.threadMuted,
    ).toBeUndefined();
  });
});
