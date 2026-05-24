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

test.describe('ATProto composer link preview', () => {
  test('shows and removes cardyb previews while composing', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('https://cardyb.bsky.app/v1/extract**', async (route) => {
      await route.fulfill({
        json: {
          url: 'https://example.com/story',
          title: 'Example Story',
          description: 'A preview from cardyb.',
          image: 'https://example.com/card.jpg',
        },
      });
    });

    await loginViaAppPassword(page);
    await page.getByRole('button', { name: 'Compose' }).click();
    const textarea = page.getByPlaceholder('What are you doing?');
    await expect(textarea).toBeVisible({ timeout: 60_000 });
    await textarea.focus();
    await textarea.pressSequentially('check https://example.com/story');

    await expect(page.locator('.compose-link-preview')).toContainText(
      'Example Story',
      { timeout: 15_000 },
    );
    await page.locator('.compose-link-preview button').click();
    await expect(page.locator('.compose-link-preview')).toHaveCount(0);
  });
});
