import './index.css';
import './cloak-mode.css';

import './polyfills';
import './instrument';

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Polyfill needed for Firefox < 122
// https://bugzilla.mozilla.org/show_bug.cgi?id=1423593
// import '@formatjs/intl-segmenter/polyfill';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './app';
import { SessionProvider } from './contexts/SessionProvider';
import { createQueryClient } from './data/query-client';
import { useSessionsStore } from './state/sessions';
import ErrorFallback from './components/error-fallback';
import { IconSpriteProvider } from './components/icon-sprite-manager';
import { applyAppviewTheme } from './utils/atproto-adapter';
import { initActivateLang } from './utils/lang';
import {
  importLegacyOriginStorage,
  redirectLegacyOrigin,
} from './utils/origin-migration';
import { initPWAViewport } from './utils/pwa-viewport';
import { captureSentryException } from './instrument';
import {
  migrateLegacyCanonicalRoute,
  migrateLegacyHashRoute,
  navigatePath,
} from './utils/router';
import states from './utils/states';

const queryClient = createQueryClient();
const bluepyReactRoot = Symbol.for('bluepy.reactRoot');

type RootContainer = HTMLElement & {
  [bluepyReactRoot]?: Root;
};

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: readonly File[];
}
interface SharedDataPayload {
  initialText: string;
  files: readonly File[];
}
interface PendingNotificationRoute {
  type?: string;
  targetAtUri?: string;
  recipientDid?: string;
  notificationId?: string;
  createdAt?: number;
}
function processShareData(
  data: ShareData | null | undefined,
): SharedDataPayload | null {
  if (!data) return null;

  const textParts: string[] = [];
  if (data.title) textParts.push(data.title);
  if (data.text) textParts.push(data.text);
  if (data.url) textParts.push(data.url);

  return {
    initialText: textParts.join('\n\n'),
    files: data.files || [],
  };
}

function handlePushNotificationRoute(route: PendingNotificationRoute): void {
  const { targetAtUri, recipientDid } = route;
  if (!targetAtUri) {
    return;
  }
  for (let index = 0; index < targetAtUri.length; index += 1) {
    if (targetAtUri.charCodeAt(index) < 32) return;
  }
  if (!/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/.test(targetAtUri)) {
    return;
  }
  const sessions = useSessionsStore.getState();
  if (recipientDid && sessions.knownDids.includes(recipientDid)) {
    sessions.setActive(recipientDid);
  }
  navigatePath(`/${targetAtUri}`);
}

function openPendingNotificationDb(): Promise<IDBDatabase> {
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

async function drainPendingNotificationRoutes(): Promise<void> {
  if (!('indexedDB' in window)) return;
  const db = await openPendingNotificationDb();
  const tx = db.transaction('routes', 'readwrite');
  const store = tx.objectStore('routes');
  const request = store.getAll();
  const routeToHandle = await new Promise<PendingNotificationRoute | null>((resolve, reject) => {
    request.addEventListener('success', () => {
      const cutoff = Date.now() - 5 * 60 * 1000;
      let selected: PendingNotificationRoute | null = null;
      for (const route of request.result as PendingNotificationRoute[]) {
        if (!route.notificationId) continue;
        store.delete(route.notificationId);
        if (!selected && (route.createdAt ?? 0) >= cutoff) selected = route;
      }
      resolve(selected);
    });
    request.addEventListener('error', () => {
      reject(request.error || new Error('Failed to read pending notification routes'));
    });
  });
  await new Promise<void>((resolve, reject) => {
    tx.addEventListener('complete', () => {
      resolve();
    });
    tx.addEventListener('error', () => {
      reject(tx.error || new Error('Failed to clear pending notification routes'));
    });
    tx.addEventListener('abort', () => {
      reject(tx.error || new Error('Failed to clear pending notification routes'));
    });
  });
  db.close();
  if (routeToHandle) handlePushNotificationRoute(routeToHandle);
}

function schedulePendingNotificationRouteDrain(): void {
  window.setTimeout(() => {
    void (async () => {
      try {
        await drainPendingNotificationRoutes();
      } catch (error) {
        console.warn('Failed to drain push notification route', error);
      }
    })();
  }, 0);
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    void captureSentryException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />;
    return this.props.children;
  }
}

