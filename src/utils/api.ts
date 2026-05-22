import {
  BSKY_INSTANCE,
  atprotoInstanceInfo,
  createAtprotoClient,
  createPublicAtprotoClient,
} from './atproto-adapter';
import {
  getCachedAtprotoOAuthSession,
  parseAtprotoOAuthAccessToken,
  restoreAtprotoOAuthSession,
} from './atproto-oauth';
import mem, { type MemoizedFunction } from './mem';
import store from './store';
import {
  getAccount,
  getAccountByAccessToken,
  getAccountByInstance,
  getCurrentAcc,
  saveAccount,
  setCurrentAccountID,
  type AccountInfo,
  type StoredAccount,
} from './store-utils';

type JsonRecord = Record<string, unknown>;
type TimelinesAccess = Record<string, Record<string, string | undefined>>;

interface AtprotoSession {
  readonly service?: string;
  readonly session?: unknown;
  readonly type?: string;
  readonly [key: string]: unknown;
}

interface AtprotoOAuthToken {
  readonly sub: string;
  readonly [key: string]: unknown;
}

interface SearchResult {
  readonly statuses?: readonly unknown[];
}

type InstanceInfo = JsonRecord & {
  readonly configuration?: {
    readonly timelinesAccess?: TimelinesAccess;
    readonly urls?: {
      readonly streaming?: string;
    };
    readonly [key: string]: unknown;
  };
  readonly domain?: string;
  readonly uri?: string;
  readonly urls?: {
    readonly streamingApi?: string;
  };
};

