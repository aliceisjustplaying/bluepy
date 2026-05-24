import { Trans } from '@lingui/react/macro';
import type { AppBskyActorDefs } from '@atproto/api';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { useProfileModeration } from '../data/moderation';
import type { ProfileModerationDecision } from '../render/moderation-decision';

import Icon from './icon';

export interface ProfileModerationGateProps {
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed
    | undefined;
  children: ReactNode;
}

function ProfileModerationCover({
  decision,
  revealed,
  onReveal,
}: {
  decision: ProfileModerationDecision;
  revealed: boolean;
  onReveal: () => void;
}) {
  if (decision.visibility === 'hide') {
    return (
      <div className="account-block filtered moderation-hidden">
        <div className="status-filtered-badge badge-meta horizontal">
          <Trans>Profile hidden by moderation settings</Trans>
        </div>
      </div>
    );
  }

  if (
    decision.visibility === 'blur' &&
    !revealed &&
    !decision.noOverride
  ) {
    return (
      <div className="account-block filtered moderation-cover">
        <button
          type="button"
          className="status-filtered-badge clickable badge-meta horizontal"
          onClick={onReveal}
        >
          <Icon icon="eye-close" size="s" alt="" />
          <span>Profile hidden by moderation settings</span>
          <span className="show-filtered">
            <Trans>Show anyway</Trans>
          </span>
        </button>
      </div>
    );
  }

  if (
    decision.visibility === 'blur' &&
    !revealed &&
    decision.noOverride
  ) {
    return (
      <div className="account-block filtered moderation-cover">
        <div className="status-filtered-badge badge-meta horizontal">
          <Icon icon="eye-close" size="s" alt="" />
          <span>Profile hidden by moderation settings</span>
        </div>
      </div>
    );
  }

  return null;
}

export default function ProfileModerationGate({
  profile,
  children,
}: ProfileModerationGateProps) {
  const [revealed, setRevealed] = useState(false);
  const decision = useProfileModeration(profile);

  if (!profile) {
    return null;
  }

  if (!decision || decision.visibility === 'show' || revealed) {
    return children;
  }

  return (
    <ProfileModerationCover
      decision={decision}
      revealed={revealed}
      onReveal={() => {
        setRevealed(true);
      }}
    />
  );
}
