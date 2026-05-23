import { describe, expect, test } from 'bun:test';

import type { AppBskyActorDefs } from '@atproto/api';

import {
  applyPreferenceMutation,
  updatePreferences,
} from '../../src/data/_internal/preferences-mutations';

function adultContentPref(enabled: boolean): AppBskyActorDefs.Preferences[number] {
  return {
    $type: 'app.bsky.actor.defs#adultContentPref',
    enabled,
  };
}

function labelersPref(
  labelers: AppBskyActorDefs.LabelerPrefItem[],
): AppBskyActorDefs.Preferences[number] {
  return {
    $type: 'app.bsky.actor.defs#labelersPref',
    labelers,
  };
}

describe('updatePreferences serialization', () => {
  test('applies concurrent mutations on the same lock key in order', async () => {
    let prefs: AppBskyActorDefs.Preferences = [
      adultContentPref(false),
      labelersPref([]),
    ];
    let inFlightGets = 0;
    let maxConcurrentGets = 0;

    const agent = {
      app: {
        bsky: {
          actor: {
            getPreferences: async () => {
              inFlightGets += 1;
              maxConcurrentGets = Math.max(maxConcurrentGets, inFlightGets);
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
              });
              inFlightGets -= 1;
              return { data: { preferences: [...prefs] } };
            },
            putPreferences: async ({
              preferences,
            }: {
              preferences: AppBskyActorDefs.Preferences;
            }) => {
              prefs = [...preferences];
            },
          },
        },
      },
    };

    await Promise.all([
      updatePreferences(
        agent,
        (current) => applyPreferenceMutation(current, 'adultContent', true),
        'did:plc:test',
      ),
      updatePreferences(
        agent,
        (current) =>
          applyPreferenceMutation(current, 'labelers', [
            { did: 'did:plc:labeler' },
          ]),
        'did:plc:test',
      ),
    ]);

    expect(maxConcurrentGets).toBe(1);
    expect(prefs).toEqual([
      adultContentPref(true),
      labelersPref([{ did: 'did:plc:labeler' }]),
    ]);
  });
});
