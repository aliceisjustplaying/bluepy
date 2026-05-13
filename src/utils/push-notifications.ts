// Utils for push notifications
import { api } from './api';
import { getVapidKey } from './store-utils';

// Subscription is an object with the following structure:
// {
//   data: {
//     alerts: {
//       admin: {
//         report: boolean,
//         signUp: boolean,
//       },
//       favourite: boolean,
//       follow: boolean,
//       mention: boolean,
//       poll: boolean,
//       reblog: boolean,
//       status: boolean,
//       update: boolean,
//     }
//   },
//   policy: "all" | "followed" | "follower" | "none",
//   subscription: {
//     endpoint: string,
//     keys: {
//       auth: string,
//       p256dh: string,
//     },
//   },
// }

// Minimal masto.v1.push surface used here. `masto.v1` carries an open index
// signature in api.ts, so each nested member arrives as `unknown` and must be
// narrowed locally. This shim disappears when the masto client gets fully
// typed in a later wave.
interface PushSubscriptionEndpoint {
  create(subscription: unknown): Promise<BackendPushSubscription>;
  fetch(): Promise<BackendPushSubscription>;
  update(subscription: unknown): Promise<BackendPushSubscription>;
  remove(): Promise<unknown>;
}

interface BackendPushSubscription {
  endpoint?: string;
  serverKey?: string;
  [key: string]: unknown;
}

function pushSubscriptionEndpoint(): PushSubscriptionEndpoint {
  const { masto } = api();
  return (
    masto.v1 as unknown as { push: { subscription: PushSubscriptionEndpoint } }
  ).push.subscription;
}

// Back-end CRUD
// =============

function createBackendPushSubscription(
  subscription: unknown,
): Promise<BackendPushSubscription> {
  return pushSubscriptionEndpoint().create(subscription);
}

function fetchBackendPushSubscription(): Promise<BackendPushSubscription> {
  return pushSubscriptionEndpoint().fetch();
}

function updateBackendPushSubscription(
  subscription: unknown,
): Promise<BackendPushSubscription> {
  return pushSubscriptionEndpoint().update(subscription);
}

function removeBackendPushSubscription(): Promise<unknown> {
  return pushSubscriptionEndpoint().remove();
}

// Front-end
// =========

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export function getRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  // return navigator.serviceWorker.ready;
  return navigator.serviceWorker.getRegistration();
}

async function getSubscription(): Promise<{
  registration: ServiceWorkerRegistration | undefined;
  subscription: PushSubscription | null | undefined;
}> {
  const registration = await getRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : undefined;
  return { registration, subscription };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

// Front-end <-> back-end
// ======================

interface InitSubscriptionResult {
  subscription: PushSubscription | null | undefined;
  backendSubscription: BackendPushSubscription | null;
}

export async function initSubscription(): Promise<
  InitSubscriptionResult | undefined
> {
  if (!isPushSupported()) return;
  const { subscription } = await getSubscription();
  let backendSubscription: BackendPushSubscription | null = null;
  try {
    backendSubscription = await fetchBackendPushSubscription();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/(not found|unknown)/i.test(message)) {
      // No subscription found
    } else {
      // Other error
      throw err;
    }
  }
  console.log('INIT subscription', {
    subscription,
    backendSubscription,
  });

  // Check if the subscription changed
  if (backendSubscription && subscription) {
    const sameEndpoint = backendSubscription.endpoint === subscription.endpoint;
    const vapidKey = getVapidKey();
    const sameKey = backendSubscription.serverKey === vapidKey;
    if (!sameEndpoint) {
      throw new Error('Backend subscription endpoint changed');
    }
    if (sameKey) {
      // Subscription didn't change
    } else {
      // Subscription changed
      console.error('🔔 Subscription changed', {
        sameEndpoint,
        serverKey: backendSubscription.serverKey,
        vapIdKey: vapidKey,
        endpoint1: backendSubscription.endpoint,
        endpoint2: subscription.endpoint,
        sameKey,
        key1: backendSubscription.serverKey,
        key2: vapidKey,
      });
      throw new Error('Backend subscription key and vapid key changed');
      // Only unsubscribe from backend, not from browser
      // await removeBackendPushSubscription();
      // // Now let's resubscribe
      // // NOTE: I have no idea if this works
      // return await updateSubscription({
      //   data: backendSubscription.data,
      //   policy: backendSubscription.policy,
      // });
    }
  }

  if (subscription && !backendSubscription) {
    // check if account's vapidKey is same as subscription's applicationServerKey
    const vapidKey = getVapidKey();
    if (vapidKey) {
      const { applicationServerKey } = subscription.options;
      const vapidKeyStr = urlBase64ToUint8Array(vapidKey as string).toString();
      const applicationServerKeyStr = new Uint8Array(
        applicationServerKey as ArrayBuffer,
      ).toString();
      const sameKey = vapidKeyStr === applicationServerKeyStr;
      if (sameKey) {
        // Subscription didn't change
      } else {
        // Subscription changed
        console.error('🔔 Subscription changed', {
          vapidKeyStr,
          applicationServerKeyStr,
          sameKey,
        });
        // Unsubscribe since backend doesn't have a subscription
        await subscription.unsubscribe();
        throw new Error('Subscription key and vapid key changed');
      }
    } else {
      console.warn('No vapidKey found');
    }
  }

  // Check if backend subscription returns 404
  // if (subscription && !backendSubscription) {
  //   // Re-subscribe to backend
  //   backendSubscription = await createBackendPushSubscription({
  //     subscription,
  //     data: {},
  //     policy: 'all',
  //   });
  // }

  return { subscription, backendSubscription };
}

interface UpdateSubscriptionArgs {
  data: unknown;
  policy: unknown;
}

export async function updateSubscription({
  data,
  policy,
}: UpdateSubscriptionArgs): Promise<
  | {
      subscription: PushSubscription | null | undefined;
      backendSubscription: BackendPushSubscription | null;
    }
  | undefined
> {
  console.log('🔔 Updating subscription', { data, policy });
  if (!isPushSupported()) return;
  let { registration, subscription } = await getSubscription();
  let backendSubscription: BackendPushSubscription | null = null;

  if (subscription) {
    try {
      backendSubscription = await updateBackendPushSubscription({
        data,
        policy,
      });
      // TODO: save subscription in user settings
    } catch (error) {
      // Backend doesn't have a subscription for this user
      // Create a new one
      backendSubscription = await createBackendPushSubscription({
        subscription,
        data,
        policy,
      });
      // TODO: save subscription in user settings
    }
  } else {
    // User is not subscribed
    const vapidKey = getVapidKey();
    if (!vapidKey) throw new Error('No server key found');
    subscription = await (
      registration as ServiceWorkerRegistration
    ).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        vapidKey as string,
      ) as BufferSource,
    });
    backendSubscription = await createBackendPushSubscription({
      subscription,
      data,
      policy,
    });
    // TODO: save subscription in user settings
  }

  return { subscription, backendSubscription };
}

export async function removeSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  const { subscription } = await getSubscription();
  if (subscription) {
    await removeBackendPushSubscription();
    await subscription.unsubscribe();
  }
}
