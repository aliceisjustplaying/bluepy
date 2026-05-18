import { expect, test } from '@playwright/test';

import {
  createAtprotoClient,
  notificationStatusURI,
  notificationType,
} from '../src/utils/atproto-adapter.js';

const TEST_CID =
  'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

/**
 * @param {string} uri
 * @param {string} handle
 * @param {string} text
 */
function makeNotificationPost(uri, handle, text) {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri,
    cid: TEST_CID,
    author: {
      did: `did:plc:${handle}`,
      handle: `${handle}.test`,
      displayName: handle,
    },
    record: {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: '2026-05-18T10:00:00.000Z',
    },
    indexedAt: '2026-05-18T10:00:00.000Z',
  };
}

test.describe('ATProto notifications', () => {
  test('maps repost-via-repost to the original post', () => {
    const notification = {
      reason: 'repost-via-repost',
      reasonSubject: 'at://did:plc:test/app.bsky.feed.repost/repost-record-key',
      record: {
        subject: {
          uri: 'at://did:plc:test/app.bsky.feed.post/post-record-key',
        },
      },
    };

    expect(notificationType(notification.reason)).toBe('reblog');
    expect(notificationStatusURI(notification)).toBe(
      'at://did:plc:test/app.bsky.feed.post/post-record-key',
    );
  });

  test('requests Bluesky mention and reply reasons for mention notifications', async () => {
    const originalFetch = globalThis.fetch;
    const mentionPostUri =
      'at://did:plc:alice/app.bsky.feed.post/mention-post';
    const replyPostUri = 'at://did:plc:bob/app.bsky.feed.post/reply-post';
    const requestedReasons = [];

    globalThis.fetch = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const parsedUrl = new URL(url);

      if (url.includes('app.bsky.notification.listNotifications')) {
        requestedReasons.push(...parsedUrl.searchParams.getAll('reasons'));
        return Response.json({
          cursor: undefined,
          notifications: [
            {
              uri: mentionPostUri,
              cid: TEST_CID,
              author: { did: 'did:plc:alice', handle: 'alice.test' },
              reason: 'mention',
              record: {},
              isRead: false,
              indexedAt: '2026-05-18T10:00:00.000Z',
            },
            {
              uri: replyPostUri,
              cid: TEST_CID,
              author: { did: 'did:plc:bob', handle: 'bob.test' },
              reason: 'reply',
              record: {},
              isRead: false,
              indexedAt: '2026-05-18T10:01:00.000Z',
            },
          ],
        });
      }

      if (url.includes('app.bsky.feed.getPosts')) {
        return Response.json({
          posts: [
            makeNotificationPost(mentionPostUri, 'alice', 'mentioned you'),
            makeNotificationPost(replyPostUri, 'bob', 'replied to you'),
          ],
        });
      }

      return Response.json({});
    };

    try {
      const client = createAtprotoClient({
        service: 'https://bsky.social',
      });
      const page = await client.v1.notifications
        .list({ limit: 20, types: ['mention'] })
        .values()
        .next();

      expect(new Set(requestedReasons)).toEqual(new Set(['mention', 'reply']));
      expect(page.value.map((notification) => notification.type)).toEqual([
        'mention',
        'mention',
      ]);
      expect(page.value.map((notification) => notification.status?.id)).toEqual(
        [encodeURIComponent(mentionPostUri), encodeURIComponent(replyPostUri)],
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
