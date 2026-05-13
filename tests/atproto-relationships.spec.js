import { expect, test } from '@playwright/test';

import { createAtprotoClient } from '../src/utils/atproto-adapter.js';

test.describe('ATProto relationships', () => {
  test('maps handle relationship responses through resolved DIDs', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );

      if (url.pathname.endsWith('/xrpc/app.bsky.actor.getProfiles')) {
        expect(url.searchParams.getAll('actors')).toEqual(['alice.test']);
        return Response.json({
          profiles: [
            {
              did: 'did:plc:alice',
              handle: 'alice.test',
              displayName: 'Alice',
            },
          ],
        });
      }

      if (url.pathname.endsWith('/xrpc/app.bsky.graph.getRelationships')) {
        expect(url.searchParams.getAll('others')).toEqual(['alice.test']);
        return Response.json({
          actor: 'did:plc:self',
          relationships: [
            {
              $type: 'app.bsky.graph.defs#relationship',
              did: 'did:plc:alice',
              following: 'at://did:plc:self/app.bsky.graph.follow/1',
            },
          ],
        });
      }

      return Response.json({});
    };

    try {
      const client = createAtprotoClient({
        service: 'https://bsky.social',
      });
      const relationships = await client.v1.accounts.relationships.fetch({
        id: 'alice.test',
      });

      expect(relationships).toEqual([
        expect.objectContaining({
          id: 'did:plc:alice',
          following: true,
          followedBy: false,
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not misalign relationships when a handle is unresolved', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );

      if (url.pathname.endsWith('/xrpc/app.bsky.actor.getProfiles')) {
        expect(url.searchParams.getAll('actors')).toEqual([
          'missing.test',
          'alice.test',
        ]);
        return Response.json({
          profiles: [
            {
              did: 'did:plc:alice',
              handle: 'alice.test',
              displayName: 'Alice',
            },
          ],
        });
      }

      if (url.pathname.endsWith('/xrpc/app.bsky.graph.getRelationships')) {
        expect(url.searchParams.getAll('others')).toEqual([
          'missing.test',
          'alice.test',
        ]);
        return Response.json({
          actor: 'did:plc:self',
          relationships: [
            {
              $type: 'app.bsky.graph.defs#notFoundActor',
              actor: 'missing.test',
              notFound: true,
            },
            {
              $type: 'app.bsky.graph.defs#relationship',
              did: 'did:plc:alice',
              followedBy: 'at://did:plc:alice/app.bsky.graph.follow/1',
            },
          ],
        });
      }

      return Response.json({});
    };

    try {
      const client = createAtprotoClient({
        service: 'https://bsky.social',
      });
      const relationships = await client.v1.accounts.relationships.fetch({
        id: ['missing.test', 'alice.test'],
      });

      expect(relationships).toEqual([
        expect.objectContaining({
          id: 'did:plc:alice',
          following: false,
          followedBy: true,
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
