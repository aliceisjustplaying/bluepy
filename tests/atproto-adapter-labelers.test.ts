import assert from 'node:assert/strict';
import { test } from 'bun:test';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function getDetailedLabelerView(did: string) {
  return {
    uri: `at://${did}/app.bsky.labeler.service/self`,
    cid: 'bafyreicustom',
    creator: {
      did,
      handle: 'labels.example.com',
      displayName: 'Custom Labels',
      avatar: 'https://example.com/avatar.jpg',
    },
    indexedAt: '2026-05-20T00:00:00.000Z',
    policies: {
      labelValues: ['curated'],
      labelValueDefinitions: [
        {
          identifier: 'curated',
          severity: 'inform',
          blurs: 'none',
          defaultSetting: 'warn',
          locales: [
            {
              lang: 'en',
              name: 'Curated',
              description: 'Reviewed by the custom labeler.',
            },
          ],
        },
      ],
    },
  };
}

test('adapter labeler helpers normalize preferences and metadata', async () => {
  const globalKeys = [
    'document',
    'localStorage',
    'navigator',
    'sessionStorage',
    'window',
  ] as const;
  const originalGlobals = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { cookie: '' },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createStorage(),
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        cookieEnabled: true,
        locks: {
          request: async (_name: string, callback: () => unknown) => callback(),
        },
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __IGNORE_GET_ACCOUNT_ERROR__: true,
        matchMedia: () => ({ matches: false }),
      },
    });

    const { saveAccount, setCurrentAccountID } =
      await import('../src/utils/store-utils');
    saveAccount({
      accessToken: 'token',
      info: { id: 'did:plc:account' },
      instanceURL: 'bsky.social',
    });
    setCurrentAccountID('did:plc:account');

    const store = (await import('../src/utils/store')).default;
    const {
      fetchAtprotoLabelerMetadata,
      getAtprotoLabelerDids,
      getStoredAtprotoLabelerDids,
    } = await import('../src/utils/atproto-adapter');

    store.account.set('preferences', {
      atprotoLabelerDids: [
        'did:plc:stored',
        'did:plc:stored',
        { did: 'did:plc:app' },
      ],
    });
    assert.deepEqual(
      getStoredAtprotoLabelerDids({
        appLabelers: ['did:plc:app'],
        configureLabelers: () => undefined,
      }),
      ['did:plc:stored'],
    );

    store.account.set('preferences', {
      moderationPrefs: {
        labelers: [{ did: 'did:plc:fallback' }, { did: 'did:plc:app' }],
      },
    });
    assert.deepEqual(
      getStoredAtprotoLabelerDids({
        appLabelers: ['did:plc:app'],
        configureLabelers: () => undefined,
      }),
      ['did:plc:fallback'],
    );
    assert.deepEqual(
      getAtprotoLabelerDids(
        { moderationPrefs: { labelers: ['did:plc:pref', 'did:plc:app'] } },
        {
          appLabelers: ['did:plc:app'],
          configureLabelers: () => undefined,
        },
      ),
      ['did:plc:pref'],
    );

    const calls: unknown[] = [];
    const metadata = await fetchAtprotoLabelerMetadata(
      {
        appLabelers: ['did:plc:app'],
        getLabelers: async (params: { dids: string[]; detailed?: boolean }) => {
          calls.push(params);
          return {
            data: {
              views: [
                getDetailedLabelerView('did:plc:custom'),
                { creator: { did: 'did:plc:missing-policies' } },
              ],
            },
          };
        },
      },
      ['did:plc:custom', 'did:plc:custom'],
    );

    assert.deepEqual(calls, [
      {
        dids: ['did:plc:app', 'did:plc:custom'],
        detailed: true,
      },
    ]);
    assert.deepEqual(metadata.labelers, {
      'did:plc:custom': {
        did: 'did:plc:custom',
        handle: 'labels.example.com',
        displayName: 'Custom Labels',
        avatar: 'https://example.com/avatar.jpg',
      },
    });
    assert.equal(
      metadata.labelDefs['did:plc:custom']?.[0]?.identifier,
      'curated',
    );
    assert.deepEqual(
      await fetchAtprotoLabelerMetadata(
        {
          getLabelDefinitions: async () => {
            throw new Error('unavailable');
          },
        },
        ['did:plc:custom'],
      ),
      { labelDefs: {}, labelers: {} },
    );
  } finally {
    globalKeys.forEach((key) => {
      const descriptor = originalGlobals.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    });
  }
});
