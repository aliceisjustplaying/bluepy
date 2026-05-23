export type SavedFeedKind = 'timeline' | 'feed' | 'list';

export interface SavedFeed {
  id: string;
  type: SavedFeedKind;
  value: string;
  pinned: boolean;
}

export type LocalShortcutKind =
  | 'notifications'
  | 'mentions'
  | 'bookmarks'
  | 'favourites'
  | 'search'
  | 'hashtag'
  | 'account-statuses'
  | 'trending'
  | 'public';

export type ShortcutEntry =
  | {
      src: 'server';
      kind: SavedFeedKind;
      id: string;
    }
  | {
      src: 'local';
      kind: LocalShortcutKind;
      id: string;
    };

export type ShortcutItem =
  | {
      src: 'server';
      kind: SavedFeedKind;
      id: string;
      value: string;
    }
  | {
      src: 'local';
      kind: LocalShortcutKind;
      id: string;
    };

function serverEntryForFeed(feed: SavedFeed): ShortcutEntry {
  return { src: 'server', kind: feed.type, id: feed.id };
}

function serverItemForFeed(feed: SavedFeed): ShortcutItem {
  return {
    src: 'server',
    kind: feed.type,
    id: feed.id,
    value: feed.value,
  };
}

function entriesEqual(a: ShortcutEntry, b: ShortcutEntry): boolean {
  return a.src === b.src && a.id === b.id && a.kind === b.kind;
}

export function reconcileShortcutBar(
  localOrder: ShortcutEntry[],
  pinnedSavedFeeds: SavedFeed[],
): {
  items: ShortcutItem[];
  nextOrder: ShortcutEntry[];
  changed: boolean;
} {
  const pinnedById = new Map(
    pinnedSavedFeeds.map((feed) => [feed.id, feed] as const),
  );

  const nextOrder: ShortcutEntry[] = [];
  const items: ShortcutItem[] = [];

  for (const entry of localOrder) {
    if (entry.src === 'local') {
      nextOrder.push(entry);
      items.push({ src: 'local', kind: entry.kind, id: entry.id });
      continue;
    }

    const feed = pinnedById.get(entry.id);
    if (!feed || feed.type !== entry.kind) {
      continue;
    }

    nextOrder.push(entry);
    items.push(serverItemForFeed(feed));
  }

  for (const feed of pinnedSavedFeeds) {
    const exists = nextOrder.some(
      (entry) => entry.src === 'server' && entry.id === feed.id,
    );
    if (!exists) {
      const entry = serverEntryForFeed(feed);
      nextOrder.push(entry);
      items.push(serverItemForFeed(feed));
    }
  }

  const changed =
    nextOrder.length !== localOrder.length ||
    nextOrder.some((entry, index) => {
      const previous = localOrder[index];
      return !previous || !entriesEqual(entry, previous);
    });

  return { items, nextOrder, changed };
}
