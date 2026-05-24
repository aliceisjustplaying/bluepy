import { expect, test } from '@playwright/test';

import {
  ATPROTO_OAUTH_CLIENT_METADATA,
  ATPROTO_OAUTH_SCOPE,
  getAtprotoOAuthClientOptions,
  localhostToLoopbackHref,
} from '../src/utils/atproto-oauth.js';

test.describe('ATProto OAuth', () => {
  test('serves client metadata for the current origin', async ({ page }) => {
    const res = await page.goto('/oauth-client-metadata.json');
    expect(res.ok()).toBe(true);
    const metadata = await res.json();
    const origin = new URL(page.url()).origin;

    expect(metadata).toEqual({
      ...ATPROTO_OAUTH_CLIENT_METADATA,
      client_id: `${origin}/oauth-client-metadata.json`,
      client_uri: `${origin}/`,
      logo_uri: `${origin}/logo-512.png`,
      redirect_uris: [`${origin}/`],
    });
    expect(metadata.scope).toBe(ATPROTO_OAUTH_SCOPE);
    expect(metadata.redirect_uris).toContain(`${origin}/`);
    expect(metadata.dpop_bound_access_tokens).toBe(true);
    expect(metadata.token_endpoint_auth_method).toBe('none');
  });

  test('uses loopback metadata in local development', () => {
    const options = getAtprotoOAuthClientOptions('http://127.0.0.1:5173');
    const localhostOptions = getAtprotoOAuthClientOptions(
      'http://localhost:5173',
    );

    expect(options.clientMetadata?.client_id).toBe(
      'http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2F',
    );
    expect(options.clientMetadata?.redirect_uris).toEqual([
      'http://127.0.0.1:5173/',
    ]);
    expect(options.clientMetadata?.scope).toBe(ATPROTO_OAUTH_SCOPE);
    expect(options.handleResolver).toBe('https://bsky.social');
    expect(options.responseMode).toBe('query');
    expect(localhostOptions.clientMetadata?.client_id).toBe(
      'http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2F',
    );
  });

  test('canonicalizes localhost routes to the loopback OAuth redirect origin', () => {
    expect(
      localhostToLoopbackHref('http://localhost:5173/notifications?foo=bar#x'),
    ).toBe('http://127.0.0.1:5173/notifications?foo=bar#x');
    expect(localhostToLoopbackHref('http://127.0.0.1:5173/login')).toBeNull();
    expect(localhostToLoopbackHref('https://localhost/login')).toBeNull();
  });

  test('keeps protected localhost OAuth deep links on the callback origin', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const currentUrl = new URL(page.url());
    const { port } = currentUrl;
    test.skip(
      currentUrl.protocol === 'https:',
      'localhost-to-loopback browser redirect only applies to HTTP local dev',
    );

    await page.goto(`http://localhost:${port}/notifications`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveURL(
      new RegExp(`^http://127\\.0\\.0\\.1:${port}/login$`),
    );
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('loginRedirect')))
      .toBe('/notifications');
  });

  test('clears a stale local OAuth account when restore has no browser session', async ({
    page,
  }) => {
    const did = 'did:plc:staleoauth';
    await page.addInitScript((accountDid) => {
      localStorage.setItem(
        'accounts',
        JSON.stringify([
          {
            accessToken: JSON.stringify({
              type: 'atproto-oauth',
              sub: accountDid,
            }),
            atproto: true,
            info: {
              id: accountDid,
              username: 'stale.test',
              acct: 'stale.test',
              displayName: 'Stale OAuth',
            },
            instanceURL: 'bsky.social',
          },
        ]),
      );
      sessionStorage.setItem('currentAccount', accountDid);
    }, did);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('link', { name: 'Connect to Atmosphere' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('accounts')))
      .toBe('[]');
  });

  test('keeps app-password login available as a fallback', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('button', { name: 'Connect to Atmosphere' }),
    ).toBeVisible();
    await page.getByText('Use app password').click();
    await expect(page.getByLabel('App password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue with app password' }),
    ).toBeVisible();
  });
});
