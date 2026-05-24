import { expect, test as base, type Browser, type Page } from '@playwright/test';

import {
  HAS_CREDS,
  IDENTIFIER,
  expectFeedItems,
  loginViaBrowserOAuth,
  waitForXrpc,
} from './helpers/auth';

let sharedPage: Page | undefined;

const test = base.extend({
  page: async ({ browser }, fixtureCallback) => {
    if (!sharedPage) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const timelineReady = waitForXrpc(page, 'app.bsky.feed.getTimeline');
      await loginViaBrowserOAuth(page);
      await timelineReady;
      sharedPage = page;
    }
    await fixtureCallback(sharedPage);
  },
});

test.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function expectFreshOauthRoute(
  browser: Browser,
  path: string,
  endpoint: string,
  selector: string,
  options: { protectedRoute?: boolean } = {},
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    let ready: Promise<void>;
    if (options.protectedRoute) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(?:[?#].*)?$/, { timeout: 60_000 });
      ready = waitForXrpc(page, endpoint, 120_000);
      await loginViaBrowserOAuth(page, { preserveCurrentPage: true });
    } else {
      await loginViaBrowserOAuth(page);
      ready = waitForXrpc(page, endpoint, 120_000);
      await page.goto(path);
    }
    await ready;
    await expect(page.locator(selector)).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }
}

async function selectMaxCatchupRange(page: Page) {
  await page.getByLabel('Catch-up range').focus();
  await page.keyboard.press('End');
  await expect(page.getByText('until the max')).toBeVisible();
}