if (!redirectLegacyOrigin()) {
  void (async () => {
    try {
      await importLegacyOriginStorage();
    } finally {
      initActivateLang();
      initPWAViewport();
      applyAppviewTheme();

      if (import.meta.env.DEV && 'serviceWorker' in navigator) {
        void (async () => {
          try {
            const registrations =
              await navigator.serviceWorker.getRegistrations();
            await Promise.all(
              registrations.map((registration) => registration.unregister()),
            );
          } catch {
            /* ignore */
          }
        })();
      }

      document.getElementById('boot-status')?.remove();
      migrateLegacyHashRoute();
      migrateLegacyCanonicalRoute();

      // The HTML template guarantees this element. Preserve the original JS
      // behavior of failing loudly if it is ever missing.
      const appContainer = document.getElementById('app') as RootContainer;
      const root =
        appContainer[bluepyReactRoot] ||
        (appContainer[bluepyReactRoot] = createRoot(appContainer));
      root.render(
        <I18nProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <BrowserRouter>
                <IconSpriteProvider>
                  <AppErrorBoundary>
                    <App />
                  </AppErrorBoundary>
                </IconSpriteProvider>
              </BrowserRouter>
            </SessionProvider>
          </QueryClientProvider>
        </I18nProvider>,
      );

      (
        window as Window & {
          __BLUEPY_APP_MOUNTED__?: boolean;
        }
      )['__BLUEPY_APP_MOUNTED__'] = true;

      try {
        const bootReloadParam = '__bluepy_boot_retry';
        const currentURL = new URL(window.location.href);
        sessionStorage.removeItem('bluepy:boot-reload-state');
        sessionStorage.removeItem('bluepy:boot-reload-attempted');
        if (currentURL.searchParams.has(bootReloadParam)) {
          currentURL.searchParams.delete(bootReloadParam);
          window.history.replaceState(
            window.history.state,
            document.title,
            `${currentURL.pathname}${currentURL.search}${currentURL.hash}`,
          );
        }
      } catch {}

      // Storage cleanup
      setTimeout(() => {
        try {
          // Clean up old settings key
          localStorage.removeItem('settings-groupedNotificationsAlpha');
        } catch {}
      }, 5000);

      // Service worker cache cleanup
      if ('serviceWorker' in navigator && typeof caches !== 'undefined') {
        const MAX_SW_CACHE_SIZE = 50;
        const IGNORE_CACHE_KEYS = new Set(['icons']);
        let clearRanOnce = false;
        const FAST_INTERVAL = 10_000; // 10 seconds
        const SLOW_INTERVAL = 60 * 60 * 1000; // 1 hour
        async function clearCaches() {
          if ((window as Window & { __IDLE__?: boolean }).__IDLE__) {
            try {
              const keys = await caches.keys();
              await Promise.all(
                keys.map(async (key) => {
                  if (IGNORE_CACHE_KEYS.has(key)) return;
                  const cache = await caches.open(key);
                  const cacheKeys = await cache.keys();
                  if (cacheKeys.length > MAX_SW_CACHE_SIZE) {
                    console.warn('Cleaning cache', key, cacheKeys.length);
                    const deleteKeys = cacheKeys.slice(MAX_SW_CACHE_SIZE);
                    await Promise.all(
                      deleteKeys.map((deleteKey) => cache.delete(deleteKey)),
                    );
                  }
                }),
              );
              clearRanOnce = true;
            } catch {} // Silent fail
          }
          // Once cleared, clear again at slower interval
          setTimeout(
            () => {
              void clearCaches();
            },
            clearRanOnce ? SLOW_INTERVAL : FAST_INTERVAL,
          );
        }
        setTimeout(() => {
          void clearCaches();
        }, FAST_INTERVAL);
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          const { data, action } =
            (event.data as
              | ({ data?: ShareData; action?: string } & PendingNotificationRoute)
              | undefined) ||
            {};
          if (event.data?.type === 'push-notification-route') {
            handlePushNotificationRoute(event.data as PendingNotificationRoute);
            return;
          }
          if (action === 'compose-with-shared-data') {
            console.log('💪 Received shared data from SW', data);
            const sharedData = processShareData(data);
            if (sharedData) {
              (
                window as Window & { __SHARED_DATA__?: SharedDataPayload }
              ).__SHARED_DATA__ = sharedData;
              states.showCompose = true; // It'll use __SHARED_DATA__
            }
          }
        });
        void (async () => {
          try {
            await drainPendingNotificationRoutes();
          } catch (error) {
            console.warn('Failed to drain push notification route', error);
          }
        })();
        window.addEventListener('focus', schedulePendingNotificationRouteDrain);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            schedulePendingNotificationRouteDrain();
          }
        });
      }

      (window as Window & { __CLOAK__?: () => void }).__CLOAK__ = () => {
        document.body.classList.toggle('cloak');
      };
    }
  })();
}
