export const MUTED_POST_VISIBILITIES = ['hide', 'collapse', 'show'] as const;

export type MutedPostVisibility = (typeof MUTED_POST_VISIBILITIES)[number];

export const DEFAULT_MUTED_POST_VISIBILITY: MutedPostVisibility = 'hide';

interface SettingsLike {
  mutedPostVisibility?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isMutedPostVisibility(
  value: unknown,
): value is MutedPostVisibility {
  return MUTED_POST_VISIBILITIES.some((visibility) => visibility === value);
}

export function getMutedPostVisibility(
  settings: SettingsLike | undefined,
): MutedPostVisibility {
  const visibility = settings?.mutedPostVisibility;
  return isMutedPostVisibility(visibility)
    ? visibility
    : DEFAULT_MUTED_POST_VISIBILITY;
}

function accountID(status: unknown): string | undefined {
  if (!isRecord(status)) return undefined;
  const account = status.account;
  if (!isRecord(account)) return undefined;
  return typeof account.id === 'string' ? account.id : undefined;
}

export function hasMutedAuthor(status: unknown): boolean {
  if (!isRecord(status)) return false;
  const atproto = status._atproto;
  const reblog = status.reblog;
  if (isRecord(atproto) && atproto.mutedAuthor === true) {
    return true;
  }
  return hasMutedAuthor(reblog);
}

function isCurrentAccountStatus(
  status: unknown,
  currentAccountID: string | null | undefined,
): boolean {
  return !!currentAccountID && accountID(status) === currentAccountID;
}

export function shouldHideMutedStatus({
  status,
  currentAccountID,
  visibility,
  forceShowMuted,
  directContext,
}: {
  status: unknown;
  currentAccountID: string | null | undefined;
  visibility: MutedPostVisibility;
  forceShowMuted?: boolean;
  directContext?: boolean;
}): boolean {
  if (forceShowMuted || visibility !== 'hide' || directContext) {
    return false;
  }
  if (isCurrentAccountStatus(status, currentAccountID)) return false;
  return hasMutedAuthor(status);
}

export function shouldCollapseMutedStatus({
  status,
  currentAccountID,
  visibility,
  forceShowMuted,
  directContext,
}: {
  status: unknown;
  currentAccountID: string | null | undefined;
  visibility: MutedPostVisibility;
  forceShowMuted?: boolean;
  directContext?: boolean;
}): boolean {
  if (forceShowMuted || visibility === 'show') return false;
  if (visibility === 'hide' && !directContext) return false;
  if (isCurrentAccountStatus(status, currentAccountID)) return false;
  return hasMutedAuthor(status);
}
