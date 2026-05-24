import { isIP } from 'node:net';
import type { Db } from './db.js';
import { keyedHash } from './privacy.js';
import type { Candidate } from './candidates.js';

export interface SettingsInput {
  enabled?: boolean;
  repliesEnabled?: boolean;
  mentionsEnabled?: boolean;
  richPreviewsEnabled?: boolean;
}

const activeRecipientCache = new WeakMap<Db, { expiresAt: number; dids: Set<string> }>();

function invalidateActiveRecipients(db: Db): void {
  activeRecipientCache.delete(db);
}

export function getSettings(db: Db, did: string) {
  const row = db.prepare('SELECT * FROM settings WHERE did = ?').get(did) as Record<string, number | string> | undefined;
  return {
    enabled: Boolean(row?.enabled),
    repliesEnabled: row ? Boolean(row.replies_enabled) : true,
    mentionsEnabled: row ? Boolean(row.mentions_enabled) : true,
    richPreviewsEnabled: row ? Boolean(row.rich_previews_enabled) : true,
  };
}

export function upsertSettings(db: Db, did: string, input: SettingsInput) {
  db.prepare(
    `INSERT INTO settings (did, enabled, replies_enabled, mentions_enabled, rich_previews_enabled, updated_at)
     VALUES (?, COALESCE(?, 0), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), CURRENT_TIMESTAMP)
     ON CONFLICT(did) DO UPDATE SET
       enabled = COALESCE(?, settings.enabled),
       replies_enabled = COALESCE(?, settings.replies_enabled),
       mentions_enabled = COALESCE(?, settings.mentions_enabled),
       rich_previews_enabled = COALESCE(?, settings.rich_previews_enabled),
       updated_at = CURRENT_TIMESTAMP`,
  ).run(
    did,
    input.enabled === undefined ? null : Number(input.enabled),
    input.repliesEnabled === undefined ? null : Number(input.repliesEnabled),
    input.mentionsEnabled === undefined ? null : Number(input.mentionsEnabled),
    input.richPreviewsEnabled === undefined ? null : Number(input.richPreviewsEnabled),
    input.enabled === undefined ? null : Number(input.enabled),
    input.repliesEnabled === undefined ? null : Number(input.repliesEnabled),
    input.mentionsEnabled === undefined ? null : Number(input.mentionsEnabled),
    input.richPreviewsEnabled === undefined ? null : Number(input.richPreviewsEnabled),
  );
  invalidateActiveRecipients(db);
  return getSettings(db, did);
}

function isPrivateIpAddress(hostname: string): boolean {
  const family = isIP(hostname);
  if (family === 4) {
    const [a = 0, b = 0] = hostname.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (family === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

function validatePushEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('invalid_subscription');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isPrivateIpAddress(hostname)
  ) {
    throw new Error('invalid_subscription');
  }
}

export function registerSubscription(db: Db, secret: string, did: string, body: unknown, vapidKeyId: string, userAgent?: string) {
  const payload = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint : '';
  const p256dh = typeof payload.keys?.p256dh === 'string' ? payload.keys.p256dh : '';
  const auth = typeof payload.keys?.auth === 'string' ? payload.keys.auth : '';
  if (!endpoint || !p256dh || !auth) throw new Error('invalid_subscription');
  validatePushEndpoint(endpoint);
  const endpointHash = keyedHash(secret, endpoint);
  db.prepare(
    `INSERT INTO subscriptions (did, endpoint, endpoint_hash, p256dh, auth, vapid_key_id, user_agent, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(did, endpoint_hash) DO UPDATE SET
       endpoint = excluded.endpoint,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       vapid_key_id = excluded.vapid_key_id,
       user_agent = excluded.user_agent,
       active = 1,
       inactive_at = NULL,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(did, endpoint, endpointHash, p256dh, auth, vapidKeyId, userAgent ?? null);
  invalidateActiveRecipients(db);
  return db.prepare('SELECT id, did, endpoint_hash, active FROM subscriptions WHERE did = ? AND endpoint_hash = ?').get(did, endpointHash);
}

export function unregisterSubscription(db: Db, secret: string, did: string, endpoint: string) {
  const endpointHash = keyedHash(secret, endpoint);
  db.prepare('UPDATE subscriptions SET active = 0, inactive_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE did = ? AND endpoint_hash = ?').run(did, endpointHash);
  invalidateActiveRecipients(db);
}

export function getCurrentSubscription(db: Db, secret: string, did: string, endpoint: string) {
  const endpointHash = keyedHash(secret, endpoint);
  const row = db
    .prepare('SELECT id, did, endpoint_hash, active FROM subscriptions WHERE did = ? AND endpoint_hash = ?')
    .get(did, endpointHash) as { id: number; did: string; endpoint_hash: string; active: number } | undefined;
  return {
    registered: Boolean(row?.active),
    subscription: row
      ? {
          id: row.id,
          did: row.did,
          endpoint_hash: row.endpoint_hash,
          active: Boolean(row.active),
        }
      : null,
  };
}

export function deleteAccountData(db: Db, did: string) {
  const tx = db.transaction(() => {
    const subIds = db.prepare('SELECT id FROM subscriptions WHERE did = ?').all(did).map((row) => (row as { id: number }).id);
    for (const id of subIds) db.prepare('DELETE FROM delivery_attempts WHERE subscription_id = ?').run(id);
    db.prepare('DELETE FROM subscriptions WHERE did = ?').run(did);
    db.prepare('DELETE FROM settings WHERE did = ?').run(did);
    db.prepare('DELETE FROM notification_events WHERE recipient_did = ?').run(did);
    db.prepare('DELETE FROM profile_cache WHERE did = ?').run(did);
  });
  tx();
  invalidateActiveRecipients(db);
}

export function pruneExpiredData(db: Db, now = new Date()): void {
  const deliveryCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const richCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE notification_events
       SET actor_handle = NULL, actor_display_name = NULL, text_excerpt = NULL
       WHERE created_at < ?`,
    ).run(richCutoff);
    db.prepare('DELETE FROM delivery_attempts WHERE created_at < ?').run(deliveryCutoff);
    db.prepare('DELETE FROM notification_events WHERE created_at < ?').run(deliveryCutoff);
    db.prepare('DELETE FROM used_auth_tokens WHERE expires_at < ?').run(now.toISOString());
    db.prepare('DELETE FROM profile_cache WHERE expires_at < ?').run(now.toISOString());
  });
  tx();
}

