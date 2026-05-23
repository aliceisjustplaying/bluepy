import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppViewConfig {
  service: string;
  proxyDid: string;
  origin: string;
}

export interface AccountPrefs {
  activeAppView: AppViewConfig;
}

interface SessionsState {
  activeDid: string | null;
  knownDids: string[];
  perAccountPrefs: Record<string, AccountPrefs>;
  setActive: (did: string) => void;
  addKnown: (did: string, prefs?: Partial<AccountPrefs>) => void;
  removeKnown: (did: string) => void;
  setActiveAppView: (did: string, cfg: AppViewConfig) => void;
}

export const DEFAULT_APPVIEW_CONFIG: AppViewConfig = {
  service: 'https://public.api.bsky.app',
  proxyDid: 'did:web:api.bsky.app',
  origin: 'https://public.api.bsky.app',
};

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set) => ({
      activeDid: null,
      knownDids: [],
      perAccountPrefs: {},
      setActive: (did) => set({ activeDid: did }),
      addKnown: (did, prefs) =>
        set((state) => ({
          knownDids: state.knownDids.includes(did)
            ? state.knownDids
            : [...state.knownDids, did],
          perAccountPrefs: {
            ...state.perAccountPrefs,
            [did]: {
              activeAppView:
                prefs?.activeAppView ??
                state.perAccountPrefs[did]?.activeAppView ??
                DEFAULT_APPVIEW_CONFIG,
            },
          },
        })),
      removeKnown: (did) =>
        set((state) => {
          const knownDids = state.knownDids.filter((entry) => entry !== did);
          const perAccountPrefs = { ...state.perAccountPrefs };
          delete perAccountPrefs[did];
          return {
            knownDids,
            perAccountPrefs,
            activeDid: state.activeDid === did ? knownDids[0] ?? null : state.activeDid,
          };
        }),
      setActiveAppView: (did, cfg) =>
        set((state) => ({
          perAccountPrefs: {
            ...state.perAccountPrefs,
            [did]: {
              ...state.perAccountPrefs[did],
              activeAppView: cfg,
            },
          },
        })),
    }),
    {
      name: 'bluepy:sessions',
      partialize: (state) => ({
        activeDid: state.activeDid,
        knownDids: state.knownDids,
        perAccountPrefs: state.perAccountPrefs,
      }),
    },
  ),
);
