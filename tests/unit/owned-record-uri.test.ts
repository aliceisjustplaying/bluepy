import { describe, expect, test } from 'bun:test';

import { parseOwnedRecordUri } from '../../src/data/_internal/owned-record-uri';

describe('parseOwnedRecordUri', () => {
  test('returns repo and rkey for a valid owned record URI', () => {
    expect(
      parseOwnedRecordUri(
        'at://did:plc:viewer/app.bsky.feed.like/abc',
        'did:plc:viewer',
        'app.bsky.feed.like',
      ),
    ).toEqual({ repo: 'did:plc:viewer', rkey: 'abc' });
  });

  test('rejects URIs whose repo is not the active DID', () => {
    expect(() =>
      parseOwnedRecordUri(
        'at://did:plc:other/app.bsky.feed.like/abc',
        'did:plc:viewer',
        'app.bsky.feed.like',
      ),
    ).toThrow('repo does not match active account');
  });

  test('rejects URIs whose collection does not match the expected one', () => {
    expect(() =>
      parseOwnedRecordUri(
        'at://did:plc:viewer/app.bsky.feed.repost/abc',
        'did:plc:viewer',
        'app.bsky.feed.like',
      ),
    ).toThrow('does not match app.bsky.feed.like');
  });

  test('rejects malformed URIs that merely contain the collection segment', () => {
    expect(() =>
      parseOwnedRecordUri(
        'https://example.test/app.bsky.feed.like/abc',
        'did:plc:viewer',
        'app.bsky.feed.like',
      ),
    ).toThrow('Record URI required');
  });

  test('rejects when there is no active DID', () => {
    expect(() =>
      parseOwnedRecordUri(
        'at://did:plc:viewer/app.bsky.feed.like/abc',
        null,
        'app.bsky.feed.like',
      ),
    ).toThrow('Active DID required');
  });
});
