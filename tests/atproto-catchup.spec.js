// @ts-check
/// <reference types="node" />

import { expect, test as base } from '@playwright/test';

const IDENTIFIER = process.env.ATPROTO_TEST_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_TEST_PASSWORD;
const HAS_CREDS = Boolean(IDENTIFIER && PASSWORD);

base.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');

/**
 * @param {import('@playwright/test').Page} page
 */
async function loginViaUI(page) {
  await page.goto('/login');
  if (
    await page
      .locator('.deck-container')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    return;
  }
  await page.getByLabel('Handle or PDS URL').fill(IDENTIFIER);
  await page.getByText('Use app password').click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page
    .getByRole('button', { name: 'Continue with app password' })
    .click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
  await expect(page.locator('.deck-container').first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * @param {number} index
 */
function fakePost(index, overrides = {}) {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
  const score = index + 1;
  return {
    id: `catchup-sort-post-${index}`,
    uri: `at://did:plc:test/app.bsky.feed.post/${index}`,
    url: `https://bsky.app/profile/example.test/post/${index}`,
    account: {
      id: `did:plc:author-${index % 4}`,
      username: `author${index % 4}.test`,
      acct: `author${index % 4}.test`,
      displayName: `Author ${index % 4}`,
      avatar: '',
      avatarStatic: '',
      bot: false,
      emojis: [],
    },
    createdAt,
    content: `rank target ${score}`,
    spoilerText: '',
    sensitive: false,
    emojis: [],
    mediaAttachments: [],
    mentions: [],
    tags: [],
    card: null,
    poll: null,
    visibility: 'public',
    reblogsCount: score,
    favouritesCount: score,
    repliesCount: 0,
    quotesCount: 0,
    inReplyToId: null,
    inReplyToAccountId: null,
    ...overrides,
  };
}

base(
  'catch-up sort renders ranked rows without placeholder gaps',
  async ({ page }) => {
    await loginViaUI(page);

    const id = `catchup-sort-${Date.now()}`;
    const posts = Array.from({ length: 80 }, (_, index) => fakePost(index));
    await page.goto('/');
    await page.evaluate(
      async ({ id: catchupId, posts: catchupPosts }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('catchup-db');
          request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('catchup-store');
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to open catch-up DB'));
          });
          request.addEventListener('success', () => {
            const tx = request.result.transaction('catchup-store', 'readwrite');
            tx.objectStore('catchup-store').put(
              {
                id: catchupId,
                posts: catchupPosts,
                count: catchupPosts.length,
                startAt: Date.parse(catchupPosts[0].createdAt),
                endAt: Date.parse(
                  catchupPosts[catchupPosts.length - 1].createdAt,
                ),
              },
              catchupId,
            );
            tx.addEventListener('complete', () => {
              request.result.close();
              resolve(undefined);
            });
            tx.addEventListener('error', () => {
              request.result.close();
              reject(tx.error ?? new Error('Failed to seed catch-up DB'));
            });
          });
        });
      },
      { id, posts },
    );

    await page.goto(`/catchup?id=${id}`);
    await expect(page.locator('.catchup-list')).toBeVisible();
    await page.locator('label.filter-sort', { hasText: 'Likes' }).click();

    const firstRows = page
      .locator('.catchup-list > li:not(.separator)')
      .first();
    await expect(firstRows.locator('.post-line')).toBeVisible();
    await expect(firstRows).toContainText('rank target 80');
    await expect(
      page.locator('.catchup-list > li:not(.separator)').nth(1),
    ).toContainText('rank target 79');
    await expect(
      page.locator('.catchup-list > li:not(.separator)').nth(2),
    ).toContainText('rank target 78');
  },
);