export interface NotificationEventRow {
  id: number;
  recipient_did: string;
  type: 'reply' | 'mention';
  source_at_uri: string;
  source_cid: string;
}

export function activeRecipientDids(db: Db): Set<string> {
  const now = Date.now();
  const cached = activeRecipientCache.get(db);
  if (cached && cached.expiresAt > now) return cached.dids;
  const rows = db
    .prepare(
      `SELECT DISTINCT subscriptions.did
       FROM subscriptions
       JOIN settings ON settings.did = subscriptions.did
       WHERE subscriptions.active = 1 AND settings.enabled = 1`,
    )
    .all() as { did: string }[];
  const dids = new Set(rows.map((row) => row.did));
  activeRecipientCache.set(db, { expiresAt: now + 5_000, dids });
  return dids;
}

export function hasActiveRecipients(db: Db): boolean {
  return activeRecipientDids(db).size > 0;
}

export function upsertNotificationEvent(db: Db, candidate: Candidate): NotificationEventRow {
  db.prepare(
    `INSERT OR IGNORE INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did, actor_handle, actor_display_name, text_excerpt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    candidate.recipientDid,
    candidate.type,
    candidate.sourceAtUri,
    candidate.sourceCid,
    candidate.actorDid,
    candidate.actorHandle ?? null,
    candidate.actorDisplayName ?? null,
    candidate.textExcerpt ?? null,
  );
  return db
    .prepare(
      `SELECT id, recipient_did, type, source_at_uri, source_cid
       FROM notification_events
       WHERE recipient_did = ? AND type = ? AND source_at_uri = ? AND source_cid = ?`,
    )
    .get(candidate.recipientDid, candidate.type, candidate.sourceAtUri, candidate.sourceCid) as NotificationEventRow;
}

export function createAdminTestEvent(db: Db, did: string): NotificationEventRow {
  const sourceAtUri = `at://${did}/app.bsky.feed.post/admin-test`;
  db.prepare(
    `INSERT OR IGNORE INTO notification_events
       (recipient_did, type, source_at_uri, source_cid, actor_did, actor_handle, actor_display_name, text_excerpt)
     VALUES (?, 'mention', ?, 'admin-test', ?, 'bluepy.social', 'Bluepy', 'Push test')`,
  ).run(did, sourceAtUri, did);
  return db
    .prepare(
      `SELECT id, recipient_did, type, source_at_uri, source_cid
       FROM notification_events
       WHERE recipient_did = ? AND type = 'mention' AND source_at_uri = ? AND source_cid = 'admin-test'`,
    )
    .get(did, sourceAtUri) as NotificationEventRow;
}

export function advanceJetstreamCursor(db: Db, id: string, timeUs: number): void {
  db.prepare(
    `INSERT INTO jetstream_state (id, last_processed_time_us, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       last_processed_time_us = max(last_processed_time_us, excluded.last_processed_time_us),
       updated_at = CURRENT_TIMESTAMP`,
  ).run(id, timeUs);
}

export function getJetstreamCursor(db: Db, id: string): number {
  const row = db.prepare('SELECT last_processed_time_us FROM jetstream_state WHERE id = ?').get(id) as
    | { last_processed_time_us: number }
    | undefined;
  return row?.last_processed_time_us ?? 0;
}
