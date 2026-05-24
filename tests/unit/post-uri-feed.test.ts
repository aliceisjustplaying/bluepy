import { describe, expect, test } from 'bun:test';

import { groupBoostItems } from '../../src/data/_internal/group-boost-items';
import type { TimelineFeedItem } from '../../src/data/feeds';

function repost(uri: string, by: string, indexedAt: string): TimelineFeedItem {
  return {
    uri,
    reason: {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: { did: by, handle: `${by}.test` },
      indexedAt,
    } as NonNullable<TimelineFeedItem['reason']>,
  };
}

describe('groupBoostItems', () => {
  test('does not replace the original post row when reposts share its URI', () => {
    const uri = 'at://did:plc:author/app.bsky.feed.post/abc';
    const rows = groupBoostItems([
      { uri },
      repost(uri, 'did:plc:one', '2026-05-24T08:00:00.000Z'),
      repost(uri, 'did:plc:two', '2026-05-24T08:01:00.000Z'),
    ]);

    expect(rows).toEqual([
      { type: 'item', item: { uri } },
      {
        type: 'boosts',
        items: [
          repost(uri, 'did:plc:one', '2026-05-24T08:00:00.000Z'),
          repost(uri, 'did:plc:two', '2026-05-24T08:01:00.000Z'),
        ],
      },
    ]);
  });
});