base(
  'catch-up sort rerenders duplicate post ids after changing sort',
  async ({ page }) => {
    await loginViaUI(page);

    const id = `catchup-duplicate-sort-${Date.now()}`;
    const duplicateCreatedAt = new Date(
      Date.UTC(2026, 0, 1, 0, 0),
    ).toISOString();
    const duplicateAccount = { ...fakePost(0).account };
    const posts = [
      fakePost(0, {
        id: 'duplicate-post-id',
        account: duplicateAccount,
        createdAt: duplicateCreatedAt,
        content: 'duplicate low rank one',
        favouritesCount: 1,
        reblogsCount: 0,
      }),
      fakePost(1, {
        id: 'duplicate-post-id',
        account: duplicateAccount,
        createdAt: duplicateCreatedAt,
        content: 'duplicate low rank two',
        favouritesCount: 2,
        reblogsCount: 0,
      }),
      fakePost(2, {
        id: 'highest-ranked-post',
        content: 'duplicate key top rank',
        favouritesCount: 100,
        reblogsCount: 50,
      }),
    ];
    await page.goto('/');
    await page.evaluate(
      async ({ id: catchupId, posts: catchupPosts }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('catchup-db');
          request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('catchup-store');
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to open catch-up DB'));
          });
          request.addEventListener('success', () => {
            const tx = request.result.transaction('catchup-store', 'readwrite');
            tx.objectStore('catchup-store').put(
              {
                id: catchupId,
                posts: catchupPosts,
                count: catchupPosts.length,
                startAt: Date.parse(catchupPosts[0].createdAt),
                endAt: Date.parse(
                  catchupPosts[catchupPosts.length - 1].createdAt,
                ),
              },
              catchupId,
            );
            tx.addEventListener('complete', () => {
              request.result.close();
              resolve(undefined);
            });
            tx.addEventListener('error', () => {
              request.result.close();
              reject(tx.error ?? new Error('Failed to seed catch-up DB'));
            });
          });
        });
      },
      { id, posts },
    );

    await page.goto(`/catchup?id=${id}`);
    await expect(page.locator('.catchup-list')).toBeVisible();
    await expect(
      page.locator('.catchup-list > li:not(.separator)').first(),
    ).toContainText('duplicate low rank one');
    await expect(page.getByText('duplicate low rank two')).toHaveCount(0);

    await page.locator('label.filter-sort', { hasText: 'Likes' }).click();

    await expect(
      page.locator('.catchup-list > li:not(.separator)').first(),
    ).toContainText('duplicate key top rank');
  },
);

base(
  'catch-up shows booster attribution when an original absorbs its boost duplicate',
  async ({ page }) => {
    await loginViaUI(page);

    const id = `catchup-original-boost-${Date.now()}`;
    const originalAccount = {
      ...fakePost(0).account,
      id: 'did:plc:original-author',
      username: 'original.test',
      acct: 'original.test',
      displayName: 'Original Author',
    };
    const boosterAccount = {
      ...fakePost(1).account,
      id: 'did:plc:booster-author',
      username: 'booster.test',
      acct: 'booster.test',
      displayName: 'Booster Author',
    };
    const original = fakePost(0, {
      id: 'original-absorbs-boost',
      account: originalAccount,
      content: 'original absorbs boost duplicate',
      reblogsCount: 1,
    });
    const posts = [
      original,
      fakePost(1, {
        id: 'boost-wrapper-duplicate',
        account: boosterAccount,
        content: 'hidden boost wrapper duplicate',
        reblog: original,
      }),
    ];
    await page.goto('/');
    await page.evaluate(
      async ({ id: catchupId, posts: catchupPosts }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('catchup-db');
          request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('catchup-store');
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to open catch-up DB'));
          });
          request.addEventListener('success', () => {
            const tx = request.result.transaction('catchup-store', 'readwrite');
            tx.objectStore('catchup-store').put(
              {
                id: catchupId,
                posts: catchupPosts,
                count: catchupPosts.length,
                startAt: Date.parse(catchupPosts[0].createdAt),
                endAt: Date.parse(
                  catchupPosts[catchupPosts.length - 1].createdAt,
                ),
              },
              catchupId,
            );
            tx.addEventListener('complete', () => {
              request.result.close();
              resolve(undefined);
            });
            tx.addEventListener('error', () => {
              request.result.close();
              reject(tx.error ?? new Error('Failed to seed catch-up DB'));
            });
          });
        });
      },
      { id, posts },
    );

    await page.goto(`/catchup?id=${id}`);
    await expect(page.locator('.catchup-list')).toBeVisible();
    await expect(
      page.locator('.catchup-list > li:not(.separator)'),
    ).toHaveCount(1);
    await expect(page.getByText('hidden boost wrapper duplicate')).toHaveCount(
      0,
    );
    await expect(
      page.getByText('original absorbs boost duplicate'),
    ).toBeVisible();
    await expect(
      page.locator('[title="Booster Author (@booster.test)"]').first(),
    ).toBeVisible();
    // The booster should be attributed exactly once, even if the boost
    // wrapper is observed more than once during dedup.
    await expect(
      page.locator(
        '.catchup-list [title="Booster Author (@booster.test)"]',
      ),
    ).toHaveCount(1);

    await page
      .locator('label.filter-author[data-author="did:plc:booster-author"]')
      .click();

    await expect(
      page.locator('.catchup-list > li:not(.separator)'),
    ).toHaveCount(1);
    await expect(
      page.getByText('original absorbs boost duplicate'),
    ).toBeVisible();
    await expect(
      page.locator('[title="Booster Author (@booster.test)"]').first(),
    ).toBeVisible();
  },
);

