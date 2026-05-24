import { expect, test } from '@playwright/test';

const IDENTIFIER = process.env.ATPROTO_TEST_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_TEST_PASSWORD;
const HAS_CREDS = Boolean(IDENTIFIER && PASSWORD);

test.skip(!HAS_CREDS, 'ATPROTO_TEST_IDENTIFIER/PASSWORD not set');

async function loginViaAppPassword(page) {
  await page.goto('/login');
  await page.getByLabel('Handle or PDS URL').fill(IDENTIFIER);
  await page.getByText('Use app password').click();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page
    .getByRole('button', { name: 'Continue with app password' })
    .click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

test.describe('ATProto mention autocomplete', () => {
  test('inserts Bluesky mention autocomplete selections in the composer', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('**/xrpc/app.bsky.actor.searchActors**', async (route) => {
      await route.fulfill({
        json: {
          actors: [
            {
              did: 'did:plc:alice',
              handle: 'alice.test',
              displayName: 'Alice Mention',
              avatar: 'https://example.com/avatar.png',
            },
          ],
        },
      });
    });

    await loginViaAppPassword(page);
    await page.getByRole('button', { name: 'Compose' }).click();
    const textarea = page.getByPlaceholder('What are you doing?');
    await expect(textarea).toBeVisible({ timeout: 60_000 });
    await textarea.focus();
    await textarea.pressSequentially('@ali');
    await expect(page.locator('.mention-autocomplete')).toHaveCount(0);
    await page
      .locator('.text-expander-menu [role="option"]')
      .filter({
        hasText: 'Alice Mention',
      })
      .click();

    await expect(textarea).toHaveValue('@alice.test ');
  });
});
