import type { Agent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  baselineAcceptedLabelers,
  createClients,
  getPdsRepoAgentFor,
  restorePdsRepoAgentFor,
  type ClientBundle,
} from '../data/clients';
import {
  createAppPasswordAgentForDid,
  syncSessionsStoreFromLegacyAccount,
} from '../data/legacy-session';
import {
  DEFAULT_APPVIEW_CONFIG,
  type AppViewConfig,
  useSessionsStore,
} from '../state/sessions';
import {
  getCachedAtprotoOAuthSession,
  restoreAtprotoOAuthSession,
} from '../utils/atproto-oauth';
import { AUTH_CHANGED_EVENT } from '../utils/auth-context';

const ClientsContext = createContext<ClientBundle | null>(null);
const ActiveSessionContext = createContext<OAuthSession | null>(null);
const AcceptedLabelerDidsContext = createContext<readonly string[]>(
  baselineAcceptedLabelers(),
);
const AcceptedLabelerSyncContext = createContext<
  (dids: readonly string[]) => void
>(() => {});

const LEGACY_APPVIEW_CONFIGS: Record<string, AppViewConfig> = {
  bluesky: DEFAULT_APPVIEW_CONFIG,
  blacksky: {
    service: 'https://api.blacksky.community',
    proxyDid: 'did:web:api.blacksky.community',
    origin: 'https://api.blacksky.community',
  },
};

function getLoggedOutAppViewConfig(): AppViewConfig {
  const legacyKey = window.localStorage.getItem('settings-appview');
  return LEGACY_APPVIEW_CONFIGS[legacyKey ?? ''] ?? DEFAULT_APPVIEW_CONFIG;
}

export function useAcceptedLabelerDids(): readonly string[] {
  return use(AcceptedLabelerDidsContext);
}

export function useAcceptedLabelerSync(): (dids: readonly string[]) => void {
  return use(AcceptedLabelerSyncContext);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const activeDid = useSessionsStore((state) => state.activeDid);
  const knownDids = useSessionsStore((state) => state.knownDids);
  const removeKnown = useSessionsStore((state) => state.removeKnown);
  const appViewCfg = useSessionsStore((state) =>
    activeDid
      ? (state.perAccountPrefs[activeDid]?.activeAppView ??
        DEFAULT_APPVIEW_CONFIG)
      : getLoggedOutAppViewConfig(),
  );

  const [session, setSession] = useState<OAuthSession | null>(() =>
    activeDid ? getCachedAtprotoOAuthSession(activeDid) : null,
  );
  const [legacyAuthVersion, setLegacyAuthVersion] = useState(0);
  const [acceptedLabelerDids, setAcceptedLabelerDids] = useState<
    readonly string[]
  >(() => baselineAcceptedLabelers());
  const syncAcceptedLabelers = useCallback((dids: readonly string[]) => {
    setAcceptedLabelerDids((current) => {
      if (
        current.length === dids.length &&
        current.every((did, index) => did === dids[index])
      ) {
        return current;
      }
      return dids;
    });
  }, []);

  useEffect(() => {
    syncSessionsStoreFromLegacyAccount();
    const onAuthChanged = () => {
      syncSessionsStoreFromLegacyAccount();
      setLegacyAuthVersion((version) => version + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const restored = await Promise.all(
        knownDids.map(async (did) => {
          try {
            const oauthSession = await restoreAtprotoOAuthSession(did);
            return oauthSession ? did : null;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      for (const did of knownDids) {
        if (restored.includes(did)) continue;
        // App-password accounts have no OAuth session; keep them in knownDids.
        if (createAppPasswordAgentForDid(did)) continue;
        removeKnown(did);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [knownDids, removeKnown]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!activeDid) {
        setSession(null);
        return;
      }

      const cached = getCachedAtprotoOAuthSession(activeDid);
      if (cached) {
        setSession(cached);
        return;
      }

      setSession(null);
      try {
        const restored = await restoreAtprotoOAuthSession(activeDid);
        if (!cancelled) setSession(restored);
      } catch {
        if (!cancelled) setSession(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDid]);

  useEffect(() => {
    if (!activeDid) {
      setAcceptedLabelerDids(baselineAcceptedLabelers());
    }
  }, [activeDid]);

  const activeSession = session?.sub === activeDid ? session : null;
  const [appPasswordAgent, setAppPasswordAgent] = useState<Agent | null>(null);

  useEffect(() => {
    if (!activeDid || activeSession) {
      setAppPasswordAgent(null);
      return;
    }
    setAppPasswordAgent(createAppPasswordAgentForDid(activeDid));
  }, [activeDid, activeSession, legacyAuthVersion]);

  const clients = useMemo(
    () =>
      createClients({
        session: activeSession,
        appPasswordAgent,
        activeAppViewService: appViewCfg.service,
        activeAppViewDid: appViewCfg.proxyDid,
        acceptedLabelerDids,
      }),
    [
      acceptedLabelerDids,
      appPasswordAgent,
      appViewCfg.proxyDid,
      appViewCfg.service,
      activeSession,
    ],
  );

  return (
    <ActiveSessionContext.Provider value={activeSession}>
      <AcceptedLabelerSyncContext.Provider value={syncAcceptedLabelers}>
        <AcceptedLabelerDidsContext.Provider value={acceptedLabelerDids}>
          <ClientsContext.Provider value={clients}>
            {children}
          </ClientsContext.Provider>
        </AcceptedLabelerDidsContext.Provider>
      </AcceptedLabelerSyncContext.Provider>
    </ActiveSessionContext.Provider>
  );
}

export function useClients(): ClientBundle {
  const clients = use(ClientsContext);
  if (!clients) {
    throw new Error('useClients must be used within SessionProvider');
  }
  return clients;
}

export function useActiveDid(): string | null {
  return useSessionsStore((state) => state.activeDid);
}

export function useActiveOAuthSession(): OAuthSession | null {
  return use(ActiveSessionContext);
}

export function usePdsRepoAgentFor(did: string): Agent | null {
  const clients = useClients();
  const activeDid = useActiveDid();
  const knownDids = useSessionsStore((state) => state.knownDids);

  const cachedAgent = useMemo(
    () => getPdsRepoAgentFor(clients, did, activeDid),
    [activeDid, clients, did],
  );

  const restoreQuery = useQuery({
    queryKey: ['pdsRepoAgent', did],
    enabled: knownDids.includes(did) && !cachedAgent,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => restorePdsRepoAgentFor(did),
  });

  return cachedAgent ?? restoreQuery.data ?? null;
}
