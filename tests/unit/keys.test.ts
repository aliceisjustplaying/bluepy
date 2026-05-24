import { describe, expect, test } from 'bun:test';

import { appviewKey, keys, stableHash } from '../../src/data/keys';

const accountScope = ['did:plc:viewer'] as const;
const viewerScope = [
  'did:plc:viewer',
  appviewKey('did:web:api.bsky.app', 'https://public.api.bsky.app'),
  stableHash(['did:plc:labeler']),
] as const;

describe('keys factory', () => {
  test('AccountScope keys start with viewerDid only', () => {
    expect(keys.preferences(accountScope)).toEqual([
      'did:plc:viewer',
      'preferences',
    ]);
    expect(keys.uiPreferences(accountScope)).toEqual([
      'did:plc:viewer',
      'uiPreferences',
    ]);
  });

  test('ViewerScope keys start with viewerDid, appviewKey, labelersHash', () => {
    const uri = 'at://did:plc:alice/app.bsky.feed.post/3k';
    expect(keys.post(viewerScope, uri)[0]).toBe('did:plc:viewer');
    expect(keys.post(viewerScope, uri)[1]).toBe(viewerScope[1]);
    expect(keys.post(viewerScope, uri)[2]).toBe(viewerScope[2]);
    expect(keys.timeline(viewerScope).length).toBe(4);
  });

  test('distinct list keys use different fourth segments', () => {
    const uri = 'at://did:plc:alice/app.bsky.feed.post/3k';
    expect(keys.post(viewerScope, uri)[3]).toBe('post');
    expect(keys.thread(viewerScope, uri)[3]).toBe('thread');
    expect(keys.profileFeed(viewerScope, 'did:plc:alice')[3]).toBe(
      'profileFeed',
    );
  });

  test('stableHash is order-independent', () => {
    expect(stableHash(['b', 'a'])).toBe(stableHash(['a', 'b']));
  });
});
