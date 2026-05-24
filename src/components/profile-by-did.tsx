import { useProfile } from '../data/profiles';
import { profileToAccount } from '../render/profile-view-map';

import AccountBlock from './account-block';
import Loader from './loader';
import ProfileModerationGate from './profile-moderation-gate';

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
