import type { AppBskyActorDefs } from '@atproto/api';
import type { mastodon } from 'masto';

export type RenderableProfile =
  | AppBskyActorDefs.ProfileViewBasic
  | AppBskyActorDefs.ProfileView
  | AppBskyActorDefs.ProfileViewDetailed;

export function profileToAccount(
  profile: RenderableProfile,
): mastodon.v1.Account {
  const createdAt =
    'indexedAt' in profile && profile.indexedAt
      ? profile.indexedAt
      : 'createdAt' in profile &&
          typeof profile.createdAt === 'string' &&
          profile.createdAt
        ? profile.createdAt
        : new Date().toISOString();
  const banner = 'banner' in profile ? (profile.banner ?? '') : '';
  const description =
    'description' in profile ? (profile.description ?? '') : '';
  const followersCount =
    'followersCount' in profile && profile.followersCount
      ? profile.followersCount
      : 0;
  const followingCount =
    'followsCount' in profile && profile.followsCount
      ? profile.followsCount
      : 0;
  const postsCount =
    'postsCount' in profile && profile.postsCount
      ? profile.postsCount
      : 0;

  return {
    id: profile.did,
    acct: profile.handle,
    username: profile.handle.split('.')[0] ?? profile.handle,
    displayName: profile.displayName || profile.handle,
    avatar: profile.avatar || '',
    avatarStatic: profile.avatar || '',
    header: banner,
    headerStatic: banner,
    locked: false,
    bot: false,
    group: false,
    createdAt,
    note: description,
    url: `https://bsky.app/profile/${profile.handle}`,
    followersCount,
    followingCount,
    statusesCount: postsCount,
    lastStatusAt: createdAt,
    emojis: [],
    fields: [],
    roles: [],
  } as mastodon.v1.Account;
}
