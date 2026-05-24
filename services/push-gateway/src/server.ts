import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, type GatewayConfig } from './config.js';
import { LXM, verifyServiceAuth, type AuthContext } from './auth.js';
import { openDb, migrate, type Db } from './db.js';
import { createDeliveryAttemptsForEvent, sendDueAttempts } from './delivery.js';
import { createAdminTestEvent, deleteAccountData, getCurrentSubscription, getSettings, pruneExpiredData, registerSubscription, unregisterSubscription, upsertSettings } from './repository.js';
import type { SettingsInput } from './repository.js';
import { consumeJetstream } from './jetstream.js';
import { sanitizeError } from './privacy.js';

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024) throw new Error('body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function errorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 400;
  if (['invalid_auth_token', 'missing_auth', 'missing_dev_did', 'invalid_auth_subject', 'invalid_auth_audience', 'invalid_auth_method', 'expired_auth_token', 'invalid_auth_signature', 'unsupported_auth_alg', 'replayed_auth_token'].includes(error.message)) {
    return 401;
  }
  return 400;
}

function publicError(error: unknown): string {
  if (!(error instanceof Error)) return 'bad_request';
  if (
    [
      'admin_only',
      'body_too_large',
      'expired_auth_token',
      'invalid_auth_audience',
      'invalid_auth_method',
      'invalid_auth_signature',
      'invalid_auth_subject',
      'invalid_auth_token',
      'invalid_did',
      'json_required',
      'localhost_only',
      'missing_auth',
      'missing_dev_did',
      'push_disabled',
      'replayed_auth_token',
      'unsupported_auth_alg',
    ].includes(error.message)
  ) {
    return error.message;
  }
  return 'bad_request';
}

function tokenEquals(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(`Bearer ${expected}`);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function settingsInput(value: unknown): SettingsInput {
  const body = value as Record<string, unknown>;
  const input: SettingsInput = {};
  if (typeof body.enabled === 'boolean') input.enabled = body.enabled;
  if (typeof body.repliesEnabled === 'boolean') input.repliesEnabled = body.repliesEnabled;
  if (typeof body.mentionsEnabled === 'boolean') input.mentionsEnabled = body.mentionsEnabled;
  if (typeof body.richPreviewsEnabled === 'boolean') input.richPreviewsEnabled = body.richPreviewsEnabled;
  return input;
}

function endpointInput(value: unknown): string {
  const body = value as Record<string, unknown>;
  return typeof body.endpoint === 'string' ? body.endpoint : '';
}

function cors(req: http.IncomingMessage, config: GatewayConfig): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'origin',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
  };
}

