CREATE TABLE IF NOT EXISTS settings (
  did TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  replies_enabled INTEGER NOT NULL DEFAULT 1,
  mentions_enabled INTEGER NOT NULL DEFAULT 1,
  rich_previews_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  did TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  vapid_key_id TEXT NOT NULL,
  user_agent TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inactive_at TEXT,
  UNIQUE(did, endpoint_hash)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_did_active ON subscriptions(did, active);
CREATE INDEX IF NOT EXISTS idx_subscriptions_endpoint_hash ON subscriptions(endpoint_hash);

CREATE TABLE IF NOT EXISTS notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_did TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reply', 'mention')),
  source_at_uri TEXT NOT NULL,
  source_cid TEXT NOT NULL,
  actor_did TEXT NOT NULL,
  actor_handle TEXT,
  actor_display_name TEXT,
  text_excerpt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recipient_did, type, source_at_uri, source_cid)
);

CREATE INDEX IF NOT EXISTS idx_notification_events_recipient ON notification_events(recipient_did, created_at);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_event_id INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'gone')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until TEXT,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(notification_event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_due ON delivery_attempts(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS jetstream_state (
  id TEXT PRIMARY KEY,
  last_processed_time_us INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_cache (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS used_auth_tokens (
  token_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  lxm TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_used_auth_tokens_expires ON used_auth_tokens(expires_at);
