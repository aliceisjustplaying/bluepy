import { afterEach, mock, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';

import worker, { FeedbackRateLimiter } from '../workers/assets.js';

afterEach(() => {
  mock.restore();
});

class MemoryDurableObjectStorage {
  constructor() {
    this.entries = new Map();
    this.alarmTime = null;
  }

  setAlarm(alarmTime) {
    this.alarmTime = alarmTime;
  }

  deleteAll() {
    this.entries.clear();
  }

  transaction(callback) {
    const transaction = {
      get: async (keys) =>
        new Map(keys.map((key) => [key, this.entries.get(key)])),
      put: async (updates) => {
        for (const [key, value] of Object.entries(updates)) {
          this.entries.set(key, value);
        }
      },
    };
    return callback(transaction);
  }
}

function createLimiterNamespace() {
  const limiters = new Map();
  return {
    idFromName: (name) => name,
    get: (id) => {
      if (!limiters.has(id)) {
        limiters.set(
          id,
          new FeedbackRateLimiter({
            storage: new MemoryDurableObjectStorage(),
          }),
        );
      }
      return limiters.get(id);
    },
  };
}

function createEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response('asset', { status: 404 }),
    },
    BLUEPY_FEEDBACK_TO: 'linear-intake@example.com',
    RESEND_API_KEY: 'test-key',
    FEEDBACK_RATE_LIMITER: createLimiterNamespace(),
    ...overrides,
  };
}

function postFeedback(body, env = createEnv(), headers = {}) {
  return worker.fetch(
    new Request('https://bluepy.social/api/feedback', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
    env,
  );
}

test('feedback endpoint sends Resend email with Linear target and diagnostics', async () => {
  const calls = [];
  spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push([input, init]);
    return new Response('{}', { status: 200 });
  });

  const response = await postFeedback({
    message: 'Timeline failed to load',
    contact: 'alice@example.com',
    page: 'https://bluepy.social/following',
    account: 'alice.test / did:plc:alice',
    pds: 'bsky.social',
    build: 'abc123',
    sentryEventId: 'event-1',
    viewport: '390x844',
    userAgent: 'Test Browser',
  });

  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.Authorization, 'Bearer test-key');
  const payload = JSON.parse(init.body);
  assert.deepEqual(payload.to, ['linear-intake@example.com']);
  assert.equal(payload.reply_to, 'alice@example.com');
  assert.match(payload.text, /Timeline failed to load/);
  assert.match(payload.text, /Page: https:\/\/bluepy\.social\/following/);
  assert.match(payload.text, /Account: alice\.test \/ did:plc:alice/);
  assert.match(payload.text, /Sentry event: event-1/);
});

test('feedback endpoint rejects invalid and abusive requests before sending', async () => {
  const calls = [];
  spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push([input, init]);
    return new Response('{}', { status: 200 });
  });

  assert.equal((await postFeedback({})).status, 400);
  assert.equal((await postFeedback('{bad json')).status, 400);
  assert.equal(
    (
      await postFeedback({ message: 'hi' }, createEnv(), {
        'content-type': 'text/plain',
      })
    ).status,
    415,
  );
  assert.equal(
    (await postFeedback({ message: 'hi', hp: 'filled' })).status,
    204,
  );
  assert.equal(calls.length, 0);
});

test('feedback endpoint rejects method, size, and missing config before sending', async () => {
  const calls = [];
  spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push([input, init]);
    return new Response('{}', { status: 200 });
  });

  assert.equal(
    (
      await worker.fetch(
        new Request('https://bluepy.social/api/feedback', {
          method: 'GET',
        }),
        createEnv(),
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await postFeedback({
        message: 'x'.repeat(17_000),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await postFeedback(
        { message: 'hello' },
        createEnv({ RESEND_API_KEY: undefined }),
      )
    ).status,
    503,
  );
  assert.equal(calls.length, 0);
});

test('feedback endpoint proxies when email config is missing and proxy is configured', async () => {
  const calls = [];
  spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push([input, init]);
    return new Response(null, { status: 204 });
  });

  const response = await postFeedback(
    { message: 'hello' },
    createEnv({
      BLUEPY_FEEDBACK_PROXY_URL: 'https://dev.bluepy.social/api/feedback',
      RESEND_API_KEY: undefined,
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].url, 'https://dev.bluepy.social/api/feedback');
  assert.equal(calls[0][0].method, 'POST');
  assert.deepEqual(await calls[0][0].json(), { message: 'hello' });
});

test('feedback endpoint refunds rate limit when Resend fails', async () => {
  let calls = 0;
  spyOn(globalThis, 'fetch').mockImplementation(async () => {
    calls += 1;
    return new Response('{}', { status: calls === 1 ? 500 : 200 });
  });

  const env = createEnv();
  const headers = { 'CF-Connecting-IP': '203.0.113.10' };
  const responses = [
    await postFeedback({ message: 'first' }, env, headers),
    await postFeedback({ message: 'second' }, env, headers),
    await postFeedback({ message: 'third' }, env, headers),
    await postFeedback({ message: 'fourth' }, env, headers),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [502, 204, 204, 429],
  );
});

test('feedback endpoint refunds rate limit when Resend throws', async () => {
  let calls = 0;
  spyOn(globalThis, 'fetch').mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new Error('network failed');
    return new Response('{}', { status: 200 });
  });

  const env = createEnv();
  const headers = { 'CF-Connecting-IP': '203.0.113.10' };
  const responses = [
    await postFeedback({ message: 'first' }, env, headers),
    await postFeedback({ message: 'second' }, env, headers),
    await postFeedback({ message: 'third' }, env, headers),
    await postFeedback({ message: 'fourth' }, env, headers),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [502, 204, 204, 429],
  );
});

test('feedback endpoint rate limits repeated submissions', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response('{}', { status: 200 }),
  );

  const env = createEnv();
  const headers = { 'CF-Connecting-IP': '203.0.113.10' };
  const responses = [
    await postFeedback({ message: 'one' }, env, headers),
    await postFeedback({ message: 'two' }, env, headers),
    await postFeedback({ message: 'three' }, env, headers),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [204, 204, 429],
  );
});

test('feedback endpoint rate limit contact bucket is scoped to client address', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response('{}', { status: 200 }),
  );

  const env = createEnv();
  const body = { message: 'same bug', contact: 'alice@example.com' };
  const responses = [
    await postFeedback(body, env, { 'CF-Connecting-IP': '203.0.113.10' }),
    await postFeedback(body, env, { 'CF-Connecting-IP': '203.0.113.10' }),
    await postFeedback(body, env, { 'CF-Connecting-IP': '203.0.113.11' }),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [204, 204, 204],
  );
});

test('feedback endpoint returns unavailable when rate limiter fails', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response('{}', { status: 200 }),
  );

  const response = await postFeedback(
    { message: 'hello' },
    createEnv({
      FEEDBACK_RATE_LIMITER: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => new Response('oops', { status: 500 }),
        }),
      },
    }),
  );

  assert.equal(response.status, 503);
});

test('feedback rate limiter clears storage on alarm', async () => {
  const storage = new MemoryDurableObjectStorage();
  const limiter = new FeedbackRateLimiter({ storage });
  const response = await limiter.fetch(
    new Request('https://feedback-rate-limiter/check', {
      method: 'POST',
      body: JSON.stringify({
        action: 'check',
        keys: ['feedback:ip'],
        limit: 2,
        periodMs: 60_000,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(storage.entries.size, 1);
  assert.ok(storage.alarmTime);

  await limiter.alarm();

  assert.equal(storage.entries.size, 0);
});
