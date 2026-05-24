import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';
import { claimDueAttempts, scheduleTransientRetry, sendAttempt, webPushTopic } from '../src/delivery.js';
import { migrate, openDb } from '../src/db.js';
import { createDeliveryAttemptsForEvent } from '../src/delivery.js';
import { registerSubscription, upsertNotificationEvent, upsertSettings } from '../src/repository.js';

void test('delivery fails fast when a subscription uses an unavailable VAPID key', async () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:target', { enabled: true, mentionsEnabled: true });
  registerSubscription(
    db,
    'secret',
    'did:plc:target',
    { endpoint: 'https://push.example/one', keys: { p256dh: 'p', auth: 'a' } },
    'old-key',
  );
  const event = upsertNotificationEvent(db, {
    recipientDid: 'did:plc:target',
    type: 'mention',
    sourceAtUri: 'at://did:plc:actor/app.bsky.feed.post/1',
    sourceCid: 'cid',
    actorDid: 'did:plc:actor',
    textExcerpt: '',
  });
  createDeliveryAttemptsForEvent(db, event.id, 'did:plc:target');
  const attempt = db.prepare('SELECT id FROM delivery_attempts').get() as { id: number };

  await sendAttempt(db, attempt.id, { subject: 'mailto:test@bluepy.social', keys: {} }, true);

  assert.deepEqual(db.prepare('SELECT status, last_error FROM delivery_attempts WHERE id = ?').get(attempt.id), {
    status: 'failed',
    last_error: 'vapid_key_unavailable',
  });
});

void test('transient retries back off briefly and then fail closed', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare(
    `INSERT INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did)
     VALUES ('did:plc:target', 'mention', 'at://did:plc:actor/app.bsky.feed.post/1', 'cid', 'did:plc:actor')`,
  ).run();
  db.prepare(
    `INSERT INTO subscriptions
       (did, endpoint, endpoint_hash, p256dh, auth, vapid_key_id)
     VALUES ('did:plc:target', 'https://push.example/one', 'hash', 'p', 'a', 'k1')`,
  ).run();
  db.prepare(
    `INSERT INTO delivery_attempts
       (notification_event_id, subscription_id, status, attempt_count)
     VALUES (1, 1, 'sending', 1)`,
  ).run();

  scheduleTransientRetry(db, 1, new Error('temporary upstream failure'), 2);
  const pending = db.prepare('SELECT status, last_error, next_attempt_at FROM delivery_attempts WHERE id = 1').get() as {
    status: string;
    last_error: string;
    next_attempt_at: string;
  };
  assert.equal(pending.status, 'pending');
  assert.equal(pending.last_error, 'temporary upstream failure');
  assert.notEqual(pending.next_attempt_at, null);

  db.prepare("UPDATE delivery_attempts SET status = 'sending', attempt_count = 2 WHERE id = 1").run();
  scheduleTransientRetry(db, 1, new Error('still failing'), 2);
  assert.deepEqual(db.prepare('SELECT status, last_error FROM delivery_attempts WHERE id = 1').get(), {
    status: 'failed',
    last_error: 'still failing',
  });
});

void test('expired sending leases are claimable again', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare(
    `INSERT INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did)
     VALUES ('did:plc:target', 'mention', 'at://did:plc:actor/app.bsky.feed.post/1', 'cid', 'did:plc:actor')`,
  ).run();
  db.prepare(
    `INSERT INTO subscriptions
       (did, endpoint, endpoint_hash, p256dh, auth, vapid_key_id)
     VALUES ('did:plc:target', 'https://push.example/one', 'hash', 'p', 'a', 'k1')`,
  ).run();
  db.prepare(
    `INSERT INTO delivery_attempts
       (notification_event_id, subscription_id, status, lease_until)
     VALUES (1, 1, 'sending', '2026-01-01T00:00:00.000Z')`,
  ).run();

  assert.deepEqual(claimDueAttempts(db, 10), [1]);
});

