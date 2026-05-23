import { expect, test } from '@playwright/test';

import { assertAtprotoPostParamsSupported } from '../src/utils/atproto-adapter.js';

test.describe('ATProto compose safety', () => {
  test('allows public posts and supported metadata', () => {
    expect(() => {
      assertAtprotoPostParamsSupported({
        language: 'en',
        quote_approval_policy: 'public',
        status: 'hello',
        visibility: 'public',
      });
    }).not.toThrow();
  });

  test('rejects unsupported privacy and content warning fields', () => {
    expect(() => {
      assertAtprotoPostParamsSupported({ visibility: 'private' });
    }).toThrow(/public visibility/);
    expect(() => {
      assertAtprotoPostParamsSupported({ sensitive: true });
    }).toThrow(/content warnings/);
    expect(() => {
      assertAtprotoPostParamsSupported({ spoiler_text: 'cw' });
    }).toThrow(/content warnings/);
    expect(() => {
      assertAtprotoPostParamsSupported({ quote_approval_policy: 'nobody' });
    }).toThrow(/quote approval/);
  });

  test('rejects list threadgates without a selected list', () => {
    expect(() => {
      assertAtprotoPostParamsSupported({
        threadgate: [{ type: 'list', list: '' }],
      });
    }).toThrow(/selected list/);
  });

  test('rejects list threadgates without a native list AT URI', () => {
    expect(() => {
      assertAtprotoPostParamsSupported({
        threadgate: [{ type: 'list', list: 'at:/bad' }],
      });
    }).toThrow(/native list AT URI/);

    expect(() => {
      assertAtprotoPostParamsSupported({
        threadgate: [
          { type: 'list', list: 'at://did:plc:test/app.bsky.feed.post/abc' },
        ],
      });
    }).toThrow(/native list AT URI/);
  });

  test('keeps shortened link text escaped', async ({ page }) => {
    await page.goto('/');
    const html = await page.evaluate(async () => {
      const { default: enhanceContent } =
        await import('/src/utils/enhance-content.ts');
      return enhanceContent(
        '<p><a href="https://example.com">https://example.com/&lt;img src=x onerror=alert(1)&gt;</a></p>',
      );
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
