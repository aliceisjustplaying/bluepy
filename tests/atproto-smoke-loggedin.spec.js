// @ts-check
/// <reference types="node" />
/**
 * Logged-in smoke test suite for Bluepy / ATProto.
 *
 * Exercises the major read + write flows end-to-end against a real
 * ATProto test account so it catches behavioral regressions that
 * unit tests + lint + typecheck miss.
 *
 * Run:
 *   set -a; source ~/.secrets/phanpy-atproto-test.env; set +a
 *   PORT=5174 bunx playwright test tests/atproto-smoke-loggedin.spec.js
 *
 * Required env vars:
 *   ATPROTO_TEST_IDENTIFIER — Bluesky handle (e.g., alice.bsky.social)
 *   ATPROTO_TEST_PASSWORD   — app password for that handle
 *
 * If either is missing the whole spec is skipped, so CI without
 * credentials remains green.
 *
 * Strategy:
 *   - One shared logged-in storage state, captured once in beforeAll
 *     and restored per test. Avoids ~25 logins.
 *   - Per-test page is fresh, so DOM state never leaks.
 *   - Every write tags content with RUN_TAG. Cleanup revisits the
 *     profile and deletes matching posts through stable status controls.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test as base } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */
/** @typedef {Record<string, unknown> & { showCompose?: unknown }} TestStates */
/** @typedef {Window & { __STATES__?: TestStates }} TestWindow */
/**
 * @typedef {{
 *   record?: {
 *     text?: string,
 *     facets?: unknown[],
 *     reply?: {
 *       parent?: { uri?: string, cid?: string },
 *       root?: { uri?: string },
 *     },
 *   },
 * }} CreateRecordPayload
 */

const IDENTIFIER = process.env.ATPROTO_TEST_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_TEST_PASSWORD;
const HAS_CREDS = Boolean(IDENTIFIER && PASSWORD);

base.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');
base.describe.configure({ mode: 'serial' });

const SMOKE_TAG_PREFIX = '[bluepy-smoke-';
const RUN_TAG = `${SMOKE_TAG_PREFIX}${Date.now()}]`;
const STORAGE_FILE = path.join(
  os.tmpdir(),
  `bluepy-smoke-storage-${process.pid}.json`,
);

/**
 * Walk the bluepy login UI end-to-end via app-password and assert
 * we land off the login page.
 *
 * @param {Page} page
 */
async function loginViaUI(page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
      await page.getByPlaceholder('alice.bsky.social').fill(IDENTIFIER);
      await page.getByText('Use app password').click();
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page
        .getByRole('button', { name: 'Continue with app password' })
        .click();
      await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
      await page.locator('.deck-container').first().waitFor({
        timeout: 30_000,
      });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Per-spec setup: log in once, persist storage state, reuse across tests.
 */
base.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  if (!HAS_CREDS) return;
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await loginViaUI(page);
    await ctx.storageState({ path: STORAGE_FILE });
  } finally {
    await ctx.close();
  }
});

/**
 * Test fixture: each test gets a fresh context with storageState restored.
 */
const test = base.extend({
  context: async ({ browser }, fixtureUse) => {
    const ctx = await browser.newContext({ storageState: STORAGE_FILE });
    await fixtureUse(ctx);
    await ctx.close();
  },
});

/** @param {Page} page @param {string} route */
const goto = (page, route) => page.goto(route);

/**
 * @param {Page} page
 * @param {(response: import('@playwright/test').Response) => boolean} matcher
 */
const waitForOkXrpc = (page, matcher) =>
  page.waitForResponse(
    (response) =>
      response.url().includes('/xrpc/') &&
      response.status() < 400 &&
      matcher(response),
    { timeout: 30_000 },
  );

/**
 * @param {Page} page
 * @param {string} collection
 */
const waitForCreateRecord = (page, collection) =>
  waitForOkXrpc(
    page,
    (response) =>
      response.url().includes('/xrpc/com.atproto.repo.createRecord') &&
      (response.request().postData() || '').includes(collection),
  );

/**
 * @param {Page} page
 * @param {string} collection
 */
const waitForDeleteRecord = (page, collection) =>
  waitForOkXrpc(
    page,
    (response) =>
      response.url().includes('/xrpc/com.atproto.repo.deleteRecord') &&
      (response.request().postData() || '').includes(collection),
  );

