import { describe, expect, test } from 'bun:test';

import {
  reconcileShortcutBar,
  type SavedFeed,
  type ShortcutEntry,
} from '../../src/data/_internal/reconcile-shortcuts';

const pinnedFeeds: SavedFeed[] = [
  {
    id: 'feed-a',
    type: 'feed',
    value: 'at://did:plc:a/app.bsky.feed.generator/a',
    pinned: true,
  },
  {
    id: 'timeline-a',
    type: 'timeline',
    value: 'following',
    pinned: true,
  },
];

describe('reconcileShortcutBar', () => {
  test('appends missing pinned server feeds', () => {
    const localOrder: ShortcutEntry[] = [
      { src: 'local', kind: 'notifications', id: 'notifs' },
    ];
    const result = reconcileShortcutBar(localOrder, pinnedFeeds);
    expect(result.changed).toBe(true);
    expect(result.nextOrder).toHaveLength(3);
    expect(result.items.map((item) => item.id)).toEqual([
      'notifs',
      'feed-a',
      'timeline-a',
    ]);
  });

  test('drops orphan server refs', () => {
    const localOrder: ShortcutEntry[] = [
      { src: 'server', kind: 'feed', id: 'removed-feed' },
      { src: 'local', kind: 'bookmarks', id: 'bookmarks' },
    ];
    const result = reconcileShortcutBar(localOrder, pinnedFeeds);
    expect(result.nextOrder.some((entry) => entry.id === 'removed-feed')).toBe(
      false,
    );
    expect(result.items.some((item) => item.id === 'bookmarks')).toBe(true);
  });

  test('is idempotent when already reconciled', () => {
    const localOrder: ShortcutEntry[] = [
      { src: 'local', kind: 'search', id: 'search' },
      { src: 'server', kind: 'feed', id: 'feed-a' },
      { src: 'server', kind: 'timeline', id: 'timeline-a' },
    ];
    const result = reconcileShortcutBar(localOrder, pinnedFeeds);
    expect(result.changed).toBe(false);
    expect(result.nextOrder).toEqual(localOrder);
  });
});
