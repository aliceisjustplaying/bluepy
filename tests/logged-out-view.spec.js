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

test('reloads once when the app script never mounts', async ({ page }) => {
  test.setTimeout(25_000);
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
    .poll(() => appScriptRequests, { timeout: 10_000 })
    .toBeGreaterThan(1);
  await expect(page.locator('#boot-status')).toContainText(
    'Safari did not run the app script',
    { timeout: 7_000 },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('bluepy:boot-reload-attempted'),
      ),
    )
    .toBe('1');
  await page.waitForTimeout(6000);
  expect(appScriptRequests).toBe(2);
});
