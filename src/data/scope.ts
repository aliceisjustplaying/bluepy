import { useMemo } from 'react';

import {
  appviewKey,
  stableHash,
  type AccountScope,
  type ViewerScope,
} from './keys';
import { baselineAcceptedLabelers } from './clients';
import {
  DEFAULT_APPVIEW_CONFIG,
  useSessionsStore,
} from '../state/sessions';
import { useActiveDid } from '../contexts/SessionProvider';

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

  return useMemo(() => {
    const acceptedLabelerDids = baselineAcceptedLabelers();
    return [
      activeDid ?? 'public',
      appviewKey(appViewCfg.proxyDid, appViewCfg.origin),
      stableHash(acceptedLabelerDids),
    ] as const;
  }, [activeDid, appViewCfg.origin, appViewCfg.proxyDid]);
}
