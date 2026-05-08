import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';

const {
  DEV,
  PHANPY_WEBSITE: WEBSITE,
} = import.meta.env;

// Resolve the client_id URL based on environment
// For production: https://<origin>/oauth-client-metadata.json
// For dev: loopback shortcut (http://localhost)
const CLIENT_ID = WEBSITE
  ? `${WEBSITE}/oauth-client-metadata.json`
  : 'http://localhost?redirect_uri=http://localhost/callback&scope=atproto+transition:generic';

const HANDLE_RESOLVER = 'https://public.api.bsky.app';

let oauthClient = null;
let initPromise = null;

/**
 * Get or create the BrowserOAuthClient singleton.
 * Lazy-initialised on first use.
 */
export async function getOAuthClient() {
  if (oauthClient) return oauthClient;
  if (initPromise) return initPromise;

  initPromise = BrowserOAuthClient.load({
    clientId: CLIENT_ID,
    handleResolver: HANDLE_RESOLVER,
  }).then((client) => {
    oauthClient = client;
    return client;
  });

  return initPromise;
}

/**
 * Initialise the OAuth client on page load.
 * Handles both callback completion and session restoration.
 *
 * Returns { session, state } if authenticated, null if not.
 * `session` is an OAuthSession — pass to `new Agent(session)` to get an API agent.
 */
export async function initOAuth() {
  try {
    const client = await getOAuthClient();
    const result = await client.init();

    if (!result) return null;

    if (result.session) {
      return {
        session: result.session,
        state: result.state,
        did: result.session.did,
        handle: result.session.handle,
      };
    }

    return null;
  } catch (e) {
    console.error('OAuth init failed:', e);
    return null;
  }
}

/**
 * Sign in to Bluesky via OAuth.
 * This never returns — the page navigates to the authorisation server.
 */
export async function signInOAuth(handle) {
  const client = await getOAuthClient();
  await client.signIn(handle, {
    scope: 'atproto transition:generic',
  });
  // Never reaches here — window.location changes to the AS
}

/**
 * Sign out of an OAuth session.
 * Revokes at the AS (best-effort) and clears IndexedDB.
 */
export async function signOutOAuth(did) {
  try {
    const client = await getOAuthClient();
    await client.signOut(did);
  } catch (e) {
    console.error('OAuth sign out failed:', e);
  }
}

/**
 * Restore an existing OAuth session by DID.
 * Auto-refreshes if the access token is near expiry.
 */
export async function restoreOAuthSession(did) {
  try {
    const client = await getOAuthClient();
    const session = await client.restore(did);
    if (!session) return null;
    return {
      session,
      did: session.did,
      handle: session.handle,
    };
  } catch (e) {
    console.error('OAuth session restore failed:', e);
    return null;
  }
}

/**
 * Create an @atproto/api Agent from an OAuth session.
 * The agent's fetch handler auto-signs DPoP on every request.
 */
export function createOAuthAgent(oauthSession) {
  return new Agent(oauthSession);
}

/**
 * Subscribe to cross-tab session updates.
 * Call this once on app init to keep UI in sync across tabs.
 */
export function onOAuthSessionUpdate(callback) {
  getOAuthClient().then((client) => {
    client.addEventListener('updated', callback);
  });
}

/**
 * Subscribe to cross-tab session deletion (sign-out).
 */
export function onOAuthSessionDelete(callback) {
  getOAuthClient().then((client) => {
    client.addEventListener('deleted', callback);
  });
}
