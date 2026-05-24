import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import * as navigationPreload from 'workbox-navigation-preload';
import { RegExpRoute, registerRoute, Route } from 'workbox-routing';
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from 'workbox-strategies';

navigationPreload.enable();

self.__WB_DISABLE_DEV_LOGS = true;

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('pages'));
});

// Custom plugin to manage hashed assets
class AssetHashPlugin {
  constructor(options = {}) {
    this.maxHashes = options.maxHashes || 2;
    this.dbName = 'workbox-expiration';
    this.storeName = 'cache-entries';
  }

  // Extract base filename from a hashed URL
  // e.g., "main-abc123.js" -> "main"
  getBaseName(url) {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();

    // Match pattern: basename-hash.extension
    // Hash uses URL-safe base64 characters (A-Za-z0-9_-), typically 8+ chars
    const match = filename.match(/^(.+?)-[A-Za-z0-9_-]{8,}\.(js|css)$/);
    return match ? match[1] : null;
  }

  // Get timestamps for multiple URLs from Workbox's ExpirationPlugin IndexedDB
  async getTimestampsFromDB(cacheName, urls) {
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName);
        request.addEventListener('success', () => {
          resolve(request.result);
        });
        request.addEventListener('error', () => {
          reject(new Error(request.error?.message ?? 'IDBRequest error'));
        });
      });

      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);

      // Batch read all timestamps in a single transaction
      const timestamps = await Promise.all(
        urls.map((url) => {
          // Workbox stores entries with key format: `${cacheName}|${url}`
          const key = `${cacheName}|${url}`;

          return new Promise((resolve) => {
            const request = store.get(key);
            request.addEventListener('success', () => {
              resolve(request.result?.timestamp || Date.now());
            });
            request.addEventListener('error', () => {
              resolve(Date.now());
            });
          });
        }),
      );

      db.close();

      return timestamps;
    } catch (error) {
      console.warn(
        `[AssetHashPlugin] Error reading timestamps from IndexedDB:`,
        error,
      );
      // Return current time for all URLs as fallback
      return urls.map(() => Date.now());
    }
  }

  cacheDidUpdate({ cacheName, request }) {
    // Run cleanup asynchronously without blocking the cache operation
    void this.cleanupOldHashes(cacheName, request.url);
  }

  async cleanupOldHashes(cacheName, requestUrl) {
    try {
      const baseName = this.getBaseName(requestUrl);
      if (!baseName) return;

      const cache = await caches.open(cacheName);

      // Find all cached entries with the same base name
      const cachedRequests = await cache.keys();
      const matchingRequests = [];

      const matchingRequestCandidates = cachedRequests.filter(
        (cachedRequest) => this.getBaseName(cachedRequest.url) === baseName,
      );
      const matchingResponses = await Promise.all(
        matchingRequestCandidates.map((cachedRequest) =>
          cache.match(cachedRequest),
        ),
      );
      matchingResponses.forEach((response, index) => {
        if (response) {
          matchingRequests.push(matchingRequestCandidates[index]);
        }
      });

      if (matchingRequests.length <= this.maxHashes) return;

      // Batch read all timestamps in a single database transaction
      const urls = matchingRequests.map((req) => req.url);
      const timestamps = await this.getTimestampsFromDB(cacheName, urls);

      // Build matching entries with timestamps
      const matchingEntries = matchingRequests.map((req, index) => ({
        request: req,
        url: req.url,
        timestamp: timestamps[index],
      }));

      // Sort by timestamp (newest first)
      matchingEntries.sort((a, b) => b.timestamp - a.timestamp);

      // Keep only the maxHashes most recent, delete the rest
      const toDelete = matchingEntries.slice(this.maxHashes);

      await Promise.all(toDelete.map((entry) => cache.delete(entry.request)));
      for (const entry of toDelete) {
        console.log(`[AssetHashPlugin] Deleted old hash: ${entry.url}`);
      }
    } catch (error) {
      console.warn(`[AssetHashPlugin] Error during cleanup:`, error);
    }
  }
}

const expirationPluginOptions = {
  purgeOnQuotaError: true,
  // "CacheFirst image maxEntries not working" https://github.com/GoogleChrome/workbox/issues/2768#issuecomment-793109906
  matchOptions: {
    // https://developer.mozilla.org/en-US/docs/Web/API/Cache/delete#Parameters
    ignoreVary: true,
  },
};

