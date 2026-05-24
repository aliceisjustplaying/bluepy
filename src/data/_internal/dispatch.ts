import type { CallMode } from '../clients';

export function feedReadMode(activeDid: string | null): CallMode {
  return activeDid
    ? 'authenticated-active-appview-via-pds'
    : 'public-active-appview';
}

export function blueskyOnlyReadMode(activeDid: string | null): CallMode {
  return activeDid
    ? 'authenticated-bluesky-appview-via-pds'
    : 'public-bluesky-appview';
}
