import { useMemo } from 'react';

import {
  appviewKey,
  stableHash,
  type AccountScope,
  type ViewerScope,
} from './keys';
import {
  DEFAULT_APPVIEW_CONFIG,
  useSessionsStore,
} from '../state/sessions';
import {
  useAcceptedLabelerDids,
  useActiveDid,
} from '../contexts/SessionProvider';

export function useAccountScope(): AccountScope | null {
  const activeDid = useActiveDid();
  return activeDid ? ([activeDid] as const) : null;
}

export function useViewerScope(): ViewerScope {
  const activeDid = useActiveDid();
  const appViewCfg = useSessionsStore((state) =>
    activeDid
      ? (state.perAccountPrefs[activeDid]?.activeAppView ??
        DEFAULT_APPVIEW_CONFIG)
      : DEFAULT_APPVIEW_CONFIG,
  );

  const acceptedLabelerDids = useAcceptedLabelerDids();

  return useMemo(
    () =>
      [
        activeDid ?? 'public',
        appviewKey(appViewCfg.proxyDid, appViewCfg.origin),
        stableHash(acceptedLabelerDids),
      ] as const,
    [acceptedLabelerDids, activeDid, appViewCfg.origin, appViewCfg.proxyDid],
  );
}
