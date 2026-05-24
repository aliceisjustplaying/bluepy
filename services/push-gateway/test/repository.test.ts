import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, openDb } from '../src/db.js';
import { deleteAccountData, getSettings, hasActiveRecipients, pruneExpiredData, registerSubscription, unregisterSubscription, upsertSettings } from '../src/repository.js';

void test('settings, registration idempotence, unregister, same endpoint for two DIDs, delete all', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.deepEqual(getSettings(db, 'did:plc:a'), { enabled: false, repliesEnabled: true, mentionsEnabled: true, richPreviewsEnabled: true });
  upsertSettings(db, 'did:plc:a', { enabled: true });
  const body = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  registerSubscription(db, 'secret', 'did:plc:a', body, 'k1');
  registerSubscription(db, 'secret', 'did:plc:a', body, 'k1');
  registerSubscription(db, 'secret', 'did:plc:b', body, 'k1');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get() as { count: number }).count, 2);
  unregisterSubscription(db, 'secret', 'did:plc:a', body.endpoint);
  assert.equal((db.prepare('SELECT active FROM subscriptions WHERE did = ?').get('did:plc:a') as { active: number }).active, 0);
  deleteAccountData(db, 'did:plc:b');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE did = ?').get('did:plc:b') as { count: number }).count, 0);
});

void test('delete-all keeps auth replay tokens until retention pruning', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare('INSERT INTO used_auth_tokens (token_hash, did, lxm, expires_at) VALUES (?, ?, ?, ?)').run(
    'token-hash',
    'did:plc:a',
    'social.bluepy.push.deleteaccountdata',
    '2026-05-24T01:00:00.000Z',
  );

  deleteAccountData(db, 'did:plc:a');

  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM used_auth_tokens WHERE did = ?').get('did:plc:a') as { count: number }).count, 1);
});

void test('active recipients require an enabled account and active subscription', () => {
  const db = openDb(':memory:');
  migrate(db);
  const body = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };

  assert.equal(hasActiveRecipients(db), false);
  registerSubscription(db, 'secret', 'did:plc:a', body, 'k1');
  assert.equal(hasActiveRecipients(db), false);
  upsertSettings(db, 'did:plc:a', { enabled: true });
  assert.equal(hasActiveRecipients(db), true);
  unregisterSubscription(db, 'secret', 'did:plc:a', body.endpoint);
  assert.equal(hasActiveRecipients(db), false);
});

void test('retention prunes old delivery rows and rich snapshots', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare(
    `INSERT INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did, actor_handle, actor_display_name, text_excerpt, created_at)
     VALUES (?, 'mention', ?, 'cid-recent', 'did:plc:actor', 'actor.test', 'Actor', 'hello', ?)`,
  ).run('did:plc:a', 'at://did:plc:actor/app.bsky.feed.post/recent', '2026-05-22T00:00:00.000Z');
  db.prepare(
    `INSERT INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did, created_at)
     VALUES (?, 'mention', ?, 'cid-old', 'did:plc:actor', ?)`,
  ).run('did:plc:a', 'at://did:plc:actor/app.bsky.feed.post/old', '2026-05-01T00:00:00.000Z');

  pruneExpiredData(db, new Date('2026-05-24T00:00:00.000Z'));

  assert.deepEqual(
    db.prepare('SELECT actor_handle, actor_display_name, text_excerpt FROM notification_events WHERE source_cid = ?').get('cid-recent'),
    { actor_handle: null, actor_display_name: null, text_excerpt: null },
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM notification_events WHERE source_cid = ?').get('cid-old') as { count: number }).count, 0);
});
