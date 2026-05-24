import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  HAS_CREDS,
  IDENTIFIER,
  loginViaBrowserOAuth,
  waitForXrpc,
} from './helpers/auth';

const TARGET_IDENTIFIER =
  process.env.ATPROTO_TEST_IDENTIFIER &&
  process.env.ATPROTO_TEST_IDENTIFIER !== IDENTIFIER
    ? process.env.ATPROTO_TEST_IDENTIFIER
    : process.env.ATPROTO_TEST_IDENTIFIER_2;

const test = base.extend<
  { page: Page },
  { authenticatedContext: BrowserContext }
>({
  authenticatedContext: [
    async ({ browser }, run) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginViaBrowserOAuth(page);
      await page.close();
      await run(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ authenticatedContext }, run) => {
    const context = authenticatedContext;
    const page = await context.newPage();
    await run(page);
    await page.close();
  },
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');
test.skip(!TARGET_IDENTIFIER, 'two live ATProto test accounts required');

function requireTargetIdentifier(): string {
  if (!TARGET_IDENTIFIER) {
    throw new Error('two live ATProto test accounts required');
  }
  return TARGET_IDENTIFIER;
}

function waitForCreateRecord(page: Page, collection: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/xrpc/com.atproto.repo.createRecord') &&
      Boolean(
        response.request().postData()?.includes(`"collection":"${collection}"`),
      ) &&
      response.status() < 400,
    { timeout: 60_000 },
  );
}

function waitForDeleteRecord(page: Page, collection: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/xrpc/com.atproto.repo.deleteRecord') &&
      Boolean(
        response.request().postData()?.includes(`"collection":"${collection}"`),
      ) &&
      response.status() < 400,
    { timeout: 60_000 },
  );
}

function waitForAppBskyMutation(page: Page, method: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(`/xrpc/${method}`) && response.status() < 400,
    { timeout: 60_000 },
  );
}

const waitForCreateBookmark = (page: Page) =>
  waitForAppBskyMutation(page, 'app.bsky.bookmark.createBookmark');

const waitForDeleteBookmark = (page: Page) =>
  waitForAppBskyMutation(page, 'app.bsky.bookmark.deleteBookmark');

async function openProfileMoreMenu(page: Page) {
  const moreButton = page
    .locator('.account-container .actions button.plain4')
    .first();
  await expect(moreButton).toBeVisible({ timeout: 60_000 });
  await moreButton.click();
}

async function profileMenuItemText(page: Page, name: RegExp): Promise<string> {
  await openProfileMoreMenu(page);
  const item = page.getByRole('menuitem').filter({ hasText: name }).first();
  await expect(item).toBeVisible({ timeout: 60_000 });
  const text = await item.innerText();
  await page.keyboard.press('Escape');
  await page
    .locator('.szh-menu-container')
    .first()
    .waitFor({ state: 'hidden', timeout: 3_000 })
    .catch(async () => {
      await page.mouse.click(5, 5);
      await page
        .locator('.szh-menu-container')
        .first()
        .waitFor({ state: 'hidden', timeout: 3_000 })
        .catch(() => undefined);
    });
  return text;
}

async function revealModeratedContent(page: Page) {
  const showAnyway = page.getByRole('button', { name: /show anyway/i });
  for (let i = 0; i < 3; i += 1) {
    const button = showAnyway.first();
    if (!(await button.isVisible({ timeout: 500 }).catch(() => false))) return;
    await button.press('Enter', { timeout: 1_000 }).catch(async () => {
      await button.click({ force: true, timeout: 1_000 });
    });
  }
}