void test('invalid stored target URI fails the attempt instead of leaving it sending', async () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:target', { enabled: true, mentionsEnabled: true });
  registerSubscription(
    db,
    'secret',
    'did:plc:target',
    { endpoint: 'https://push.example/one', keys: { p256dh: 'p', auth: 'a' } },
    'k1',
  );
  db.prepare(
    `INSERT INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did)
     VALUES ('did:plc:target', 'mention', 'https://evil.example/post', 'cid', 'did:plc:actor')`,
  ).run();
  db.prepare(
    `INSERT INTO delivery_attempts
       (notification_event_id, subscription_id, status)
     VALUES (1, 1, 'sending')`,
  ).run();

  await sendAttempt(db, 1, { subject: 'mailto:test@bluepy.social', keys: { k1: { publicKey: 'public', privateKey: 'private' } } }, true);

  assert.deepEqual(db.prepare('SELECT status, last_error FROM delivery_attempts WHERE id = 1').get(), {
    status: 'failed',
    last_error: 'invalid_target_at_uri',
  });
});

void test('disabled settings stop sends before calling Web Push', async () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:target', { enabled: false, mentionsEnabled: true });
  registerSubscription(
    db,
    'secret',
    'did:plc:target',
    { endpoint: 'https://push.example/one', keys: { p256dh: 'p', auth: 'a' } },
    'k1',
  );
  const event = upsertNotificationEvent(db, {
    recipientDid: 'did:plc:target',
    type: 'mention',
    sourceAtUri: 'at://did:plc:actor/app.bsky.feed.post/1',
    sourceCid: 'cid',
    actorDid: 'did:plc:actor',
    textExcerpt: '',
  });
  createDeliveryAttemptsForEvent(db, event.id, 'did:plc:target');
  const attempt = db.prepare('SELECT id FROM delivery_attempts').get() as { id: number };
  const originalSendNotification = webpush.sendNotification;
  let called = false;
  webpush.sendNotification = (async () => {
    called = true;
    throw new Error('unexpected send');
  }) as typeof webpush.sendNotification;
  try {
    await sendAttempt(db, attempt.id, { subject: 'mailto:test@bluepy.social', keys: { k1: { publicKey: 'public', privateKey: 'private' } } }, true);
  } finally {
    webpush.sendNotification = originalSendNotification;
  }

  assert.equal(called, false);
  assert.deepEqual(db.prepare('SELECT status, last_error FROM delivery_attempts WHERE id = ?').get(attempt.id), {
    status: 'failed',
    last_error: 'disabled_by_settings',
  });
});

void test('gone Web Push responses deactivate the subscription', async () => {
  const db = openDb(':memory:');
  migrate(db);
  upsertSettings(db, 'did:plc:target', { enabled: true, mentionsEnabled: true });
  registerSubscription(
    db,
    'secret',
    'did:plc:target',
    { endpoint: 'https://push.example/one', keys: { p256dh: 'p', auth: 'a' } },
    'k1',
  );
  const event = upsertNotificationEvent(db, {
    recipientDid: 'did:plc:target',
    type: 'mention',
    sourceAtUri: 'at://did:plc:actor/app.bsky.feed.post/1',
    sourceCid: 'cid',
    actorDid: 'did:plc:actor',
    textExcerpt: '',
  });
  createDeliveryAttemptsForEvent(db, event.id, 'did:plc:target');
  const attempt = db.prepare('SELECT id FROM delivery_attempts').get() as { id: number };
  const originalSendNotification = webpush.sendNotification;
  webpush.sendNotification = (async () => {
    throw Object.assign(new Error('subscription gone'), { statusCode: 410 });
  }) as typeof webpush.sendNotification;
  try {
    await sendAttempt(db, attempt.id, { subject: 'mailto:test@bluepy.social', keys: { k1: { publicKey: 'public', privateKey: 'private' } } }, true);
  } finally {
    webpush.sendNotification = originalSendNotification;
  }

  assert.deepEqual(db.prepare('SELECT status, last_error FROM delivery_attempts WHERE id = ?').get(attempt.id), {
    status: 'gone',
    last_error: 'subscription gone',
  });
  assert.deepEqual(db.prepare('SELECT active, inactive_at IS NOT NULL AS inactive FROM subscriptions WHERE id = 1').get(), {
    active: 0,
    inactive: 1,
  });
});

void test('Apple Web Push endpoints omit coalescing topic', () => {
  assert.equal(webPushTopic('https://web.push.apple.com/Q/example', 1), undefined);
  assert.equal(webPushTopic('https://updates.push.services.mozilla.com/wpush/v2/example', 1), 'bluepy-1');
});
