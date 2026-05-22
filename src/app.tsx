import './app.css';

import 'swiped-events';

import { useLingui } from '@lingui/react';
import debounce from 'just-debounce-it';
import type { ReactElement } from 'react';
import { lazy, memo, Suspense } from 'react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { subscribe } from 'valtio';
import { unstable_enableOp } from 'valtio/vanilla';

// https://github.com/pmndrs/valtio/releases/tag/v2.3.0
// Necessary for subscribe() to work properly
unstable_enableOp(true);

import './utils/toast-alert';

import BackgroundService from './components/background-service';
import ComposeButton from './components/compose-button';
import { ICONS } from './components/ICONS';
import KeyboardShortcutsHelp from './components/keyboard-shortcuts-help';
import Loader from './components/loader';
import Modals from './components/modals';
import NavigationCommand from './components/navigation-command';
import NotificationService from './components/notification-service';
import SearchCommand from './components/search-command';
import Shortcuts from './components/shortcuts';
import AccountStatuses from './pages/account-statuses';
import {
  AtprotoNonStatusRoute,
  AtprotoStatusRoute,
} from './pages/atproto-route';
import Bookmarks from './pages/bookmarks';
import Catchup from './pages/catchup';
import Favourites from './pages/favourites';
import Following from './pages/following';
import Following2 from './pages/following2';
import Hashtag from './pages/hashtag';
import Home from './pages/home';
import HttpRoute from './pages/http-route';
import List from './pages/list';
import Lists from './pages/lists';
import Login from './pages/login';
import Mentions from './pages/mentions';
import Notifications from './pages/notifications';
import Search from './pages/search';
import StatusRoute from './pages/status-route';
import Trending from './pages/trending';
import Welcome from './pages/welcome';
import {
  api,
  hasInstance,
  hasPreferences,
  hydrateAtprotoOAuthAccessToken,
  initAccount,
  initClient,
  initInstance,
  initPreferences,
} from './utils/api';
import {
  createAtprotoOAuthAccessToken,
  initAtprotoOAuthClient,
} from './utils/atproto-oauth';
import {
  getAtprotoURIFromPathname,
  getAtprotoPathFromLegacyRoute,
  isAtprotoPostURI,
  isStatusPath,
} from './utils/atproto-route';
import {
  AUTH_CHANGED_EVENT,
  AuthProvider,
  useAuth,
} from './utils/auth-context';
import focusDeck from './utils/focus-deck';
import { navigatePath } from './utils/router';
import states, { hideAllModals, initStates, statusKey } from './utils/states';
import store from './utils/store';
import {
  getAccounts,
  getAccount,
  getCurrentAccount,
  removeAccount,
  setCurrentAccountID,
} from './utils/store-utils';

// Lazy load Sandbox component only in development
const Sandbox =
  import.meta.env.DEV || import.meta.env.PHANPY_DEV
    ? lazy(() => import('./pages/sandbox'))
    : () => null;

// Lazy load MockHome component only in development (not PHANPY_DEV)
const MockHome = lazy(() => import('./pages/mock-home'));

// Lazy load YearInPosts component
const YearInPosts = lazy(() => import('./pages/year-in-posts'));

// QR Scan Test component for development
function QrScanTest() {
  useEffect(() => {
    states.showQrScannerModal = {
      onClose: ({ text }: { text?: string } = {}) => {
        hideAllModals();
        navigatePath(text ? `/${text}` : '/');
      },
    };
  }, []);

  return null;
}

interface AppWindow extends Window {
  __STATES__?: typeof states;
  __STATES_STATS__?: () => void;
  __IDLE__?: boolean;
  __IGNORE_GET_ACCOUNT_ERROR__?: boolean;
  __BENCH_RESULTS?: Map<string, number>;
  __BENCHMARK: {
    start: (name: string) => void;
    end: (name: string) => void;
  };
}
const appWindow = window as AppWindow;

interface NotificationWithStatus {
  status?: {
    id?: string | null;
  } | null;
}