const iconsRoute = new Route(
  ({ request, sameOrigin }) => {
    const isIcon = request.url.includes('/icons/');
    return sameOrigin && isIcon;
  },
  new CacheFirst({
    cacheName: 'icons',
    plugins: [
      new ExpirationPlugin({
        // Weirdly high maxEntries number, due to some old icons suddenly disappearing and not rendering
        // NOTE: Temporary fix
        maxEntries: 300,
        maxAgeSeconds: 3 * 24 * 60 * 60, // 3 days
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(iconsRoute);

const assetsRoute = new Route(
  ({ request, sameOrigin }) => {
    const isAsset =
      request.destination === 'style' || request.destination === 'script';
    const hasHash = /-[0-9a-z-]{4,}\./i.test(request.url);
    return sameOrigin && isAsset && hasHash;
  },
  new StaleWhileRevalidate({
    cacheName: 'assets',
    plugins: [
      // Only enable AssetHashPlugin in production
      ...(import.meta.env.PROD
        ? [
            new AssetHashPlugin({
              maxHashes: 2, // Keep only 2 most recent hashes of each file
            }),
          ]
        : []),
      new ExpirationPlugin({
        maxEntries: 40,
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(assetsRoute);

const imageRoute = new Route(
  ({ request, sameOrigin }) => {
    const isRemote = !sameOrigin;
    const isImage = request.destination === 'image';
    const isAvatar = request.url.includes('/avatars/');
    const isCustomEmoji = request.url.includes('/custom/_emojis');
    const isEmoji = request.url.includes('/emoji/');
    return isRemote && isImage && (isAvatar || isCustomEmoji || isEmoji);
  },
  new CacheFirst({
    cacheName: 'remote-images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(imageRoute);

// 1-day cache for
// - /api/v1/custom_emojis
// - /api/v1/lists/:id
// - /api/v1/announcements
const apiExtendedRoute = new RegExpRoute(
  /^https?:\/\/[^/]+\/api\/v\d+\/(custom_emojis|lists\/\d+|announcements)$/,
  new StaleWhileRevalidate({
    cacheName: 'api-extended',
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 12 * 60 * 60, // 12 hours
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(apiExtendedRoute);

// Cache ActivityPub requests (Accept: application/activity+json)
const activityPubRoute = new Route(
  ({ request }) => {
    const acceptHeader = request.headers.get('accept');
    return acceptHeader?.includes('application/activity+json');
  },
  new StaleWhileRevalidate({
    cacheName: 'activity-json',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60, // 1 hour
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(activityPubRoute);

// Note: expiration is not working as expected
// https://github.com/GoogleChrome/workbox/issues/3316
//
// const apiIntermediateRoute = new RegExpRoute(
//   // Matches:
//   // - trends/*
//   // - timelines/link
//   /^https?:\/\/[^\/]+\/api\/v\d+\/(trends|timelines\/link)/,
//   new StaleWhileRevalidate({
//     cacheName: 'api-intermediate',
//     plugins: [
//       new ExpirationPlugin({
//         maxAgeSeconds: 1 * 60, // 1min
//       }),
//       new CacheableResponsePlugin({
//         statuses: [0, 200],
//       }),
//     ],
//   }),
// );
// registerRoute(apiIntermediateRoute);

const apiRoute = new RegExpRoute(
  // Matches:
  // - statuses/:id/context - some contexts are really huge
  /^https?:\/\/[^/]+\/api\/v\d+\/(statuses\/\d+\/context)/,
  new NetworkFirst({
    cacheName: 'api',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 5 * 60, // 5 minutes
        ...expirationPluginOptions,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);
registerRoute(apiRoute);

// PUSH NOTIFICATIONS
// ==================

function isBluepyPostAtUri(value) {
  if (typeof value !== 'string') return false;
  for (const char of value) {
    if (char.charCodeAt(0) < 32) return false;
  }
  return /^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/.test(value);
}

self.addEventListener('push', (event) => {
  const { data } = event;
  if (!data) return;

  let payload;
  try {
    payload = data.json();
  } catch {
    payload = {};
  }
  delete payload.access_token;
  delete payload.accessToken;
  delete payload.refresh_token;
  delete payload.refreshToken;
  delete payload.dpop;

  if (payload.version === 1) {
    const { title, body, notificationId, type, targetAtUri, recipientDid } =
      payload;
    if (!isBluepyPostAtUri(targetAtUri)) {
      event.waitUntil(
        self.registration.showNotification('New activity in Bluepy', {
          body: 'Open Bluepy to view it.',
          icon: '/logo-192.png',
          dir: 'auto',
          badge: '/logo-badge-72.png',
          tag: notificationId || `bluepy-${Date.now()}`,
          timestamp: Date.now(),
        }),
      );
      return;
    }
    if (navigator.setAppBadge && type === 'mention') {
      void navigator.setAppBadge(1);
    }
    event.waitUntil(
      self.registration.showNotification(title || 'Bluepy', {
        body: body || 'Open Bluepy to view it.',
        icon: '/logo-192.png',
        dir: 'auto',
        badge: '/logo-badge-72.png',
        tag: notificationId,
        timestamp: Date.now(),
        data: {
          notificationId,
          type,
          targetAtUri,
          recipientDid,
        },
      }),
    );
    return;
  }

  const {
    title,
    body,
    icon,
    notification_id,
    notification_type,
    preferred_locale,
    account_id,
  } = payload;

  if (navigator.setAppBadge && notification_type === 'mention') {
    void navigator.setAppBadge(1);
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      dir: 'auto',
      badge: '/logo-badge-72.png',
      lang: preferred_locale,
      tag: notification_id,
      timestamp: Date.now(),
      data: {
        account_id,
        notification_id,
        notification_type,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const { account_id, notification_id, notificationId, targetAtUri, recipientDid } =
    event.notification.data || {};
  if (targetAtUri) {
    if (!isBluepyPostAtUri(targetAtUri)) {
      event.waitUntil(event.notification.close());
      return;
    }
    const url = new URL(`/${targetAtUri}`, self.location.origin).href;
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        const bestClient =
          clients.find(
            (client) => client.focused || client.visibilityState === 'visible',
          ) || clients[0];
        const message = {
          type: 'push-notification-route',
          targetAtUri,
          recipientDid,
          notificationId,
        };
        await storePendingNotificationRoute(message);
        if (bestClient) {
          if ('navigate' in bestClient) {
            await bestClient.navigate(url);
          }
          await bestClient.focus();
          bestClient.postMessage?.(message);
        } else {
          await self.clients.openWindow(url);
        }
        await event.notification.close();
      })(),
    );
    return;
  }
  const params = new URLSearchParams();
  const id = notification_id || event.notification.tag;
  if (id) params.set('notification_id', id);
  if (account_id) params.set('account_id', account_id);
  const url = `/notifications${params.size ? `?${params}` : ''}`;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const bestClient =
        clients.find(
          (client) => client.focused || client.visibilityState === 'visible',
        ) || clients[0];
      if (bestClient) {
        await bestClient.focus();
        if (account_id) {
          bestClient.postMessage?.({
            type: 'notification',
            accountId: account_id,
            id,
          });
        } else if ('navigate' in bestClient) {
          await bestClient.navigate(url);
        }
      } else {
        await self.clients.openWindow(url);
      }
      await event.notification.close();
    })(),
  );
});

function openPendingNotificationDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bluepy:pending-notification-routes', 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('routes', { keyPath: 'notificationId' });
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error || new Error('Failed to open pending notification database'));
    });
  });
}

async function storePendingNotificationRoute(route) {
  const db = await openPendingNotificationDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('routes', 'readwrite');
    tx.objectStore('routes').put({ ...route, createdAt: Date.now() });
    tx.addEventListener('complete', () => {
      resolve();
    });
    tx.addEventListener('error', () => {
      reject(new Error('Failed to store pending notification route'));
    });
  });
  db.close();
}

// WEB SHARE TARGET
// ================

let pendingShareData = null;
self.addEventListener('message', (event) => {
  console.log('💪 SW received event', event, pendingShareData);
  const source = event.data?.type === 'client-ready' && event.source;
  if (source && pendingShareData) {
    source.postMessage(
      {
        type: 'share-target',
        data: pendingShareData,
        action: 'compose-with-shared-data',
      },
      [],
    );
    pendingShareData = null;
  }
});

registerRoute(
  // Works with relative path
  ({ url }) => url.pathname.endsWith('/share'),
  async ({ request }) => {
    console.log('💪 Handling share target POST request', request);
    try {
      const formData = await request.formData();
      const sharedData = {
        title: formData.get('title') || '',
        text: formData.get('text') || '',
        url: formData.get('url') || '',
        files: formData.getAll('files'),
        timestamp: Date.now(),
      };
      // Store pending data and redirect first
      pendingShareData = sharedData;
    } catch (e) {
      console.error(e);
    }
    return Response.redirect('./', 303);
  },
  'POST',
);
