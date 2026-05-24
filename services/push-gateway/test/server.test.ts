import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { migrate, openDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import type { GatewayConfig } from '../src/config.js';

const config: GatewayConfig = {
  port: 0,
  databasePath: ':memory:',
  allowedOrigins: new Set(['https://bluepy.social']),
  gatewayPublicUrl: 'http://127.0.0.1',
  serviceDid: 'did:web:notifications-gateway.bluepy.social',
  logHashSecret: 'secret',
  richPreviewsEnabled: true,
  activeVapidKeyId: 'k1',
  vapidPublicKey: 'public',
  vapidPrivateKey: 'private',
  vapidKeys: { k1: { publicKey: 'public', privateKey: 'private' } },
  vapidSubject: 'mailto:test@bluepy.social',
  adminToken: 'admin',
  devAuthToken: 'dev',
  jetstreamUrl: 'wss://jetstream.example',
};

async function withServer(fn: (base: string) => Promise<void>) {
  const db = openDb(':memory:');
  migrate(db);
  const server = createServer(db, config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function authHeaders(did = 'did:plc:user') {
  return {
    authorization: 'Bearer dev',
    'x-dev-did': did,
    'content-type': 'application/json',
    origin: 'https://bluepy.social',
  };
}

void test('settings require auth and round-trip by authenticated DID', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/settings`)).status, 401);
    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ enabled: true, repliesEnabled: false }),
    });
    assert.equal(put.status, 200, await put.text());
    const get = await fetch(`${base}/settings`, { headers: authHeaders() });
    assert.deepEqual(await get.json(), {
      enabled: true,
      repliesEnabled: false,
      mentionsEnabled: true,
      richPreviewsEnabled: true,
    });
  });
});

void test('preflight includes methods for configured origins', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/settings`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://bluepy.social',
        'access-control-request-method': 'PUT',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://bluepy.social');
    assert.equal(res.headers.get('access-control-allow-methods')?.includes('PUT'), true);
  });
});

void test('dev auth bypass is disabled in production', async () => {
  const previous = process.env.NODE_ENV;
  const previousUnsigned = process.env.ALLOW_UNSIGNED_DEV_TOKENS;
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_UNSIGNED_DEV_TOKENS = '1';
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/settings`, { headers: authHeaders() });
      assert.equal(res.status, 401);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (previousUnsigned === undefined) delete process.env.ALLOW_UNSIGNED_DEV_TOKENS;
    else process.env.ALLOW_UNSIGNED_DEV_TOKENS = previousUnsigned;
  }
});

void test('registration is idempotent and unregister deactivates current endpoint', async () => {
  await withServer(async (base) => {
    const body = JSON.stringify({
      endpoint: 'https://push.example/one',
      keys: { p256dh: 'p', auth: 'a' },
    });
    const first = await fetch(`${base}/subscriptions`, {
      method: 'POST',
      headers: authHeaders(),
      body,
    });
    const second = await fetch(`${base}/subscriptions`, {
      method: 'POST',
      headers: authHeaders(),
      body,
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await first.json() as { subscription: { id: number } }).subscription.id, (await second.json() as { subscription: { id: number } }).subscription.id);
    const current = await fetch(`${base}/subscriptions/current`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: 'https://push.example/one' }),
    });
    const currentBody = await current.json() as {
      registered: boolean;
      subscription: { id: number; did: string; endpoint_hash: string; active: boolean };
    };
    assert.equal(currentBody.registered, true);
    assert.deepEqual(
      {
        id: currentBody.subscription.id,
        did: currentBody.subscription.did,
        active: currentBody.subscription.active,
      },
      { id: 1, did: 'did:plc:user', active: true },
    );
    assert.equal(typeof currentBody.subscription.endpoint_hash, 'string');

    const removed = await fetch(`${base}/subscriptions/unregister`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: 'https://push.example/one' }),
    });
    assert.equal(removed.status, 200);
    const currentAfterRemove = await fetch(`${base}/subscriptions/current`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: 'https://push.example/one' }),
    });
    assert.equal((await currentAfterRemove.json() as { registered: boolean }).registered, false);
  });
});

void test('delete-all removes account data for the authenticated DID', async () => {
  await withServer(async (base) => {
    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: authHeaders('did:plc:a'),
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(put.status, 200, await put.text());
    const deleted = await fetch(`${base}/subscriptions/delete-all-for-account`, {
      method: 'POST',
      headers: authHeaders('did:plc:a'),
    });
    assert.equal(deleted.status, 200, await deleted.text());
    const get = await fetch(`${base}/settings`, { headers: authHeaders('did:plc:a') });
    assert.equal((await get.json() as { enabled: boolean }).enabled, false);
  });
});

void test('admin test-send reports disabled recipients clearly', async () => {
  await withServer(async (base) => {
    const unauthenticated = await fetch(`${base}/admin/test-send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did: 'did:plc:a' }),
    });
    assert.equal(unauthenticated.status, 403);

    const res = await fetch(`${base}/admin/test-send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin' },
      body: JSON.stringify({ did: 'did:plc:a' }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'push_disabled' });
  });
});
