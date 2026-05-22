import { Agent } from '@atproto/api';
import {
  BrowserOAuthClient,
  type BrowserOAuthClientOptions,
  type OAuthSession,
} from '@atproto/oauth-client-browser';

import { BSKY_PDS } from './atproto-login-service';

export const ATPROTO_OAUTH_SCOPE = 'atproto transition:generic';

function buildClientMetadata(
  origin: string,
): NonNullable<BrowserOAuthClientOptions['clientMetadata']> {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Bluepy',
    client_uri: `${origin}/`,
    logo_uri: `${origin}/logo-512.png`,
    policy_uri:
      'https://github.com/aliceisjustplaying/bluepy/blob/bluesky/PRIVACY.MD',
    redirect_uris: [`${origin}/`],
    scope: ATPROTO_OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

export const ATPROTO_OAUTH_CLIENT_METADATA = buildClientMetadata(
  'https://bluepy.social',
);

const oauthSessions = new Map<string, OAuthSession>();
let oauthClientPromise: Promise<BrowserOAuthClient> | undefined;
let oauthInitPromise: ReturnType<BrowserOAuthClient['init']> | undefined;

function isLoopbackOrigin(origin: string = location.origin): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === 'http:' &&
      (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export function getAtprotoOAuthClientOptions(
  origin: string = location.origin,
): BrowserOAuthClientOptions {
  return {
    handleResolver: BSKY_PDS,
    responseMode: 'query',
    clientMetadata: isLoopbackOrigin(origin)
      ? undefined
      : buildClientMetadata(origin),
  };
}

export interface AtprotoOAuthAccessTokenPayload {
  type: 'atproto-oauth';
  sub: string;
}

export function createAtprotoOAuthAccessToken(sub: string): string {
  return JSON.stringify({
    type: 'atproto-oauth',
    sub,
  } satisfies AtprotoOAuthAccessTokenPayload);
}

export function parseAtprotoOAuthAccessToken(
  accessToken: string | null | undefined,
): AtprotoOAuthAccessTokenPayload | null {
  if (!accessToken) return null;
  try {
    const data: unknown = JSON.parse(accessToken);
    if (
      data !== null &&
      typeof data === 'object' &&
      (data as { type?: unknown }).type === 'atproto-oauth' &&
      typeof (data as { sub?: unknown }).sub === 'string' &&
      (data as { sub: string }).sub.length > 0
    ) {
      return data as AtprotoOAuthAccessTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

async function getAtprotoOAuthClient(): Promise<BrowserOAuthClient> {
  if (window.__BLUEPY_OAUTH_TEST_CLIENT__) {
    return window.__BLUEPY_OAUTH_TEST_CLIENT__ as BrowserOAuthClient;
  }
  if (!oauthClientPromise) {
    oauthClientPromise = Promise.resolve(
      new BrowserOAuthClient(getAtprotoOAuthClientOptions()),
    );
  }
  return oauthClientPromise;
}

export async function initAtprotoOAuthClient(): ReturnType<
  BrowserOAuthClient['init']
> {
  const client = await getAtprotoOAuthClient();
  if (!client.init) return undefined;
  if (!oauthInitPromise) {
    oauthInitPromise = client.init().then((result) => {
      if (result?.session) {
        oauthSessions.set(result.session.sub, result.session);
      }
      return result;
    });
  }
  return oauthInitPromise;
}

export async function restoreAtprotoOAuthSession(
  sub: string | null | undefined,
  refresh?: boolean,
): Promise<OAuthSession | null> {
  if (!sub) return null;
  if (oauthSessions.has(sub)) return oauthSessions.get(sub) as OAuthSession;
  const client = await getAtprotoOAuthClient();
  const session = await client.restore(sub, refresh);
  oauthSessions.set(sub, session);
  return session;
}

export function getCachedAtprotoOAuthSession(
  sub: string | null | undefined,
): OAuthSession | null {
  return oauthSessions.get(sub as string) || null;
}

export function createAtprotoOAuthAgent(
  session: OAuthSession | null | undefined,
): Agent | null {
  if (!session) return null;
  return new Agent(session);
}

export async function startAtprotoOAuthLogin(
  input: string,
): Promise<OAuthSession> {
  const client = await getAtprotoOAuthClient();
  return client.signIn(input, {
    scope: ATPROTO_OAUTH_SCOPE,
  });
}

// Revoke an OAuth account's tokens at the authorization server and drop the
// cached session. App-password accounts carry no OAuth token, so they parse to
// null here and are simply cleared locally by the caller. Best-effort: the
// local cache is dropped even if the network revocation fails.
export async function signOutAtprotoOAuthSession(
  accessToken: string | null | undefined,
): Promise<void> {
  const payload = parseAtprotoOAuthAccessToken(accessToken);
  if (!payload?.sub) return;
  oauthSessions.delete(payload.sub);
  try {
    const client = await getAtprotoOAuthClient();
    await client.revoke(payload.sub);
  } catch (error) {
    console.error('Failed to revoke ATProto OAuth session:', error);
  }
}
