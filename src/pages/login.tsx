import './login.css';

import { Trans, useLingui } from '@lingui/react/macro';
import Fuse from 'fuse.js';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSearchParams } from 'react-router-dom';

import logo from '../assets/logo.svg';

import LangSelector from '../components/lang-selector';
import Link from '../components/link';
import Loader from '../components/loader';
import instancesListURL from '../data/instances.json?url';
import { initClient, initInstance, initPreferences } from '../utils/api';
import { BSKY_INSTANCE, loginAtproto } from '../utils/atproto-adapter';
import { startAtprotoOAuthLogin } from '../utils/atproto-oauth';
import {
  getAuthorizationURL,
  getPKCEAuthorizationURL,
  registerApplication,
} from '../utils/auth';
import { openAuthPopup, watchAuthPopup } from '../utils/auth-popup';
import { supportsPKCE } from '../utils/oauth-pkce';
import store from '../utils/store';
import {
  getCredentialApplication,
  hasAccountInInstance,
  saveAccount,
  setCurrentAccountID,
  storeCredentialApplication,
} from '../utils/store-utils';
import useTitle from '../utils/useTitle';

interface CredentialApplicationShape extends Record<string, unknown> {
  client_id?: string;
  client_secret?: string;
}

function Login() {
  const { t } = useLingui();
  useTitle(t`Log in`, '/login');
  const instanceURLRef = useRef<HTMLInputElement | null>(null);
  const cachedInstanceURL = store.local.get('instanceURL');
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [bskyIdentifier, setBskyIdentifier] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [bskyService, setBskyService] = useState('');
  const [searchParams] = useSearchParams();
  const instance = searchParams.get('instance');
  const submit = searchParams.get('submit');
  const [instanceText, setInstanceText] = useState(
    instance || cachedInstanceURL?.toLowerCase() || '',
  );

  const [instancesList, setInstancesList] = useState<string[]>([]);
  const searcher = useRef<Fuse<string> | undefined>(undefined);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(instancesListURL);
        const data = await res.json();
        setInstancesList(data);
        searcher.current = new Fuse(data);
      } catch (e) {
        // Silently fail
        console.error(e);
      }
    })();
  }, []);

  // useEffect(() => {
  //   if (cachedInstanceURL) {
  //     instanceURLRef.current.value = cachedInstanceURL.toLowerCase();
  //   }
  // }, []);

  const submitInstance = (instanceURL: string | null | undefined) => {
    if (!instanceURL) return;

    (async () => {
      // WEB_DOMAIN vs LOCAL_DOMAIN negotiation time
      // https://docs.joinmastodon.org/admin/config/#web_domain
      try {
        const res = await fetch(`https://${instanceURL}/.well-known/host-meta`); // returns XML
        const text = await res.text();
        // Parse XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        // Get Link[template]
        const link = xmlDoc.getElementsByTagName('Link')[0];
        const template = link.getAttribute('template');
        const url = URL.parse(template!);
        const { host } = url!; // host includes the port
        if (instanceURL !== host) {
          console.log(`💫 ${instanceURL} -> ${host}`);
          instanceURL = host;
        }
      } catch (e) {
        // Silently fail
        console.error(e);
      }

      store.local.set('instanceURL', instanceURL);

      setUIState('loading');
      try {
        let credentialApplication = getCredentialApplication(
          instanceURL,
        ) as CredentialApplicationShape | null;
        if (
          !credentialApplication ||
          !credentialApplication.client_id ||
          !credentialApplication.client_secret
        ) {
          credentialApplication = (await registerApplication({
            instanceURL,
          })) as CredentialApplicationShape;
          storeCredentialApplication(instanceURL, credentialApplication);
        }

        const { client_id, client_secret } = credentialApplication;

        const authPKCE = await supportsPKCE({ instanceURL });
        console.log({ authPKCE });
        const forceLogin = hasAccountInInstance(instanceURL);

        let authUrl;
        if (authPKCE && window.isSecureContext) {
          if (client_id && client_secret) {
            const [url, verifier] = await getPKCEAuthorizationURL({
              instanceURL,
              client_id,
              forceLogin,
            });
            store.sessionCookie.set('codeVerifier', verifier);
            authUrl = url;
          } else {
            alert(t`Failed to register application`);
            setUIState('default');
            return;
          }
        } else {
          if (client_id && client_secret) {
            authUrl = await getAuthorizationURL({
              instanceURL,
              client_id,
              forceLogin,
            });
          } else {
            alert(t`Failed to register application`);
            setUIState('default');
            return;
          }
        }

        const popup = openAuthPopup(authUrl);

        if (popup) {
          watchAuthPopup(
            popup,
            (code) => {
              const callbackUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
              window.location.href = callbackUrl;
            },
            (error) => {
              console.error('Popup auth error:', error);
              setUIState('error');
            },
          );
        } else {
          // Popup blocked, fallback to redirect
          console.log('Popup blocked, falling back to redirect');
          location.href = authUrl;
        }

        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  };

  const cleanInstanceText = instanceText
    ? instanceText
        .replace(/^https?:\/\//, '') // Remove protocol from instance URL
        .replace(/\/+$/, '') // Remove trailing slash
        .replace(/^@?[^@]+@/, '') // Remove @?acct@
        .trim()
    : null;
  const instanceTextLooksLikeDomain =
    /[^\s\r\n\t\/\\]+\.[^\s\r\n\t\/\\]+/.test(cleanInstanceText as string) &&
    !/[\s\/\\@]/.test(cleanInstanceText as string);

  const instancesSuggestions = cleanInstanceText
    ? searcher.current
        ?.search(cleanInstanceText, {
          limit: 10,
        })
        ?.map((match) => match.item)
    : [];

  const selectedInstanceText = instanceTextLooksLikeDomain
    ? cleanInstanceText
    : instancesSuggestions?.length
      ? instancesSuggestions[0]
      : instanceText
        ? instancesList.find((instance) => instance.includes(instanceText))
        : null;

  const onSubmit = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.preventDefault();
    // const { elements } = e.target;
    // let instanceURL = elements.instanceURL.value.toLowerCase();
    // // Remove protocol from instance URL
    // instanceURL = instanceURL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    // // Remove @acct@ or acct@ from instance URL
    // instanceURL = instanceURL.replace(/^@?[^@]+@/, '');
    // if (!/\./.test(instanceURL)) {
    //   instanceURL = instancesList.find((instance) =>
    //     instance.includes(instanceURL),
    //   );
    // }
    // submitInstance(instanceURL);
    submitInstance(selectedInstanceText);
  };

  const submitBluesky = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.preventDefault();
    if (!bskyIdentifier || !bskyPassword) return;
    (async () => {
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
        location.href = location.pathname || '/';
      } catch (e) {
        console.error(e);
        setUIState('error');
      } finally {
        setUIState('default');
      }
    })();
  };

  const submitBlueskyOAuth = (
    e: JSX.TargetedEvent<HTMLButtonElement, Event>,
  ) => {
    e.preventDefault();
    if (!bskyIdentifier) return;
    (async () => {
      setUIState('loading');
      try {
        await startAtprotoOAuthLogin(bskyIdentifier.trim());
      } catch (e) {
        console.error(e);
        setUIState('error');
      } finally {
        setUIState('default');
      }
    })();
  };

  if (submit) {
    useEffect(() => {
      submitInstance(instance || selectedInstanceText);
    }, []);
  }

  return (
    <main id="login" style={{ textAlign: 'center' }}>
      <form onSubmit={submitBluesky}>
        <h1>
          <img src={logo} alt="" width="80" height="80" />
          <br />
          <Trans>Log in</Trans>
        </h1>
        <section class="bsky-login">
          <h2>Bluesky</h2>
          <label>
            <p>Handle or PDS URL</p>
            <input
              value={bskyIdentifier}
              type="text"
              class="large"
              disabled={uiState === 'loading'}
              autocorrect="off"
              autocapitalize="off"
              autocomplete="username"
              spellcheck={false}
              placeholder="alice.bsky.social"
              onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) =>
                setBskyIdentifier(e.currentTarget.value)
              }
            />
          </label>
          <div>
            <button
              type="button"
              disabled={uiState === 'loading' || !bskyIdentifier}
              onClick={submitBlueskyOAuth}
            >
              Continue with OAuth
            </button>
          </div>
          <details class="bsky-advanced-login">
            <summary>Use app password</summary>
            <label>
              <p>App password</p>
              <input
                value={bskyPassword}
                type="password"
                class="large"
                disabled={uiState === 'loading'}
                autocomplete="current-password"
                onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) =>
                  setBskyPassword(e.currentTarget.value)
                }
              />
            </label>
            <label>
              <p>PDS URL, optional</p>
              <input
                value={bskyService}
                type="text"
                class="large"
                disabled={uiState === 'loading'}
                autocorrect="off"
                autocapitalize="off"
                autocomplete="url"
                spellcheck={false}
                placeholder="pds.example.com"
                onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) =>
                  setBskyService(e.currentTarget.value)
                }
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
          <p class="error">
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
