import './login.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import logo from '../assets/logo.svg';

import LangSelector from '../components/lang-selector';
import Link from '../components/link';
import Loader from '../components/loader';
import { initClient, initInstance, initPreferences } from '../utils/api';
import {
  APPVIEW_OPTIONS,
  BSKY_INSTANCE,
  applyAppviewTheme,
  getActiveAppview,
  loginAtproto,
} from '../utils/atproto-adapter';
import { startAtprotoOAuthLogin } from '../utils/atproto-oauth';
import { notifyAuthChanged } from '../utils/auth-context';
import { navigatePath } from '../utils/router';
import store from '../utils/store';
import { saveAccount, setCurrentAccountID } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

const HANDLE_SUFFIXES = [
  '.bsky.social',
  '.blacksky.app',
  '.eurosky.social',
  '.pckt.cafe',
  '.com',
  '.tngl.sh',
  '.myatproto.social',
  '.margin.cafe',
  '.selfhosted.social',
  '.npmx.social',
];

function Login() {
  const { t } = useLingui();
  useTitle(t`Log in`, '/login');
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [bskyIdentifier, setBskyIdentifier] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [bskyService, setBskyService] = useState('');
  const [appview, setAppview] = useState(getActiveAppview());
  useEffect(() => {
    applyAppviewTheme(appview);
  }, [appview]);
  const remainingSuffixes = useRef<string[]>([]);
  const [currentSuffix, setCurrentSuffix] = useState(HANDLE_SUFFIXES[0]);
  const [suffixFading, setSuffixFading] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setSuffixFading(true);
      setTimeout(() => {
        setCurrentSuffix((prev: string) => {
          if (remainingSuffixes.current.length === 0) {
            remainingSuffixes.current = HANDLE_SUFFIXES.filter(
              (s) => s !== prev,
            ).toSorted(() => Math.random() - 0.5);
          }
          return remainingSuffixes.current.pop()!;
        });
        setSuffixFading(false);
      }, 500);
    }, 1500);
    return () => clearInterval(id);
  }, []);
  const submitBluesky = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bskyIdentifier || !bskyPassword) return;
    void (async () => {
      store.local.set('settings-appview', appview);
      applyAppviewTheme(appview);
      setUIState('loading');
      try {
        const { account, session, service } = await loginAtproto({
          identifier: bskyIdentifier.trim(),
          password: bskyPassword,
          service: bskyService,
        });
        const accessToken = JSON.stringify({
          type: 'atproto',
          service,
          session,
        });
        saveAccount({
          info: account,
          instanceURL: BSKY_INSTANCE,
          accessToken,
          atproto: true,
          createdAt: Date.now(),
        });
        setCurrentAccountID(account.id);
        const client = initClient({ instance: BSKY_INSTANCE, accessToken });
        await Promise.allSettled([
          initPreferences(client),
          initInstance(client, BSKY_INSTANCE),
        ]);
        notifyAuthChanged();
        const redirectPath = store.session.get('loginRedirect') || '/';
        store.session.del('loginRedirect');
        navigatePath(redirectPath, { replace: true });
      } catch (err) {
        console.error(err);
        setUIState('error');
      } finally {
        setUIState('default');
      }
    })();
  };

  const submitBlueskyOAuth = (e: SyntheticEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!bskyIdentifier) return;
    void (async () => {
      store.local.set('settings-appview', appview);
      applyAppviewTheme(appview);
      setUIState('loading');
      try {
        await startAtprotoOAuthLogin(bskyIdentifier.trim());
      } catch (err) {
        console.error(err);
        setUIState('error');
      } finally {
        setUIState('default');
      }
    })();
  };

  return (
    <main id="login" style={{ textAlign: 'center' }}>
      <form onSubmit={submitBluesky}>
        <h1>
          <img src={logo} alt="" width="80" height="80" />
          <br />
          <Trans>Log in</Trans>
        </h1>
        <section className="bsky-login">
          <label>
            <div
              style={{
                position: 'relative',
                display: 'inline-block',
                width: '100%',
              }}
            >
              <input
                value={bskyIdentifier}
                type="text"
                className="large"
                aria-label="Handle or PDS URL"
                disabled={uiState === 'loading'}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="username"
                spellCheck={false}
                onInput={(e: SyntheticEvent<HTMLInputElement>) => {
                  setBskyIdentifier(e.currentTarget.value);
                }}
                onFocus={() => setHandleFocused(true)}
                onBlur={() => setHandleFocused(false)}
                style={{ width: '100%' }}
              />
              {!bskyIdentifier && !handleFocused && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    color: 'var(--placeholder-color, #999)',
                    whiteSpace: 'nowrap',
                    fontSize: 'inherit',
                  }}
                >
                  you
                  <span
                    style={{
                      display: 'inline-block',
                      opacity: suffixFading ? 0 : 1,
                      transform: suffixFading
                        ? 'translateY(-4px)'
                        : 'translateY(0)',
                      transition: 'opacity 0.25s ease, transform 0.25s ease',
                    }}
                  >
                    {currentSuffix}
                  </span>
                </span>
              )}
            </div>
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5em',
              marginTop: '1em',
            }}
          >
            AppView:{' '}
            <select
              value={appview}
              onChange={(e) =>
                setAppview((e.target as HTMLSelectElement).value)
              }
            >
              {Object.entries(APPVIEW_OPTIONS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: '1em' }}>
            <button
              type="button"
              disabled={uiState === 'loading' || !bskyIdentifier}
              onClick={submitBlueskyOAuth}
            >
              Connect to Atmosphere
            </button>
          </div>
          <details className="bsky-advanced-login">
            <summary>Use app password</summary>
            <label>
              <p>App password</p>
              <input
                value={bskyPassword}
                type="password"
                className="large"
                aria-label={t`App password`}
                disabled={uiState === 'loading'}
                autoComplete="current-password"
                onInput={(e: SyntheticEvent<HTMLInputElement>) => {
                  setBskyPassword(e.currentTarget.value);
                }}
              />
            </label>
            <label>
              <p>PDS URL, optional</p>
              <input
                value={bskyService}
                type="text"
                className="large"
                aria-label={t`PDS URL, optional`}
                disabled={uiState === 'loading'}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="url"
                spellCheck={false}
                placeholder="pds.example.com"
                onInput={(e: SyntheticEvent<HTMLInputElement>) => {
                  setBskyService(e.currentTarget.value);
                }}
              />
            </label>
            <div>
              <button
                type="submit"
                disabled={
                  uiState === 'loading' || !bskyIdentifier || !bskyPassword
                }
              >
                Continue with app password
              </button>
            </div>
          </details>
        </section>
        {uiState === 'error' && (
          <p className="error">
            <Trans>
              Failed to log in. Please check your handle and app password.
            </Trans>
          </p>
        )}
        <Loader hidden={uiState !== 'loading'} />
        <hr />
        <p>
          <Link to="/">
            <Trans>Go home</Trans>
          </Link>
        </p>
        <LangSelector />
      </form>
    </main>
  );
}

export default Login;
