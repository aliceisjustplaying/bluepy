import assert from 'node:assert/strict';
import { test } from 'bun:test';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('preference subscribers receive fresh values and can unsubscribe', async () => {
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
  const originalConsoleError = console.error;
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

    const {
      getPreferences,
      getPreferenceSnapshot,
      setPreferences,
      subscribePreferences,
    } = await import('../src/utils/api');
    const seen: unknown[] = [];
    const unsubscribe = subscribePreferences(() => {
      seen.push(getPreferenceSnapshot() as unknown);
    });

    setPreferences({ atprotoLabelerDids: ['did:plc:labeler'] });
    assert.deepEqual([...seen], [{ atprotoLabelerDids: ['did:plc:labeler'] }]);
    const snapshot = getPreferenceSnapshot();
    getPreferences.cache.clear();
    assert.equal(getPreferenceSnapshot(), snapshot);

    unsubscribe();
    setPreferences({ atprotoLabelerDids: ['did:plc:other'] });
    assert.deepEqual([...seen], [{ atprotoLabelerDids: ['did:plc:labeler'] }]);

    const reportedErrors: unknown[] = [];
    console.error = (error?: unknown) => {
      reportedErrors.push(error);
    };
    const unsubscribeThrowing = subscribePreferences(() => {
      throw new Error('subscriber failed');
    });
    const unsubscribeHealthy = subscribePreferences(() => {
      seen.push(getPreferenceSnapshot() as unknown);
    });
    setPreferences({ atprotoLabelerDids: ['did:plc:healthy'] });
    assert.deepEqual(
      [...seen],
      [
        { atprotoLabelerDids: ['did:plc:labeler'] },
        { atprotoLabelerDids: ['did:plc:healthy'] },
      ],
    );
    assert.equal(reportedErrors.length, 1);
    unsubscribeThrowing();
    unsubscribeHealthy();
  } finally {
    console.error = originalConsoleError;
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
