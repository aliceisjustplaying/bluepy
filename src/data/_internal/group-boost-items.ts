import type { AppBskyFeedDefs } from '@atproto/api';

import type { TimelineFeedItem } from '../feeds';

export type PostUriFeedRow =
  | { type: 'item'; item: TimelineFeedItem }
  | { type: 'boosts'; items: TimelineFeedItem[] };

export function isReasonRepost(
  reason: AppBskyFeedDefs.FeedViewPost['reason'],
): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonRepost';
}

export function normalizeTimelineFeedItem(
  item: TimelineFeedItem | string,
): TimelineFeedItem {
  return typeof item === 'string' ? { uri: item } : item;
}

export function groupBoostItems(
  items: readonly (TimelineFeedItem | string)[],
): PostUriFeedRow[] {
  const rows: PostUriFeedRow[] = [];
  const groups = new Map<string, TimelineFeedItem[]>();

  for (const item of items) {
    const normalized = normalizeTimelineFeedItem(item);
    if (normalized.reason && isReasonRepost(normalized.reason)) {
      const existing = groups.get(normalized.uri);
      if (existing) {
        existing.push(normalized);
        continue;
      }
      groups.set(normalized.uri, [normalized]);
    }
    rows.push({ type: 'item', item: normalized });
  }

  return rows.map((row) => {
    if (row.type !== 'item') return row;
    if (!isReasonRepost(row.item.reason)) return row;
    const grouped = groups.get(row.item.uri);
    return grouped && grouped.length > 1 ? { type: 'boosts', items: grouped } : row;
  });
}