export interface MastoClient {
  readonly v1: {
    readonly accounts: {
      verifyCredentials(): Promise<AccountInfo>;
    };
    readonly instance: {
      fetch(): Promise<InstanceInfo | null | undefined>;
    };
    readonly preferences: {
      fetch(): Promise<JsonRecord>;
    };
    readonly [key: string]: unknown;
  };
  readonly v2: {
    readonly instance: {
      fetch(): Promise<InstanceInfo | null | undefined>;
    };
    readonly search: {
      list(options: {
        readonly limit: number;
        readonly q: string;
        readonly type: 'statuses';
      }): Promise<SearchResult | null | undefined>;
    };
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

type StreamingClient = unknown;

interface ApiClient {
  streamingCallback?: ((streaming: StreamingClient) => void) | null;
  accessToken?: string | null;
  atproto?: boolean;
  instance: string;
  masto: MastoClient;
  streaming?: StreamingClient;
  onStreamingReady(callback: (streaming: StreamingClient) => void): void;
}

interface ApiOptions {
  readonly accessToken?: string;
  readonly account?: StoredAccount | null;
  readonly accountID?: string;
  readonly instance?: string;
}

interface ApiResult {
  readonly authenticated: boolean;
  readonly client: ApiClient;
  readonly instance: string;
  readonly masto: MastoClient;
  readonly streaming?: StreamingClient;
}

const readAtprotoOAuthToken = parseAtprotoOAuthAccessToken as (
  accessToken?: string | null,
) => AtprotoOAuthToken | null | undefined;
const restoreAtprotoSession = restoreAtprotoOAuthSession as (
  subject: string,
) => Promise<unknown>;
const readCachedAtprotoOAuthSession = getCachedAtprotoOAuthSession as (
  subject?: string,
) => unknown;

// Per-instance masto instance
// Useful when only one account is logged in
// I'm not sure if I'll ever allow multiple logged-in accounts but oh well...
// E.g. apis['mastodon.social']
const apis: Record<string, ApiClient | undefined> = {};

// Per-account masto instance
// Note: There can be many accounts per instance
// Useful when multiple accounts are logged in or when certain actions require a specific account
// Just in case if I need this one day.
// E.g. accountApis['mastodon.social']['ACCESS_TOKEN']
const accountApis: Record<
  string,
  Record<string, ApiClient | undefined> | undefined
> = {};
window.__ACCOUNT_APIS__ = accountApis;

// Current account masto instance
let currentAccountApi: ApiClient | undefined;

function ensureAccountApis(
  instance: string,
): Record<string, ApiClient | undefined> {
  return (accountApis[instance] ??= {});
}

function getAccountApi(
  instance: string,
  accessToken: string,
): ApiClient | undefined {
  return accountApis[instance]?.[accessToken];
}

function cacheClient(client: ApiClient): void {
  apis[client.instance] = client;
  ensureAccountApis(client.instance);
  if (client.accessToken) {
    ensureAccountApis(client.instance)[client.accessToken] = client;
  }
}

export function initClient({
  accessToken,
}: {
  readonly accessToken?: string | null;
  readonly instance?: string | null;
}): ApiClient {
  // ATProto-only: there is no non-Bluesky runtime, so every client targets the
  // Bluesky AppView regardless of the requested instance.
  const normalizedInstance = BSKY_INSTANCE;
  const atprotoSession = parseAtprotoSession(accessToken);
  const atprotoOAuthSession = readAtprotoOAuthToken(accessToken);
  const oauthSession = readCachedAtprotoOAuthSession(atprotoOAuthSession?.sub);
  let client: ApiClient | undefined;
  let persistedAccessToken = accessToken;
  const persistSession = (_event: unknown, session: unknown) => {
    if (!session || !persistedAccessToken) {
      return;
    }
    const account = getAccountByAccessToken(persistedAccessToken);
    if (!account) {
      return;
    }
    const nextAccessToken = JSON.stringify({
      service: atprotoSession?.service,
      session,
      type: 'atproto',
    });
    account.accessToken = nextAccessToken;
    account.updatedAt = Date.now();
    saveAccount(account);
    const cachedAccountApis = accountApis[normalizedInstance];
    if (cachedAccountApis?.[persistedAccessToken] !== undefined) {
      delete cachedAccountApis[persistedAccessToken];
    }
    persistedAccessToken = nextAccessToken;
    if (client) {
      client.accessToken = nextAccessToken;
      ensureAccountApis(normalizedInstance)[nextAccessToken] = client;
    }
  };
  const masto = (
    atprotoSession || atprotoOAuthSession
      ? createAtprotoClient({
          oauthSession,
          persistSession,
          service: atprotoSession?.service,
          session: atprotoSession?.session,
        })
      : createPublicAtprotoClient()
  ) as MastoClient;
  client = {
    accessToken,
    atproto: true,
    instance: normalizedInstance,
    masto,
    onStreamingReady(callback) {
      this.streamingCallback = callback;
    },
  };
  cacheClient(client);
  return client;
}

function parseAtprotoSession(
  accessToken?: string | null,
): AtprotoSession | null {
  if (!accessToken) {
    return null;
  }
  try {
    const data = JSON.parse(accessToken) as AtprotoSession;
    return data?.type === 'atproto' ? data : null;
  } catch {
    return null;
  }
}

export async function hydrateAtprotoOAuthAccessToken(
  accessToken: string,
): Promise<string> {
  const data = readAtprotoOAuthToken(accessToken);
  if (!data) {
    return accessToken;
  }
  await restoreAtprotoSession(data.sub);
  return accessToken;
}

export function hasInstance(instance: string): boolean {
  const instances =
    store.local.getJSON<Record<string, unknown>>('instances') ?? {};
  return Boolean(instances[instance]);
}

export function getMastoV1Resource<T>(
  masto: MastoClient,
  resourceName: string,
  assertResource?: (resource: unknown) => resource is T,
): T {
  const resource: unknown = masto.v1[resourceName];
  if (assertResource && !assertResource(resource)) {
    throw new TypeError(`Invalid masto.v1 resource: ${resourceName}`);
  }
  return resource as T;
}

export function getMastoV2Resource<T>(
  masto: MastoClient,
  resourceName: string,
  assertResource?: (resource: unknown) => resource is T,
): T {
  const resource: unknown = masto.v2[resourceName];
  if (assertResource && !assertResource(resource)) {
    throw new TypeError(`Invalid masto.v2 resource: ${resourceName}`);
  }
  return resource as T;
}

// Store the instance configuration; the config is needed for composing.
// ATProto-only: the Bluesky AppView config is synthesized locally rather than
// fetched, so there is no instance/NodeInfo probing or streaming setup.
export async function initInstance(
  client: ApiClient,
  instance: string,
): Promise<void> {
  const instances =
    store.local.getJSON<Record<string, unknown>>('instances') ?? {};
  const info = atprotoInstanceInfo();
  instances[BSKY_INSTANCE] = info;
  if (instance) {
    instances[instance.toLowerCase()] = info;
  }
  store.local.setJSON('instances', instances);
}

// Get the account information and store it
export async function initAccount(
  client: ApiClient,
  instance: string,
  accessToken: string,
  vapidKey?: string | null,
): Promise<void> {
  const atprotoAccount = await client.masto.v1.accounts.verifyCredentials();
  setCurrentAccountID(atprotoAccount.id);
  saveAccount({
    accessToken,
    atproto: true,
    createdAt: Date.now(),
    info: atprotoAccount,
    instanceURL: BSKY_INSTANCE,
    vapidKey,
  });
}

export const getPreferences = mem(
  () => store.account.get<JsonRecord>('preferences') ?? {},
  {
    expires: 60 * 1000, // 1 minute
  },
) as MemoizedFunction<readonly [], JsonRecord>;

const preferenceListeners = new Set<() => void>();
let preferenceSnapshot: JsonRecord | undefined;

export function getPreferenceSnapshot(): JsonRecord {
  preferenceSnapshot ??= getPreferences();
  return preferenceSnapshot;
}

export function subscribePreferences(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

export function setPreferences(preferences: JsonRecord): void {
  getPreferences.cache.clear(); // Clear memo cache
  store.account.set('preferences', preferences);
  preferenceSnapshot = preferences;
  preferenceListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  });
}

export function hasPreferences(): boolean {
  return Boolean(getPreferences());
}

// Get preferences
export async function initPreferences(client: ApiClient): Promise<void> {
  try {
    const { masto } = client;
    __BENCHMARK.start('fetch-preferences');
    const preferences = await masto.v1.preferences.fetch();
    __BENCHMARK.end('fetch-preferences');
    setPreferences(preferences);
  } catch (error) {
    // Silently fail
    console.error(error);
  }
}

// Get the masto instance
// If accountID is provided, get the masto instance for that account
export function api({
  instance: requestedInstance,
  accessToken,
  accountID,
  account,
}: ApiOptions = {}): ApiResult {
  // ATProto-only: initClient always targets the Bluesky AppView and caches under
  // BSKY_INSTANCE, so normalize any requested route instance to BSKY_INSTANCE.
  // Otherwise a logged-in user on a legacy `/:instance/...` route would miss the
  // cached/stored account and fall through to a public (logged-out) client.
  const instance = requestedInstance ? BSKY_INSTANCE : undefined;

  // If instance and accessToken are provided, get the masto instance for that account
  if (instance && accessToken) {
    const client =
      getAccountApi(instance, accessToken) ??
      initClient({ accessToken, instance });
    const { masto, streaming } = client;
    return {
      authenticated: true,
      client,
      instance,
      masto,
      streaming,
    };
  }

  if (accessToken) {
    // If only accessToken is provided, get the masto instance for that accessToken
    for (const cachedInstance in accountApis) {
      const clientForAccessToken = getAccountApi(cachedInstance, accessToken);
      if (clientForAccessToken) {
        const { masto, streaming } = clientForAccessToken;
        return {
          authenticated: true,
          client: clientForAccessToken,
          instance: cachedInstance,
          masto,
          streaming,
        };
      }
    }
    const storedAccount = getAccountByAccessToken(accessToken);
    if (storedAccount) {
      const storedAccessToken = storedAccount.accessToken;
      const storedInstance = storedAccount.instanceURL.toLowerCase().trim();
      const client = initClient({
        accessToken: storedAccessToken,
        instance: storedInstance,
      });
      const { masto, streaming } = client;
      return {
        authenticated: true,
        client,
        instance: storedInstance,
        masto,
        streaming,
      };
    }
    throw new Error('Access token not found');
  }

  // If account is provided, get the masto instance for that account
  if (account || accountID) {
    const storedAccount = account ?? getAccount(accountID);
    if (storedAccount) {
      const storedAccessToken = storedAccount.accessToken;
      const storedInstance = storedAccount.instanceURL.toLowerCase().trim();
      const client =
        getAccountApi(storedInstance, storedAccessToken) ??
        initClient({
          accessToken: storedAccessToken,
          instance: storedInstance,
        });
      const { masto, streaming } = client;
      return {
        authenticated: true,
        client,
        instance: storedInstance,
        masto,
        streaming,
      };
    }
    throw new Error(`Account ${accountID} not found`);
  }

  const currentAccount = getCurrentAcc();

  // If only instance is provided, get the masto instance for that instance
  if (instance) {
    if (currentAccountApi?.instance === instance) {
      return {
        authenticated: true,
        client: currentAccountApi,
        instance,
        masto: currentAccountApi.masto,
        streaming: currentAccountApi.streaming,
      };
    }

    if (currentAccount?.instanceURL === instance) {
      const { accessToken: currentAccessToken } = currentAccount;
      currentAccountApi =
        getAccountApi(instance, currentAccessToken) ??
        initClient({ accessToken: currentAccessToken, instance });
      return {
        authenticated: true,
        client: currentAccountApi,
        instance,
        masto: currentAccountApi.masto,
        streaming: currentAccountApi.streaming,
      };
    }

    const instanceAccount = getAccountByInstance(instance);
    if (instanceAccount) {
      const storedAccessToken = instanceAccount.accessToken;
      const client =
        getAccountApi(instance, storedAccessToken) ??
        initClient({ accessToken: storedAccessToken, instance });
      const { masto, streaming } = client;
      return {
        authenticated: true,
        client,
        instance,
        masto,
        streaming,
      };
    }

    const client = apis[instance] ?? initClient({ instance });
    const { masto, streaming, accessToken: clientAccessToken } = client;
    return {
      authenticated: Boolean(clientAccessToken),
      client,
      instance,
      masto,
      streaming,
    };
  }

  // If no instance is provided, get the masto instance for the current account
  if (currentAccountApi) {
    return {
      authenticated: true,
      client: currentAccountApi,
      instance: currentAccountApi.instance,
      masto: currentAccountApi.masto,
      streaming: currentAccountApi.streaming,
    };
  }
  if (currentAccount) {
    const { accessToken: currentAccessToken, instanceURL: currentInstance } =
      currentAccount;
    currentAccountApi =
      getAccountApi(currentInstance, currentAccessToken) ??
      initClient({
        accessToken: currentAccessToken,
        instance: currentInstance,
      });
    return {
      authenticated: true,
      client: currentAccountApi,
      instance: currentInstance,
      masto: currentAccountApi.masto,
      streaming: currentAccountApi.streaming,
    };
  }

  // If no instance is provided and no account is logged in, fall back to the
  // public (unauthenticated) Bluesky AppView client.
  const client = apis[BSKY_INSTANCE] ?? initClient({ instance: BSKY_INSTANCE });
  const { masto, streaming } = client;
  return {
    authenticated: false,
    client,
    instance: BSKY_INSTANCE,
    masto,
    streaming,
  };
}

window.__API__ = {
  accountApis,
  apis,
};
