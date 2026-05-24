export interface GatewayConfig {
  port: number;
  databasePath: string;
  allowedOrigins: Set<string>;
  gatewayPublicUrl: string;
  serviceDid: string;
  logHashSecret: string;
  richPreviewsEnabled: boolean;
  activeVapidKeyId: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidKeys: Record<string, VapidKeyPair>;
  vapidSubject: string;
  adminToken?: string;
  devAuthToken?: string;
  jetstreamUrl: string;
}

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function loadVapidKeys(activeKeyId: string, activePair: VapidKeyPair): Record<string, VapidKeyPair> {
  let configured: Record<string, VapidKeyPair> = {};
  if (process.env.VAPID_KEYS_JSON) {
    try {
      const parsed = JSON.parse(process.env.VAPID_KEYS_JSON) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_shape');
      configured = Object.fromEntries(
        Object.entries(parsed).map(([keyId, value]) => {
          const publicKey =
            value && typeof value === 'object'
              ? (value as { publicKey?: unknown }).publicKey
              : undefined;
          const privateKey =
            value && typeof value === 'object'
              ? (value as { privateKey?: unknown }).privateKey
              : undefined;
          if (
            !value ||
            typeof value !== 'object' ||
            typeof publicKey !== 'string' ||
            typeof privateKey !== 'string' ||
            !publicKey.trim() ||
            !privateKey.trim()
          ) {
            throw new Error('invalid_shape');
          }
          return [
            keyId,
            {
              publicKey,
              privateKey,
            },
          ];
        }),
      );
    } catch {
      throw new Error('Invalid VAPID_KEYS_JSON');
    }
  }
  return { ...configured, [activeKeyId]: activePair };
}

export function loadConfig(): GatewayConfig {
  const activeVapidKeyId = required('VAPID_KEY_ID');
  const activeVapidPair = {
    publicKey: required('VAPID_PUBLIC_KEY'),
    privateKey: required('VAPID_PRIVATE_KEY'),
  };
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid PORT');
  return {
    port,
    databasePath: process.env.PUSH_GATEWAY_DB ?? './push-gateway.sqlite3',
    allowedOrigins: new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)),
    gatewayPublicUrl: required('GATEWAY_PUBLIC_URL'),
    serviceDid: process.env.SERVICE_DID ?? 'did:web:notifications-gateway.bluepy.social',
    logHashSecret: required('LOG_HASH_SECRET'),
    richPreviewsEnabled: process.env.RICH_PREVIEWS_ENABLED !== 'false',
    activeVapidKeyId,
    vapidPublicKey: activeVapidPair.publicKey,
    vapidPrivateKey: activeVapidPair.privateKey,
    vapidKeys: loadVapidKeys(activeVapidKeyId, activeVapidPair),
    vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@bluepy.social',
    adminToken: process.env.ADMIN_TOKEN,
    devAuthToken: process.env.DEV_AUTH_TOKEN,
    jetstreamUrl: process.env.JETSTREAM_URL ?? 'wss://jetstream2.us-east.bsky.network',
  };
}
