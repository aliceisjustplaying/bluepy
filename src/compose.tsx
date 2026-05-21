import './index.css';
import './app.css';

import './polyfills';

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import ComposeSuspense from './components/compose-suspense';
import { IconSpriteProvider } from './components/icon-sprite-manager';
import Loader from './components/loader';
import { initActivateLang } from './utils/lang';
import { initPWAViewport } from './utils/pwa-viewport';
import { initStates } from './utils/states';
import { getCurrentAccount } from './utils/store-utils';
import useTitle from './utils/useTitle';

interface ComposePayload {
  editStatus?: unknown;
  replyToStatus?: {
    account?: { acct?: string; username?: string };
    [key: string]: unknown;
  };
  draftStatus?: unknown;
  quoteStatus?: unknown;
}

interface ComposeCloseResults {
  newStatus?: unknown;
  fn?: () => void;
}

type ComposeOpener = {
  console?: Console;
  focus?: () => void;
  __STATES__?: { reloadStatusPage: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isComposeOpener(value: unknown): value is ComposeOpener {
  return isRecord(value);
}

function composeOpener(): ComposeOpener | null {
  const opener: unknown = Reflect.get(window, 'opener');
  return isComposeOpener(opener) ? opener : null;
}

function composePayload(): ComposePayload {
  const payload: unknown = Reflect.get(window, '__COMPOSE__');
  return isRecord(payload) ? payload : {};
}

initActivateLang();
initPWAViewport();

const opener = composeOpener();
if (opener?.console) {
  // The compose popup proxies its console through the parent window so
  // logs surface in the opener's devtools.
  globalThis.console = opener.console;
}

function App() {
  const { t } = useLingui();
  const [uiState, setUIState] = useState('default');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  const { editStatus, replyToStatus, draftStatus, quoteStatus } =
    composePayload();

  useTitle(
    editStatus
      ? t`Editing source status`
      : replyToStatus
        ? t`Replying to @${
            replyToStatus.account?.acct || replyToStatus.account?.username
          }`
        : t`Compose`,
    '',
  );

  useEffect(() => {
    const account = getCurrentAccount();
    setIsLoggedIn(!!account);
    if (account) {
      initStates();
    }
  }, []);

  useEffect(() => {
    if (uiState === 'closed') {
      try {
        // Focus parent window
        composeOpener()?.focus?.();
      } catch {}
      window.close();
    }
  }, [uiState]);

  if (uiState === 'closed') {
    return (
      <div className="box">
        <p>
          <Trans>You may close this page now.</Trans>
        </p>
        <p>
          <button
            onClick={() => {
              window.close();
            }}
          >
            <Trans>Close window</Trans>
          </button>
        </p>
      </div>
    );
  }

  console.debug('OPEN COMPOSE');

  if (isLoggedIn === false) {
    return (
      <div className="box">
        <h1>
          <Trans>Error</Trans>
        </h1>
        <p>
          <Trans>Login required.</Trans>
        </p>
        <p>
          <a href="/">
            <Trans>Go home</Trans>
          </a>
        </p>
      </div>
    );
  }

  if (isLoggedIn) {
    return (
      <ComposeSuspense
        editStatus={editStatus}
        replyToStatus={replyToStatus}
        draftStatus={draftStatus}
        quoteStatus={quoteStatus}
        standalone
        hasOpener={!!composeOpener()}
        onClose={(results: ComposeCloseResults | null | undefined) => {
          const { newStatus, fn = () => {} } = results || {};
          try {
            if (newStatus) {
              const openerStates = composeOpener()?.__STATES__;
              if (openerStates) openerStates.reloadStatusPage++;
            }
            fn();
            setUIState('closed');
          } catch {}
        }}
      />
    );
  }

  return (
    <div className="box">
      <Loader />
    </div>
  );
}

const bluepyReactRoot = Symbol.for('bluepy.reactRoot');

type RootContainer = HTMLElement & {
  [bluepyReactRoot]?: Root;
};

// Preserve original JS behavior of failing loudly if the template's root
// element is ever missing.
const appContainer = document.getElementById('app-standalone');
if (!appContainer) {
  throw new Error('Missing #app-standalone');
}
const rootContainer: RootContainer = appContainer;
const root =
  rootContainer[bluepyReactRoot] ||
  (rootContainer[bluepyReactRoot] = createRoot(rootContainer));
root.render(
  <I18nProvider i18n={i18n}>
    <IconSpriteProvider>
      <App />
    </IconSpriteProvider>
  </I18nProvider>,
);
