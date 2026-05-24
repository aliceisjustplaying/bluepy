import { afterEach, describe, expect, test } from 'bun:test';

const originalGlobals = {
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  navigator: globalThis.navigator,
  sessionStorage: globalThis.sessionStorage,
  window: globalThis.window,
};

function PushManager() {}

function installBrowserMocks({
  endpoint,
  storedKeyId = 'k1',
  onUpdate,
  onSubscribe,
}: {
  endpoint?: string;
  storedKeyId?: string | null;
  onUpdate?: () => void;
  onSubscribe?: () => void;
}) {
  process.env.PHANPY_PUSH_GATEWAY_URL = 'https://gateway.test/push-gateway/';
  const storage = new Map<string, string>();
  if (storedKeyId) storage.set('pushGatewayVapidKeyId', storedKeyId);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      cookieEnabled: false,
      serviceWorker: {
        getRegistration: async () => ({
          update: async () => {
            onUpdate?.();
          },
          pushManager: {
            getSubscription: async () => endpoint ? { endpoint } : null,
            subscribe: async () => {
              onSubscribe?.();
              return {
                endpoint: 'https://push.example/new',
                toJSON: () => ({
                  endpoint: 'https://push.example/new',
                  keys: { p256dh: 'p', auth: 'a' },
                }),
                unsubscribe: async () => true,
              };
            },
          },
        }),
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      PushManager,
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
}

describe('web push subscriptions', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalGlobals.fetch });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalGlobals.localStorage });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalGlobals.navigator });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: originalGlobals.sessionStorage });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalGlobals.window });
  });

  test('checks the gateway row for the active DID and endpoint', async () => {
    installBrowserMocks({ endpoint: 'https://push.example/one' });
    const requests: { url: string; body?: string; authorization?: string }[] = [];
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          body: typeof init?.body === 'string' ? init.body : undefined,
          authorization: typeof init?.headers === 'object' && init.headers
            ? (init.headers as Record<string, string>).authorization
            : undefined,
        });
        return new Response(JSON.stringify({ registered: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const { isCurrentDeviceRegistered } = await import('../src/utils/web-push-subscriptions');

    const lxmCalls: string[] = [];
    const registered = await isCurrentDeviceRegistered(async (lxm) => {
      lxmCalls.push(lxm);
      return 'service-auth';
    });

    expect(registered).toBe(true);
    expect(requests).toEqual([
      {
        url: 'https://gateway.test/push-gateway/subscriptions/current',
        body: JSON.stringify({ endpoint: 'https://push.example/one' }),
        authorization: 'Bearer service-auth',
      },
    ]);
    expect(lxmCalls).toEqual(['social.bluepy.push.getsettings']);
  });

  test('does not treat a browser subscription as registered without the gateway row', async () => {
    installBrowserMocks({ endpoint: 'https://push.example/two' });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => new Response(JSON.stringify({ registered: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const { isCurrentDeviceRegistered } = await import('../src/utils/web-push-subscriptions');

    const registered = await isCurrentDeviceRegistered(async () => 'service-auth');

    expect(registered).toBe(false);
  });

  test('updates the service worker before creating a browser subscription', async () => {
    let updated = false;
    let subscribedAfterUpdate = false;
    installBrowserMocks({
      storedKeyId: null,
      onUpdate: () => {
        updated = true;
      },
      onSubscribe: () => {
        subscribedAfterUpdate = updated;
      },
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string) => new Response(
        JSON.stringify(
          url.endsWith('/vapid-public-key')
            ? { keyId: 'k1', publicKey: 'AQID' }
            : { subscription: { id: 1 } },
        ),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    });
    const { registerCurrentDevice } = await import('../src/utils/web-push-subscriptions');

    await registerCurrentDevice(async () => 'service-auth');

    expect(subscribedAfterUpdate).toBe(true);
  });
});
