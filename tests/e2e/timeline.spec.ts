import { expect, test as base } from '@playwright/test';

import {
  HAS_CREDS,
  expectFeedItems,
  loginViaBrowserOAuth,
  waitForXrpc,
} from './helpers/auth';

const test = base;
test.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');

test.describe('timeline feed (data layer)', () => {
  test('logged-in home renders the data-layer timeline shell', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const timelineReady = waitForXrpc(page, 'app.bsky.feed.getTimeline');
    await loginViaBrowserOAuth(page);
    await timelineReady;

    await expect(page.locator('[data-timeline-id="home"]')).toBeVisible({
      timeout: 60_000,
    });
    await expectFeedItems(page);
  });
});
