// @ts-check
import { expect, test } from '@playwright/test';

test('has welcome page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
});

test('loads post page and works', async ({ page }) => {
  await page.route('**/api/v1/statuses/123', async (route) => {
    await route.fulfill({
      json: {
        id: '123',
        created_at: '2024-01-01T12:00:00.000Z',
        account: {
          id: '1',
          username: 'testuser',
          display_name: 'Test User',
          acct: 'testuser@test.social',
        },
        content: '<p>This is a test post</p>',
      },
    });
  });

  await page.route('**/api/v1/statuses/123/context', async (route) => {
    await route.fulfill({
      json: {
        ancestors: [],
        descendants: [],
      },
    });
  });

  await page.goto('/#/test.social/s/123');
  await expect(page.locator('text=This is a test post')).toBeVisible();
});

test('uses cache-busting reloads when the app script never mounts', async ({
  page,
}) => {
  test.setTimeout(45_000);
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.fulfill({
      contentType: 'application/javascript',
      body: '// Simulate Safari restoring the boot document without app mount.',
    });
  });

  await page.goto('/');

  await expect
    .poll(() => appScriptRequests, { timeout: 25_000 })
    .toBe(4);
  await expect(page.locator('#boot-status')).toContainText(
    'Safari did not run the app script',
    { timeout: 7_000 },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          sessionStorage.getItem('bluepy:boot-reload-state') || '{}',
        ).attempts,
      ),
    )
    .toBe(3);
  expect(new URL(page.url()).searchParams.has('__bluepy_boot_retry')).toBe(
    true,
  );
  await page.waitForTimeout(6000);
  expect(appScriptRequests).toBe(4);
});

test('uses cache-busting reloads when the app script fails to load', async ({
  page,
}) => {
  test.setTimeout(20_000);
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.abort('failed');
  });

  await page.goto('/');

  await expect
    .poll(() => appScriptRequests, { timeout: 10_000 })
    .toBe(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          sessionStorage.getItem('bluepy:boot-reload-state') || '{}',
        ).attempts,
      ),
    )
    .toBe(3);
  expect(new URL(page.url()).searchParams.has('__bluepy_boot_retry')).toBe(
    true,
  );
  await page.waitForTimeout(1000);
  expect(appScriptRequests).toBe(4);
});

test('shows boot failure without recovery on app runtime errors', async ({
  page,
}) => {
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.fulfill({
      contentType: 'application/javascript',
      body: "throw new Error('boot boom');",
    });
  });

  await page.goto('/');

  await expect(page.locator('#boot-status')).toContainText('boot boom');
  await page.waitForTimeout(6000);
  expect(appScriptRequests).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('bluepy:boot-reload-state'),
      ),
    )
    .toBeNull();
});

test('clears boot retry state after a successful mount', async ({ page }) => {
  await page.goto('/favicon.ico');
  await page.evaluate(() => {
    sessionStorage.setItem(
      'bluepy:boot-reload-state',
      JSON.stringify({ attempts: 2, lastAt: Date.now() }),
    );
    sessionStorage.setItem('bluepy:boot-reload-attempted', '1');
  });

  await page.goto('/?__bluepy_boot_retry=123');
  await expect(page.locator('#welcome')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        search: location.search,
        state: sessionStorage.getItem('bluepy:boot-reload-state'),
        legacyState: sessionStorage.getItem('bluepy:boot-reload-attempted'),
      })),
    )
    .toEqual({
      search: '',
      state: null,
      legacyState: null,
    });
});

test('does not treat post-mount module failures as boot failures', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  const mountedURL = page.url();

  await page.evaluate(() => {
    const script = document.createElement('script');
    script.type = 'module';
    document.body.append(script);
    script.dispatchEvent(new Event('error'));
  });

  await page.waitForTimeout(1000);
  expect(page.url()).toBe(mountedURL);
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('bluepy:boot-reload-state'),
      ),
    )
    .toBeNull();
});
