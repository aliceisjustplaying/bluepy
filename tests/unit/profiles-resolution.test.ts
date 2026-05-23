import { describe, expect, test } from 'bun:test';

import type { AppBskyActorDefs } from '@atproto/api';

import { primeProfiles } from '../../src/data/_internal/prime';
import { appviewKey, keys, stableHash } from '../../src/data/keys';
import { createQueryClient } from '../../src/data/query-client';

const viewerScope = [
  'did:plc:viewer',
  appviewKey('did:web:api.bsky.app', 'https://public.api.bsky.app'),
  stableHash(['did:plc:labeler']),
] as const;

describe('profile handle resolution cache', () => {
  test('actorResolution stores DID only while profile body lives at profileByDid', () => {
    const qc = createQueryClient();
    const handle = 'alice.test';
    const profile = {
      did: 'did:plc:alice',
      handle,
      displayName: 'Alice',
    } as AppBskyActorDefs.ProfileViewDetailed;

    primeProfiles(qc, viewerScope, profile);
    qc.setQueryData(keys.actorResolution(viewerScope, handle), profile.did);

    const resolved = qc.getQueryData<string>(
      keys.actorResolution(viewerScope, handle),
    );
    expect(resolved).toBe(profile.did);
    expect(
      qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
        keys.profileByDid(viewerScope, profile.did),
      ),
    ).toEqual(profile);
    expect(resolved).not.toHaveProperty('displayName');
  });
});
