import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';

import {
  decidePostModeration,
  decideProfileModeration,
  type ModerationContext,
} from '../../src/render/moderation-decision';

const fixtureDir = join(import.meta.dir, '../fixtures/atproto');

const labelerDid = 'did:plc:fixture010';

function baseContext(
  overrides: Partial<ModerationContext> = {},
): ModerationContext {
  return {
    baselineLabelers: [{ did: labelerDid }],
    subscribedLabelers: [],
    acceptedLabelerDids: [labelerDid],
    contentLabelPrefs: [],
    adultContent: false,
    mutedWords: [],
    hiddenPosts: [],
    userDid: 'did:plc:viewer',
    ...overrides,
  };
}

function loadPost(name: string): AppBskyFeedDefs.PostView {
  const raw = JSON.parse(
    readFileSync(join(fixtureDir, 'moderation', name), 'utf8'),
  ) as AppBskyFeedDefs.PostView | { post: AppBskyFeedDefs.PostView };
  if ('post' in raw) return raw.post;
  return raw;
}

function loadProfile(name: string): AppBskyActorDefs.ProfileViewDetailed {
  return JSON.parse(
    readFileSync(join(fixtureDir, name), 'utf8'),
  ) as AppBskyActorDefs.ProfileViewDetailed;
}

describe('decidePostModeration', () => {
  test('label fixture warns when label is from accepted labeler', () => {
    const post = loadPost('label.json');
    const decision = decidePostModeration(post, baseContext());
    expect(['warn', 'blur', 'hide']).toContain(decision.visibility);
    expect(decision.labels?.length).toBeGreaterThan(0);
  });

  test('hidden-post cause when URI is in hiddenPosts', () => {
    const post = loadPost('label.json');
    const withoutLabels = { ...post, labels: [] };
    const decision = decidePostModeration(
      withoutLabels,
      baseContext({ hiddenPosts: [post.uri] }),
    );
    expect(decision.cause).toBe('hidden-post');
    expect(decision.visibility).not.toBe('show');
  });

  test('muted-word cause when text matches mutedWordsPref', () => {
    const post = loadPost('muted-word.json');
    const decision = decidePostModeration(
      post,
      baseContext({
        mutedWords: [
          {
            id: '1',
            value: 'Fixture',
            targets: ['content'],
            actorTarget: 'all',
          },
        ],
      }),
    );
    expect(decision.cause).toBe('muted-word');
  });

  test('blocking cause from author.viewer.blocking', () => {
    const post = loadPost('label.json');
    const blocked = {
      ...post,
      labels: [],
      author: {
        ...post.author,
        viewer: {
          ...post.author.viewer,
          blocking: 'at://did:plc:fixture002/app.bsky.graph.block/abc',
        },
      },
    };
    const decision = decidePostModeration(blocked, baseContext());
    expect(decision.cause).toBe('blocking');
  });
});

describe('decideProfileModeration', () => {
  test('muted profile cause', () => {
    const profile = loadProfile('moderation/muted-profile.json');
    const decision = decideProfileModeration(profile, baseContext());
    expect(decision.cause).toBe('muted');
  });

  test('filters labels to accepted labeler set', () => {
    const profile = loadProfile('getProfile.basic.json');
    const decision = decideProfileModeration(
      profile,
      baseContext({ acceptedLabelerDids: ['did:plc:unknown'] }),
    );
    expect(decision.labels ?? []).toHaveLength(0);
  });
});