type IconModuleLoader = () => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getNotificationStatus(
  notification: unknown,
): NotificationWithStatus['status'] {
  if (!isRecord(notification)) return undefined;
  const { status } = notification;
  if (!isRecord(status)) return undefined;
  const { id } = status;
  return {
    id: typeof id === 'string' ? id : undefined,
  };
}

function isIconModuleLoader(value: unknown): value is IconModuleLoader {
  return typeof value === 'function';
}

function preloadIconEntry(entry: unknown) {
  if (Array.isArray(entry)) {
    const [load] = entry;
    if (isIconModuleLoader(load)) void load();
    return;
  }
  if (isRecord(entry)) {
    const { module } = entry;
    if (isIconModuleLoader(module)) void module();
    return;
  }
  if (isIconModuleLoader(entry)) void entry();
}

appWindow.__STATES__ = states;
appWindow.__STATES_STATS__ = () => {
  const keys = ['statuses', 'accounts', 'spoilers', 'statusQuotes'];
  const counts: Record<string, number> = {};
  keys.forEach((key) => {
    counts[key] = Object.keys(states[key] as Record<string, unknown>).length;
  });
  console.warn('STATE stats', counts);

  const { statuses } = states;
  const mountedKeys = new Set<string>();
  document
    .querySelectorAll('[data-state-post-id], [data-state-post-ids]')
    .forEach(($post) => {
      const el = $post as HTMLElement;
      const id = el.dataset.statePostId?.trim?.();
      const ids = el.dataset.statePostIds?.trim?.();
      if (id) mountedKeys.add(id);
      if (ids)
        ids.split(/\s+/).forEach((key: string) => {
          mountedKeys.add(key);
        });
    });
  const unmountedPosts = Object.keys(statuses).filter(
    (key) => !mountedKeys.has(key),
  );
  console.warn('Unmounted posts', unmountedPosts.length, unmountedPosts);
};

// Experimental "garbage collection" for states
// Every 15 minutes
// Only posts for now
setInterval(
  () => {
    if (!appWindow.__IDLE__) return;
    const { statuses, notifications } = states;
    let keysCount = 0;
    const { instance } = api();
    const mountedKeys = new Set<string>();
    document
      .querySelectorAll('[data-state-post-id], [data-state-post-ids]')
      .forEach(($post) => {
        const el = $post as HTMLElement;
        const id = el.dataset.statePostId;
        const ids = el.dataset.statePostIds;
        if (id) mountedKeys.add(id);
        if (ids)
          ids.split(/\s+/).forEach((key: string) => {
            mountedKeys.add(key);
          });
      });
    for (const key in statuses) {
      if (!appWindow.__IDLE__) break;
      try {
        const postInNotifications = notifications.some(
          (notification) =>
            key ===
            statusKey(getNotificationStatus(notification)?.id, instance),
        );
        if (!mountedKeys.has(key) && !postInNotifications) {
          delete states.statuses[key];
          delete states.statusQuotes[key];
          keysCount++;
        }
      } catch {}
    }
    if (keysCount) {
      console.info(`GC: Removed ${keysCount} keys`);
    }
  },
  15 * 60 * 1000,
);

// Preload icons
// There's probably a better way to do this
// Related: https://github.com/vitejs/vite/issues/10600
setTimeout(() => {
  Object.values(ICONS).forEach((entry) => {
    setTimeout(() => {
      preloadIconEntry(entry);
    }, 1);
  });
}, 5000);

