import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Agent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { useQuery } from '@tanstack/react-query';

import {
  baselineAcceptedLabelers,
  createClients,
  getPdsRepoAgentFor,
  restorePdsRepoAgentFor,
  type ClientBundle,
} from '../data/clients';
import {
  DEFAULT_APPVIEW_CONFIG,
  useSessionsStore,
} from '../state/sessions';
import {
  getCachedAtprotoOAuthSession,
  restoreAtprotoOAuthSession,
} from '../utils/atproto-oauth';

const ClientsContext = createContext<ClientBundle | null>(null);
const ActiveSessionContext = createContext<OAuthSession | null>(null);
const AcceptedLabelerDidsContext = createContext<readonly string[]>(
  baselineAcceptedLabelers(),
);
const AcceptedLabelerSyncContext = createContext<
  (dids: readonly string[]) => void
>(() => {});

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
      : DEFAULT_APPVIEW_CONFIG,
  );

  const [session, setSession] = useState<OAuthSession | null>(() =>
    activeDid ? getCachedAtprotoOAuthSession(activeDid) : null,
  );
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
        if (!restored.includes(did)) {
          removeKnown(did);
        }
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

  const clients = useMemo(
    () =>
      createClients({
        session,
        activeAppViewService: appViewCfg.service,
        activeAppViewDid: appViewCfg.proxyDid,
        acceptedLabelerDids,
      }),
    [acceptedLabelerDids, appViewCfg.proxyDid, appViewCfg.service, session],
  );

  return (
    <ActiveSessionContext.Provider value={session}>
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
