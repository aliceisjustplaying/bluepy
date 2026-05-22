import mem from './mem';
// TODO(oxlint:import/no-cycle): store <-> store-utils cycle is structural; see
// store.ts for the rationale and break-up plan.
import store from './store';

type JsonRecord = Record<string, unknown>;

export interface AccountInfo {
  readonly id: string;
  readonly avatar?: string;
  readonly avatar_static?: string;
  readonly displayName?: string;
  readonly [key: string]: unknown;
}

export interface StoredAccount {
  accessToken: string;
  atproto?: boolean;
  createdAt?: number;
  info: AccountInfo;
  instanceURL: string;
  lastAccessedAt?: number;
  updatedAt?: number;
  vapidKey?: string | null;
}

type InstanceConfiguration = JsonRecord & {
  polls?: JsonRecord;
  statuses?: JsonRecord;
  vapid?: {
    public_key?: string;
    publicKey?: string;
  };
};

type InstanceInfo = JsonRecord & {
  configuration?: InstanceConfiguration;
  version?: string;
};

export function getAccounts(): StoredAccount[] {
  return store.local.getJSON<StoredAccount[]>('accounts') ?? [];
}

const removedAccountIDs = new Set<string>();

export function saveAccounts(accounts: readonly StoredAccount[]): void {
  store.local.setJSON(
    'accounts',
    accounts.filter((account) => !removedAccountIDs.has(account.info.id)),
  );
}

const MINS_5 = 5 * 60 * 1000;
export function getAccount(id?: string | null): StoredAccount | null {
  const accounts = getAccounts();
  const account =
    id === undefined || id === null
      ? accounts[0]
      : accounts.find((candidate) => candidate.info.id === id);
  if (!account) {
    return null;
  }
  const now = Date.now();
  // Only update if more than 5 mins
  if (
    account.lastAccessedAt === undefined ||
    now - account.lastAccessedAt > MINS_5
  ) {
    account.lastAccessedAt = now;
    saveAccounts(accounts);
  }
  return account;
}

export function getAccountByAccessToken(
  accessToken: string,
): StoredAccount | undefined {
  const accounts = getAccounts();
  return accounts.find((account) => account.accessToken === accessToken);
}

export function getAccountByInstance(
  instance: string,
): StoredAccount | undefined {
  const accounts = getAccounts();
  return accounts.find((account) => account.instanceURL === instance);
}

const standaloneMQ =
  typeof window !== 'undefined'
    ? window.matchMedia('(display-mode: standalone)')
    : null;

export function getCurrentAccountID(): string | null {
  try {
    const id = store.session.get('currentAccount');
    if (id) {
      return id;
    }
  } catch {}
  if (standaloneMQ?.matches) {
    try {
      const id = store.local.get('currentAccount');
      if (id) {
        return id;
      }
    } catch {}
  }
  return null;
}

// Memoized version of getCurrentAccountID for performance
export const getCurrentAccID = mem(getCurrentAccountID, {
  expires: 60 * 1000, // 1 minute
});

export function setCurrentAccountID(id: string): void {
  getCurrentAccID.cache.clear();
  try {
    getCurrentAcc.cache.clear();
  } catch {}
  try {
    store.session.set('currentAccount', id);
  } catch {}
  if (standaloneMQ?.matches) {
    try {
      store.local.set('currentAccount', id);
    } catch {}
  }
}

export function removeAccount(id: string): void {
  removedAccountIDs.add(id);
  getCurrentAccID.cache.clear();
  try {
    getCurrentAcc.cache.clear();
  } catch {}
  saveAccounts(getAccounts());
  try {
    if (store.session.get('currentAccount') === id) {
      store.session.del('currentAccount');
    }
  } catch {}
  if (standaloneMQ?.matches) {
    try {
      if (store.local.get('currentAccount') === id) {
        store.local.del('currentAccount');
      }
    } catch {}
  }
}

export function getCurrentAccount(): StoredAccount | null {
  if (!window.__IGNORE_GET_ACCOUNT_ERROR__) {
    // Track down getCurrentAccount() calls before account-based states are initialized
    console.error('getCurrentAccount() called before states are initialized');
    if (import.meta.env.DEV) {
      console.trace();
    }
  }
  const currentAccount = getCurrentAccountID();
  let account = getAccount(currentAccount);
  if (!account) {
    // Fallback to the first account if currentAccount is not found
    account = getAccount();
  }
  return account;
}

// Memoized version of getCurrentAccount for performance
export const getCurrentAcc = mem(getCurrentAccount, {
  expires: 60 * 1000, // 1 minute
});

export function getCurrentAccountNS(): string {
  const account = getCurrentAccount();
  if (!account) {
    throw new Error('Current account not found');
  }
  const {
    instanceURL,
    info: { id },
  } = account;
  return `${id}@${instanceURL}`;
}

export function saveAccount(account: StoredAccount): void {
  removedAccountIDs.delete(account.info.id);
  const accounts = getAccounts();
  const acc = accounts.find(
    (storedAccount) => storedAccount.info.id === account.info.id,
  );
  if (acc) {
    acc.info = account.info;
    acc.instanceURL = account.instanceURL;
    acc.accessToken = account.accessToken;
    acc.vapidKey = account.vapidKey;
    acc.updatedAt = Date.now();
  } else {
    accounts.push(account);
  }
  saveAccounts(accounts);
}

export function updateAccount(accountInfo: AccountInfo): void {
  // Only update if displayName or avatar or avatar_static is different
  const accounts = getAccounts();
  const acc = accounts.find((account) => account.info.id === accountInfo.id);
  if (
    acc &&
    (acc.info.displayName !== accountInfo.displayName ||
      acc.info.avatar !== accountInfo.avatar ||
      acc.info.avatar_static !== accountInfo.avatar_static)
  ) {
    acc.info = {
      ...acc.info,
      ...accountInfo,
    };
    saveAccounts(accounts);
  }
}

let currentInstance: InstanceInfo | null = null;
export function getCurrentInstance(): InstanceInfo {
  if (currentInstance) {
    return currentInstance;
  }
  try {
    const account = getCurrentAccount();
    if (!account) {
      return {};
    }
    const instances =
      store.local.getJSON<Record<string, InstanceInfo>>('instances');
    const instance = account.instanceURL.toLowerCase();
    return (currentInstance = instances?.[instance] ?? {});
  } catch (error) {
    console.error(error);
    // alert(`Failed to load instance configuration. Please try again.\n\n${e}`);
    // Temporary fix for corrupted data
    // store.local.del('instances');
    // location.reload();
    return {};
  }
}

function getInstanceConfiguration(
  instance: InstanceInfo,
): InstanceConfiguration {
  const { configuration } = instance;
  return {
    ...configuration,
    polls: configuration?.polls ?? {},
    statuses: configuration?.statuses ?? {},
  };
}

export function getCurrentInstanceConfiguration(): InstanceConfiguration {
  const instance = getCurrentInstance();
  return getInstanceConfiguration(instance);
}

export function getVapidKey(instance?: InstanceInfo): unknown {
  // Vapid key has moved from account to instance config
  const config = instance
    ? getInstanceConfiguration(instance)
    : getCurrentInstanceConfiguration();
  const vapidKey = config.vapid?.publicKey ?? config.vapid?.public_key;
  return vapidKey ?? getCurrentAccount()?.vapidKey;
}
