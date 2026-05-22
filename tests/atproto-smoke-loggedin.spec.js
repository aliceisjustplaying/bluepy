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

import { AtpAgent } from '@atproto/api';
import { getPdsEndpoint, isValidDidDoc } from '@atproto/common-web';
import { devices, expect, test as base } from '@playwright/test';

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
const SERVICE = process.env.ATPROTO_TEST_SERVICE;
const HAS_CREDS = Boolean(IDENTIFIER && PASSWORD);

base.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');
base.describe.configure({ mode: 'serial' });

const SMOKE_TAG_PREFIX = '[bluepy-smoke-';
const RUN_TAG = `${SMOKE_TAG_PREFIX}${Date.now()}]`;
const SMOKE_SEED_BODY = `${RUN_TAG} seed`;
const BSKY_DISCOVER_FEED =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const STORAGE_FILE = path.join(
  os.tmpdir(),
  `bluepy-smoke-storage-${process.pid}.json`,
);
/** @type {Promise<AtpAgent> | null} */
let cleanupAgentPromise = null;

/** @param {string | undefined} service */
function normalizeService(service) {
  if (!service) return null;
  const normalized = service
    .trim()
    .replace(/^at:\/\//, '')
    .replace(/\/+$/, '');
  if (!normalized) return null;
  return /^https?:\/\//.test(normalized) ? normalized : `https://${normalized}`;
}

/** @param {string} service */
function isBskyHostedPds(service) {
  try {
    const { hostname } = new URL(service);
    return (
      hostname === 'bsky.social' || hostname.endsWith('.host.bsky.network')
    );
  } catch {
    return false;
  }
}

async function resolveCleanupService() {
  const explicit = normalizeService(SERVICE);
  if (explicit) return explicit;
  if (!IDENTIFIER || IDENTIFIER.includes('@')) return 'https://bsky.social';

  try {
    const handleUrl = new URL(
      '/xrpc/com.atproto.identity.resolveHandle',
      'https://public.api.bsky.app',
    );
    handleUrl.searchParams.set('handle', IDENTIFIER.replace(/^@/, ''));
    const handleRes = await fetch(handleUrl);
    if (!handleRes.ok) throw new Error('handle resolution failed');
    const handleData = await handleRes.json();
    const did = handleData?.did;
    if (typeof did !== 'string' || !did) throw new Error('missing DID');

    let didDocUrl;
    if (did.startsWith('did:plc:')) {
      didDocUrl = `https://plc.directory/${encodeURIComponent(did)}`;
    } else if (did.startsWith('did:web:')) {
      const host = did
        .slice('did:web:'.length)
        .split(':')
        .map(decodeURIComponent)
        .join('/');
      didDocUrl = `https://${host}/.well-known/did.json`;
    } else {
      throw new Error('unsupported DID method');
    }

    const didDocRes = await fetch(didDocUrl);
    if (!didDocRes.ok) throw new Error('DID document resolution failed');
    const didDoc = await didDocRes.json();
    if (!isValidDidDoc(didDoc)) throw new Error('invalid DID document');
    const pdsEndpoint = getPdsEndpoint(didDoc);
    if (!pdsEndpoint) return 'https://bsky.social';
    return isBskyHostedPds(pdsEndpoint) ? 'https://bsky.social' : pdsEndpoint;
  } catch {
    return 'https://bsky.social';
  }
}

async function getCleanupAgent() {
  if (!cleanupAgentPromise) {
    cleanupAgentPromise = (async () => {
      const agent = new AtpAgent({ service: await resolveCleanupService() });
      await agent.login({ identifier: IDENTIFIER, password: PASSWORD });
      return agent;
    })();
  }
  return cleanupAgentPromise;
}

/**
 * @param {string} uri
 */
function rkeyFromPostUri(uri) {
  return uri.split('/').pop() || '';
}

/**
 * Delete matching smoke posts directly through XRPC so cleanup does not depend
 * on UI selectors, timeline freshness, or delete menu behavior.
 *
 * @param {string} marker
 */
async function cleanupSmokePosts(marker) {
  if (!HAS_CREDS) return;
  const agent = await getCleanupAgent();
  for (let pass = 0; pass < 3; pass++) {
    let cursor;
    let deleted = 0;
    for (let pageNo = 0; pageNo < 20; pageNo++) {
      const res = await agent.getAuthorFeed({
        actor: agent.did,
        cursor,
        filter: 'posts_with_replies',
        limit: 100,
      });
      for (const item of res.data.feed) {
        const post = item.post;
        const text = post.record?.text;
        if (
          post.author.did !== agent.did ||
          typeof text !== 'string' ||
          !text.includes(marker)
        ) {
          continue;
        }
        const rkey = rkeyFromPostUri(post.uri);
        if (!rkey) continue;
        await agent.com.atproto.repo
          .deleteRecord({
            repo: agent.did,
            collection: 'app.bsky.feed.post',
            rkey,
          })
          .catch(() => {});
        deleted++;
      }
      cursor = res.data.cursor;
      if (!cursor) break;
    }
    if (deleted === 0) break;
  }
}

/** @param {string} body */
async function createSmokePost(body) {
  const agent = await getCleanupAgent();
  await agent.com.atproto.repo.createRecord({
    repo: agent.did,
    collection: 'app.bsky.feed.post',
    record: {
      $type: 'app.bsky.feed.post',
      text: body,
      createdAt: new Date().toISOString(),
    },
  });
}

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
      await page.getByLabel('Handle or PDS URL').fill(IDENTIFIER);
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
  await cleanupSmokePosts(SMOKE_TAG_PREFIX);
  await createSmokePost(SMOKE_SEED_BODY);
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
    .locator(
      `.status-deck :is(${titleSelector}), .status.large :is(${titleSelector})`,
    )
    .last();
}

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

  test('mobile Discover feed keeps position after opening and closing a post', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: STORAGE_FILE,
      ...devices['iPhone 13'],
    });
    const page = await ctx.newPage();
    try {
      const discoverPath = `/${BSKY_DISCOVER_FEED}`;
      await page.goto(discoverPath);
      const list = page.locator('#list-page');
      await expect(list).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#list-page [data-href]').first()).toBeVisible({
        timeout: 30_000,
      });
      let targetIndex = -1;
      let scrollTop = 0;
      for (let attempt = 0; attempt < 8 && targetIndex < 0; attempt += 1) {
        await list.evaluate((element, attemptIndex) => {
          const startingScrollTop = Math.max(1400, element.scrollHeight * 0.25);
          element.scrollTo(
            0,
            startingScrollTop + attemptIndex * window.innerHeight * 0.7,
          );
        }, attempt);
        await page.waitForTimeout(500);
        targetIndex = await page.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll('#list-page [data-href]'),
          );
          return items.findIndex((item) => {
            const rect = item.getBoundingClientRect();
            return (
              rect.top > 120 &&
              rect.bottom < window.innerHeight - 20 &&
              /\d+\s+repl(?:y|ies)/i.test(item.textContent || '')
            );
          });
        });
        scrollTop = await list.evaluate((element) => element.scrollTop);
      }
      expect(scrollTop).toBeGreaterThan(1000);
      expect(
        targetIndex,
        'Expected a visible reply-bearing feed item',
      ).toBeGreaterThanOrEqual(0);
      const target = page.locator('#list-page [data-href]').nth(targetIndex);
      await target.evaluate((element) => {
        element.setAttribute('data-smoke-target', '1');
      });
      await target.tap();
      await expect(page.locator('.deck-close')).toHaveCount(1, {
        timeout: 30_000,
      });
      await expect
        .poll(() => list.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(scrollTop - 300);

      const threadLink = page
        .locator('.status-deck li.descendant .status-link[href]')
        .first();
      await expect(threadLink).toBeVisible({ timeout: 30_000 });
      const firstPostURL = page.url();
      await threadLink.tap();
      await expect(page).not.toHaveURL(firstPostURL);
      await expect(page.locator('.deck-close')).toHaveCount(1);
      await expect
        .poll(() => list.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(scrollTop - 300);

      await page.locator('.deck-close').tap();
      await expect(page).toHaveURL(new RegExp(BSKY_DISCOVER_FEED));
      await expect(page.locator('.deck-close')).toHaveCount(0);
      await expect
        .poll(() => list.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(scrollTop - 300);
      await expect(page.locator('[data-smoke-target="1"]')).toBeVisible();
    } finally {
      await ctx.close();
    }
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

  // Phase 2D: the Mastodon-only list knobs (replies_policy, exclusive) were
  // removed; ATProto list create/update only accepts a title.
  test('new-list form is title-only (no Mastodon replies-policy / exclusive)', async ({
    page,
  }) => {
    await goto(page, '/l');
    await expect(page.locator('#lists-page')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /new list/i }).first().click();
    const form = page.locator('form.list-form');
    await expect(form).toBeVisible({ timeout: 10_000 });
    await expect(form.locator('input[name="title"]')).toBeVisible();
    await expect(form.locator('select[name="replies_policy"]')).toHaveCount(0);
    await expect(form.locator('input[name="exclusive"]')).toHaveCount(0);
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

  // Phase 2D: Trending was reduced to the Bluesky Discover feed. The Mastodon
  // trending-hashtags / trending-links / link-mentions chrome was removed with
  // the feature-detection system (those endpoints returned empty collections on
  // ATProto). Assert the route still renders posts from the Discover feed.
  test('trending page renders Discover-feed posts', async ({ page }) => {
    await goto(page, '/trending');
    await expect(page.locator('.deck-container').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page
        .locator('[data-state-post-id], article.status, .status-link')
        .first(),
    ).toBeVisible({ timeout: 30_000 });
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

  test('compose add-media control attaches an image on narrow viewports', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openModal(page, 'showCompose');
    await page.locator('#compose-container textarea').first().waitFor({
      timeout: 15_000,
    });
    await page
      .locator('#compose-container input[type="file"]:not([capture])')
      .last()
      .setInputFiles(path.join(process.cwd(), 'public/logo-192.png'));

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

test.describe('write flows', () => {
  test.afterEach(async () => {
    await cleanupSmokePosts(RUN_TAG);
  });

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
    await expect(
      page.getByText('Post published. Check it out.', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('compose: a published post survives a reload (then leaves for sweep)', async ({
    page,
  }) => {
    const body = `${RUN_TAG} persist ${Date.now()}`;
    await composeAndPublish(page, body);
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
    await page
      .getByRole('button', { name: /^Reply$/ })
      .first()
      .click();
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
    await expect(textarea).toHaveCount(0, { timeout: 30_000 });
  });

  test('like + unlike persists across reload', async ({ page }) => {
    test.setTimeout(120_000);
    const body = `${RUN_TAG} like ${Date.now()}`;
    await composeAndPublish(page, body);
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
    await goto(
      page,
      `/search?q=${encodeURIComponent(IDENTIFIER)}&type=accounts`,
    );
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="earch" i]')
      .first();
    await searchInput.waitFor({ timeout: 15_000 });
    await expect(searchInput).toHaveValue(IDENTIFIER);
    await expect(
      page.locator('.account-block', { hasText: IDENTIFIER }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('paste-to-quote: pasting a Bluesky post URL suggests a native quote', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Publish a post we can quote, then read back its canonical detail link.
    const body = `${RUN_TAG} quote target ${Date.now()}`;
    await composeAndPublish(page, body);

    await goto(page, `/a/${IDENTIFIER}`);
    const article = page
      .locator('[data-state-post-id]', { hasText: body })
      .first();
    await article.waitFor({ timeout: 45_000 });
    const href = await article.evaluate((element) => {
      const link =
        element.closest('.status-link[data-href]') ||
        element.querySelector('.status-link[data-href]');
      return link?.getAttribute('data-href');
    });
    if (!href) throw new Error('published post is missing a detail link');
    const rkeyMatch = decodeURIComponent(href).match(
      /app\.bsky\.feed\.post\/([^/?#]+)/i,
    );
    if (!rkeyMatch) throw new Error(`could not extract rkey from ${href}`);
    // Build the public bsky.app URL — exercises handle→DID resolution, not just
    // a bare at:// URI. Strip a leading '@' so a `@handle` env value still
    // yields a valid profile URL.
    const actor = (IDENTIFIER || '').replace(/^@/, '');
    const postUrl = `https://bsky.app/profile/${actor}/post/${rkeyMatch[1]}`;

    // Open a fresh compose and paste the post URL, as a user would.
    await openModal(page, 'showCompose');
    const textarea = page.locator('#compose-container textarea').first();
    await textarea.waitFor({ timeout: 15_000 });
    await textarea.focus();
    await textarea.evaluate((el, url) => {
      const dt = new DataTransfer();
      dt.setData('text', url);
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, postUrl);

    // The resolved post should be offered as a quote, with our body inside it.
    const suggestion = page.locator('.quote-suggestion');
    await expect(suggestion).toBeVisible({ timeout: 20_000 });
    await expect(suggestion).toContainText('Turn link into a quote?');
    await expect(suggestion.locator('.quote-status')).toContainText(body, {
      timeout: 20_000,
    });
  });
});

// ---------------------------------------------------------------------------
// AFTER ALL — sweep RUN_TAG residue from the profile, then unlink storage.
// ---------------------------------------------------------------------------

base.afterAll(async () => {
  if (!HAS_CREDS) return;
  try {
    await cleanupSmokePosts(SMOKE_TAG_PREFIX);
  } catch {
    /* swallow */
  } finally {
    try {
      fs.unlinkSync(STORAGE_FILE);
    } catch {
      /* fine */
    }
  }
});
