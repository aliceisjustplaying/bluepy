import type { AppBskyActorDefs } from '@atproto/api';
import type { mastodon } from 'masto';

import { useProfile } from '../data/profiles';

import AccountBlock from './account-block';
import Loader from './loader';
import ProfileModerationGate from './profile-moderation-gate';

function profileToAccount(
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed,
): mastodon.v1.Account {
  const detailed =
    profile as AppBskyActorDefs.ProfileViewDetailed;
  return {
    id: profile.did,
    acct: profile.handle,
    username: profile.handle.split('.')[0] ?? profile.handle,
    displayName: profile.displayName || profile.handle,
    avatar: profile.avatar || '',
    avatarStatic: profile.avatar || '',
    header: detailed.banner || '',
    headerStatic: detailed.banner || '',
    locked: false,
    bot: false,
    group: false,
    createdAt: profile.indexedAt || new Date().toISOString(),
    note: profile.description || '',
    url: `https://bsky.app/profile/${profile.handle}`,
    followersCount: detailed.followersCount ?? 0,
    followingCount: detailed.followsCount ?? 0,
    statusesCount: detailed.postsCount ?? 0,
    lastStatusAt: profile.indexedAt || null,
    emojis: [],
    fields: [],
    roles: [],
  } as mastodon.v1.Account;
}

export interface ProfileByDidProps {
  did: string;
  instance?: string;
  showStats?: boolean;
}

export default function ProfileByDid({
  did,
  instance = 'bsky.social',
  showStats = false,
}: ProfileByDidProps) {
  const { data: profile, isLoading, error } = useProfile(did);

  if (isLoading) {
    return <Loader abrupt />;
  }

  if (error || !profile) {
    return null;
  }

  return (
    <ProfileModerationGate profile={profile}>
      <AccountBlock
        account={profileToAccount(profile)}
        instance={instance}
        showStats={showStats}
      />
    </ProfileModerationGate>
  );
}
