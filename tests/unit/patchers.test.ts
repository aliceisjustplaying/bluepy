import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';

import {
  patchPostBookmark,
  patchPostLike,
  patchPostRepost,
  patchProfileBlock,
  patchProfileFollow,
  patchProfileMute,
} from '../../src/data/_internal/patchers';

const fixtureDir = join(import.meta.dir, '../fixtures/atproto');

function loadPost(): AppBskyFeedDefs.PostView {
  const fixture = JSON.parse(
    readFileSync(join(fixtureDir, 'moderation/label.json'), 'utf8'),
  ) as AppBskyFeedDefs.PostView;
  return structuredClone(fixture);
}

function loadProfile(): AppBskyActorDefs.ProfileViewDetailed {
  const fixture = JSON.parse(
    readFileSync(join(fixtureDir, 'getProfile.basic.json'), 'utf8'),
  ) as AppBskyActorDefs.ProfileViewDetailed;
  return structuredClone(fixture);
}

describe('optimistic patchers', () => {
  test('like patch toggles viewer.like and likeCount', () => {
    const before = loadPost();
    const likeUri = 'at://did:plc:viewer/app.bsky.feed.like/abc';
    const liked = patchPostLike(before, true, likeUri);
    expect(liked.viewer?.like).toBe(likeUri);
    expect(liked.likeCount).toBe((before.likeCount ?? 0) + 1);
    const confirmed = patchPostLike(liked, true, likeUri);
    expect(confirmed.likeCount).toBe(liked.likeCount);
    const restored = patchPostLike(liked, false);
    expect(restored.likeCount).toBe(before.likeCount);
    expect(restored.viewer?.like).toBeUndefined();
  });

  test('repost patch toggles viewer.repost and repostCount', () => {
    const before = loadPost();
    const repostUri = 'at://did:plc:viewer/app.bsky.feed.repost/abc';
    const reposted = patchPostRepost(before, true, repostUri);
    expect(reposted.viewer?.repost).toBe(repostUri);
    expect(reposted.repostCount).toBe((before.repostCount ?? 0) + 1);
    const confirmed = patchPostRepost(reposted, true, repostUri);
    expect(confirmed.repostCount).toBe(reposted.repostCount);
  });

  test('bookmark patch toggles viewer.bookmarked', () => {
    const before = loadPost();
    const bookmarked = patchPostBookmark(before, true);
    expect(bookmarked.viewer?.bookmarked).toBe(true);
    const restored = patchPostBookmark(bookmarked, false);
    expect(restored.viewer?.bookmarked).toBeUndefined();
  });

  test('follow patch toggles viewer.following', () => {
    const before = loadProfile();
    const followUri = 'at://did:plc:viewer/app.bsky.graph.follow/abc';
    const following = patchProfileFollow(before, true, followUri);
    expect(following.viewer?.following).toBe(followUri);
  });

  test('mute patch toggles viewer.muted', () => {
    const before = loadProfile();
    const muted = patchProfileMute(before, true);
    expect(muted.viewer?.muted).toBe(true);
  });

  test('block patch toggles viewer.blocking', () => {
    const before = loadProfile();
    const blockUri = 'at://did:plc:viewer/app.bsky.graph.block/abc';
    const blocked = patchProfileBlock(before, true, blockUri);
    expect(blocked.viewer?.blocking).toBe(blockUri);
  });
});
