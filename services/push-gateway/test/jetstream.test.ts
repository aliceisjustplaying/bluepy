import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, openDb } from '../src/db.js';
import { processJetstreamEvent, processJetstreamEventWithProfileCache, resumeCursorUs } from '../src/jetstream.js';
import { registerSubscription, upsertSettings } from '../src/repository.js';

const subscription = {
  endpoint: 'https://push.example/sub',
  keys: { p256dh: 'p', auth: 'a' },
};

void test('creates per-device attempts and preserves unsent devices on replay', () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:recipient', { enabled: true });
  registerSubscription(db, 'secret', 'did:plc:recipient', subscription, 'k1');
  registerSubscription(
    db,
    'secret',
    'did:plc:recipient',
    { ...subscription, endpoint: 'https://push.example/sub2' },
    'k1',
  );

  const event = {
    kind: 'commit',
    did: 'did:plc:author',
    time_us: 1_000_000,
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
      cid: 'cid1',
      record: {
        text: 'hello',
        reply: {
          parent: { uri: 'at://did:plc:recipient/app.bsky.feed.post/root' },
        },
      },
    },
  };

  const first = processJetstreamEvent(db, event);
  assert.equal(first.events, 1);
  assert.equal(first.attempts, 2);

  db.prepare('DELETE FROM delivery_attempts WHERE subscription_id = 2').run();
  const replay = processJetstreamEvent(db, event);
  assert.equal(replay.events, 1);
  assert.equal(replay.attempts, 1);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM delivery_attempts').get() as { count: number }).count,
    2,
  );
});

void test('drops disabled recipients and resumes with replay window', () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:recipient', { enabled: false });
  registerSubscription(db, 'secret', 'did:plc:recipient', subscription, 'k1');
  const result = processJetstreamEvent(db, {
    kind: 'commit',
    did: 'did:plc:author',
    time_us: 80_000_000,
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
      cid: 'cid1',
      record: {
        text: 'hello',
        facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:recipient' }] }],
      },
    },
  });
  assert.equal(result.dropped, 1);
  assert.equal(resumeCursorUs(db), 20_000_000);
});

void test('fresh gateways start near now instead of replaying old Jetstream history', () => {
  const db = openDb(':memory:');
  migrate(db);
  const before = Date.now() * 1000 - 60_000_000;
  const cursor = resumeCursorUs(db);
  const after = Date.now() * 1000;

  assert.ok(cursor >= before);
  assert.ok(cursor <= after);
});

void test('profile fetch is skipped when candidates are not active recipients', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('unexpected profile fetch');
  }) as typeof fetch;
  try {
    const result = await processJetstreamEventWithProfileCache(db, {
      kind: 'commit',
      did: 'did:plc:author',
      time_us: 80_000_000,
      commit: {
        operation: 'create',
        collection: 'app.bsky.feed.post',
        rkey: 'abc',
        cid: 'cid1',
        record: {
          text: 'hello',
          facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:recipient' }] }],
        },
      },
    });
    assert.equal(result.dropped, 1);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
