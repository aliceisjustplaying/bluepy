import { AppBskyActorDefs } from '@atproto/api';

import type { SavedFeed } from './reconcile-shortcuts';

export type PreferenceMutationType =
  | 'adultContent'
  | 'contentLabels'
  | 'savedFeeds'
  | 'mutedWords'
  | 'threadView'
  | 'feedView'
  | 'postInteractionSettings'
  | 'hiddenPosts'
  | 'personalDetails'
  | 'labelers';

type Preferences = AppBskyActorDefs.Preferences;

function withoutType(
  prefs: Preferences,
  isType: (value: unknown) => boolean,
): Preferences {
  return prefs.filter((entry) => !isType(entry));
}

function replaceSingle(
  prefs: Preferences,
  isType: (value: unknown) => boolean,
  next: AppBskyActorDefs.Preferences[number],
): Preferences {
  return [...withoutType(prefs, isType), next];
}

function replaceMany(
  prefs: Preferences,
  isType: (value: unknown) => boolean,
  next: readonly AppBskyActorDefs.Preferences[number][],
): Preferences {
  return [...withoutType(prefs, isType), ...next];
}

function toSavedFeedItems(feeds: SavedFeed[]): AppBskyActorDefs.SavedFeed[] {
  return feeds.map((feed) => ({
    id: feed.id,
    type: feed.type,
    value: feed.value,
    pinned: feed.pinned,
  }));
}

export function applyPreferenceMutation(
  prefs: Preferences,
  type: PreferenceMutationType,
  value: unknown,
): Preferences {
  switch (type) {
    case 'adultContent':
      return replaceSingle(prefs, AppBskyActorDefs.isAdultContentPref, {
        $type: 'app.bsky.actor.defs#adultContentPref',
        enabled: Boolean(value),
      });
    case 'contentLabels':
      return replaceMany(
        prefs,
        AppBskyActorDefs.isContentLabelPref,
        value as AppBskyActorDefs.Preferences[number][],
      );
    case 'savedFeeds':
      return replaceSingle(prefs, AppBskyActorDefs.isSavedFeedsPrefV2, {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: toSavedFeedItems(value as SavedFeed[]),
      });
    case 'mutedWords':
      return replaceSingle(prefs, AppBskyActorDefs.isMutedWordsPref, {
        $type: 'app.bsky.actor.defs#mutedWordsPref',
        items: value as AppBskyActorDefs.MutedWord[],
      });
    case 'threadView':
      return replaceSingle(
        prefs,
        AppBskyActorDefs.isThreadViewPref,
        value as AppBskyActorDefs.Preferences[number],
      );
    case 'feedView':
      return replaceMany(
        prefs,
        AppBskyActorDefs.isFeedViewPref,
        value as AppBskyActorDefs.Preferences[number][],
      );
    case 'postInteractionSettings':
      return replaceSingle(
        prefs,
        AppBskyActorDefs.isPostInteractionSettingsPref,
        value as AppBskyActorDefs.Preferences[number],
      );
    case 'hiddenPosts':
      return replaceSingle(prefs, AppBskyActorDefs.isHiddenPostsPref, {
        $type: 'app.bsky.actor.defs#hiddenPostsPref',
        items: value as string[],
      });
    case 'personalDetails':
      return replaceSingle(
        prefs,
        AppBskyActorDefs.isPersonalDetailsPref,
        value as AppBskyActorDefs.Preferences[number],
      );
    case 'labelers':
      return replaceSingle(prefs, AppBskyActorDefs.isLabelersPref, {
        $type: 'app.bsky.actor.defs#labelersPref',
        labelers: value as AppBskyActorDefs.LabelerPrefItem[],
      });
    default: {
      const impossible: never = type;
      throw new Error(`Unknown preference mutation type: ${String(impossible)}`);
    }
  }
}

const updateChains = new Map<string, Promise<unknown>>();

// TanStack mutationKey does not serialize writes; this chain does.
async function runSerialized<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = updateChains.get(lockKey) ?? Promise.resolve();
  const operation = (async () => {
    try {
      await previous;
    } catch {
      // keep the chain alive after a failed update
    }
    return fn();
  })();

  updateChains.set(lockKey, operation);
  try {
    return await operation;
  } finally {
    if (updateChains.get(lockKey) === operation) {
      updateChains.delete(lockKey);
    }
  }
}

export async function updatePreferences(
  agent: {
    app: {
      bsky: {
        actor: {
          getPreferences: (args: Record<string, never>) => Promise<{
            data: { preferences: Preferences };
          }>;
          putPreferences: (args: {
            preferences: Preferences;
          }) => Promise<unknown>;
        };
      };
    };
  },
  mutate: (prefs: Preferences) => Preferences,
  lockKey = 'default',
): Promise<Preferences> {
  return runSerialized(lockKey, async () => {
    const res = await agent.app.bsky.actor.getPreferences({});
    const next = mutate([...res.data.preferences]);
    await agent.app.bsky.actor.putPreferences({ preferences: next });
    return next;
  });
}
