import { describe, expect, test } from 'bun:test';

import type { ClientBundle } from '../../src/data/clients';
import { resolveRelationshipRecordUri } from '../../src/data/profiles';

function clientsWithRelationship(
  relationship: Record<string, unknown>,
  calls: string[],
): ClientBundle {
  return {
    pdsRepoAgent: null,
    activeAppViewProxyAgent: {
      app: {
        bsky: {
          graph: {
            getRelationships: async (params: {
              actor: string;
              others: string[];
            }) => {
              calls.push(`${params.actor}:${params.others.join(',')}`);
              return { data: { relationships: [relationship] } };
            },
          },
        },
      },
    },
    bskyAppViewProxyAgent: null,
    publicActiveAppViewAgent: {} as ClientBundle['publicActiveAppViewAgent'],
    publicBskyAppViewAgent: {} as ClientBundle['publicBskyAppViewAgent'],
    activeAppViewService: 'https://example.test',
  } as ClientBundle;
}

describe('profile mutation record URI resolution', () => {
  test('uses valid supplied relationship record URIs without refetching', async () => {
    const calls: string[] = [];
    const uri = 'at://did:plc:viewer/app.bsky.graph.follow/rkey';

    const result = await resolveRelationshipRecordUri(
      clientsWithRelationship({}, calls),
      'did:plc:viewer',
      'did:plc:target',
      'following',
      uri,
    );
    expect(result).toBe(uri);
    expect(calls).toEqual([]);
  });

  test('recovers missing or placeholder relationship URIs from getRelationships', async () => {
    const calls: string[] = [];
    const uri = 'at://did:plc:viewer/app.bsky.graph.block/rkey';

    const result = await resolveRelationshipRecordUri(
      clientsWithRelationship({ blocking: uri }, calls),
      'did:plc:viewer',
      'did:plc:target',
      'blocking',
      'did:plc:target',
    );
    expect(result).toBe(uri);
    expect(calls).toEqual(['did:plc:viewer:did:plc:target']);
  });
});
