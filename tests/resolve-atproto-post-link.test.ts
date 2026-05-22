import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'bun:test';

import { resolveAtprotoPostURI } from '../src/utils/resolve-atproto-post-link';

const POST = 'at://did:plc:abc/app.bsky.feed.post/xyz';
const OWN_HOST = 'bluepy.social';

const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;

beforeEach(() => {
  // Own-permalink resolution only fires for links to *this* app instance.
  Object.defineProperty(globalThis, 'location', {
    value: { host: OWN_HOST, href: `https://${OWN_HOST}/` },
    configurable: true,
    writable: true,
  });
  // Resolve only the one handle we test with; everything else 404s so we can
  // assert that unresolvable handles yield null rather than a bogus URI.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes('resolveHandle') && url.includes('handle=alice.test')) {
      return new Response(JSON.stringify({ did: 'did:plc:alice' }), {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, 'location', {
    value: originalLocation,
    configurable: true,
    writable: true,
  });
});

test('passes through a bare DID-based at:// post URI', async () => {
  assert.equal(await resolveAtprotoPostURI(POST), POST);
});

test('decodes a URI-encoded at:// post URI', async () => {
  assert.equal(
    await resolveAtprotoPostURI(encodeURIComponent(POST)),
    POST,
  );
});

test('resolves a bsky.app post URL whose actor is already a DID', async () => {
  assert.equal(
    await resolveAtprotoPostURI(
      'https://bsky.app/profile/did:plc:abc/post/xyz',
    ),
    POST,
  );
});

test('resolves a bsky.app post URL by resolving the handle to a DID', async () => {
  assert.equal(
    await resolveAtprotoPostURI('https://bsky.app/profile/alice.test/post/xyz'),
    'at://did:plc:alice/app.bsky.feed.post/xyz',
  );
});

test('resolves our own at:// permalink', async () => {
  assert.equal(
    await resolveAtprotoPostURI(`https://bluepy.social/${POST}`),
    POST,
  );
});

test('resolves a legacy /s/<encoded-uri> permalink', async () => {
  assert.equal(
    await resolveAtprotoPostURI(
      `https://bluepy.social/s/${encodeURIComponent(POST)}`,
    ),
    POST,
  );
});

test('returns null for a Mastodon/Fediverse post URL', async () => {
  assert.equal(
    await resolveAtprotoPostURI('https://mastodon.social/@user/110000000000'),
    null,
  );
});

test('returns null for an arbitrary external URL', async () => {
  assert.equal(await resolveAtprotoPostURI('https://example.com/post/1'), null);
});

test('returns null for an external URL that merely embeds a bsky post link', async () => {
  // Must not treat a non-bsky host as an internal post just because the link
  // appears in its query string.
  assert.equal(
    await resolveAtprotoPostURI(
      'https://example.com/?u=https://bsky.app/profile/alice.test/post/xyz',
    ),
    null,
  );
});

test('returns null for a foreign host carrying an at:// path', async () => {
  // Only *our own* permalinks count as internal record links.
  assert.equal(await resolveAtprotoPostURI(`https://example.com/${POST}`), null);
});

test('returns null for a non-post at:// URI (profile)', async () => {
  assert.equal(
    await resolveAtprotoPostURI('at://did:plc:abc/app.bsky.actor.profile/self'),
    null,
  );
});

test('returns null when a bsky.app handle cannot be resolved', async () => {
  assert.equal(
    await resolveAtprotoPostURI(
      'https://bsky.app/profile/nope.invalid/post/xyz',
    ),
    null,
  );
});

test('returns null for empty input', async () => {
  assert.equal(await resolveAtprotoPostURI(''), null);
  assert.equal(await resolveAtprotoPostURI(undefined), null);
});
