import { getAPIVersions, getCurrentInstance } from './store-utils';

export function supportsNativeQuote(): boolean {
  if (getCurrentInstance()?.domain === 'bsky.social') return true;
  return ((getAPIVersions()?.mastodon as number | undefined) ?? 0) >= 7;
}

export function getPostQuoteApprovalPolicy(
  quoteApproval: Record<string, unknown> | null | undefined,
): string {
  const k = (quoteApproval?.currentUser as string | undefined) ?? '';
  const entry = quoteApproval?.[k] as { [i: number]: string } | undefined;
  return entry?.[0] || 'nobody';
}
