import webpush from 'web-push';
import type { VapidKeyPair } from './config.js';
import type { Db } from './db.js';
import { buildPayload, payloadBytes } from './payload.js';
import { sanitizeError } from './privacy.js';

export type FailureClass = 'gone' | 'payload_too_large' | 'transient' | 'permanent';

interface DeliveryAttemptRow {
  id: number;
  event_id: number;
  recipient_did: string;
  type: 'reply' | 'mention';
  source_at_uri: string;
  actor_did: string;
  actor_handle: string | null;
  actor_display_name: string | null;
  text_excerpt: string | null;
  subscription_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  vapid_key_id: string;
  enabled: number | null;
  replies_enabled: number | null;
  mentions_enabled: number | null;
  rich_previews_enabled: number | null;
}

export function classifyWebPushFailure(statusCode: number | undefined): FailureClass {
  if (statusCode === undefined) return 'transient';
  if (statusCode === 404 || statusCode === 410) return 'gone';
  if (statusCode === 413) return 'payload_too_large';
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) return 'transient';
  return 'permanent';
}

export function deterministicTopic(eventId: number): string {
  return `bluepy-${eventId}`;
}

export function webPushTopic(endpoint: string, eventId: number): string | undefined {
  return new URL(endpoint).hostname === 'web.push.apple.com'
    ? undefined
    : deterministicTopic(eventId);
}

export function createDeliveryAttemptsForEvent(db: Db, notificationEventId: number, recipientDid: string): number {
  const activeSubs = db.prepare('SELECT id FROM subscriptions WHERE did = ? AND active = 1').all(recipientDid) as { id: number }[];
  const insert = db.prepare(
    `INSERT INTO delivery_attempts (notification_event_id, subscription_id, status)
     VALUES (?, ?, 'pending')
     ON CONFLICT(notification_event_id, subscription_id) DO UPDATE SET
       status = CASE
         WHEN delivery_attempts.status IN ('failed', 'gone') THEN 'pending'
         ELSE delivery_attempts.status
       END,
       next_attempt_at = CASE
         WHEN delivery_attempts.status IN ('failed', 'gone') THEN CURRENT_TIMESTAMP
         ELSE delivery_attempts.next_attempt_at
       END,
       updated_at = CURRENT_TIMESTAMP
     WHERE delivery_attempts.status IN ('failed', 'gone')`,
  );
  let created = 0;
  for (const sub of activeSubs) created += insert.run(notificationEventId, sub.id).changes;
  return created;
}

export function claimDueAttempts(db: Db, limit: number, leaseMs = 30_000): number[] {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'pending', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'sending' AND (lease_until <= ? OR lease_until IS NULL)`,
  ).run(now);
  const rows = db
    .prepare(
      `SELECT id FROM delivery_attempts
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY created_at
       LIMIT ?`,
    )
    .all(now, limit) as { id: number }[];
  const update = db.prepare(
    `UPDATE delivery_attempts
     SET status = 'sending', lease_until = ?, attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`,
  );
  return rows.flatMap((row) => (update.run(leaseUntil, row.id).changes ? [row.id] : []));
}

export function scheduleTransientRetry(db: Db, attemptId: number, error: unknown, maxAttempts = 5): void {
  const row = db.prepare('SELECT attempt_count FROM delivery_attempts WHERE id = ?').get(attemptId) as
    | { attempt_count: number }
    | undefined;
  const attempts = row?.attempt_count ?? maxAttempts;
  if (attempts >= maxAttempts) {
    db.prepare("UPDATE delivery_attempts SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      sanitizeError(error),
      attemptId,
    );
    return;
  }
  const delaySeconds = Math.min(300, 2 ** Math.max(0, attempts - 1) * 30);
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'pending', next_attempt_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(nextAttemptAt, sanitizeError(error), attemptId);
}

export async function sendDueAttempts(
  db: Db,
  options: {
    limit: number;
    vapid: { subject: string; keys: Record<string, VapidKeyPair> };
    richPreviewsEnabled: boolean;
  },
): Promise<number> {
  const attemptIds = claimDueAttempts(db, options.limit);
  for (const attemptId of attemptIds) {
    await sendAttempt(db, attemptId, options.vapid, options.richPreviewsEnabled);
  }
  return attemptIds.length;
}

export async function sendAttempt(db: Db, attemptId: number, vapid: { subject: string; keys: Record<string, VapidKeyPair> }, richPreviewsEnabled: boolean) {
  const row = db
    .prepare(
      `SELECT da.id, ne.id AS event_id, ne.recipient_did, ne.type, ne.source_at_uri, ne.actor_did,
              ne.actor_handle, ne.actor_display_name, ne.text_excerpt,
              s.id AS subscription_id, s.endpoint, s.p256dh, s.auth, s.vapid_key_id,
              st.enabled, st.replies_enabled, st.mentions_enabled, st.rich_previews_enabled
       FROM delivery_attempts da
       JOIN notification_events ne ON ne.id = da.notification_event_id
       JOIN subscriptions s ON s.id = da.subscription_id
       LEFT JOIN settings st ON st.did = ne.recipient_did
       WHERE da.id = ?`,
    )
    .get(attemptId) as DeliveryAttemptRow | undefined;
  if (!row) return;
  const typeEnabled = row.type === 'reply' ? row.replies_enabled : row.mentions_enabled;
  if (!row.enabled || !typeEnabled) {
    db.prepare("UPDATE delivery_attempts SET status = 'failed', last_error = 'disabled_by_settings', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(attemptId);
    return;
  }
  const vapidKey = vapid.keys[row.vapid_key_id];
  if (!vapidKey) {
    db.prepare("UPDATE delivery_attempts SET status = 'failed', last_error = 'vapid_key_unavailable', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(attemptId);
    return;
  }
  try {
    const rich = richPreviewsEnabled && Boolean(row.rich_previews_enabled);
    const payload = buildPayload(
      {
        notificationId: String(row.event_id),
        recipientDid: row.recipient_did,
        type: row.type,
        targetAtUri: row.source_at_uri,
        actorDid: row.actor_did,
        actorHandle: row.actor_handle ?? undefined,
        actorDisplayName: row.actor_display_name ?? undefined,
        textExcerpt: row.text_excerpt ?? undefined,
      },
      rich,
    );
    const bytes = payloadBytes(payload);
    if (bytes > 4096) {
      db.prepare("UPDATE delivery_attempts SET status = 'failed', last_error = 'payload_too_large', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(attemptId);
      return;
    }
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 6,
        urgency: 'normal',
        topic: webPushTopic(row.endpoint, row.event_id),
        vapidDetails: {
          subject: vapid.subject,
          publicKey: vapidKey.publicKey,
          privateKey: vapidKey.privateKey,
        },
      },
    );
    db.prepare("UPDATE delivery_attempts SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(attemptId);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'invalid_target_at_uri') {
      db.prepare("UPDATE delivery_attempts SET status = 'failed', last_error = 'invalid_target_at_uri', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(attemptId);
      return;
    }
    const statusCode =
      typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : undefined;
    const klass = classifyWebPushFailure(statusCode);
    if (klass === 'gone') db.prepare('UPDATE subscriptions SET active = 0, inactive_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.subscription_id);
    if (klass === 'transient') {
      scheduleTransientRetry(db, attemptId, error);
      return;
    }
    db.prepare('UPDATE delivery_attempts SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      klass === 'gone' ? 'gone' : 'failed',
      sanitizeError(error),
      attemptId,
    );
  }
}
