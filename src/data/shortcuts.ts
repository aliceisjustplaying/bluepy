import { useEffect, useMemo } from 'react';

import { useActiveDid } from '../contexts/SessionProvider';
import { useShortcutsStore } from '../state/shortcuts';

import {
  reconcileShortcutBar,
  type ShortcutItem,
} from './_internal/reconcile-shortcuts';
import { usePreferences } from './preferences';

export function useShortcutBar(): ShortcutItem[] {
  const activeDid = useActiveDid();
  const localOrder = useShortcutsStore((state) =>
    activeDid ? state.getOrder(activeDid) : [],
  );
  const { data: prefs } = usePreferences();
  const pinned = useMemo(
    () => (prefs?.savedFeeds ?? []).filter((feed) => feed.pinned),
    [prefs?.savedFeeds],
  );
  const reconciled = useMemo(
    () => reconcileShortcutBar(localOrder, pinned),
    [localOrder, pinned],
  );
  const setOrder = useShortcutsStore((state) => state.setOrder);

  useEffect(() => {
    if (activeDid && reconciled.changed) {
      setOrder(activeDid, reconciled.nextOrder);
    }
  }, [activeDid, reconciled.changed, reconciled.nextOrder, setOrder]);

  return reconciled.items;
}

export function useSetShortcutOrder(): (order: ShortcutItem[]) => void {
  const activeDid = useActiveDid();
  const setOrder = useShortcutsStore((state) => state.setOrder);

  return (items) => {
    if (!activeDid) return;
    setOrder(
      activeDid,
      items.map((item) =>
        item.src === 'server'
          ? { src: 'server', kind: item.kind, id: item.id }
          : { src: 'local', kind: item.kind, id: item.id },
      ),
    );
  };
}
