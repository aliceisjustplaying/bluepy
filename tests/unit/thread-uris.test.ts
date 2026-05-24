import { describe, expect, test } from 'bun:test';
import type { AppBskyFeedDefs } from '@atproto/api';

import { collectThreadUris } from '../../src/data/_internal/thread-uris';

function threadPost(uri: string): AppBskyFeedDefs.ThreadViewPost {
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: { uri, cid: 'bafy', author: { did: 'did:test' } },
    replies: [],
  } as unknown as AppBskyFeedDefs.ThreadViewPost;
}

describe('collectThreadUris', () => {
  test('orders ancestors before hero and replies after', () => {
    const root = threadPost('at://did:plc:root/post/1');
    const hero = {
      ...threadPost('at://did:plc:hero/post/2'),
      parent: root,
      replies: [threadPost('at://did:plc:reply/post/3')],
    } as unknown as AppBskyFeedDefs.ThreadViewPost;

    expect(collectThreadUris(hero)).toEqual([
      'at://did:plc:root/post/1',
      'at://did:plc:hero/post/2',
      'at://did:plc:reply/post/3',
    ]);
  });
});