async function openFirstStatusDetail(page: Page): Promise<string> {
  await page.goto('/trending');
  const article = page.locator('[data-state-post-id]').first();
  await expect(article).toBeVisible({ timeout: 60_000 });
  const href = await article.evaluate((element) => {
    const link =
      element.closest('.status-link[data-href]') ??
      element.querySelector('.status-link[data-href]');
    return link?.getAttribute('data-href');
  });
  if (!href) throw new Error('first status is missing a detail link');
  const detailPath = href.startsWith('#') ? `/${href}` : href;
  await page.goto(detailPath);
  await revealModeratedContent(page);
  return detailPath;
}

async function composeTemporaryPost(page: Page, body: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Compose' }).click();
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await textarea.fill(body);
  const create = waitForCreateRecord(page, 'app.bsky.feed.post');
  await page
    .getByRole('button', { name: /^(post|publish)$/i })
    .first()
    .click();
  const response = await create;
  const payload: unknown = await response.json();
  const uri =
    typeof payload === 'object' &&
    payload !== null &&
    'uri' in payload &&
    typeof payload.uri === 'string'
      ? payload.uri
      : undefined;
  if (!uri) {
    throw new Error('create post response missing uri');
  }
  await expect(textarea).toHaveCount(0, { timeout: 30_000 });
  return uri;
}

function statusDetailButton(page: Page, titleSelector: string) {
  return page
    .locator(
      `.status-deck :is(${titleSelector}), .status.large :is(${titleSelector})`,
    )
    .last();
}

async function buttonTitle(button: ReturnType<typeof statusDetailButton>) {
  const title = await button.getAttribute('title');
  if (!title) throw new Error('status action button is missing a title');
  return title;
}

test('profile follow and unfollow use ATProto record mutations', async ({
  page,
}) => {
  const target = requireTargetIdentifier();
  const profileReady = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await profileReady;

  const actionButton = page
    .locator('.account-container .actions button')
    .filter({ hasText: /Follow|Following|Unfollow/i })
    .first();
  await expect(actionButton).toBeVisible({ timeout: 60_000 });
  const initialText = await actionButton.innerText();

  if (/following/i.test(initialText)) {
    const unfollow = waitForDeleteRecord(page, 'app.bsky.graph.follow');
    await actionButton.click();
    await page.getByRole('menuitem', { name: /unfollow/i }).click();
    await unfollow;
    await expect(actionButton).toContainText(/Follow/i, { timeout: 30_000 });

    const restore = waitForCreateRecord(page, 'app.bsky.graph.follow');
    await actionButton.click();
    await restore;
  } else {
    const follow = waitForCreateRecord(page, 'app.bsky.graph.follow');
    await actionButton.click();
    await follow;
    await expect(actionButton).toContainText(/Following/i, { timeout: 30_000 });

    const restore = waitForDeleteRecord(page, 'app.bsky.graph.follow');
    await actionButton.click();
    await page.getByRole('menuitem', { name: /unfollow/i }).click();
    await restore;
  }
});

test('profile mute and unmute use ATProto graph mutations', async ({
  page,
}) => {
  const target = requireTargetIdentifier();
  const profileReady = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await profileReady;

  await openProfileMoreMenu(page);
  const muteItem = page
    .getByRole('menuitem')
    .filter({ hasText: /Mute|Unmute/i })
    .first();
  await expect(muteItem).toBeVisible({ timeout: 60_000 });
  const initialText = await muteItem.innerText();

  if (/unmute/i.test(initialText)) {
    const unmute = waitForAppBskyMutation(page, 'app.bsky.graph.unmuteActor');
    await muteItem.click();
    await unmute;

    await openProfileMoreMenu(page);
    const restore = waitForAppBskyMutation(page, 'app.bsky.graph.muteActor');
    await page.getByRole('menuitem', { name: /^mute/i }).click();
    await restore;
  } else {
    const mute = waitForAppBskyMutation(page, 'app.bsky.graph.muteActor');
    await muteItem.click();
    await mute;

    await openProfileMoreMenu(page);
    const restore = waitForAppBskyMutation(page, 'app.bsky.graph.unmuteActor');
    await page.getByRole('menuitem', { name: /^unmute/i }).click();
    await restore;
  }
});

