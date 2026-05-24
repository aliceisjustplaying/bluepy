import { expect, test } from '@playwright/test';

test('feedback form submits from the welcome footer', async ({ page }) => {
  const requests = [];
  await page.route('**/api/feedback', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  const modal = page.locator('.feedback-modal-container');
  await expect(modal).toBeVisible();

  await page.getByLabel('What happened?').fill('The timeline is stuck.');
  await page.getByLabel('Contact, optional').fill('@alice.test');
  await modal.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Thanks, got it.')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    message: 'The timeline is stuck.',
    contact: '@alice.test',
    subject: 'Feedback from Bluepy',
  });
  expect(requests[0].page).toContain('/');
  expect(requests[0].userAgent).toBeTruthy();
});
