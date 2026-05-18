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

/**
 * @param {Parameters<typeof globalThis.fetch>[0]} input
 */
function fetchInputUrl(input) {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
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

    globalThis.fetch = /** @type {typeof globalThis.fetch} */ (async (input) => {
      const url = fetchInputUrl(input);
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
    });

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

  test('does not server-filter notifications when status is requested', async () => {
    const originalFetch = globalThis.fetch;
    const mentionPostUri =
      'at://did:plc:alice/app.bsky.feed.post/mention-post';
    const replyPostUri = 'at://did:plc:bob/app.bsky.feed.post/reply-post';
    const statusPostUri =
      'at://did:plc:carol/app.bsky.feed.post/status-post';
    const requests = [];
    const notifications = [
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
      {
        uri: statusPostUri,
        cid: TEST_CID,
        author: { did: 'did:plc:carol', handle: 'carol.test' },
        reason: 'subscribed-post',
        record: {},
        isRead: false,
        indexedAt: '2026-05-18T10:02:00.000Z',
      },
      {
        uri: 'at://did:plc:dave/app.bsky.graph.follow/follow-record',
        cid: TEST_CID,
        author: { did: 'did:plc:dave', handle: 'dave.test' },
        reason: 'follow',
        record: {},
        isRead: false,
        indexedAt: '2026-05-18T10:03:00.000Z',
      },
    ];

    globalThis.fetch = /** @type {typeof globalThis.fetch} */ (async (input) => {
      const url = fetchInputUrl(input);
      const parsedUrl = new URL(url);

      if (url.includes('app.bsky.notification.listNotifications')) {
        const reasons = parsedUrl.searchParams.getAll('reasons');
        requests.push(reasons);
        return Response.json({
          cursor: undefined,
          notifications: reasons.length
            ? notifications.filter((notification) =>
                reasons.includes(notification.reason),
              )
            : notifications,
        });
      }

      if (url.includes('app.bsky.feed.getPosts')) {
        return Response.json({
          posts: [
            makeNotificationPost(mentionPostUri, 'alice', 'mentioned you'),
            makeNotificationPost(replyPostUri, 'bob', 'replied to you'),
            makeNotificationPost(statusPostUri, 'carol', 'posted'),
          ],
        });
      }

      return Response.json({});
    });

    try {
      const client = createAtprotoClient({
        service: 'https://bsky.social',
      });

      const statusPage = await client.v1.notifications
        .list({ limit: 20, types: ['status'] })
        .values()
        .next();
      const mixedPage = await client.v1.notifications
        .list({ limit: 20, types: ['mention', 'status'] })
        .values()
        .next();

      expect(requests).toEqual([[], []]);
      expect(statusPage.value.map((notification) => notification.type)).toEqual(
        ['status'],
      );
      expect(mixedPage.value.map((notification) => notification.type)).toEqual([
        'mention',
        'mention',
        'status',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
