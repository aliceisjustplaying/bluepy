import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { OAuthSession } from '@atproto/oauth-client-browser';

import {
  baselineAcceptedLabelers,
  createClients,
  getPdsRepoAgentFor,
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

  const clients = useMemo(
    () =>
      createClients({
        session,
        activeAppViewService: appViewCfg.service,
        activeAppViewDid: appViewCfg.proxyDid,
        acceptedLabelerDids: baselineAcceptedLabelers(),
      }),
    [appViewCfg.proxyDid, appViewCfg.service, session],
  );

  return (
    <ActiveSessionContext.Provider value={session}>
      <ClientsContext.Provider value={clients}>
        {children}
      </ClientsContext.Provider>
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

export function usePdsRepoAgentFor(did: string) {
  const activeDid = useActiveDid();
  const activeSession = use(ActiveSessionContext);
  const session =
    did === activeDid ? activeSession : getCachedAtprotoOAuthSession(did);
  return getPdsRepoAgentFor(session);
}
