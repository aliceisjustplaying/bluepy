/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

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

void test('preference subscribers receive fresh values and can unsubscribe', async () => {
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
    seen.push(getPreferenceSnapshot());
  });

  setPreferences({ atprotoLabelerDids: ['did:plc:labeler'] });
  assert.deepEqual(seen, [{ atprotoLabelerDids: ['did:plc:labeler'] }]);
  const snapshot = getPreferenceSnapshot();
  getPreferences.cache.clear();
  assert.equal(getPreferenceSnapshot(), snapshot);

  unsubscribe();
  setPreferences({ atprotoLabelerDids: ['did:plc:other'] });
  assert.deepEqual(seen, [{ atprotoLabelerDids: ['did:plc:labeler'] }]);
});
