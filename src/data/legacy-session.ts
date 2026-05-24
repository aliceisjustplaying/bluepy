import { Agent, AtpAgent, type AtpSessionData } from '@atproto/api';

import {
  DEFAULT_APPVIEW_CONFIG,
  type AppViewConfig,
  useSessionsStore,
} from '../state/sessions';
import store from '../utils/store';
import {
  getAccount,
  getCurrentAccount,
  type StoredAccount,
} from '../utils/store-utils';

interface AppPasswordAccessToken {
  type?: string;
  service?: string;
  session?: AtpSessionData;
}

const LEGACY_APPVIEW_CONFIGS: Record<string, AppViewConfig> = {
  bluesky: DEFAULT_APPVIEW_CONFIG,
  blacksky: {
    service: 'https://api.blacksky.community',
    proxyDid: 'did:web:api.blacksky.community',
    origin: 'https://api.blacksky.community',
  },
};

function getLegacyActiveAppViewConfig(): AppViewConfig {
  return (
    LEGACY_APPVIEW_CONFIGS[store.local.get('settings-appview') || ''] ??
    DEFAULT_APPVIEW_CONFIG
  );
}

function parseAppPasswordAccessToken(
  accessToken: string | null | undefined,
): AppPasswordAccessToken | null {
  if (!accessToken) return null;
  try {
    const data = JSON.parse(accessToken) as AppPasswordAccessToken;
    return data?.type === 'atproto' ? data : null;
  } catch {
    return null;
  }
}

function isAppPasswordAccount(account: StoredAccount | null | undefined): boolean {
  if (!account?.atproto) return false;
  return parseAppPasswordAccessToken(account.accessToken) !== null;
}

export function createAppPasswordAgentForDid(did: string): Agent | null {
  let account: StoredAccount | null;
  try {
    account = getAccount(did) ?? getCurrentAccount();
  } catch {
    return null;
  }
  if (!account || account.info.id !== did || !isAppPasswordAccount(account)) {
    return null;
  }

  const token = parseAppPasswordAccessToken(account.accessToken);
  if (!token?.session) return null;

  const service = token.service?.trim() || 'https://bsky.social';
  const agent = new AtpAgent({ service });
  agent.sessionManager.session = token.session;
  agent.configureLabelers([]);
  return agent;
}

export function syncSessionsStoreFromLegacyAccount(): string | null {
  let account: ReturnType<typeof getCurrentAccount>;
  try {
    account = getCurrentAccount();
  } catch {
    return null;
  }
  const did =
    typeof account?.info?.id === 'string' && account.atproto
      ? account.info.id
      : null;
  if (!did) return null;

  const sessionsStore = useSessionsStore.getState();
  sessionsStore.addKnown(did, { activeAppView: getLegacyActiveAppViewConfig() });
  if (sessionsStore.activeDid !== did) {
    sessionsStore.setActive(did);
  }
  return did;
}