test('profile block and unblock use ATProto record mutations', async ({
  page,
}) => {
  const target = requireTargetIdentifier();
  const profileReady = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await profileReady;

  const actionButton = page
    .locator('.account-container .actions button')
    .filter({ hasText: /Follow|Following|Unfollow/i })
    .first();
  const wasFollowing =
    (await actionButton.innerText({ timeout: 2_000 }).catch(() => '')) ===
    'Following';

  await openProfileMoreMenu(page);
  const blockItem = page
    .getByRole('menuitem')
    .filter({ hasText: /Block|Unblock/i })
    .first();
  await expect(blockItem).toBeVisible({ timeout: 60_000 });
  const initialText = await blockItem.innerText();

  if (/unblock/i.test(initialText)) {
    const unblock = waitForDeleteRecord(page, 'app.bsky.graph.block');
    await blockItem.click();
    await unblock;

    await openProfileMoreMenu(page);
    await page.getByRole('menuitem', { name: /block/i }).click();
    const restore = waitForCreateRecord(page, 'app.bsky.graph.block');
    await page.getByRole('menuitem', { name: /block .+\?/i }).click();
    await restore;
  } else {
    await blockItem.click();
    const block = waitForCreateRecord(page, 'app.bsky.graph.block');
    await page.getByRole('menuitem', { name: /block .+\?/i }).click();
    await block;

    await openProfileMoreMenu(page);
    const restore = waitForDeleteRecord(page, 'app.bsky.graph.block');
    await page.getByRole('menuitem', { name: /unblock/i }).click();
    await restore;

    if (wasFollowing) {
      const follow = waitForCreateRecord(page, 'app.bsky.graph.follow');
      await actionButton.click();
      await follow;
    }
  }
});

test('status account menu deletes an ATProto post through OAuth', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const body = `[bluepy-m8-delete-${Date.now()}]`;
  const uri = await composeTemporaryPost(page, body);

  await page.goto(`/${uri}`);
  await expect(
    page
      .locator('.status-deck [data-state-post-id]', { hasText: body })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.locator('.status-deck .more-button').click();
  const muteThread = waitForAppBskyMutation(page, 'app.bsky.graph.muteThread');
  await page.getByRole('menuitem', { name: /mute conversation/i }).click();
  await muteThread;

  const refreshedAfterMute = waitForXrpc(page, 'app.bsky.feed.getPostThread');
  await page.goto(`/${uri}`);
  await refreshedAfterMute;
  await page.locator('.status-deck .more-button').click();
  const unmuteThread = waitForAppBskyMutation(
    page,
    'app.bsky.graph.unmuteThread',
  );
  await page.getByRole('menuitem', { name: /unmute conversation/i }).click();
  await unmuteThread;

  const deletePost = waitForDeleteRecord(page, 'app.bsky.feed.post');
  await page.locator('.status-deck .more-button').click();
  await page.getByRole('menuitem', { name: /^delete/i }).click();
  await page.getByRole('menuitem', { name: /delete this post/i }).click();
  await deletePost;

  await page.goto(`/${uri}`);
  await expect(
    page.locator('.status-deck [data-state-post-id]', { hasText: body }),
  ).toHaveCount(0, { timeout: 30_000 });
});