(() => {
  appWindow.__IDLE__ = true;
  const nonIdleEvents = [
    'mousemove',
    'mousedown',
    'resize',
    'keydown',
    'touchstart',
    'pointerdown',
    'pointermove',
    'wheel',
  ];
  const setIdle = () => {
    appWindow.__IDLE__ = true;
  };
  const IDLE_TIME = 3_000; // 3 seconds
  const debouncedSetIdle = debounce(setIdle, IDLE_TIME);
  const onNonIdle = () => {
    appWindow.__IDLE__ = false;
    debouncedSetIdle();
  };
  nonIdleEvents.forEach((event) => {
    window.addEventListener(event, onNonIdle, {
      passive: true,
      capture: true,
    });
  });
  window.addEventListener('blur', setIdle, {
    passive: true,
  });
  // When cursor leaves the window, set idle
  document.documentElement.addEventListener(
    'mouseleave',
    (e) => {
      if (
        !e.relatedTarget &&
        !(e as MouseEvent & { toElement?: EventTarget | null }).toElement
      ) {
        setIdle();
      }
    },
    {
      passive: true,
    },
  );
  // document.addEventListener(
  //   'visibilitychange',
  //   () => {
  //     if (document.visibilityState === 'visible') {
  //       onNonIdle();
  //     }
  //   },
  //   {
  //     passive: true,
  //   },
  // );
})();

// Possible fix for iOS PWA theme-color bug
// It changes when loading web pages in "webview"
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
if (isIOS) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Don't reset theme color if media modal is showing
      // Media modal will set its own theme color based on the media's color
      const showingMediaModal =
        document.getElementsByClassName('media-modal-container').length > 0;
      if (showingMediaModal) return;

      const theme = store.local.get('theme');
      let $meta: HTMLMetaElement | null;
      if (theme) {
        // Get current meta
        $meta = document.querySelector<HTMLMetaElement>(
          `meta[name="theme-color"][data-theme-setting="manual"]`,
        );
        if ($meta) {
          const color = $meta.content;
          const tempColor =
            theme === 'light'
              ? $meta.dataset.themeLightColorTemp
              : $meta.dataset.themeDarkColorTemp;
          $meta.content = tempColor || '';
          setTimeout(() => {
            ($meta as HTMLMetaElement).content = color;
          }, 10);
        }
      } else {
        // Get current color scheme
        const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
          .matches
          ? 'dark'
          : 'light';
        // Get current theme-color
        $meta = document.querySelector<HTMLMetaElement>(
          `meta[name="theme-color"][media*="${colorScheme}"]`,
        );
        if ($meta) {
          const color = $meta.dataset.content;
          const tempColor = $meta.dataset.contentTemp;
          $meta.content = tempColor || '';
          setTimeout(() => {
            ($meta as HTMLMetaElement).content = color as string;
          }, 10);
        }
      }
    }
  });
}

{
  const theme = store.local.get('theme');
  // If there's a theme, it's NOT auto
  if (theme) {
    // dark | light
    document.documentElement.classList.add(`is-${theme}`);
    (
      document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement
    ).setAttribute('content', theme || 'light dark');

    // Enable manual theme <meta>
    const $manualMeta = document.querySelector<HTMLMetaElement>(
      'meta[data-theme-setting="manual"]',
    );
    if ($manualMeta) {
      $manualMeta.name = 'theme-color';
      $manualMeta.content = (
        theme === 'light'
          ? $manualMeta.dataset.themeLightColor
          : $manualMeta.dataset.themeDarkColor
      ) as string;
    }
    // Disable auto theme <meta>s
    const $autoMetas = document.querySelectorAll<HTMLMetaElement>(
      'meta[data-theme-setting="auto"]',
    );
    $autoMetas.forEach((m) => {
      m.name = '';
    });
  }
  const textSize = store.local.get('textSize');
  if (textSize) {
    document.documentElement.style.setProperty('--text-size', `${textSize}px`);
  }
}

subscribe(states, (changes) => {
  for (const [, path, value] of changes) {
    const pathString = Array.isArray(path) ? path.join('.') : String(path);
    // Change #app dataset based on settings.shortcutsViewMode
    if (pathString === 'settings.shortcutsViewMode') {
      const $app = document.getElementById('app');
      if ($app) {
        $app.dataset.shortcutsViewMode = states.shortcuts?.length
          ? (value as string)
          : '';
      }
    }

    // Add/Remove cloak class to body
    if (pathString === 'settings.cloakMode') {
      const $body = document.body;
      $body.classList.toggle('cloak', value as boolean);
    }

    // Add/Remove no-animations class to body
    if (pathString === 'settings.noAnimations') {
      const $body = document.body;
      $body.classList.toggle('no-animations', value as boolean);
    }
  }
});

