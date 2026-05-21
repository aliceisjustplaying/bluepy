import "./login.css";

import { Trans, useLingui } from "@lingui/react/macro";
import Fuse from "fuse.js";
import type { SyntheticEvent } from "react";
import { useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import logo from "../assets/logo.svg";

import LangSelector from "../components/lang-selector";
import Link from "../components/link";
import Loader from "../components/loader";
import instancesListURL from "../data/instances.json?url";
import { initClient, initInstance, initPreferences } from "../utils/api";
import {
  APPVIEW_OPTIONS,
  BSKY_INSTANCE,
  applyAppviewTheme,
  getActiveAppview,
  loginAtproto,
} from "../utils/atproto-adapter";
import { startAtprotoOAuthLogin } from "../utils/atproto-oauth";
import {
  getAuthorizationURL,
  getPKCEAuthorizationURL,
  registerApplication,
} from "../utils/auth";
import { notifyAuthChanged } from "../utils/auth-context";
import { openAuthPopup, watchAuthPopup } from "../utils/auth-popup";
import { supportsPKCE } from "../utils/oauth-pkce";
import { navigatePath } from "../utils/router";
import store from "../utils/store";
import {
  getCredentialApplication,
  hasAccountInInstance,
  saveAccount,
  setCurrentAccountID,
  storeCredentialApplication,
} from "../utils/store-utils";
import useTitle from "../utils/useTitle";

interface CredentialApplicationShape extends Record<string, unknown> {
  client_id?: string;
  client_secret?: string;
}

const HANDLE_SUFFIXES = [
  ".bsky.social",
  ".blacksky.app",
  ".eurosky.social",
  ".pckt.cafe",
  ".com",
  ".tngl.sh",
  ".myatproto.social",
  ".margin.cafe",
  ".selfhosted.social",
  ".npmx.social",
];

interface SuffixState {
  currentSuffix: string;
  suffixFading: boolean;
}

type SuffixAction = { type: "fade" } | { type: "replace"; suffix: string };

interface LoginFormState {
  bskyIdentifier: string;
  bskyPassword: string;
  bskyService: string;
  appview: string;
  handleFocused: boolean;
}

type LoginFormAction =
  | { type: "identifier"; value: string }
  | { type: "password"; value: string }
  | { type: "service"; value: string }
  | { type: "appview"; value: string }
  | { type: "handleFocused"; value: boolean };

function suffixReducer(state: SuffixState, action: SuffixAction): SuffixState {
  switch (action.type) {
    case "fade":
      return { ...state, suffixFading: true };
    case "replace":
      return { currentSuffix: action.suffix, suffixFading: false };
  }
  return state;
}

function loginFormReducer(
  state: LoginFormState,
  action: LoginFormAction,
): LoginFormState {
  switch (action.type) {
    case "identifier":
      return { ...state, bskyIdentifier: action.value };
    case "password":
      return { ...state, bskyPassword: action.value };
    case "service":
      return { ...state, bskyService: action.value };
    case "appview":
      return { ...state, appview: action.value };
    case "handleFocused":
      return { ...state, handleFocused: action.value };
  }
  return state;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

async function loadInstancesList(): Promise<string[]> {
  const res = await fetch(instancesListURL);
  return stringArray(await res.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function credentialApplication(
  value: unknown,
): CredentialApplicationShape | null {
  if (!isRecord(value)) return null;
  return {
    ...value,
    client_id:
      typeof value.client_id === "string" ? value.client_id : undefined,
    client_secret:
      typeof value.client_secret === "string"
        ? value.client_secret
        : undefined,
  };
}

function useLoginController() {
  const { t } = useLingui();
  useTitle(t`Log in`, "/login");
  const cachedInstanceURL = store.local.get("instanceURL");
  const [uiState, setUIState] = useState<"default" | "loading" | "error">(
    "default",
  );
  const [
    { bskyIdentifier, bskyPassword, bskyService, appview, handleFocused },
    dispatchLoginForm,
  ] = useReducer(loginFormReducer, {
    bskyIdentifier: "",
    bskyPassword: "",
    bskyService: "",
    appview: getActiveAppview(),
    handleFocused: false,
  });
  useEffect(() => {
    applyAppviewTheme(appview);
  }, [appview]);
  const remainingSuffixes = useRef<string[]>([]);
  const [{ currentSuffix, suffixFading }, dispatchSuffix] = useReducer(
    suffixReducer,
    {
      currentSuffix: HANDLE_SUFFIXES[0],
      suffixFading: false,
    },
  );
  const currentSuffixRef = useRef(currentSuffix);
  currentSuffixRef.current = currentSuffix;
  useEffect(() => {
    const id = setInterval(() => {
      dispatchSuffix({ type: "fade" });
      setTimeout(() => {
        if (remainingSuffixes.current.length === 0) {
          remainingSuffixes.current = HANDLE_SUFFIXES.filter(
            (s) => s !== currentSuffixRef.current,
          ).toSorted(() => Math.random() - 0.5);
        }
        dispatchSuffix({
          type: "replace",
          suffix: remainingSuffixes.current.pop() ?? HANDLE_SUFFIXES[0],
        });
      }, 500);
    }, 1500);
    return () => {
      clearInterval(id);
    };
  }, []);
  const [searchParams] = useSearchParams();
  const instance = searchParams.get("instance");
  const submit = searchParams.get("submit");
  const [instanceText] = useState(
    instance || cachedInstanceURL?.toLowerCase() || "",
  );

  const [instancesList, setInstancesList] = useReducer(
    (_currentInstances: string[], nextInstances: string[]) => nextInstances,
    [],
  );
  const searcher = useRef<Fuse<string> | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      try {
        const data = await loadInstancesList();
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

    void (async () => {
      // WEB_DOMAIN vs LOCAL_DOMAIN negotiation time
      // https://docs.joinmastodon.org/admin/config/#web_domain
      try {
        const res = await fetch(`https://${instanceURL}/.well-known/host-meta`); // returns XML
        const text = await res.text();
        // Parse XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        // Get Link[template]
        const link = xmlDoc.getElementsByTagName("Link")[0];
        const template = link.getAttribute("template");
        const url = template ? URL.parse(template) : null;
        if (url) {
          const { host } = url; // host includes the port
          if (instanceURL !== host) {
            console.log(`💫 ${instanceURL} -> ${host}`);
            instanceURL = host;
          }
        }
      } catch (e) {
        // Silently fail
        console.error(e);
      }

      store.local.set("instanceURL", instanceURL);

      setUIState("loading");
      try {
        let credentialApp = credentialApplication(
          getCredentialApplication(instanceURL),
        );
        if (
          !credentialApp ||
          !credentialApp.client_id ||
          !credentialApp.client_secret
        ) {
          credentialApp = credentialApplication(
            await registerApplication({
              instanceURL,
            }),
          );
          if (!credentialApp) {
            throw new Error("Unable to register application");
          }
          storeCredentialApplication(instanceURL, credentialApp);
        }

        const { client_id, client_secret } = credentialApp;

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
            store.sessionCookie.set("codeVerifier", verifier);
            authUrl = url;
          } else {
            alert(t`Failed to register application`);
            setUIState("default");
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
            setUIState("default");
            return;
          }
        }

        const popup = openAuthPopup(authUrl);

        if (popup) {
          watchAuthPopup(
            popup,
            (code) => {
              setUIState("default");
              const callbackUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
              window.location.href = callbackUrl;
            },
            (error) => {
              console.error("Popup auth error:", error);
              setUIState("error");
            },
          );
        } else {
          // Popup blocked, fallback to redirect
          console.log("Popup blocked, falling back to redirect");
          location.href = authUrl;
        }
      } catch (e) {
        console.error(e);
        setUIState("error");
      }
    })();
  };

  const cleanInstanceText = instanceText
    ? instanceText
        .replace(/^https?:\/\//, "") // Remove protocol from instance URL
        .replace(/\/+$/, "") // Remove trailing slash
        .replace(/^@?[^@]+@/, "") // Remove @?acct@
        .trim()
    : null;
  const instanceTextLooksLikeDomain =
    !!cleanInstanceText &&
    /[^\s\r\n\t/\\]+\.[^\s\r\n\t/\\]+/.test(cleanInstanceText) &&
    !/[\s/\\@]/.test(cleanInstanceText);

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
        ? instancesList.find((item) => item.includes(instanceText))
        : null;

  const submitBluesky = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bskyIdentifier || !bskyPassword) return;
    void (async () => {
      store.local.set("settings-appview", appview);
      applyAppviewTheme(appview);
      setUIState("loading");
      try {
        const { account, session, service } = await loginAtproto({
          identifier: bskyIdentifier.trim(),
          password: bskyPassword,
          service: bskyService,
        });
        const accessToken = JSON.stringify({
          type: "atproto",
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
        const redirectPath = store.session.get("loginRedirect") || "/";
        store.session.del("loginRedirect");
        navigatePath(redirectPath, { replace: true });
        setUIState("default");
      } catch (err) {
        console.error(err);
        setUIState("error");
      }
    })();
  };

  const submitBlueskyOAuth = (e: SyntheticEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!bskyIdentifier) return;
    void (async () => {
      store.local.set("settings-appview", appview);
      applyAppviewTheme(appview);
      setUIState("loading");
      try {
        await startAtprotoOAuthLogin(bskyIdentifier.trim());
        setUIState("default");
      } catch (err) {
        console.error(err);
        setUIState("error");
      }
    })();
  };

  // Intentional one-shot: mirror the JS original's `if (submit) {
  // useEffect(..., []) }` semantics by capturing the relevant values into a
  // ref the first time the effect runs and ignoring all subsequent updates.
  const submitOnMountRef = useRef({
    submit,
    instance,
    selectedInstanceText,
    submitInstance,
  });
  useEffect(() => {
    const initial = submitOnMountRef.current;
    if (initial.submit) {
      initial.submitInstance(initial.instance || initial.selectedInstanceText);
    }
  }, []);

  return {
    appview,
    bskyIdentifier,
    bskyPassword,
    bskyService,
    currentSuffix,
    dispatchLoginForm,
    handleFocused,
    submitBluesky,
    submitBlueskyOAuth,
    suffixFading,
    uiState,
  };
}

type LoginController = ReturnType<typeof useLoginController>;

function AppPasswordDetails({
  bskyIdentifier,
  bskyPassword,
  bskyService,
  dispatchLoginForm,
  uiState,
}: Pick<
  LoginController,
  | "bskyIdentifier"
  | "bskyPassword"
  | "bskyService"
  | "dispatchLoginForm"
  | "uiState"
>) {
  return (
    <details className="bsky-advanced-login">
      <summary>Use app password</summary>
      <label>
        <p>App password</p>
        <input
          value={bskyPassword}
          type="password"
          className="large"
          disabled={uiState === "loading"}
          autoComplete="current-password"
          onChange={(e: SyntheticEvent<HTMLInputElement>) => {
            dispatchLoginForm({
              type: "password",
              value: e.currentTarget.value,
            });
          }}
        />
      </label>
      <label>
        <p>PDS URL, optional</p>
        <input
          value={bskyService}
          type="text"
          className="large"
          disabled={uiState === "loading"}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="url"
          spellCheck={false}
          placeholder="pds.example.com"
          onChange={(e: SyntheticEvent<HTMLInputElement>) => {
            dispatchLoginForm({
              type: "service",
              value: e.currentTarget.value,
            });
          }}
        />
      </label>
      <div>
        <button
          type="submit"
          disabled={uiState === "loading" || !bskyIdentifier || !bskyPassword}
        >
          Continue with app password
        </button>
      </div>
    </details>
  );
}

function BskyLoginSection({
  appview,
  bskyIdentifier,
  bskyPassword,
  bskyService,
  currentSuffix,
  dispatchLoginForm,
  handleFocused,
  submitBlueskyOAuth,
  suffixFading,
  uiState,
}: Omit<LoginController, "submitBluesky">) {
  return (
    <section className="bsky-login">
      <label>
        <div className="bsky-identifier-field">
          <input
            value={bskyIdentifier}
            type="text"
            className="large"
            aria-label="Handle or PDS URL"
            disabled={uiState === "loading"}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="username"
            spellCheck={false}
            onChange={(e: SyntheticEvent<HTMLInputElement>) => {
              dispatchLoginForm({
                type: "identifier",
                value: e.currentTarget.value,
              });
            }}
            onFocus={() => {
              dispatchLoginForm({ type: "handleFocused", value: true });
            }}
            onBlur={() => {
              dispatchLoginForm({ type: "handleFocused", value: false });
            }}
          />
          {!bskyIdentifier && !handleFocused && (
            <span aria-hidden="true" className="bsky-identifier-placeholder">
              you
              <span
                className={`bsky-identifier-suffix ${
                  suffixFading ? "fading" : "visible"
                }`}
              >
                {currentSuffix}
              </span>
            </span>
          )}
        </div>
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5em",
          marginTop: "1em",
        }}
      >
        AppView:{" "}
        <select
          value={appview}
          onChange={(e) => {
            dispatchLoginForm({
              type: "appview",
              value: e.currentTarget.value,
            });
          }}
        >
          {Object.entries(APPVIEW_OPTIONS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ marginTop: "1em" }}>
        <button
          type="button"
          disabled={uiState === "loading" || !bskyIdentifier}
          onClick={submitBlueskyOAuth}
        >
          Connect to Atmosphere
        </button>
      </div>
      <AppPasswordDetails
        bskyIdentifier={bskyIdentifier}
        bskyPassword={bskyPassword}
        bskyService={bskyService}
        dispatchLoginForm={dispatchLoginForm}
        uiState={uiState}
      />
    </section>
  );
}

function Login() {
  const controller = useLoginController();
  const { submitBluesky, uiState } = controller;

  return (
    <main id="login" style={{ textAlign: "center" }}>
      <form onSubmit={submitBluesky}>
        <h1>
          <img src={logo} alt="" width="80" height="80" />
          <br />
          <Trans>Log in</Trans>
        </h1>
        <BskyLoginSection {...controller} />
        {uiState === "error" && (
          <p className="error">
            <Trans>
              Failed to log in. Please check your handle and app password.
            </Trans>
          </p>
        )}
        <Loader hidden={uiState !== "loading"} />
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