test('report modal mute and block actions use ATProto mutations', async ({
  page,
}) => {
  const target = requireTargetIdentifier();
  await page.route('**/xrpc/com.atproto.moderation.createReport', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        reasonType: 'com.atproto.moderation.defs#reasonSpam',
        subject: {
          $type: 'com.atproto.admin.defs#repoRef',
          did: 'did:plc:fixture',
        },
        reportedBy: 'did:plc:viewer',
        createdAt: new Date().toISOString(),
      }),
    }),
  );
  const profileReady = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await profileReady;

  const initialMuteText = await profileMenuItemText(page, /Mute|Unmute/i);
  const wasMuted = /unmute/i.test(initialMuteText);
  if (wasMuted) {
    await openProfileMoreMenu(page);
    const unmute = waitForAppBskyMutation(page, 'app.bsky.graph.unmuteActor');
    await page.getByRole('menuitem', { name: /^unmute/i }).click();
    await unmute;
  }
  await openProfileMoreMenu(page);
  await page.getByRole('menuitem', { name: /report/i }).click();
  await page.getByLabel(/spam/i).check();
  await page.getByLabel(/additional info/i).fill('Bluepy M8 e2e report mute');
  const mute = waitForAppBskyMutation(page, 'app.bsky.graph.muteActor');
  await page
    .getByRole('button', { name: /send report.*mute profile/i })
    .click();
  await mute;
  await expect(page.getByRole('heading', { name: /report/i })).toHaveCount(0, {
    timeout: 30_000,
  });

  const refreshedAfterMute = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await refreshedAfterMute;
  await openProfileMoreMenu(page);
  const unmute = waitForAppBskyMutation(page, 'app.bsky.graph.unmuteActor');
  await page.getByRole('menuitem', { name: /^unmute/i }).click({ force: true });
  await unmute;

  const refreshedAfterUnmute = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await refreshedAfterUnmute;
  const actionButton = page
    .locator('.account-container .actions button')
    .filter({ hasText: /Follow|Following|Unfollow/i })
    .first();
  const wasFollowing = /following/i.test(
    await actionButton.innerText({ timeout: 2_000 }).catch(() => ''),
  );
  const initialBlockText = await profileMenuItemText(page, /Block|Unblock/i);
  const wasBlocked = /unblock/i.test(initialBlockText);
  if (wasBlocked) {
    await openProfileMoreMenu(page);
    const unblock = waitForDeleteRecord(page, 'app.bsky.graph.block');
    await page.getByRole('menuitem', { name: /unblock/i }).click();
    await unblock;
  }
  await openProfileMoreMenu(page);
  await page.getByRole('menuitem', { name: /report/i }).click();
  await page.getByLabel(/spam/i).check();
  await page.getByLabel(/additional info/i).fill('Bluepy M8 e2e report block');
  const block = waitForCreateRecord(page, 'app.bsky.graph.block');
  await page
    .getByRole('button', { name: /send report.*block profile/i })
    .click();
  await block;
  await expect(page.getByRole('heading', { name: /report/i })).toHaveCount(0, {
    timeout: 30_000,
  });

  const refreshedAfterBlock = waitForXrpc(page, 'app.bsky.actor.getProfile');
  await page.goto(`/a/${target}`);
  await refreshedAfterBlock;
  await openProfileMoreMenu(page);
  const unblock = waitForDeleteRecord(page, 'app.bsky.graph.block');
  await page.getByRole('menuitem', { name: /unblock/i }).click({ force: true });
  await unblock;

  if (wasFollowing) {
    const follow = waitForCreateRecord(page, 'app.bsky.graph.follow');
    await actionButton.click();
    await follow;
  }
});

