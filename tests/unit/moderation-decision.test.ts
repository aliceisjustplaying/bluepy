import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { InterpretedLabelValueDefinition } from '@atproto/api';

import {
  decidePostModeration,
  decideProfileModeration,
  type ModerationContext,
} from '../../src/render/moderation-decision';

const fixtureDir = join(import.meta.dir, '../fixtures/atproto');

const labelerDid = 'did:plc:fixture010';
const customLabelerDid = 'did:plc:custom-labeler';
const otherLabelerDid = 'did:plc:other-labeler';

function baseContext(
  overrides: Partial<ModerationContext> = {},
): ModerationContext {
  return {
    baselineLabelers: [{ did: labelerDid }],
    subscribedLabelers: [],
    acceptedLabelerDids: [labelerDid],
    labelDefs: {},
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
  test('label fixture keeps post content visible when only media is blurred', () => {
    const post = loadPost('label.json');
    const decision = decidePostModeration(post, baseContext());
    expect(decision.visibility).toBe('show');
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
    expect(decision.visibility).toBe('blur');
    expect(decision.noOverride).toBe(true);
  });

  test('media-only blur surfaces contentMedia UI separately from contentView', () => {
    const post = loadPost('label.json');
    const decision = decidePostModeration(post, baseContext());
    expect(decision.visibility).toBe('show');
    expect(decision.mediaBlur).toBe(true);
    expect(decision.mediaNoOverride).toBe(true);
    expect(decision.noOverride).toBeUndefined();
  });

  test('labeler-specific content label prefs do not apply to other labelers', () => {
    const post = {
      ...loadPost('label.json'),
      labels: [
        {
          src: otherLabelerDid,
          uri: 'at://did:plc:fixture010/app.bsky.feed.post/3mmjrhdk6sc2z',
          val: 'custom-label',
          cts: '2026-05-23T15:32:32.053Z',
        },
      ],
    };
    const customLabel: InterpretedLabelValueDefinition = {
      identifier: 'custom-label',
      locales: [],
      severity: 'alert',
      blurs: 'content',
      defaultSetting: 'ignore',
      configurable: true,
      flags: [],
      behaviors: {
        content: {
          contentView: 'blur',
          contentList: 'blur',
        },
      },
    };

    const decision = decidePostModeration(
      post,
      baseContext({
        subscribedLabelers: [
          { did: customLabelerDid },
          { did: otherLabelerDid },
        ],
        acceptedLabelerDids: [labelerDid, customLabelerDid, otherLabelerDid],
        labelDefs: {
          [customLabelerDid]: [customLabel],
          [otherLabelerDid]: [customLabel],
        },
        contentLabelPrefs: [
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'custom-label',
            labelerDid: customLabelerDid,
            visibility: 'hide',
          },
        ],
      }),
    );

    expect(decision.visibility).toBe('show');
    expect(decision.labels).toHaveLength(1);
  });

  test.each([
    {
      type: 'app.bsky.embed.record#viewNotFound',
      uri: 'at://did:plc:missing/app.bsky.feed.post/missing',
      notFound: true,
    },
    {
      type: 'app.bsky.embed.record#viewDetached',
      uri: 'at://did:plc:detached/app.bsky.feed.post/detached',
      detached: true,
    },
  ])('unavailable quoted record does not hide the parent post', (record) => {
    const post = {
      ...loadPost('label.json'),
      labels: [],
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: record.type,
          uri: record.uri,
          notFound: 'notFound' in record ? record.notFound : undefined,
          detached: 'detached' in record ? record.detached : undefined,
        },
      },
    } satisfies AppBskyFeedDefs.PostView;
    const decision = decidePostModeration(post, baseContext());
    expect(decision.visibility).toBe('show');
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
