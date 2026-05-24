import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppBskyActorDefs } from '@atproto/api';

import {
  applyPreferenceMutation,
  type PreferenceMutationType,
} from '../../src/data/_internal/preferences-mutations';

const fixturePath = join(
  import.meta.dir,
  '../fixtures/atproto/getPreferences.with-unknown.json',
);

const UNKNOWN_PREF = {
  $type: 'app.bsky.actor.defs#someFuturePref',
  futureField: 'fixture-future-value',
} as const;

function loadFixturePreferences(): AppBskyActorDefs.Preferences {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    preferences: AppBskyActorDefs.Preferences;
  };
  return raw.preferences;
}

function findUnknown(prefs: AppBskyActorDefs.Preferences) {
  return prefs.find(
    (entry) => entry.$type === 'app.bsky.actor.defs#someFuturePref',
  );
}

const mutationSamples: Record<
  PreferenceMutationType,
  Parameters<typeof applyPreferenceMutation>[2]
> = {
  adultContent: true,
  contentLabels: [
    {
      $type: 'app.bsky.actor.defs#contentLabelPref',
      label: 'test-label',
      visibility: 'hide',
    },
  ],
  savedFeeds: [
    {
      id: 'fixture-feed',
      type: 'timeline',
      value: 'following',
      pinned: true,
    },
  ],
  mutedWords: [
    {
      id: 'fixture-muted',
      value: 'fixture',
      targets: ['content'],
      actorTarget: 'all',
    },
  ],
  threadView: {
    $type: 'app.bsky.actor.defs#threadViewPref',
    sort: 'oldest',
  },
  feedView: [
    {
      $type: 'app.bsky.actor.defs#feedViewPref',
      feed: 'home',
      hideReplies: true,
    },
  ],
  postInteractionSettings: {
    $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
    threadgateAllowRules: [],
  },
  hiddenPosts: ['at://did:plc:fixture/app.bsky.feed.post/fixture'],
  personalDetails: {
    $type: 'app.bsky.actor.defs#personalDetailsPref',
    birthDate: '1990-01-01',
  },
  labelers: [{ did: 'did:plc:fixture-labeler' }],
};

describe('preferences preserve-unknown writes', () => {
  test('fixture includes the unknown preference entry', () => {
    const prefs = loadFixturePreferences();
    expect(findUnknown(prefs)).toEqual(UNKNOWN_PREF);
  });

  for (const type of Object.keys(mutationSamples) as PreferenceMutationType[]) {
    test(`${type} mutation preserves unknown $type entries`, () => {
      const prefs = loadFixturePreferences();
      const next = applyPreferenceMutation(prefs, type, mutationSamples[type]);
      expect(findUnknown(next)).toEqual(UNKNOWN_PREF);
    });
  }
});
