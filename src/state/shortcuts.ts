import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ShortcutEntry } from '../data/_internal/reconcile-shortcuts';

interface ShortcutsState {
  orderByDid: Record<string, ShortcutEntry[]>;
  getOrder: (did: string) => ShortcutEntry[];
  setOrder: (did: string, order: ShortcutEntry[]) => void;
}

export const useShortcutsStore = create<ShortcutsState>()(
  persist(
    (set, get) => ({
      orderByDid: {},
      getOrder: (did) => get().orderByDid[did] ?? [],
      setOrder: (did, order) => {
        set((state) => ({
          orderByDid: {
            ...state.orderByDid,
            [did]: order,
          },
        }));
      },
    }),
    {
      name: 'bluepy:shortcuts',
      partialize: (state) => ({ orderByDid: state.orderByDid }),
    },
  ),
);
