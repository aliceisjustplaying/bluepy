import { describe, expect, test } from 'bun:test';

import {
  decodeAtprotoRecordPath,
  getAtprotoPathFromLegacyRoute,
} from '../src/utils/atproto-route';

describe('ATProto route helpers', () => {
  test('decodes worker-encoded AT URI paths while preserving query and hash', () => {
    expect(
      decodeAtprotoRecordPath(
        '/at%3A/did%3Aplc%3Aabc/app.bsky.feed.post/post123?q=1#reply',
      ),
    ).toBe('/at://did:plc:abc/app.bsky.feed.post/post123?q=1#reply');
    expect(
      decodeAtprotoRecordPath(
        '/at%3A/did%3Aplc%3Aabc/app.bsky.feed.post/post123?q=1#reply#nested',
      ),
    ).toBe('/at://did:plc:abc/app.bsky.feed.post/post123?q=1#reply#nested');
    expect(
      decodeAtprotoRecordPath(
        '/at%3A/did%3Aplc%3Aabc/app.bsky.feed.post/post123#',
      ),
    ).toBe('/at://did:plc:abc/app.bsky.feed.post/post123#');
  });

  test('leaves unrelated encoded paths unchanged', () => {
    expect(decodeAtprotoRecordPath('/search?q=at%3A%2F%2Fdid')).toBe(
      '/search?q=at%3A%2F%2Fdid',
    );
  });

  test('canonicalizes fully encoded and Worker-decoded legacy record paths', () => {
    expect(
      getAtprotoPathFromLegacyRoute(
        '/bsky.social/s/at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2Fpost123',
      ),
    ).toBe('/at://did:plc:abc/app.bsky.feed.post/post123');
    expect(
      getAtprotoPathFromLegacyRoute(
        '/bsky.social/s/at%3A/did%3Aplc%3Aabc/app.bsky.feed.post/post123',
      ),
    ).toBe('/at://did:plc:abc/app.bsky.feed.post/post123');
  });
});
