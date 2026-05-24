import { describe, expect, test } from 'bun:test';

import { renderPostText } from '../../src/render/post-text';

describe('renderPostText', () => {
  test('escapes plain text and preserves newlines', () => {
    expect(renderPostText('a & b\n<c>')).toBe('a &amp; b<br />&lt;c&gt;');
  });

  test('renders links with rel attributes', () => {
    const html = renderPostText('see https://example.test/x', [
      {
        index: { byteStart: 4, byteEnd: 27 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.test/x',
          },
        ],
      },
    ]);
    expect(html).toContain('href="https://example.test/x"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  test('renders mentions as profile at-URI permalinks', () => {
    const html = renderPostText('@alice.bsky.social hello', [
      {
        index: { byteStart: 0, byteEnd: 18 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#mention',
            did: 'did:plc:alice',
          },
        ],
      },
    ]);
    expect(html).toContain(
      'href="/at://did:plc:alice/app.bsky.actor.profile/self"',
    );
    expect(html).toContain('@alice.bsky.social');
  });

  test('renders hashtags', () => {
    const html = renderPostText('hello #Bluepy', [
      {
        index: { byteStart: 6, byteEnd: 13 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Bluepy' }],
      },
    ]);
    expect(html).toContain('href="/t/Bluepy"');
    expect(html).toContain('#<span>Bluepy</span>');
  });

  test('rejects unsafe link facet schemes like javascript:', () => {
    const html = renderPostText('click me', [
      {
        index: { byteStart: 0, byteEnd: 8 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'javascript:alert(1)',
          },
        ],
      },
    ]);
    expect(html).toBe('click me');
    expect(html).not.toContain('href=');
  });
});
