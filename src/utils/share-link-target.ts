export const DEFAULT_SHARE_LINK_TARGET = 'bluepy';

export type ShareLinkTarget = 'bluepy' | 'bsky';

export function isShareLinkTarget(value: unknown): value is ShareLinkTarget {
  return value === 'bluepy' || value === 'bsky';
}

export function getShareLinkTarget(value: unknown): ShareLinkTarget {
  return isShareLinkTarget(value) ? value : DEFAULT_SHARE_LINK_TARGET;
}