/** @param {Page} page */
const waitForCreateBookmark = (page) =>
  waitForOkXrpc(page, (response) =>
    response.url().includes('/xrpc/app.bsky.bookmark.createBookmark'),
  );

/** @param {Page} page */
const waitForDeleteBookmark = (page) =>
  waitForOkXrpc(page, (response) =>
    response.url().includes('/xrpc/app.bsky.bookmark.deleteBookmark'),
  );

/**
 * @param {Locator} locator
 * @param {string} label
 */
async function getRequiredTitle(locator, label) {
  const title = await locator.getAttribute('title');
  expect(title, `${label} must expose a title`).toBeTruthy();
  if (!title) throw new Error(`${label} missing title`);
  return title;
}

/** @param {Page} page */
async function openFirstStatusDetail(page) {
  await page.goto('/');
  const article = page.locator('[data-state-post-id]').first();
  await article.waitFor({ timeout: 30_000 });
  await openStatusDetailFromArticle(page, article);
}

/**
 * @param {Page} page
 * @param {Locator} article
 */
async function openStatusDetailFromArticle(page, article) {
  const href = await article.evaluate((element) => {
    const link =
      element.closest('.status-link[data-href]') ||
      element.querySelector('.status-link[data-href]');
    return link?.getAttribute('data-href');
  });
  if (!href) throw new Error('created status is missing a detail link');
  await page.goto(href.startsWith('#') ? `/${href}` : href);
  await expect(page).toHaveURL(/\/(?:s\/|at:\/\/|at%3A)/i, { timeout: 15_000 });
}

/**
 * @param {Page} page
 * @param {string} titleSelector
 */
