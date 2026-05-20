import { expect, test } from '@playwright/test';

import { createAtprotoClient } from '../src/utils/atproto-adapter.js';

const bookmarkedPost = {
  $type: 'app.bsky.feed.defs#postView',
  uri: 'at://did:plc:alice/app.bsky.feed.post/bookmarked',
  cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  author: {
    did: 'did:plc:alice',
    handle: 'alice.test',
    displayName: 'Alice',
  },
  record: {
    $type: 'app.bsky.feed.post',
    text: 'bookmarked post',
    createdAt: '2026-05-08T00:00:00.000Z',
  },
  indexedAt: '2026-05-08T00:00:00.000Z',
  replyCount: 1,
  repostCount: 2,
  likeCount: 3,
  quoteCount: 4,
  viewer: {
    bookmarked: true,
  },
};

test.describe('ATProto bookmarks', () => {
  test('maps official bookmark views from the nested item post', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url.includes('app.bsky.bookmark.getBookmarks')) {
        return Response.json({
          cursor: undefined,
          bookmarks: [
            {
              subject: {
                uri: bookmarkedPost.uri,
                cid: bookmarkedPost.cid,
              },
              item: bookmarkedPost,
              createdAt: '2026-05-08T00:01:00.000Z',
            },
          ],
        });
      }

      return Response.json({});
    };

    try {
      const client = createAtprotoClient({
        service: 'https://bsky.social',
      });
      const page = await client.v1.bookmarks.list({ limit: 1 }).values().next();

      expect(page.value).toHaveLength(1);
      expect(page.value[0]).toMatchObject({
        id: encodeURIComponent(bookmarkedPost.uri),
        uri: bookmarkedPost.uri,
        content: 'bookmarked post',
        bookmarked: true,
        repliesCount: 1,
        repostsCount: 2,
        favouritesCount: 3,
        quotesCount: 4,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
