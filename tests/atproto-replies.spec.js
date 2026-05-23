import { expect, test } from '@playwright/test';

import {
  fetchFollowingFeedPage,
  feedToStatuses,
  hydrateFeedReplyContext,
  postProcessFollowingFeed,
  postToStatus,
} from '../src/utils/atproto-adapter.js';
import { shouldShowReplyBadge } from '../src/utils/reply-badge.ts';
import {
  shouldFetchReplyContextForInstance,
  shouldFetchThreadParent,
} from '../src/utils/reply-context.js';
import {
  appendThreadDescendant,
  clearThreadDescendantReplies,
} from '../src/utils/thread-structure.js';
import {
  dedupeTimelineContextItems,
  groupContextItems,
} from '../src/utils/timeline-context.js';

/**
 * @typedef {import('../src/utils/thread-structure.js').ThreadStatus} ThreadStatus
 */

const parentUri = 'at://did:plc:parent/app.bsky.feed.post/root';
const childUri = 'at://did:plc:child/app.bsky.feed.post/reply';
const rootUri = 'at://did:plc:root/app.bsky.feed.post/root';

/**
 * @typedef {{
 *   post?: Record<string, unknown>;
 *   reply?: Record<string, unknown>;
 * }} FeedReplyOverrides
 *
 * @typedef {{
 *   post: Record<string, unknown>;
 *   reply: {
 *     parent: Record<string, unknown> & { author: Record<string, unknown> };
 *     root: Record<string, unknown>;
 *   };
 *   reason?: Record<string, unknown>;
 * }} FeedReplyItem
 */

/**
 * @param {FeedReplyOverrides} [overrides]
 * @returns {FeedReplyItem}
 */
function feedReply(overrides = {}) {
  return {
    post: {
      uri: childUri,
      cid: 'child-cid',
      author: {
        did: 'did:plc:child',
        handle: 'child.test',
        displayName: 'Child',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'reply text',
        createdAt: '2026-05-08T00:00:00.000Z',
        reply: {
          root: { uri: parentUri, cid: 'parent-cid' },
          parent: { uri: parentUri, cid: 'parent-cid' },
        },
      },
      indexedAt: '2026-05-08T00:00:00.000Z',
      replyCount: 0,
      repostCount: 0,
      likeCount: 0,
      quoteCount: 0,
      ...overrides.post,
    },
    reply: {
      parent: {
        uri: parentUri,
        cid: 'parent-cid',
        author: {
          did: 'did:plc:parent',
          handle: 'parent.test',
          displayName: 'Parent',
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'parent text',
          createdAt: '2026-05-08T00:00:00.000Z',
        },
      },
      root: {
        uri: parentUri,
        cid: 'parent-cid',
      },
      ...overrides.reply,
    },
  };
}

