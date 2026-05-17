// @ts-check
import { expect, test } from '@playwright/test';

/**
 * @typedef {Window & {
 *   __BLUEPY_OAUTH_TEST_CLIENT__?: {
 *     restore(): Promise<{
 *       sub: string;
 *       did: string;
 *       fetchHandler(url: string | URL | Request): Promise<Response>;
 *     }>;
 *   };
 *   __STATES__?: { showShortcutsSettings?: boolean };
 * }} BluepyWindow
 */

const did = 'did:plc:settings';
const accountNamespace = `${did}@bsky.social`;

test('remembers multi-column shortcut view mode after reload', async ({
  page,
}) => {
  await page.addInitScript(
    ({ testDid, testAccountNamespace }) => {
      const account = {
        info: {
          id: testDid,
          username: 'settings.test',
          acct: 'settings.test',
          displayName: 'Settings Test',
          avatarStatic: '',
        },
        instanceURL: 'bsky.social',
        accessToken: JSON.stringify({ type: 'atproto-oauth', sub: testDid }),
        atproto: true,
        createdAt: Date.now(),
      };
      localStorage.setItem('accounts', JSON.stringify([account]));
      localStorage.setItem(
        'shortcuts',
        JSON.stringify({
          [testAccountNamespace]: [{ type: 'following' }],
        }),
      );
      const appWindow = /** @type {BluepyWindow} */ (window);
      appWindow.__BLUEPY_OAUTH_TEST_CLIENT__ = {
        restore: async () => ({
          sub: testDid,
          did: testDid,
          /** @param {string | URL | Request} url */
          fetchHandler: async (url) => {
            const urlString =
              typeof url === 'string'
                ? url
                : url instanceof URL
                  ? url.href
                  : url.url;
            if (urlString.includes('app.bsky.actor.getProfile')) {
              return Response.json({
                did: testDid,
                handle: 'settings.test',
                displayName: 'Settings Test',
              });
            }
            if (urlString.includes('app.bsky.feed.getTimeline')) {
              return Response.json({ feed: [] });
            }
            if (urlString.includes('app.bsky.actor.getPreferences')) {
              return Response.json({ preferences: [] });
            }
            return Response.json({});
          },
        }),
      };
    },
    { testDid: did, testAccountNamespace: accountNamespace },
  );

  await page.goto('/');
  await expect(page.locator('.deck-container').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const appWindow = /** @type {BluepyWindow} */ (window);
    if (appWindow.__STATES__) {
      appWindow.__STATES__.showShortcutsSettings = true;
    }
  });

  await page
    .locator('label')
    .filter({ has: page.locator('input[value="multi-column"]') })
    .click();
  await expect
    .poll(() =>
      page.evaluate((storedAccountNamespace) => {
        return (
          localStorage.getItem('settings-shortcutsViewMode') ===
          JSON.stringify({ [storedAccountNamespace]: 'multi-column' })
        );
      }, accountNamespace),
    )
    .toBe(true);

  await page.reload();
  await expect(page.locator('.deck-container').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const appWindow = /** @type {BluepyWindow} */ (window);
    if (appWindow.__STATES__) {
      appWindow.__STATES__.showShortcutsSettings = true;
    }
  });
  await expect(page.getByLabel('Multi-column')).toBeChecked();
});
