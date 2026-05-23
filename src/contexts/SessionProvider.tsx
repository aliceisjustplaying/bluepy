import { createContext, use, useMemo, type ReactNode } from 'react';

import {
  BSKY_APPVIEW_URL,
  createClients,
  type ClientBundle,
} from '../data/clients';

const ClientsContext = createContext<ClientBundle | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const clients = useMemo(
    () =>
      createClients({
        session: null,
        activeAppViewService: BSKY_APPVIEW_URL,
      }),
    [],
  );

  return (
    <ClientsContext.Provider value={clients}>{children}</ClientsContext.Provider>
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
  return null;
}