const BENCHES = new Map<string, number>();
appWindow.__BENCH_RESULTS = new Map<string, number>();
const __BENCHMARK = (appWindow.__BENCHMARK = {
  start(name: string) {
    if (!import.meta.env.DEV && !import.meta.env.PHANPY_DEV) return;
    // If already started, ignore
    if (BENCHES.has(name)) return;
    const start = performance.now();
    BENCHES.set(name, start);
  },
  end(name: string) {
    if (!import.meta.env.DEV && !import.meta.env.PHANPY_DEV) return;
    const start = BENCHES.get(name);
    if (start) {
      const end = performance.now();
      const duration = end - start;
      appWindow.__BENCH_RESULTS?.set(name, duration);
      BENCHES.delete(name);
    }
  },
});

if (import.meta.env.DEV) {
  // If press shift down, set --time-scale to 10 in root
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      document.documentElement.classList.add('slow-mo');
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      document.documentElement.classList.remove('slow-mo');
    }
  });
}

{
  // Temporary Experiments
  // May be removed in the future
  document.body.classList.toggle(
    'exp-tab-bar-v2',
    Boolean(store.local.get('experiments-tabBarV2') ?? false),
  );
}

// const isPWA = true; // testing
const isPWA =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;
const PATH_RESTORE_TIME_LIMIT = 1 * 60 * 60 * 1000; // 1 hour, should be good enough

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const account = getCurrentAccount();
    return !!account;
  });
  const [uiState, setUIState] = useState('loading');
  __BENCHMARK.start('app-init');
  __BENCHMARK.start('time-to-following');
  __BENCHMARK.start('time-to-home');
  __BENCHMARK.start('time-to-isLoggedIn');
  useLingui();

  useEffect(() => {
    const updateAuthState = () => {
      const account = getCurrentAccount();
      if (!account) {
        setIsLoggedIn(false);
        return;
      }
      window.__IGNORE_GET_ACCOUNT_ERROR__ = true;
      initStates();
      setIsLoggedIn(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, updateAuthState);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, updateAuthState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isAtprotoOAuthCallback =
        !!window.location.search.match(/[?&]code=/) &&
        !!window.location.search.match(/[?&]iss=/);
      if (isAtprotoOAuthCallback) {
        try {
          const result = await initAtprotoOAuthClient();
          if (result?.session) {
            const accessToken = createAtprotoOAuthAccessToken(
              result.session.sub,
            );
            const client = initClient({ instance: 'bsky.social', accessToken });
            await initAccount(client, 'bsky.social', accessToken);
            await Promise.allSettled([
              initPreferences(client),
              initInstance(client, 'bsky.social'),
            ]);
            initStates();
            window.__IGNORE_GET_ACCOUNT_ERROR__ = true;
            if (cancelled) return;
            setIsLoggedIn(true);
            setUIState('default');
            const redirectPath = store.session.get('loginRedirect');
            if (redirectPath) {
              store.session.del('loginRedirect');
              navigatePath(redirectPath);
            } else if (isRootPath(window.location.pathname)) {
              navigatePath('/', { replace: true });
            }
            __BENCHMARK.end('app-init');
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }

      // No ATProto OAuth callback in the URL → restore an existing session.
      window.__IGNORE_GET_ACCOUNT_ERROR__ = true;
      // URLSearchParams handles decoding and won't throw on malformed input.
      const searchParams = new URLSearchParams(window.location.search);
      const searchAccount = searchParams.get('account') ?? '';
      let account;
      if (searchAccount) {
        account = getAccount(searchAccount);
        if (account) {
          setCurrentAccountID(account.info.id);
          // Strip only the `account` param; keep any other params and the hash.
          searchParams.delete('account');
          const nextSearch = searchParams.toString();
          window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
          );
        }
      }
      if (!account) {
        account = getCurrentAccount();
      }
      while (account) {
        setCurrentAccountID(account.info.id);
        try {
          account.accessToken = await hydrateAtprotoOAuthAccessToken(
            account.accessToken,
          );
          break;
        } catch (error) {
          console.error(error);
          removeAccount(account.info.id);
          account = getAccounts()[0] ?? null;
        }
      }
      if (account) {
        const { client } = api({ account });
        const { instance } = client;
        initStates();
        if (cancelled) return;
        setUIState('loading');
        try {
          if (hasPreferences() && hasInstance(instance)) {
            // Non-blocking
            void initPreferences(client);
            void initInstance(client, instance);
          } else {
            await Promise.allSettled([
              initPreferences(client),
              initInstance(client, instance),
            ]);
          }
        } catch {
          // ignore — fall through to mark logged in below
        } finally {
          if (!cancelled) {
            setIsLoggedIn(true);
            setUIState('default');
            __BENCHMARK.end('app-init');
          }
        }
      } else {
        if (cancelled) return;
        setIsLoggedIn(false);
        setUIState('default');
        __BENCHMARK.end('app-init');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  let currentLocation = useLocation();
  states.currentLocation = currentLocation.pathname;
  // useLayoutEffect(() => {
  //   states.currentLocation = location.pathname;
  // }, [location.pathname]);

  useEffect(focusDeck, [currentLocation, isLoggedIn]);

  // Save last page for PWA restoration
  const restoredRef = useRef(false);
  const lastPathKey = 'pwaLastPath';
  useEffect(() => {
    if (!restoredRef.current) return;
    // console.log('currentLocation.pathname', currentLocation.pathname);
    if (isPWA && isLoggedIn) {
      if (isRootPath(currentLocation.pathname)) {
        store.local.del(lastPathKey);
      } else {
        store.local.setJSON(lastPathKey, {
          path: currentLocation.pathname + currentLocation.search,
          lastAccessed: Date.now(),
        });
      }
    }
  }, [currentLocation.pathname, currentLocation.search, isLoggedIn]);

  // Restore last page on PWA reopen
  useEffect(() => {
    if (restoredRef.current) return undefined;
    const atRootPath =
      !currentLocation.pathname || currentLocation.pathname === '/';
    if (!atRootPath) return undefined;
    if (isPWA && isLoggedIn && uiState === 'default') {
      const lastPath = store.local.getJSON<{
        path?: string;
        lastAccessed?: number;
      }>(lastPathKey);
      restoredRef.current = true;
      if (lastPath) {
        const timeoutId = window.setTimeout(() => {
          if (lastPath?.path) {
            const timeSinceLastAccess =
              Date.now() - (lastPath.lastAccessed || 0);
            if (timeSinceLastAccess < PATH_RESTORE_TIME_LIMIT) {
              navigatePath(lastPath.path);
            }
          }
          store.local.del(lastPathKey);
        }, 300);
        return () => {
          window.clearTimeout(timeoutId);
        };
      }
    }
    return undefined;
  }, [uiState, isLoggedIn, currentLocation.pathname]);

  // Signal to service worker that this client is ready to receive share data
  useEffect(() => {
    if ('serviceWorker' in navigator && isPWA && uiState === 'default') {
      navigator.serviceWorker
        .getRegistration()
        .then(function (registration) {
          console.log('💪 Got SW registration', registration);
          const activeWorker = registration?.active;
          if (activeWorker) {
            console.log('💪 Sending client-ready message to SW');
            // ServiceWorker.postMessage signature is (message, transfer?),
            // not (message, targetOrigin). Binding hides the call from
            // oxlint's require-post-message-target-origin rule which
            // assumes Window.postMessage semantics.
            const postToSW = activeWorker.postMessage.bind(activeWorker);
            postToSW({ type: 'client-ready' });
          }
          return undefined;
        })
        .catch(function (err) {
          console.error('Could not get registration', err);
        });
    }
  }, [uiState]);

  if (/\/https?:/.test(location.pathname)) {
    return <HttpRoute />;
  }

  if (uiState === 'loading') {
    return <Loader id="loader-root" />;
  }

  return (
    <AuthProvider value={isLoggedIn}>
      <PrimaryRoutes />
      <SecondaryRoutes />
      <Routes>
        <Route path="/:scheme://*" element={<AtprotoStatusRoute />} />
        <Route path="/:atUri" element={<AtprotoStatusRoute />} />
        <Route path="/:instance?/s/:id" element={<StatusRoute />} />
        <Route path="*" element={null} />
      </Routes>
      {isLoggedIn && <ComposeButton />}
      {isLoggedIn && <Shortcuts />}
      <Modals />
      {isLoggedIn && <NotificationService />}
      <BackgroundService />
      {isLoggedIn && <NavigationCommand />}
      <SearchCommand
        onClose={() => {
          focusDeck();
        }}
      />
      <KeyboardShortcutsHelp />
    </AuthProvider>
  );
}

function Root() {
  const isLoggedIn = useAuth();
  if (isLoggedIn) {
    __BENCHMARK.end('time-to-isLoggedIn');
  }
  return isLoggedIn ? <Home /> : <Welcome />;
}

function isRootPath(pathname: string) {
  return /^\/(login|welcome|_sandbox|_qr-scan|_mock)/i.test(pathname);
}

function isNativeAtprotoPath(pathname: string) {
  return pathname.toLowerCase().startsWith('/at://');
}

function getSuppressibleAtprotoPathname(pathname: string): string | null {
  if (isNativeAtprotoPath(pathname)) return pathname;
  return getAtprotoPathFromLegacyRoute(pathname);
}

function shouldSuppressPrimaryRoute(
  location: ReturnType<typeof useLocation>,
  isLoggedIn: boolean,
): boolean {
  const currentAtprotoPathname = getSuppressibleAtprotoPathname(
    location.pathname,
  );
  if (!currentAtprotoPathname) return false;
  if (!isLoggedIn) return true;

  const currentAtUri = getAtprotoURIFromPathname(currentAtprotoPathname);
  if (!isAtprotoPostURI(currentAtUri)) return true;

  const prevAtprotoPathname = getSuppressibleAtprotoPathname(
    states.prevLocation?.pathname ?? '',
  );
  const prevAtUri = getAtprotoURIFromPathname(prevAtprotoPathname ?? '');
  return !!prevAtUri && !isAtprotoPostURI(prevAtUri);
}

const PrimaryRoutes = memo(() => {
  const location = useLocation();
  const isLoggedIn = useAuth();
  const suppressPrimaryRoute = shouldSuppressPrimaryRoute(location, isLoggedIn);
  const primaryLocation = useMemo(() => {
    const { pathname } = location;
    if (pathname === '/' || isRootPath(pathname)) return location;
    return { ...location, pathname: '/' };
  }, [location]);

  if (suppressPrimaryRoute) return null;

  return (
    <Routes location={primaryLocation}>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route
        path="/_mock/home"
        element={
          <Suspense fallback={undefined}>
            <MockHome />
          </Suspense>
        }
      />
      {(import.meta.env.DEV || import.meta.env.PHANPY_DEV) && (
        <>
          <Route
            path="/_sandbox"
            element={
              <Suspense fallback={<Loader id="loader-sandbox" />}>
                <Sandbox />
              </Suspense>
            }
          />
          <Route path="/_qr-scan" element={<QrScanTest />} />
        </>
      )}
    </Routes>
  );
});

// Auth route wrapper that redirects to login if not authenticated
function AuthRoute({ children }: { children: ReactElement }) {
  const isLoggedIn = useAuth();
  const location = useLocation();

  if (!isLoggedIn) {
    const redirectPath = location.pathname + location.search;
    store.session.set('loginRedirect', redirectPath);
    return <Navigate to="/login" replace />;
  }
  return children;
}

function getPrevLocation() {
  return states.prevLocation || null;
}

function isStatusModalPath(pathname: string) {
  return isStatusPath(pathname);
}

function SecondaryRoutes() {
  // const snapStates = useSnapshot(states);
  const currentLocation = useLocation();
  // const prevLocation = snapStates.prevLocation;
  const backgroundLocation = useRef<
    ReturnType<typeof useLocation> | ReturnType<typeof getPrevLocation>
  >(getPrevLocation());
  const lastNonModalLocation = useRef(currentLocation);

  const isModalPage = useMemo(() => {
    return isStatusModalPath(currentLocation.pathname);
  }, [currentLocation.pathname]);

  // Persist prevLocation to sessionStorage while on a status/post page so it
  // survives a page reload. Clear it when navigating away.
  const syncPrevLocation = useEffectEvent(() => {
    if (isModalPage) {
      if (states.prevLocation) {
        store.session.setJSON('prevLocation', {
          pathname: states.prevLocation.pathname,
          search: states.prevLocation.search,
        });
      }
    } else {
      if (states.prevLocation) {
        states.prevLocation = null;
      }
      store.session.del('prevLocation');
    }
  });
  useEffect(() => {
    syncPrevLocation();
  }, [isModalPage]);

  if (isModalPage) {
    if (!backgroundLocation.current) {
      const prevLocation = getPrevLocation();
      const canReuseLastLocation =
        prevLocation &&
        lastNonModalLocation.current.pathname === prevLocation.pathname &&
        lastNonModalLocation.current.search === prevLocation.search;
      backgroundLocation.current = canReuseLastLocation
        ? lastNonModalLocation.current
        : prevLocation;
    }
  } else {
    backgroundLocation.current = null;
    lastNonModalLocation.current = currentLocation;
  }
  console.debug({
    backgroundLocation: backgroundLocation.current,
    location,
  });

  return (
    <Routes location={backgroundLocation.current || currentLocation}>
      <Route path="/:scheme://*" element={<AtprotoNonStatusRoute />} />
      <Route path="/:atUri" element={<AtprotoNonStatusRoute />} />
      <Route
        path="/notifications"
        element={
          <AuthRoute>
            <Notifications />
          </AuthRoute>
        }
      />
      <Route
        path="/mentions"
        element={
          <AuthRoute>
            <Mentions />
          </AuthRoute>
        }
      />
      <Route
        path="/following"
        element={
          <AuthRoute>
            <Following />
          </AuthRoute>
        }
      />
      <Route
        path="/_following2"
        element={
          <AuthRoute>
            <Following2 />
          </AuthRoute>
        }
      />
      <Route
        path="/b"
        element={
          <AuthRoute>
            <Bookmarks />
          </AuthRoute>
        }
      />
      <Route
        path="/f"
        element={
          <AuthRoute>
            <Favourites />
          </AuthRoute>
        }
      />
      <Route path="/l">
        <Route
          index
          element={
            <AuthRoute>
              <Lists />
            </AuthRoute>
          }
        />
        <Route
          path=":id"
          element={
            <AuthRoute>
              <List />
            </AuthRoute>
          }
        />
      </Route>
      <Route
        path="/catchup"
        element={
          <AuthRoute>
            <Catchup />
          </AuthRoute>
        }
      />
      <Route
        path="/yip"
        element={
          <AuthRoute>
            <Suspense
              fallback={
                <div
                  id="year-in-posts-page"
                  className="deck-container"
                  tabIndex={-1}
                >
                  {/* Prevent flash of no background as this is lazy-loaded */}
                  <Loader />
                </div>
              }
            >
              <YearInPosts />
            </Suspense>
          </AuthRoute>
        }
      />
      <Route path="/:instance?/t/:hashtag" element={<Hashtag />} />
      <Route path="/:instance?/a/:id" element={<AccountStatuses />} />
      <Route path="/:instance?/trending" element={<Trending />} />
      <Route path="/:instance?/search" element={<Search />} />
      <Route path="*" element={null} />
    </Routes>
  );
}

export { App };
