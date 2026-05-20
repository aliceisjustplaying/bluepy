import { expect, test } from '@playwright/test';

import {
  createAtprotoClient,
  notificationStatusURI,
  notificationType,
} from '../src/utils/atproto-adapter.js';

const TEST_CID = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

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
    const mentionPostUri = 'at://did:plc:alice/app.bsky.feed.post/mention-post';
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

      const method =
        typeof input === 'object' && input && 'method' in input
          ? input.method
          : 'GET';
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
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

  test('backfills notification author avatars from Bluesky when Blacksky omits them', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocalStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    let fallbackRequests = 0;

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key) => (key === 'settings-appview' ? 'blacksky' : null),
        removeItem: () => {},
        setItem: () => {},
      },
    });

    globalThis.fetch = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const parsedUrl = new URL(url);

      if (url.includes('app.bsky.notification.listNotifications')) {
        return Response.json({
          cursor: undefined,
          notifications: [
            {
              uri: 'at://did:plc:alice/app.bsky.graph.follow/follow-record',
              cid: TEST_CID,
              author: {
                did: 'did:plc:alice',
                handle: 'alice.test',
                displayName: 'Alice',
              },
              reason: 'follow',
              record: {},
              isRead: false,
              indexedAt: '2026-05-18T10:00:00.000Z',
            },
          ],
        });
      }

      if (
        parsedUrl.hostname === 'public.api.bsky.app' &&
        url.includes('app.bsky.actor.getProfile')
      ) {
        fallbackRequests += 1;
        return Response.json({
          $type: 'app.bsky.actor.defs#profileView',
          did: 'did:plc:alice',
          handle: 'alice.test',
          displayName: 'Alice',
          avatar:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar@jpeg',
          labels: [],
          viewer: {},
        });
      }

      const method =
        typeof input === 'object' && input && 'method' in input
          ? input.method
          : 'GET';
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    };

    try {
      const client = createAtprotoClient({
        service: 'https://api.blacksky.community',
      });
      const page = await client.v1.notifications
        .list({ limit: 20 })
        .values()
        .next();

      expect(fallbackRequests).toBe(1);
      expect(page.value[0].account.avatarStatic).toBe(
        'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar@jpeg',
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});
