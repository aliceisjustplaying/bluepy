import { expect, type Page } from '@playwright/test';

const APP_PASSWORD_IDENTIFIER = process.env.ATPROTO_TEST_IDENTIFIER;
const APP_PASSWORD = process.env.ATPROTO_TEST_PASSWORD;
const OAUTH_IDENTIFIER =
  process.env.ATPROTO_OAUTH_TEST_IDENTIFIER ??
  process.env.ATPROTO_TEST_IDENTIFIER_2 ??
  APP_PASSWORD_IDENTIFIER;
const OAUTH_PASSWORD =
  process.env.ATPROTO_OAUTH_TEST_PASSWORD ??
  process.env.ATPROTO_TEST_PASSWORD_2 ??
  APP_PASSWORD;
const HAS_CREDS = Boolean(OAUTH_IDENTIFIER && OAUTH_PASSWORD);

export async function loginViaAppPassword(page: Page): Promise<void> {
  await page.goto('/login');
  if (
    await page
      .locator('[data-timeline-id="home"]')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    return;
  }
  await page.getByLabel('Handle or PDS URL').fill(APP_PASSWORD_IDENTIFIER!);
  await page.getByText('Use app password').click();
  await page.locator('input[type="password"]').fill(APP_PASSWORD!);
  await page
    .getByRole('button', { name: 'Continue with app password' })
    .click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

async function fillFirstVisible(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (
      await locator
        .isVisible({ timeout: 1_500 })
        .catch(() => false)
    ) {
      try {
        await locator.fill(value, { timeout: 2_000 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function fillFirstVisibleLabel(
  page: Page,
  labels: RegExp[],
  value: string,
): Promise<boolean> {
  for (const label of labels) {
    const locator = page.getByLabel(label).first();
    if (
      await locator
        .isVisible({ timeout: 1_500 })
        .catch(() => false)
    ) {
      try {
        await locator.fill(value, { timeout: 2_000 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (
      await locator
        .isVisible({ timeout: 1_500 })
        .catch(() => false)
    ) {
      try {
        await locator.click({ timeout: 2_000 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function completeOAuthProviderLogin(
  page: Page,
  appOrigin: string,
): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (
    !(await fillFirstVisibleLabel(
      page,
      [/handle or email/i, /handle/i, /email/i, /username/i],
      OAUTH_IDENTIFIER!,
    ))
  ) {
    await fillFirstVisible(
      page,
      [
        'input[name="identifier"]',
        'input[name="handle"]',
        'input[name="username"]',
        'input[name="login"]',
        'input[type="email"]',
        'input[type="text"]',
      ],
      OAUTH_IDENTIFIER!,
    );
  }
  await clickFirstVisible(page, [
    'button:has-text("Next")',
    'button:has-text("Continue")',
  ]);
  if (!(await fillFirstVisibleLabel(page, [/password/i], OAUTH_PASSWORD!))) {
    await fillFirstVisible(
      page,
      ['input[name="password"]', 'input[type="password"]'],
      OAUTH_PASSWORD!,
    );
  }

  for (let i = 0; i < 8; i += 1) {
    const currentUrl = new URL(page.url());
    if (currentUrl.origin === appOrigin && currentUrl.pathname !== '/login') {
      return;
    }
    await clickFirstVisible(page, [
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Approve")',
      'button:has-text("Authorize")',
      'button:has-text("Allow")',
      'button:has-text("Accept")',
      'button:has-text("Continue")',
      'button[type="submit"]',
    ]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page
      .waitForURL(
        (url) => url.origin !== appOrigin || url.pathname !== '/login',
        { timeout: 5_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  }
}

export async function loginViaBrowserOAuth(
  page: Page,
  options: { preserveCurrentPage?: boolean } = {},
): Promise<void> {
  if (!options.preserveCurrentPage) {
    await page.goto('/login');
  } else {
    await page.waitForURL(/\/login(?:[?#].*)?$/, { timeout: 15_000 }).catch(() => {});
  }
  const appOrigin = new URL(page.url()).origin;
  if (
    await page
      .locator('[data-timeline-id="home"]')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    return;
  }
  await page.getByLabel('Handle or PDS URL').fill(OAUTH_IDENTIFIER!);
  await page.getByRole('button', { name: 'Connect to Atmosphere' }).click();
  await page
    .waitForURL((url) => url.origin !== appOrigin || url.pathname !== '/login', {
      timeout: 15_000,
    })
    .catch(() => {});
  await completeOAuthProviderLogin(page, appOrigin);
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 90_000 });
  await expect(page.locator('[data-timeline-id="home"], main').first()).toBeVisible({
    timeout: 90_000,
  });
}

export async function waitForXrpc(
  page: Page,
  method: string,
  timeout = 60_000,
): Promise<void> {
  await page.waitForResponse(
    (response) =>
      response.url().includes(`/xrpc/${method}`) && response.status() < 400,
    { timeout },
  );
}

export async function expectFeedItems(page: Page): Promise<void> {
  await expect(
    page
      .locator(
        '.timeline-list .timeline-item, .timeline .timeline-item, .timeline-empty',
      )
      .first(),
  ).toBeVisible({ timeout: 60_000 });
}

export { HAS_CREDS, OAUTH_IDENTIFIER as IDENTIFIER };