test.describe('M7 migrated feeds', () => {
  test.afterAll(async () => {
    await sharedPage?.context().close();
    sharedPage = undefined;
  });

  test('home timeline loads via getTimeline', async ({ page }) => {
    test.setTimeout(120_000);
    await expect(page.locator('[data-timeline-id="home"]')).toBeVisible();
    await expectFeedItems(page);
  });

  test('following feed loads via getTimeline', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/following');
    await expect(page.locator('[data-timeline-id="following"]')).toBeVisible();
    await expectFeedItems(page);
  });

  test('notifications feed loads', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.notification.listNotifications');
    await page.goto('/notifications');
    await ready;
    await expect(
      page.locator('[data-timeline-id="notifications"]'),
    ).toBeVisible();
  });

  test('mentions feed loads filtered notifications', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.notification.listNotifications');
    await page.goto('/mentions');
    await ready;
    await expect(page.locator('[data-timeline-id="mentions"]')).toBeVisible();
  });

  test('bookmarks feed loads', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.bookmark.getBookmarks');
    await page.goto('/b');
    await ready;
    await expect(page.locator('[data-timeline-id="bookmarks"]')).toBeVisible();
  });

  test('favourites feed loads via getActorLikes', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.feed.getActorLikes');
    await page.goto('/f');
    await ready;
    await expect(page.locator('[data-timeline-id="favourites"]')).toBeVisible();
  });

  test('profile posts feed loads via getAuthorFeed', async ({ page }) => {
    test.setTimeout(120_000);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/xrpc/app.bsky.feed.getAuthorFeed') &&
        response.status() < 400,
    );
    await page.goto(`/a/${IDENTIFIER}`);
    const response = await responsePromise;
    await expect(
      page.locator('[data-timeline-id="account-statuses"]'),
    ).toBeVisible({ timeout: 60_000 });
    const body = (await response.json()) as { feed?: unknown[] };
    if ((body.feed?.length ?? 0) > 0) {
      await expectFeedItems(page);
    } else {
      await expect(
        page.locator('.timeline-empty, .timeline-page').first(),
      ).toBeVisible();
    }
  });

  test('profile header and follow graph reads use ATProto endpoints', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const profileReady = waitForXrpc(page, 'app.bsky.actor.getProfile');
    await page.goto(`/a/${IDENTIFIER}`);
    await profileReady;
    await expect(page.locator('.account-container')).toBeVisible({
      timeout: 60_000,
    });

    await expect(
      page.locator('.account-container .stats').getByText(/Followers?/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await Promise.all([
      waitForXrpc(page, 'app.bsky.graph.getFollowers'),
      page
        .locator('.account-container .stats')
        .getByText(/Followers?/)
        .first()
        .evaluate((element: HTMLElement) => {
          element.click();
        }),
    ]);
    await expect(page.locator('#generic-accounts-container')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page
        .locator(
          '#generic-accounts-container .accounts-list > li, #generic-accounts-container .ui-state.insignificant',
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    await page.locator('#generic-accounts-container .sheet-close').click();
    await expect(page.locator('#generic-accounts-container')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
    await expect(
      page.locator('.account-container .stats').getByText(/Following/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await Promise.all([
      waitForXrpc(page, 'app.bsky.graph.getFollows'),
      page
        .locator('.account-container .stats')
        .getByText(/Following/)
        .first()
        .evaluate((element: HTMLElement) => {
          element.click();
        }),
    ]);
    await expect(page.locator('#generic-accounts-container')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.locator('#generic-accounts-container .accounts-list > li').first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('hashtag feed loads via searchPosts', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.feed.searchPosts');
    await page.goto('/t/atproto');
    await ready;
    await expect(page.locator('[data-timeline-id="hashtag"]')).toBeVisible();
  });

  test('trending discover feed loads via getFeed', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.feed.getFeed');
    await page.goto('/trending');
    await ready;
    await expect(page.locator('[data-timeline-id="trending"]')).toBeVisible();
    await expectFeedItems(page);
  });

  test('search posts loads via searchPosts', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.feed.searchPosts');
    await page.goto('/search?q=bluesky&type=statuses');
    await ready;
    await expect(page.locator('[data-timeline-id="search-posts"]')).toBeVisible();
  });

  test('search accounts loads via searchActors', async ({ page }) => {
    test.setTimeout(120_000);
    const ready = waitForXrpc(page, 'app.bsky.actor.searchActors');
    await page.goto('/search?q=alice&type=accounts');
    await ready;
    await expect(page.locator('.accounts-list').first()).toBeVisible();
  });

  test('lists index renders', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/l');
    await expect(page.locator('.timeline-page, .lists-page, main').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('post detail opens from Discover and loads thread', async ({ page }) => {
    test.setTimeout(120_000);
    const feedReady = waitForXrpc(page, 'app.bsky.feed.getFeed');
    await page.goto('/trending');
    await feedReady;
    await expectFeedItems(page);
    const item = page
      .locator('.status-link[data-href]')
      .filter({ has: page.locator('.status:not(.filtered)') })
      .first();
    const link = item.locator('> .status-link-native');
    await expect(link).toBeVisible();
    const ready = waitForXrpc(page, 'app.bsky.feed.getPostThread');
    await link.focus();
    await page.keyboard.press('Enter');
    await ready;
    await expect(page.locator('.status-deck .timeline.flat.contextual.grow')).toBeVisible();
    await expect(page.locator('.status-deck li.hero .status').first()).toBeVisible();
  });

  test('catch-up scans the OAuth timeline and renders rows', async ({ page }) => {
    test.setTimeout(180_000);
    const ready = waitForXrpc(page, 'app.bsky.feed.getTimeline', 120_000);
    await page.goto('/catchup');
    await selectMaxCatchupRange(page);
    await page.getByRole('button', { name: 'Catch up' }).click();
    await ready;
    await expect(page.locator('.catchup-list .post-line').first()).toBeVisible({
      timeout: 120_000,
    });
  });

  test('uses browser OAuth in fresh contexts and opens migrated deep links', async ({
    browser,
  }) => {
    test.setTimeout(360_000);
    await expectFreshOauthRoute(
      browser,
      '/notifications',
      'app.bsky.notification.listNotifications',
      '[data-timeline-id="notifications"]',
      { protectedRoute: true },
    );
    await expectFreshOauthRoute(
      browser,
      `/a/${IDENTIFIER}`,
      'app.bsky.actor.getProfile',
      '.account-container',
    );
    await expectFreshOauthRoute(
      browser,
      '/trending',
      'app.bsky.feed.getFeed',
      '[data-timeline-id="trending"]',
    );

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginViaBrowserOAuth(page);
      await page.goto('/trending');
      await waitForXrpc(page, 'app.bsky.feed.getFeed', 120_000);
      const href = await page
        .locator('.status-link[data-href]')
        .first()
        .getAttribute('data-href');
      expect(href).toBeTruthy();
      const threadReady = waitForXrpc(page, 'app.bsky.feed.getPostThread', 120_000);
      await page.goto(href!);
      await threadReady;
      await expect(page.locator('.status-deck li.hero .status').first()).toBeVisible({
        timeout: 60_000,
      });

      const timelineReady = waitForXrpc(page, 'app.bsky.feed.getTimeline', 120_000);
      await page.goto('/catchup');
      await selectMaxCatchupRange(page);
      await page.getByRole('button', { name: 'Catch up' }).click();
      await timelineReady;
      await expect(page.locator('.catchup-list .post-line').first()).toBeVisible({
        timeout: 120_000,
      });
    } finally {
      await context.close();
    }
  });
});