base(
  'catch-up shows booster attribution when a quote absorbs its boost duplicate',
  async ({ page }) => {
    await loginViaUI(page);

    const id = `catchup-quote-boost-${Date.now()}`;
    const quoteAccount = {
      ...fakePost(0).account,
      id: 'did:plc:quote-author',
      username: 'quote.test',
      acct: 'quote.test',
      displayName: 'Quote Author',
    };
    const boosterAccount = {
      ...fakePost(1).account,
      id: 'did:plc:quote-booster',
      username: 'quote-booster.test',
      acct: 'quote-booster.test',
      displayName: 'Quote Booster',
    };
    const quotedPost = fakePost(2, {
      id: 'quoted-target-post',
      account: {
        ...fakePost(2).account,
        id: 'did:plc:quoted-author',
        username: 'quoted.test',
        acct: 'quoted.test',
        displayName: 'Quoted Author',
        url: 'https://bsky.app/profile/quoted.test',
      },
      content: 'quoted target content',
    });
    const quotePost = fakePost(0, {
      id: 'quote-absorbs-boost',
      account: quoteAccount,
      content: 'quote absorbs boost duplicate',
      quote: {
        quotedStatus: quotedPost,
      },
      reblogsCount: 1,
    });
    const posts = [
      quotePost,
      fakePost(1, {
        id: 'quote-boost-wrapper-duplicate',
        account: boosterAccount,
        content: 'hidden quote boost wrapper duplicate',
        reblog: quotePost,
      }),
    ];
    await page.goto('/');
    await page.evaluate(
      async ({ id: catchupId, posts: catchupPosts }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('catchup-db');
          request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('catchup-store');
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to open catch-up DB'));
          });
          request.addEventListener('success', () => {
            const tx = request.result.transaction('catchup-store', 'readwrite');
            tx.objectStore('catchup-store').put(
              {
                id: catchupId,
                posts: catchupPosts,
                count: catchupPosts.length,
                startAt: Date.parse(catchupPosts[0].createdAt),
                endAt: Date.parse(
                  catchupPosts[catchupPosts.length - 1].createdAt,
                ),
              },
              catchupId,
            );
            tx.addEventListener('complete', () => {
              request.result.close();
              resolve(undefined);
            });
            tx.addEventListener('error', () => {
              request.result.close();
              reject(tx.error ?? new Error('Failed to seed catch-up DB'));
            });
          });
        });
      },
      { id, posts },
    );

    await page.goto(`/catchup?id=${id}`);
    await expect(page.locator('.catchup-list')).toBeVisible();
    await expect(
      page.locator('.catchup-list > li:not(.separator)'),
    ).toHaveCount(1);
    await expect(
      page.getByText('hidden quote boost wrapper duplicate'),
    ).toHaveCount(0);
    await expect(page.getByText('quote absorbs boost duplicate')).toBeVisible();
    await expect(
      page.locator('[title="Quote Booster (@quote-booster.test)"]').first(),
    ).toBeVisible();
    // The booster should be attributed exactly once, even if the boost
    // wrapper is observed more than once during dedup.
    await expect(
      page.locator(
        '.catchup-list [title="Quote Booster (@quote-booster.test)"]',
      ),
    ).toHaveCount(1);
  },
);

base(
  'catch-up date sort compares timezone-offset timestamps by instant',
  async ({ page }) => {
    await loginViaUI(page);

    const id = `catchup-date-offset-${Date.now()}`;
    const posts = [
      fakePost(0, {
        id: 'timezone-offset-newer-post',
        content: 'timezone offset newer post',
        createdAt: '2026-05-18T20:46:14-04:00',
      }),
      fakePost(1, {
        id: 'utc-older-post',
        content: 'utc older post',
        createdAt: '2026-05-18T21:30:00.000Z',
      }),
      fakePost(2, {
        id: 'utc-newest-post',
        content: 'utc newest post',
        createdAt: '2026-05-19T01:00:00.000Z',
      }),
    ];
    await page.goto('/');
    await page.evaluate(
      async ({ id: catchupId, posts: catchupPosts }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('catchup-db');
          request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('catchup-store');
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to open catch-up DB'));
          });
          request.addEventListener('success', () => {
            const tx = request.result.transaction('catchup-store', 'readwrite');
            tx.objectStore('catchup-store').put(
              {
                id: catchupId,
                posts: catchupPosts,
                count: catchupPosts.length,
                startAt: Date.parse(catchupPosts[0].createdAt),
                endAt: Date.parse(
                  catchupPosts[catchupPosts.length - 1].createdAt,
                ),
              },
              catchupId,
            );
            tx.addEventListener('complete', () => {
              request.result.close();
              resolve(undefined);
            });
            tx.addEventListener('error', () => {
              request.result.close();
              reject(tx.error ?? new Error('Failed to seed catch-up DB'));
            });
          });
        });
      },
      { id, posts },
    );

    await page.goto(`/catchup?id=${id}`);
    await expect(page.locator('.catchup-list')).toBeVisible();

    await expect(
      page.locator('.catchup-list > li:not(.separator)').first(),
    ).toContainText('utc older post');
  },
);
