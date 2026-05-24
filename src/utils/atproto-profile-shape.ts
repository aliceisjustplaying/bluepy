import type { AppBskyActorDefs } from '@atproto/api';

export type AtprotoProfileView =
  | AppBskyActorDefs.ProfileViewBasic
  | AppBskyActorDefs.ProfileView
  | AppBskyActorDefs.ProfileViewDetailed;

export function profileHasCounts(
  profile: unknown,
): profile is AppBskyActorDefs.ProfileViewDetailed {
  if (!profile || typeof profile !== 'object') return false;
  const record = profile as Record<string, unknown>;
  return (
    typeof record.followersCount === 'number' &&
    typeof record.followsCount === 'number' &&
    typeof record.postsCount === 'number'
  );
}