test('post engagement actions use ATProto mutations through OAuth', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const detailPath = await openFirstStatusDetail(page);

  const likeButton = statusDetailButton(
    page,
    'button[title="Like"], button[title="Unlike"]',
  );
  await expect(likeButton).toBeVisible({ timeout: 30_000 });
  if (/unlike/i.test(await buttonTitle(likeButton))) {
    const unlike = waitForDeleteRecord(page, 'app.bsky.feed.like');
    await likeButton.click();
    await unlike;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedLikeButton = statusDetailButton(
      page,
      'button[title="Like"], button[title="Unlike"]',
    );
    await expect(reloadedLikeButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedLikeButton).toHaveAttribute('title', /^Like$/i, {
      timeout: 30_000,
    });
    const restore = waitForCreateRecord(page, 'app.bsky.feed.like');
    await reloadedLikeButton.click();
    await restore;
  } else {
    const like = waitForCreateRecord(page, 'app.bsky.feed.like');
    await likeButton.click();
    await like;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedLikeButton = statusDetailButton(
      page,
      'button[title="Like"], button[title="Unlike"]',
    );
    await expect(reloadedLikeButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedLikeButton).toHaveAttribute('title', /unlike/i, {
      timeout: 30_000,
    });
    const restore = waitForDeleteRecord(page, 'app.bsky.feed.like');
    await reloadedLikeButton.click();
    await restore;
  }

  const bookmarkButton = statusDetailButton(
    page,
    'button[title="Bookmark"], button[title="Unbookmark"]',
  );
  await expect(bookmarkButton).toBeVisible({ timeout: 30_000 });
  if (/unbookmark/i.test(await buttonTitle(bookmarkButton))) {
    const unbookmark = waitForDeleteBookmark(page);
    await bookmarkButton.click();
    await unbookmark;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedBookmarkButton = statusDetailButton(
      page,
      'button[title="Bookmark"], button[title="Unbookmark"]',
    );
    await expect(reloadedBookmarkButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedBookmarkButton).toHaveAttribute(
      'title',
      /^Bookmark$/i,
      {
        timeout: 30_000,
      },
    );
    const restore = waitForCreateBookmark(page);
    await reloadedBookmarkButton.click();
    await restore;
  } else {
    const bookmark = waitForCreateBookmark(page);
    await bookmarkButton.click();
    await bookmark;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedBookmarkButton = statusDetailButton(
      page,
      'button[title="Bookmark"], button[title="Unbookmark"]',
    );
    await expect(reloadedBookmarkButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedBookmarkButton).toHaveAttribute(
      'title',
      /unbookmark/i,
      { timeout: 30_000 },
    );
    const restore = waitForDeleteBookmark(page);
    await reloadedBookmarkButton.click();
    await restore;
  }

  const repostButton = statusDetailButton(
    page,
    'button[title="Repost/Quote…"], button[title="Repost…"], button[title="Undo repost"]',
  );
  await expect(repostButton).toBeVisible({ timeout: 30_000 });
  if (/undo repost/i.test(await buttonTitle(repostButton))) {
    await repostButton.click();
    const unrepost = waitForDeleteRecord(page, 'app.bsky.feed.repost');
    await page.getByRole('menuitem', { name: /undo repost/i }).click();
    await unrepost;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedRepostButton = statusDetailButton(
      page,
      'button[title="Repost/Quote…"], button[title="Repost…"], button[title="Undo repost"]',
    );
    await expect(reloadedRepostButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedRepostButton).toHaveAttribute(
      'title',
      /^Repost(?:\/Quote)?…$/i,
      { timeout: 30_000 },
    );
    await reloadedRepostButton.click();
    const restore = waitForCreateRecord(page, 'app.bsky.feed.repost');
    await page.getByRole('menuitem', { name: /repost/i }).click();
    await restore;
  } else {
    await repostButton.click();
    const repost = waitForCreateRecord(page, 'app.bsky.feed.repost');
    await page.getByRole('menuitem', { name: /repost/i }).click();
    await repost;
    await page.goto(detailPath);
    await revealModeratedContent(page);
    const reloadedRepostButton = statusDetailButton(
      page,
      'button[title="Repost/Quote…"], button[title="Repost…"], button[title="Undo repost"]',
    );
    await expect(reloadedRepostButton).toBeVisible({ timeout: 30_000 });
    await expect(reloadedRepostButton).toHaveAttribute(
      'title',
      /undo repost/i,
      { timeout: 30_000 },
    );
    await reloadedRepostButton.click();
    const restore = waitForDeleteRecord(page, 'app.bsky.feed.repost');
    await page.getByRole('menuitem', { name: /undo repost/i }).click();
    await restore;
  }
});