test.describe('ATProto reply mapping', () => {
  test('keeps the hydrated parent actor from timeline feed replies', () => {
    const status = postToStatus(feedReply());

    expect(status.inReplyToId).toBe(encodeURIComponent(parentUri));
    expect(status.inReplyToAccountId).toBe('did:plc:parent');
    expect(status._atproto.parent).toEqual({
      uri: parentUri,
      cid: 'parent-cid',
    });
    expect(status._atproto.replyParentAccount).toMatchObject({
      id: 'did:plc:parent',
      username: 'parent.test',
    });
  });

  test('falls back to the parent AT URI repo when the parent post is not hydrated', () => {
    const item = feedReply({ reply: undefined });
    delete item.reply;

    const status = postToStatus(item);

    expect(status.inReplyToAccountId).toBe('did:plc:parent');
    expect(status._atproto.replyParentAccount).toBeUndefined();
    expect(status._atproto.replyParentUnavailable).toBe(true);
  });

  test('keeps reply parent URIs when the parent cid is absent', () => {
    const item = feedReply({
      post: {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:00:00.000Z',
          reply: {
            root: { uri: rootUri },
            parent: { uri: parentUri },
          },
        },
      },
      reply: undefined,
    });
    delete item.reply;

    const status = postToStatus(item);

    expect(status.inReplyToId).toBe(encodeURIComponent(parentUri));
    expect(status._atproto.parent).toEqual({ uri: parentUri, cid: undefined });
    expect(status._atproto.root).toEqual({ uri: rootUri, cid: undefined });
  });

  test('shows Bluesky reply badges even when the reply mentions the parent actor', () => {
    expect(
      shouldShowReplyBadge({
        inReplyToId: encodeURIComponent(parentUri),
        inReplyToAccount: { id: 'did:plc:parent' },
        instance: 'bsky.social',
        spoilerText: '',
        mentions: [{ id: 'did:plc:parent' }],
        inReplyToAccountId: 'did:plc:parent',
      }),
    ).toBe(true);

    expect(
      shouldShowReplyBadge({
        inReplyToId: encodeURIComponent(parentUri),
        inReplyToAccount: { id: 'did:plc:parent' },
        instance: 'mastodon.social',
        spoilerText: '',
        mentions: [{ id: 'did:plc:parent' }],
        inReplyToAccountId: 'did:plc:parent',
      }),
    ).toBe(false);
  });

  test('shows stable generic Bluesky reply badges when parent actor is unavailable', () => {
    expect(
      shouldShowReplyBadge({
        inReplyToId: encodeURIComponent(parentUri),
        inReplyToAccount: undefined,
        isReplyParentUnavailable: true,
        instance: 'bsky.social',
        spoilerText: '',
        mentions: [],
        inReplyToAccountId: 'did:plc:parent',
      }),
    ).toBe(true);
  });

  test('does not fetch Bluesky reply context from timeline cards', () => {
    expect(shouldFetchReplyContextForInstance('bsky.social')).toBe(false);
    expect(
      shouldFetchThreadParent({
        instance: 'bsky.social',
        status: {
          inReplyToId: encodeURIComponent(parentUri),
          inReplyToAccountId: 'did:plc:alice',
          account: { id: 'did:plc:alice' },
        },
      }),
    ).toBe(false);
  });

  test('extracts hydrated reply context from feed payload synchronously', () => {
    const item = feedReply({
      post: {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:02:00.000Z',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: parentUri, cid: 'parent-cid' },
          },
        },
      },
      reply: {
        root: {
          uri: rootUri,
          cid: 'root-cid',
          author: {
            did: 'did:plc:root',
            handle: 'root.test',
            displayName: 'Root',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'root text',
            createdAt: '2026-05-08T00:00:00.000Z',
          },
        },
      },
    });

    const statuses = feedToStatuses([item]);

    expect(statuses.map((status) => status.uri)).toEqual([
      rootUri,
      parentUri,
      childUri,
    ]);
    expect(statuses[2]._atproto.replyParentAccount).toMatchObject({
      id: 'did:plc:parent',
      username: 'parent.test',
    });
  });

  test('uses grandparent author for payload-hydrated middle replies', () => {
    const grandparentUri = 'at://did:plc:grandparent/app.bsky.feed.post/root';
    const item = feedReply({
      post: {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:02:00.000Z',
          reply: {
            root: { uri: grandparentUri, cid: 'grandparent-cid' },
            parent: { uri: parentUri, cid: 'parent-cid' },
          },
        },
      },
      reply: {
        root: {
          uri: grandparentUri,
          cid: 'grandparent-cid',
          author: {
            did: 'did:plc:grandparent',
            handle: 'grandparent.test',
            displayName: 'Grandparent',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'grandparent text',
            createdAt: '2026-05-08T00:00:00.000Z',
          },
        },
        parent: {
          uri: parentUri,
          cid: 'parent-cid',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.test',
            displayName: 'Parent',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'parent text',
            createdAt: '2026-05-08T00:01:00.000Z',
            reply: {
              root: { uri: grandparentUri, cid: 'grandparent-cid' },
              parent: { uri: grandparentUri, cid: 'grandparent-cid' },
            },
          },
        },
        grandparentAuthor: {
          did: 'did:plc:grandparent',
          handle: 'grandparent.test',
          displayName: 'Grandparent',
        },
      },
    });

    const statuses = feedToStatuses([item]);

    expect(statuses.map((status) => status.uri)).toEqual([
      grandparentUri,
      parentUri,
      childUri,
    ]);
    expect(statuses[1]._atproto.replyParentUnavailable).toBe(false);
    expect(statuses[1]._atproto.replyParentAccount).toMatchObject({
      id: 'did:plc:grandparent',
      username: 'grandparent.test',
    });
  });

  test('batch hydrates missing feed reply parents before timeline render', async () => {
    const item = feedReply({ reply: undefined });
    delete item.reply;
    /** @type {string[] | undefined} */
    let requestedURIs;

    /** @param {{ uris: string[] }} params */
    const getPosts = async ({ uris }) => {
      requestedURIs = uris;
      return {
        data: {
          posts: [
            {
              uri: parentUri,
              cid: 'parent-cid',
              author: {
                did: 'did:plc:parent',
                handle: 'parent.test',
                displayName: 'Parent',
                avatar: 'https://cdn.example/avatar.jpg',
              },
              record: {
                $type: 'app.bsky.feed.post',
                text: 'parent text',
                createdAt: '2026-05-08T00:00:00.000Z',
              },
              indexedAt: '2026-05-08T00:00:00.000Z',
            },
          ],
        },
      };
    };

    const feed = await hydrateFeedReplyContext([item], {
      getPosts,
    });
    const statuses = feedToStatuses(feed);

    expect(requestedURIs).toEqual([parentUri]);
    expect(statuses.map((status) => status.uri)).toEqual([parentUri, childUri]);
    expect(statuses[1]._atproto.replyParentAccount).toMatchObject({
      id: 'did:plc:parent',
      username: 'parent.test',
      avatar: 'https://cdn.example/avatar.jpg',
    });
  });

  test('uses same-page root posts before Following thread dedupe', async () => {
    const rootPost = {
      uri: rootUri,
      cid: 'root-cid',
      author: {
        did: 'did:plc:root',
        handle: 'root.test',
        displayName: 'Root',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'root text',
        createdAt: '2026-05-08T00:00:00.000Z',
      },
      indexedAt: '2026-05-08T00:00:00.000Z',
    };
    const reply = feedReply({
      post: {
        author: {
          did: 'did:plc:child',
          handle: 'child.test',
          displayName: 'Child',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/1' },
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:02:00.000Z',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: parentUri, cid: 'parent-cid' },
          },
        },
      },
      reply: {
        root: { uri: rootUri, cid: 'root-cid' },
        parent: {
          uri: parentUri,
          cid: 'parent-cid',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.test',
            displayName: 'Parent',
            viewer: {
              following: 'at://did:plc:user/app.bsky.graph.follow/2',
            },
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'parent text',
            createdAt: '2026-05-08T00:01:00.000Z',
            reply: {
              root: { uri: rootUri, cid: 'root-cid' },
              parent: { uri: rootUri, cid: 'root-cid' },
            },
          },
        },
        grandparentAuthor: rootPost.author,
      },
    });
    const root = { post: rootPost };

    const feed = await hydrateFeedReplyContext([reply, root], {
      getPosts: async () => {
        throw new Error('same-page root should not be fetched');
      },
    });
    const statuses = feedToStatuses(
      postProcessFollowingFeed(feed, 'did:plc:user'),
    );

    expect(statuses.map((status) => status.uri)).toEqual([
      rootUri,
      parentUri,
      childUri,
    ]);
  });

  test('fetches missing parents while reusing same-page roots', async () => {
    const rootPost = {
      uri: rootUri,
      cid: 'root-cid',
      author: {
        did: 'did:plc:root',
        handle: 'root.test',
        displayName: 'Root',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'root text',
        createdAt: '2026-05-08T00:00:00.000Z',
      },
      indexedAt: '2026-05-08T00:00:00.000Z',
    };
    const reply = feedReply({
      post: {
        author: {
          did: 'did:plc:child',
          handle: 'child.test',
          displayName: 'Child',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/1' },
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:02:00.000Z',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: parentUri, cid: 'parent-cid' },
          },
        },
      },
      reply: {
        root: { uri: rootUri, cid: 'root-cid' },
        parent: { uri: parentUri, cid: 'parent-cid' },
      },
    });
    const root = { post: rootPost };
    /** @type {string[] | undefined} */
    let requestedURIs;

    const feed = await hydrateFeedReplyContext([reply, root], {
      /** @param {{ uris: string[] }} params */
      getPosts: async ({ uris }) => {
        requestedURIs = uris;
        return {
          data: {
            posts: [
              {
                uri: parentUri,
                cid: 'parent-cid',
                author: {
                  did: 'did:plc:parent',
                  handle: 'parent.test',
                  displayName: 'Parent',
                  viewer: {
                    following: 'at://did:plc:user/app.bsky.graph.follow/2',
                  },
                },
                record: {
                  $type: 'app.bsky.feed.post',
                  text: 'parent text',
                  createdAt: '2026-05-08T00:01:00.000Z',
                  reply: {
                    root: { uri: rootUri, cid: 'root-cid' },
                    parent: { uri: rootUri, cid: 'root-cid' },
                  },
                },
                indexedAt: '2026-05-08T00:01:00.000Z',
              },
            ],
          },
        };
      },
    });
    const statuses = feedToStatuses(
      postProcessFollowingFeed(feed, 'did:plc:user'),
    );

    expect(requestedURIs).toEqual([parentUri]);
    expect(statuses.map((status) => status.uri)).toEqual([
      rootUri,
      parentUri,
      childUri,
    ]);
  });

  test('groups incomplete Following reply chains with the root post', async () => {
    const intermediateUri =
      'at://did:plc:intermediate/app.bsky.feed.post/intermediate';
    const rootPost = {
      uri: rootUri,
      cid: 'root-cid',
      author: {
        did: 'did:plc:root',
        handle: 'root.test',
        displayName: 'Root',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'root text',
        createdAt: '2026-05-08T00:00:00.000Z',
      },
      indexedAt: '2026-05-08T00:00:00.000Z',
    };
    const item = feedReply({
      post: {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'reply text',
          createdAt: '2026-05-08T00:02:00.000Z',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: parentUri, cid: 'parent-cid' },
          },
        },
      },
      reply: {
        root: rootPost,
        parent: {
          uri: parentUri,
          cid: 'parent-cid',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.test',
            displayName: 'Parent',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'parent text',
            createdAt: '2026-05-08T00:01:00.000Z',
            reply: {
              root: { uri: rootUri, cid: 'root-cid' },
              parent: { uri: intermediateUri, cid: 'intermediate-cid' },
            },
          },
        },
      },
    });

    const statuses = feedToStatuses([item]);
    const grouped = groupContextItems(statuses);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      type: 'conversation',
      incompleteThread: true,
    });
    expect(
      Array.from(grouped[0].items, (status) => String(status.uri)),
    ).toEqual([rootUri, parentUri, childUri]);
  });

  test('groups direct Following replies without duplicating the root post', () => {
    const statuses = feedToStatuses([feedReply()]);
    const grouped = groupContextItems(statuses);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      type: 'conversation',
      incompleteThread: false,
    });
    expect(
      Array.from(grouped[0].items, (status) => String(status.uri)),
    ).toEqual([parentUri, childUri]);
  });

  test('marks first visible mid-chain Following replies as incomplete', () => {
    const intermediateUri =
      'at://did:plc:intermediate/app.bsky.feed.post/intermediate';
    const statuses = feedToStatuses([
      feedReply({
        post: {
          record: {
            $type: 'app.bsky.feed.post',
            text: 'reply text',
            createdAt: '2026-05-08T00:02:00.000Z',
            reply: {
              root: { uri: rootUri, cid: 'root-cid' },
              parent: { uri: parentUri, cid: 'parent-cid' },
            },
          },
        },
        reply: {
          root: { uri: rootUri, cid: 'root-cid' },
          parent: {
            uri: parentUri,
            cid: 'parent-cid',
            author: {
              did: 'did:plc:parent',
              handle: 'parent.test',
              displayName: 'Parent',
            },
            record: {
              $type: 'app.bsky.feed.post',
              text: 'parent text',
              createdAt: '2026-05-08T00:01:00.000Z',
              reply: {
                root: { uri: rootUri, cid: 'root-cid' },
                parent: { uri: intermediateUri, cid: 'intermediate-cid' },
              },
            },
          },
        },
      }),
    ]);
    const grouped = groupContextItems(statuses);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      incompleteThread: true,
    });
    expect(
      Array.from(grouped[0].items, (status) => String(status.uri)),
    ).toEqual([parentUri, childUri]);
  });

  test('hides Following replies to people the current user does not follow', () => {
    const item = feedReply({
      post: {
        author: {
          did: 'did:plc:child',
          handle: 'child.test',
          displayName: 'Child',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/1' },
        },
      },
      reply: {
        parent: {
          uri: parentUri,
          cid: 'parent-cid',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.test',
            displayName: 'Parent',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'parent text',
            createdAt: '2026-05-08T00:00:00.000Z',
          },
        },
      },
    });

    expect(postProcessFollowingFeed([item], 'did:plc:user')).toEqual([]);
  });

  test('keeps Following replies when the parent author is followed', () => {
    const item = feedReply({
      post: {
        author: {
          did: 'did:plc:child',
          handle: 'child.test',
          displayName: 'Child',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/1' },
        },
      },
      reply: {
        parent: {
          uri: parentUri,
          cid: 'parent-cid',
          author: {
            did: 'did:plc:parent',
            handle: 'parent.test',
            displayName: 'Parent',
            viewer: {
              following: 'at://did:plc:user/app.bsky.graph.follow/2',
            },
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'parent text',
            createdAt: '2026-05-08T00:00:00.000Z',
          },
        },
      },
    });

    expect(postProcessFollowingFeed([item], 'did:plc:user')).toEqual([item]);
  });

  test('continues past empty processed Following pages', async () => {
    const parent = {
      uri: parentUri,
      cid: 'parent-cid',
      author: {
        did: 'did:plc:parent',
        handle: 'parent.test',
        displayName: 'Parent',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'parent text',
        createdAt: '2026-05-08T00:00:00.000Z',
      },
    };
    const hiddenReply = feedReply({
      post: {
        author: {
          did: 'did:plc:child',
          handle: 'child.test',
          displayName: 'Child',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/1' },
        },
      },
      reply: {
        parent,
        root: parent,
      },
    });
    const visibleUri = 'at://did:plc:visible/app.bsky.feed.post/visible';
    const visiblePost = {
      post: {
        uri: visibleUri,
        cid: 'visible-cid',
        author: {
          did: 'did:plc:visible',
          handle: 'visible.test',
          displayName: 'Visible',
          viewer: { following: 'at://did:plc:user/app.bsky.graph.follow/2' },
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'visible text',
          createdAt: '2026-05-08T00:01:00.000Z',
        },
        indexedAt: '2026-05-08T00:01:00.000Z',
        replyCount: 0,
        repostCount: 0,
        likeCount: 0,
        quoteCount: 0,
      },
    };
    const cursors = [];
    const agent = {
      getTimeline: async ({ cursor }) => {
        cursors.push(cursor);
        return cursor
          ? { data: { cursor: undefined, feed: [visiblePost] } }
          : { data: { cursor: 'page-2', feed: [hiddenReply] } };
      },
    };

    const page = await fetchFollowingFeedPage({
      agent,
      currentUserDid: 'did:plc:user',
      limit: 20,
    });

    expect(cursors).toEqual([undefined, 'page-2']);
    expect(page.cursor).toBeUndefined();
    expect(page.items.map((status) => status.uri)).toEqual([visibleUri]);
  });

  test('dedupes Following threads without hiding reposted replies', () => {
    const root = {
      post: {
        ...feedReply().reply.parent,
        uri: parentUri,
      },
    };
    const reply = feedReply();
    const repostedReply = feedReply({
      post: { uri: `${childUri}-repost` },
      reply: {
        parent: {
          ...feedReply().reply.parent,
          author: {
            ...feedReply().reply.parent.author,
            viewer: {
              following: 'at://did:plc:user/app.bsky.graph.follow/2',
            },
          },
        },
      },
    });
    repostedReply.reason = {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: {
        did: 'did:plc:reposter',
        handle: 'reposter.test',
        displayName: 'Reposter',
      },
      indexedAt: '2026-05-08T00:03:00.000Z',
    };

    expect(
      postProcessFollowingFeed([root, reply, repostedReply], 'did:plc:user'),
    ).toEqual([root, repostedReply]);
  });

  test('groups reposted replies by canonical post while keeping boost metadata', () => {
    const root = {
      post: {
        ...feedReply().reply.parent,
        uri: parentUri,
      },
    };
    const reply = feedReply();
    const repostedReply = feedReply();
    repostedReply.reason = {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: {
        did: 'did:plc:reposter',
        handle: 'reposter.test',
        displayName: 'Reposter',
      },
      indexedAt: '2026-05-08T00:03:00.000Z',
    };

    const processed = postProcessFollowingFeed(
      [root, reply, repostedReply],
      'did:plc:user',
    );
    const grouped = groupContextItems(feedToStatuses(processed));

    expect(processed).toEqual([root, repostedReply]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      type: 'conversation',
      incompleteThread: false,
    });
    expect(grouped[0].items).toHaveLength(2);
    expect(grouped[0].items[1].reblog).toBeTruthy();
    expect(grouped[0].items[1].account).toMatchObject({
      id: 'did:plc:reposter',
    });
  });

  test('prefers repost wrapper when canonical reply also reaches context grouping', () => {
    const root = {
      post: {
        ...feedReply().reply.parent,
        uri: parentUri,
      },
    };
    const reply = feedReply();
    const repostedReply = feedReply();
    repostedReply.reason = {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: {
        did: 'did:plc:reposter',
        handle: 'reposter.test',
        displayName: 'Reposter',
      },
      indexedAt: '2026-05-08T00:03:00.000Z',
    };

    const grouped = groupContextItems(
      feedToStatuses([root, reply, repostedReply]),
    );

    expect(grouped).toHaveLength(1);
    expect(
      Array.from(grouped[0].items, (status) => String(status.uri)),
    ).toEqual([parentUri, childUri]);
    expect(grouped[0].items[1].id).toContain('-repost-');
    expect(grouped[0].items[1].reblog).toBeTruthy();
    expect(grouped[0].items[1]._atproto?.root?.uri).toBe(parentUri);
  });

  test('matches reposted ancestors to canonical child reply ids', () => {
    const repostedParent = {
      id: 'parent-repost',
      createdAt: '2026-05-08T00:01:00.000Z',
      inReplyToId: null,
      account: { id: 'did:plc:reposter' },
      reblog: {
        id: 'parent',
        createdAt: '2026-05-08T00:00:00.000Z',
        inReplyToId: null,
        account: { id: 'did:plc:parent' },
      },
    };
    const child = {
      id: 'child',
      createdAt: '2026-05-08T00:02:00.000Z',
      inReplyToId: 'parent',
      account: { id: 'did:plc:child' },
    };

    const grouped = groupContextItems([repostedParent, child]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].items).toEqual([repostedParent, child]);
  });

  test('keeps repost wrapper when canonical post arrives later with context annotations', () => {
    const root = {
      id: 'parent',
      createdAt: '2026-05-08T00:00:00.000Z',
      inReplyToId: null,
      account: { id: 'did:plc:parent' },
    };
    const repostedChild = {
      id: 'child-repost',
      createdAt: '2026-05-08T00:03:00.000Z',
      inReplyToId: 'parent',
      account: { id: 'did:plc:reposter' },
      reblog: {
        id: 'child',
        createdAt: '2026-05-08T00:02:00.000Z',
        inReplyToId: 'parent',
        account: { id: 'did:plc:child' },
      },
    };
    const canonicalChild = {
      id: 'child',
      createdAt: '2026-05-08T00:02:00.000Z',
      inReplyToId: 'parent',
      account: { id: 'did:plc:child' },
      _atproto: {
        root: { uri: parentUri },
      },
    };

    const grouped = groupContextItems([root, repostedChild, canonicalChild]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].items).toHaveLength(2);
    expect(grouped[0].items[1].id).toBe('child-repost');
    expect(grouped[0].items[1].reblog).toBeTruthy();
    expect(grouped[0].items[1]._atproto?.root?.uri).toBe(parentUri);
  });

  test('classifies reposted same-author reply chains by original author', () => {
    const root = {
      id: 'parent',
      createdAt: '2026-05-08T00:00:00.000Z',
      inReplyToId: null,
      account: { id: 'did:plc:author' },
    };
    const repostedChild = {
      id: 'child-repost',
      createdAt: '2026-05-08T00:03:00.000Z',
      inReplyToId: 'parent',
      account: { id: 'did:plc:reposter' },
      reblog: {
        id: 'child',
        createdAt: '2026-05-08T00:02:00.000Z',
        inReplyToId: 'parent',
        account: { id: 'did:plc:author' },
      },
    };

    const grouped = groupContextItems([root, repostedChild]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ type: 'thread' });
    expect(grouped[0].items[1]._differentAuthor).toBeFalsy();
  });

  test('dedupes thread contexts loaded across timeline pages', () => {
    const middleUri = 'at://did:plc:parent/app.bsky.feed.post/middle-reply';
    const latestUri = 'at://did:plc:parent/app.bsky.feed.post/latest-reply';
    const rootPost = {
      ...feedReply().reply.parent,
      uri: parentUri,
      author: {
        did: 'did:plc:parent',
        handle: 'parent.test',
        displayName: 'Parent',
      },
      record: {
        $type: 'app.bsky.feed.post',
        text: 'root text',
        createdAt: '2026-05-08T00:00:00.000Z',
      },
    };
    const middlePost = {
      uri: middleUri,
      cid: 'middle-cid',
      author: rootPost.author,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'middle reply',
        createdAt: '2026-05-08T00:01:00.000Z',
        reply: {
          root: { uri: parentUri, cid: 'parent-cid' },
          parent: { uri: parentUri, cid: 'parent-cid' },
        },
      },
      indexedAt: '2026-05-08T00:01:00.000Z',
    };
    const latestPost = {
      uri: latestUri,
      cid: 'latest-cid',
      author: rootPost.author,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'latest reply',
        createdAt: '2026-05-08T00:02:00.000Z',
        reply: {
          root: { uri: parentUri, cid: 'parent-cid' },
          parent: { uri: middleUri, cid: 'middle-cid' },
        },
      },
      indexedAt: '2026-05-08T00:02:00.000Z',
    };
    const latestPage = groupContextItems(
      feedToStatuses([
        {
          post: latestPost,
          reply: {
            root: rootPost,
            parent: middlePost,
          },
        },
      ]),
    );
    const middlePage = groupContextItems(
      feedToStatuses([
        {
          post: middlePost,
          reply: {
            root: rootPost,
            parent: rootPost,
          },
        },
      ]),
    );
    const rootPage = feedToStatuses([{ post: rootPost }]);

    const deduped = dedupeTimelineContextItems([
      ...latestPage,
      ...middlePage,
      ...rootPage,
    ]);

    expect(
      Array.from(deduped, (item) =>
        Array.isArray(item.items)
          ? item.items.map((inner) => inner.uri)
          : item.uri,
      ),
    ).toEqual([[parentUri, middleUri, latestUri]]);
  });

  test('promotes same-author replies even when their parent is nested', () => {
    /** @type {ThreadStatus} */
    const hero = {
      id: 'root',
      account: { id: 'did:plc:alice' },
    };
    /** @type {ThreadStatus} */
    const directReply = {
      id: 'direct-reply',
      inReplyToId: 'root',
      inReplyToAccountId: 'did:plc:alice',
      account: { id: 'did:plc:bob' },
    };
    /** @type {ThreadStatus} */
    const nestedAliceReply = {
      id: 'nested-alice-reply',
      inReplyToId: 'direct-reply',
      inReplyToAccountId: 'did:plc:bob',
      account: { id: 'did:plc:alice' },
    };
    /** @type {ThreadStatus} */
    const sameAuthorChild = {
      id: 'same-author-child',
      inReplyToId: 'nested-alice-reply',
      inReplyToAccountId: 'did:plc:alice',
      account: { id: 'did:plc:alice' },
    };
    /** @type {ThreadStatus[]} */
    const descendants = [directReply, nestedAliceReply, sameAuthorChild];
    /** @type {ThreadStatus[]} */
    const topLevel = [];

    for (const descendant of descendants) {
      appendThreadDescendant(descendant, hero, descendants, topLevel);
    }

    expect(topLevel.map((status) => status.id)).toEqual([
      'direct-reply',
      'same-author-child',
    ]);
    expect(directReply.__replies?.map((status) => status.id)).toEqual([
      'nested-alice-reply',
    ]);
    expect(nestedAliceReply.__replies).toBeUndefined();

    clearThreadDescendantReplies(descendants);
    /** @type {ThreadStatus[]} */
    const rebuiltTopLevel = [];
    for (const descendant of descendants) {
      appendThreadDescendant(descendant, hero, descendants, rebuiltTopLevel);
    }

    expect(rebuiltTopLevel.map((status) => status.id)).toEqual([
      'direct-reply',
      'same-author-child',
    ]);
    expect(directReply.__replies?.map((status) => status.id)).toEqual([
      'nested-alice-reply',
    ]);
    expect(nestedAliceReply.__replies).toBeUndefined();
  });
});
