import type { ComAtprotoServerGetServiceAuth } from '@atproto/api';
import store from './store';

const GATEWAY_URL = import.meta.env.PHANPY_PUSH_GATEWAY_URL || '';
const SERVICE_DID =
  import.meta.env.PHANPY_PUSH_GATEWAY_DID ||
  'did:web:notifications-gateway.bluepy.social';
const GATEWAY_TIMEOUT_MS = 30_000;

export interface GatewaySettings {
  enabled: boolean;
  repliesEnabled: boolean;
  mentionsEnabled: boolean;
  richPreviewsEnabled: boolean;
}

export interface GatewayPublicKey {
  keyId: string;
  publicKey: string;
}

export type ServiceAuthProvider = (lxm: string) => Promise<string>;
export interface ServiceAuthCapableAgent {
  com?: {
    atproto?: {
      server?: {
        getServiceAuth?: (
          args: ComAtprotoServerGetServiceAuth.QueryParams,
        ) => Promise<ComAtprotoServerGetServiceAuth.Response>;
      };
    };
  };
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

function gateway(path: string): string {
  if (!GATEWAY_URL) throw new Error('Push gateway is not configured');
  const base = GATEWAY_URL.endsWith('/') ? GATEWAY_URL : `${GATEWAY_URL}/`;
  return new URL(path.replace(/^\/+/, ''), base).href;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const registration =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.ready);
  if (!registration) throw new Error('Service worker is not ready');
  await registration.update().catch(() => undefined);
  return registration;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function gatewayFetch<T>(path: string, lxm: string, auth: ServiceAuthProvider, init: RequestInit = {}): Promise<T> {
  const token = await auth(lxm);
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (init.body) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort(new Error('Push gateway request timed out'));
  }, GATEWAY_TIMEOUT_MS);
  const abort = () => {
    controller.abort(init.signal?.reason);
  };
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  let res: Response;
  try {
    res = await fetch(gateway(path), {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Push gateway request failed: ${res.status}${body ? ` ${body.slice(0, 240)}` : ''}`);
  }
  return (await res.json()) as T;
}

export async function getGatewayPublicKey(): Promise<GatewayPublicKey> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort(new Error('Push gateway request timed out'));
  }, GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(gateway('/vapid-public-key'), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Unable to fetch push key: ${res.status}`);
    return (await res.json()) as GatewayPublicKey;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function fetchPushSettings(auth: ServiceAuthProvider): Promise<GatewaySettings> {
  return gatewayFetch('/settings', 'social.bluepy.push.getsettings', auth);
}

export async function hasCurrentDeviceSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return Boolean(subscription && store.local.get('pushGatewayVapidKeyId'));
}

export async function isCurrentDeviceRegistered(auth: ServiceAuthProvider): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription || !store.local.get('pushGatewayVapidKeyId')) return false;
  const result = await gatewayFetch<{ registered: boolean }>('/subscriptions/current', 'social.bluepy.push.getsettings', auth, {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  return result.registered;
}

export async function savePushSettings(settings: Partial<GatewaySettings>, auth: ServiceAuthProvider): Promise<GatewaySettings> {
  return gatewayFetch('/settings', 'social.bluepy.push.putsettings', auth, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function registerCurrentDevice(auth: ServiceAuthProvider): Promise<void> {
  if (!isPushSupported()) throw new Error('Push is not supported in this browser');
  const key = await getGatewayPublicKey();
  const registration = await getRegistration();
  const existing = await registration.pushManager.getSubscription();
  const storedKeyId = store.local.get('pushGatewayVapidKeyId');
  let subscription = existing;
  let shouldRollbackSubscription = false;
  if (subscription && storedKeyId !== key.keyId) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey) as BufferSource,
    });
    shouldRollbackSubscription = true;
  }
  try {
    await gatewayFetch('/subscriptions', 'social.bluepy.push.registersubscription', auth, {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch (error) {
    if (shouldRollbackSubscription) await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  store.local.set('pushGatewayVapidKeyId', key.keyId);
}

export async function unregisterCurrentDevice(auth: ServiceAuthProvider): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return;
  await gatewayFetch('/subscriptions/unregister', 'social.bluepy.push.unregistersubscription', auth, {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  store.local.del('pushGatewayVapidKeyId');
}

export async function deleteAllPushDataForAccount(auth: ServiceAuthProvider): Promise<void> {
  await gatewayFetch('/subscriptions/delete-all-for-account', 'social.bluepy.push.deleteaccountdata', auth, {
    method: 'POST',
  });
  store.local.del('pushGatewayVapidKeyId');
}

export { SERVICE_DID };
