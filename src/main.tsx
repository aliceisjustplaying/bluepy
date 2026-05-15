import './index.css';
import './cloak-mode.css';

import './instrument';

import './polyfills';

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import * as Sentry from '@sentry/react';
// Polyfill needed for Firefox < 122
// https://bugzilla.mozilla.org/show_bug.cgi?id=1423593
// import '@formatjs/intl-segmenter/polyfill';
import { render } from 'preact';
import type { ComponentType, VNode } from 'preact';
import { HashRouter } from 'react-router-dom';

import { App } from './app';
import { IconSpriteProvider } from './components/icon-sprite-manager';
import { initActivateLang } from './utils/lang';
import {
  importLegacyOriginStorage,
  redirectLegacyOrigin,
} from './utils/origin-migration';
import { initPWAViewport } from './utils/pwa-viewport';
import states from './utils/states';

function preactComponent<P>(component: unknown): ComponentType<P> {
  return component as ComponentType<P>;
}

// Vite aliases `react` to `preact/compat` at bundle time, so Sentry's
// `ErrorBoundary` works at runtime with preact children. The shipped Sentry
// types extend `React.Component`, and preact's JSX type system does not
// accept React class components directly.
const SentryErrorBoundary = preactComponent<{
  fallback?: VNode;
  children?: unknown;
}>(Sentry.ErrorBoundary);

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

if (!redirectLegacyOrigin()) {
  void importLegacyOriginStorage().finally(() => {
    initActivateLang();
    initPWAViewport();

    if (import.meta.env.DEV) {
      void import('preact/debug');
    }

    if (import.meta.env.DEV && 'serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            void registration.unregister();
          });
          return undefined;
        })
        .catch(() => {});
    }

    document.getElementById('boot-status')?.remove();

    render(
      <I18nProvider i18n={i18n}>
        <HashRouter>
          <IconSpriteProvider>
            <SentryErrorBoundary fallback={<p>Something went wrong.</p>}>
              <App />
            </SentryErrorBoundary>
          </IconSpriteProvider>
        </HashRouter>
      </I18nProvider>,
      // The HTML template guarantees this element. Preserve the original JS
      // behavior of failing loudly through `render(...)` if it is ever missing
      // rather than silently skipping mount.
      document.getElementById('app') as HTMLElement,
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
      const IGNORE_CACHE_KEYS = ['icons'];
      let clearRanOnce = false;
      const FAST_INTERVAL = 10_000; // 10 seconds
      const SLOW_INTERVAL = 60 * 60 * 1000; // 1 hour
      async function clearCaches() {
        if ((window as Window & { __IDLE__?: boolean }).__IDLE__) {
          try {
            const keys = await caches.keys();
            for (const key of keys) {
              if (IGNORE_CACHE_KEYS.includes(key)) continue;
              const cache = await caches.open(key);
              const cacheKeys = await cache.keys();
              if (cacheKeys.length > MAX_SW_CACHE_SIZE) {
                console.warn('Cleaning cache', key, cacheKeys.length);
                const deleteKeys = cacheKeys.slice(MAX_SW_CACHE_SIZE);
                for (const deleteKey of deleteKeys) {
                  await cache.delete(deleteKey);
                }
              }
            }
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
          (event.data as { data?: ShareData; action?: string } | undefined) ||
          {};
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
    }

    (window as Window & { __CLOAK__?: () => void }).__CLOAK__ = () => {
      document.body.classList.toggle('cloak');
    };
  });
}