function statusDetailButton(page, titleSelector) {
  return page
    .locator(`.status-deck :is(${titleSelector}), .status.large :is(${titleSelector})`)
    .first();
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------

test('login: app-password flow lands on the home deck', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginViaUI(page);
    await expect(page.locator('.deck-container').first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// READ FLOWS — assert each page renders its known root element.
// ---------------------------------------------------------------------------

test.describe('read flows', () => {
  test('home renders deck', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('#home-page, .deck-container').first(),
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test('home timeline shows at least one status', async ({ page }) => {
    await page.goto('/');
    await expect(
      page
        .locator('[data-state-post-id], article.status, .status-link')
        .first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('clicking a status opens its detail view', async ({ page }) => {
    await openFirstStatusDetail(page);
    await Promise.all(
      [
        'reply-button',
        'reblog-button',
        'favourite-button',
        'bookmark-button',
      ].flatMap((buttonClass) => {
        const button = page
          .locator(`.status.large .actions .action > button.${buttonClass}`)
          .first();
        return [
          expect(button).toHaveClass(/(?:^|\s)plain(?:\s|$)/),
          expect(button).toHaveClass(
            new RegExp(`(?:^|\\s)${buttonClass}(?:\\s|$)`),
          ),
        ];
      }),
    );
  });

  test('notifications page renders', async ({ page }) => {
    await goto(page, '/notifications');
    await expect(page.locator('#notifications-page')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('mentions page renders', async ({ page }) => {
    await goto(page, '/mentions');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('search page renders', async ({ page }) => {
    await goto(page, '/search');
    await expect(page.locator('#search-page')).toBeVisible({ timeout: 15_000 });
  });

  test('lists page renders', async ({ page }) => {
    await goto(page, '/l');
    await expect(page.locator('#lists-page')).toBeVisible({ timeout: 15_000 });
  });

  test('bookmarks page renders', async ({ page }) => {
    await goto(page, '/b');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('favourites page renders', async ({ page }) => {
    await goto(page, '/f');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('catchup page renders', async ({ page }) => {
    await goto(page, '/catchup');
    await expect(page.locator('#catchup-page')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('year-in-posts page renders', async ({ page }) => {
    await goto(page, '/yip');
    await expect(page.locator('#year-in-posts-page')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('own account page renders', async ({ page }) => {
    await goto(page, `/a/${IDENTIFIER}`);
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

// ---------------------------------------------------------------------------
// MODAL FLOWS — driven via valtio's `window.__STATES__` for determinism.
// ---------------------------------------------------------------------------

test.describe('modals', () => {
  /**
   * @param {Page} page
   * @param {string} stateKey
   */
  async function openModal(page, stateKey) {
    await page.goto('/');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.evaluate((k) => {
      const appWindow = /** @type {TestWindow} */ (window);
      if (typeof appWindow.__STATES__ === 'object' && appWindow.__STATES__) {
        appWindow.__STATES__[k] = true;
      }
    }, stateKey);
  }

  test('settings modal opens', async ({ page }) => {
    await openModal(page, 'showSettings');
    await expect(page.locator('text=/Settings/i').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('drafts modal opens', async ({ page }) => {
    await openModal(page, 'showDrafts');
    await expect(page.locator('text=/Drafts/i').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('compose modal opens with textarea', async ({ page }) => {
    await openModal(page, 'showCompose');
    await expect(page.locator('textarea').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#modal-container > div').first()).toHaveClass(
      /(?:^|\s)solid(?:\s|$)/,
    );
  });

  test('compose add-media menu attaches an image on narrow viewports', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModal(page, 'showCompose');
    await page.locator('#compose-container .add-button').click();

    const mediaItem = page.locator('.szh-menu__item.compose-menu-add-media');
    await expect(mediaItem.first()).toBeVisible({ timeout: 5_000 });

    const chooserPromise = page.waitForEvent('filechooser');
    await mediaItem.first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles(path.join(process.cwd(), 'public/logo-192.png'));

    await expect(
      page.locator('#compose-container img[src^="blob:"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('shortcuts modal opens', async ({ page }) => {
    await openModal(page, 'showShortcutsSettings');
    await expect(page.locator('text=/Shortcut/i').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ---------------------------------------------------------------------------
// WRITE FLOWS
// ---------------------------------------------------------------------------

/**
 * Track every post we create so afterAll can delete via the same XRPC
 * client the app uses, surviving DOM-selector drift.
 */
/** @type {Array<{ page: import('@playwright/test').Page, body: string }>} */
const CREATED = [];

test.describe('write flows', () => {
  /**
   * @param {Page} page
   * @param {string} body
   */
  async function composeAndPublish(page, body) {
    await page.goto('/');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.evaluate(() => {
      const appWindow = /** @type {TestWindow} */ (window);
      if (typeof appWindow.__STATES__ === 'object' && appWindow.__STATES__) {
        appWindow.__STATES__.showCompose = true;
      }
    });
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ timeout: 15_000 });
    await textarea.fill(body);
    await page
      .getByRole('button', { name: /^(post|publish)$/i })
      .first()
      .click();
    // Compose modal closes; textarea disappears as success signal.
    await expect(textarea).toHaveCount(0, { timeout: 30_000 });
  }

  /**
   * @param {Page} page
   * @param {string} body
   */
  async function composeAndPublishWithShortcut(page, body) {
    await page.goto('/');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.evaluate(() => {
      const appWindow = /** @type {TestWindow} */ (window);
      if (typeof appWindow.__STATES__ === 'object' && appWindow.__STATES__) {
        appWindow.__STATES__.showCompose = true;
      }
    });
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ timeout: 15_000 });
    await textarea.fill(body);
    await textarea.press('Control+Enter');
    await expect(textarea).toHaveCount(0, { timeout: 30_000 });
  }

  async function openCreatedStatusDetail(page, body) {
    const article = page
      .locator('[data-state-post-id]', { hasText: body })
      .first();
    if ((await article.count()) === 0) {
      await goto(page, `/a/${IDENTIFIER}`);
    }
    await article.waitFor({ timeout: 45_000 });
    await openStatusDetailFromArticle(page, article);
  }

  test('compose + publish + delete a post (asserts deletion)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const body = `${RUN_TAG} compose ${Date.now()}`;
    await composeAndPublish(page, body);

    await page
      .getByText('Post published. Check it out.')
      .click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/at:\/\/[^/]+\/app\.bsky\.feed\.post\//);
    await page.getByTestId('status-more-button').click();
    await page.getByTestId('status-delete-trigger').click();
    await page.getByTestId('status-delete-confirm').click();

    // Hard assertion: the post is gone from the profile after a reload.
    await goto(page, `/a/${IDENTIFIER}`);
    await expect(
      page.locator('[data-state-post-id]', { hasText: body.slice(0, 28) }),
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test('compose keyboard shortcut publishes a post', async ({ page }) => {
    const body = `${RUN_TAG} shortcut ${Date.now()}`;
    await composeAndPublishWithShortcut(page, body);
    CREATED.push({ page, body });
    await expect(
      page.getByText('Post published. Check it out.', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('compose: a published post survives a reload (then leaves for sweep)', async ({
    page,
  }) => {
    const body = `${RUN_TAG} persist ${Date.now()}`;
    await composeAndPublish(page, body);
    CREATED.push({ page, body });
    await goto(page, `/a/${IDENTIFIER}`);
    await expect(
      page.locator('[data-state-post-id]', { hasText: body }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('reply UI opens compose modal from a status detail', async ({
    page,
  }) => {
    const body = `${RUN_TAG} reply-target ${Date.now()}`;
    await composeAndPublish(page, body);
    CREATED.push({ page, body });
    await openCreatedStatusDetail(page, body);

    const replyBtn = statusDetailButton(page, 'button[title="Reply"]');
    await replyBtn.waitFor({ timeout: 15_000 });
    await replyBtn.click();

    const textarea = page.locator('textarea').first();
    try {
      await expect(textarea).toBeVisible({ timeout: 3_000 });
    } catch {
      await page
        .getByRole('menuitem', { name: /^Reply/ })
        .first()
        .click();
      await expect(textarea).toBeVisible({ timeout: 15_000 });
    }
    await expect(textarea).toHaveValue('');

    const replyBody = `${RUN_TAG} reply ${Date.now()}`;
    await textarea.fill(replyBody);
    const replyMutation = waitForCreateRecord(page, 'app.bsky.feed.post');
    await page.getByRole('button', { name: /^Reply$/ }).first().click();
    const replyResponse = await replyMutation;
    /** @type {CreateRecordPayload} */
    const createRecordPayload = JSON.parse(
      replyResponse.request().postData() || '{}',
    );
    const replyRecord = createRecordPayload.record || {};
    expect(replyRecord.text).toBe(replyBody);
    expect(replyRecord.reply?.parent?.uri).toMatch(
      /^at:\/\/[^/]+\/app\.bsky\.feed\.post\//,
    );
    expect(replyRecord.reply?.parent?.cid).toEqual(expect.any(String));
    expect(replyRecord.reply?.root?.uri).toMatch(
      /^at:\/\/[^/]+\/app\.bsky\.feed\.post\//,
    );
    expect(replyRecord.facets || []).toEqual([]);
    CREATED.push({ page, body: replyBody });
    await expect(textarea).toHaveCount(0, { timeout: 30_000 });
  });

  test('like + unlike persists across reload', async ({ page }) => {
    test.setTimeout(120_000);
    const body = `${RUN_TAG} like ${Date.now()}`;
    await composeAndPublish(page, body);
    CREATED.push({ page, body });
    await openCreatedStatusDetail(page, body);
    const url = page.url();

    const likeBtn = statusDetailButton(
      page,
      'button[title="Like"], button[title="Unlike"]',
    );
    await likeBtn.waitFor({ timeout: 15_000 });
    const initialTitle = await getRequiredTitle(likeBtn, 'like button');
    const likeMutation = waitForCreateRecord(page, 'app.bsky.feed.like');
    await likeBtn.click();
    await likeMutation;
    await expect(likeBtn).not.toHaveAttribute('title', initialTitle, {
      timeout: 15_000,
    });
    // Verify the new state survives a reload (catches optimistic-only flips).
    await page.goto(url);
    const reloadedLike = statusDetailButton(
      page,
      'button[title="Like"], button[title="Unlike"]',
    );
    await reloadedLike.waitFor({ timeout: 15_000 });
    await expect(reloadedLike).not.toHaveAttribute('title', initialTitle, {
      timeout: 15_000,
    });
    // Revert.
    const unlikeMutation = waitForDeleteRecord(page, 'app.bsky.feed.like');
    await reloadedLike.click();
    await unlikeMutation;
    await expect(reloadedLike).toHaveAttribute('title', initialTitle, {
      timeout: 15_000,
    });
  });

  test('bookmark + unbookmark persists across reload', async ({ page }) => {
    test.setTimeout(120_000);
    const body = `${RUN_TAG} bookmark ${Date.now()}`;
    await composeAndPublish(page, body);
    CREATED.push({ page, body });
    await openCreatedStatusDetail(page, body);

    const bmBtn = statusDetailButton(
      page,
      'button[title="Bookmark"], button[title="Unbookmark"]',
    );
    await bmBtn.waitFor({ timeout: 15_000 });
    const initial = await getRequiredTitle(bmBtn, 'bookmark button');
    const bookmarkMutation = waitForCreateBookmark(page);
    await bmBtn.click();
    await bookmarkMutation;
    await expect(bmBtn).not.toHaveAttribute('title', initial, {
      timeout: 15_000,
    });
    const bookmarksPage = await page.context().newPage();
    try {
      await bookmarksPage.goto('/b');
      await expect(
        bookmarksPage
          .locator('[data-state-post-id]', { hasText: body })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await bookmarksPage.close();
    }
    const unbookmarkMutation = waitForDeleteBookmark(page);
    await bmBtn.click();
    await unbookmarkMutation;
    await expect(bmBtn).toHaveAttribute('title', initial, {
      timeout: 15_000,
    });
    await page.goto('/b');
    await expect(
      page.locator('[data-state-post-id]', { hasText: body }),
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test('boost + unboost (self-boost is supported on Bluesky)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const body = `${RUN_TAG} boost ${Date.now()}`;
    await composeAndPublish(page, body);
    CREATED.push({ page, body });
    await openCreatedStatusDetail(page, body);
    const url = page.url();

    const boostBtn = page.getByTestId('status-boost-button').first();
    await boostBtn.waitFor({ timeout: 15_000 });
    const initial = await getRequiredTitle(boostBtn, 'boost button');
    await boostBtn.click();
    // Bluepy shows a confirmation menu for boost/unboost.
    const boostMutation = waitForCreateRecord(page, 'app.bsky.feed.repost');
    await page.getByTestId('status-boost-confirm').click();
    await boostMutation;
    await expect(boostBtn).not.toHaveAttribute('title', initial, {
      timeout: 15_000,
    });

    // Reload + revert.
    await page.goto(url);
    const reloaded = page.getByTestId('status-boost-button').first();
    await reloaded.waitFor({ timeout: 15_000 });
    await expect(reloaded).not.toHaveAttribute('title', initial, {
      timeout: 15_000,
    });
    await reloaded.click();
    const unboostMutation = waitForDeleteRecord(page, 'app.bsky.feed.repost');
    await page.getByTestId('status-boost-confirm').click();
    await unboostMutation;
    await expect(reloaded).toHaveAttribute('title', initial, {
      timeout: 15_000,
    });
  });

  test('search: type a query, results show', async ({ page }) => {
    await goto(page, '/search');
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="earch" i]')
      .first();
    await searchInput.waitFor({ timeout: 15_000 });
    await searchInput.fill('bluesky');
    await page.waitForTimeout(2000); // debounce
    // Results area shows accounts or statuses; assert _something_ rendered.
    await expect(
      page
        .locator('article, .account-block, .status, [data-state-post-id]')
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// AFTER ALL — sweep RUN_TAG residue from the profile, then unlink storage.
// ---------------------------------------------------------------------------

base.afterAll(async ({ browser }) => {
  if (!HAS_CREDS) return;
  let ctx;
  try {
    ctx = await browser.newContext({ storageState: STORAGE_FILE });
  } catch {
    return;
  }
  const page = await ctx.newPage();
  try {
    // Multi-pass sweep: scroll, find RUN_TAG, delete, repeat. Bounded.
    await page.goto(`/a/${IDENTIFIER}`).catch(() => {});
    for (let pass = 0; pass < 5; pass++) {
      const orphan = page
        .locator('[data-state-post-id]', { hasText: SMOKE_TAG_PREFIX })
        .first();
      if ((await orphan.count()) === 0) break;
      try {
        await openStatusDetailFromArticle(page, orphan);
      } catch {
        await page.goto(`/a/${IDENTIFIER}`).catch(() => {});
        continue;
      }
      await page
        .getByTestId('status-more-button')
        .first()
        .click()
        .catch(() => {});
      await page
        .getByTestId('status-delete-trigger')
        .first()
        .click()
        .catch(() => {});
      await page
        .getByTestId('status-delete-confirm')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(1000);
      await page.goto(`/a/${IDENTIFIER}`).catch(() => {});
    }
  } catch {
    /* swallow */
  } finally {
    await ctx.close();
    // Unlink storage AFTER cleanup completes.
    try {
      fs.unlinkSync(STORAGE_FILE);
    } catch {
      /* fine */
    }
  }
});