function metrics(db: Db): string {
  const activeSubscriptions = (db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE active = 1').get() as { count: number }).count;
  const attemptRows = db.prepare('SELECT status, COUNT(*) AS count FROM delivery_attempts GROUP BY status').all() as { status: string; count: number }[];
  const eventRows = db.prepare('SELECT type, COUNT(*) AS count FROM notification_events GROUP BY type').all() as { type: string; count: number }[];
  const lines = [
    '# HELP subscriptions_active Active push subscriptions',
    '# TYPE subscriptions_active gauge',
    `subscriptions_active ${activeSubscriptions}`,
    '# HELP delivery_attempts_total Delivery attempts by status',
    '# TYPE delivery_attempts_total gauge',
    ...attemptRows.map((row) => `delivery_attempts_total{status="${row.status}"} ${row.count}`),
    '# HELP notification_events_total Notification events by type',
    '# TYPE notification_events_total gauge',
    ...eventRows.map((row) => `notification_events_total{type="${row.type}"} ${row.count}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function requireAuth(req: http.IncomingMessage, db: Db, config: GatewayConfig, lxm: (typeof LXM)[keyof typeof LXM]): Promise<AuthContext> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw new Error('missing_auth');
  if (process.env.NODE_ENV !== 'production' && config.devAuthToken && auth === `Bearer ${config.devAuthToken}`) {
    const did = req.headers['x-dev-did'];
    if (typeof did !== 'string' || !did.startsWith('did:')) throw new Error('missing_dev_did');
    return { did, lxm };
  }
  return await verifyServiceAuth({
    db,
    rawToken: auth.slice('Bearer '.length),
    expectedAud: config.serviceDid,
    expectedLxm: lxm,
    allowUnsignedDevTokens: process.env.NODE_ENV !== 'production' && process.env.ALLOW_UNSIGNED_DEV_TOKENS === '1',
  });
}

export function createServer(db: Db, config: GatewayConfig): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res, db, config);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, db: Db, config: GatewayConfig): Promise<void> {
  const headers = cors(req, config);
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'OPTIONS') return send(res, 204, {}, headers);
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true }, headers);
    if (req.method === 'GET' && url.pathname === '/vapid-public-key') {
      return send(res, 200, { keyId: config.activeVapidKeyId, publicKey: config.vapidPublicKey }, headers);
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
      const remote = req.socket.remoteAddress;
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return send(res, 403, { error: 'localhost_only' }, headers);
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(metrics(db));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/settings') {
      const auth = await requireAuth(req, db, config, LXM['GET /settings']);
      return send(res, 200, getSettings(db, auth.did), headers);
    }
    if (req.method === 'PUT' && url.pathname === '/settings') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('json_required');
      const auth = await requireAuth(req, db, config, LXM['PUT /settings']);
      return send(res, 200, upsertSettings(db, auth.did, settingsInput(await readJson(req))), headers);
    }
    if (req.method === 'POST' && url.pathname === '/subscriptions') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('json_required');
      const auth = await requireAuth(req, db, config, LXM['POST /subscriptions']);
      const sub = registerSubscription(db, config.logHashSecret, auth.did, await readJson(req), config.activeVapidKeyId, req.headers['user-agent']);
      return send(res, 200, { subscription: sub }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/subscriptions/current') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('json_required');
      const auth = await requireAuth(req, db, config, LXM['GET /settings']);
      const body = await readJson(req);
      return send(res, 200, getCurrentSubscription(db, config.logHashSecret, auth.did, endpointInput(body)), headers);
    }
    if (req.method === 'POST' && url.pathname === '/subscriptions/unregister') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('json_required');
      const auth = await requireAuth(req, db, config, LXM['POST /subscriptions/unregister']);
      const body = await readJson(req);
      unregisterSubscription(db, config.logHashSecret, auth.did, endpointInput(body));
      return send(res, 200, { ok: true }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/subscriptions/delete-all-for-account') {
      const auth = await requireAuth(req, db, config, LXM['POST /subscriptions/delete-all-for-account']);
      deleteAccountData(db, auth.did);
      return send(res, 200, { ok: true }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/admin/test-send') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('json_required');
      const adminAuth = tokenEquals(req.headers.authorization, config.adminToken);
      if (!adminAuth) return send(res, 403, { error: 'admin_only' }, headers);
      const body = await readJson(req);
      const did = typeof (body as { did?: unknown }).did === 'string' ? (body as { did: string }).did : '';
      if (!did.startsWith('did:')) throw new Error('invalid_did');
      if (!getSettings(db, did).enabled) return send(res, 400, { error: 'push_disabled' }, headers);
      const event = createAdminTestEvent(db, did);
      const attempts = createDeliveryAttemptsForEvent(db, event.id, did);
      const sent = await sendDueAttempts(db, {
        limit: 50,
        vapid: {
          subject: config.vapidSubject,
          keys: config.vapidKeys,
        },
        richPreviewsEnabled: config.richPreviewsEnabled,
      });
      return send(res, 202, { accepted: true, notificationEventId: event.id, attempts, sent }, headers);
    }
    return send(res, 404, { error: 'not_found' }, headers);
  } catch (error) {
    return send(res, errorStatus(error), { error: publicError(error) }, headers);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const db = openDb(config.databasePath);
  migrate(db);
  const abort = new AbortController();
  process.on('SIGTERM', () => {
    abort.abort();
  });
  process.on('SIGINT', () => {
    abort.abort();
  });
  let deliveryInFlight = false;
  const deliverDue = async () => {
    if (deliveryInFlight) return;
    deliveryInFlight = true;
    try {
      await sendDueAttempts(db, {
        limit: 100,
        vapid: {
          subject: config.vapidSubject,
          keys: config.vapidKeys,
        },
        richPreviewsEnabled: config.richPreviewsEnabled,
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'push_delivery_error', error: sanitizeError(error) }));
    } finally {
      deliveryInFlight = false;
    }
  };
  const deliveryInterval = setInterval(() => {
    void deliverDue();
  }, 5_000);
  const pruneInterval = setInterval(() => {
    pruneExpiredData(db);
  }, 60 * 60 * 1000);
  const server = createServer(db, config);
  abort.signal.addEventListener('abort', () => {
    clearInterval(deliveryInterval);
    clearInterval(pruneInterval);
    server.close();
  });
  void consumeJetstream(db, {
    url: config.jetstreamUrl,
    signal: abort.signal,
    onResult: () => {
      void deliverDue();
    },
    onError: (error) => {
      console.error(JSON.stringify({ event: 'jetstream_error', error: sanitizeError(error) }));
    },
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'jetstream_stopped', error: sanitizeError(error) }));
  });
  server.listen(config.port, () => {
    console.log(JSON.stringify({ event: 'push_gateway_started', port: config.port }));
  });
}
