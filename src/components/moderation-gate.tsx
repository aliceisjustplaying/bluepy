import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { PostModerationDecision } from '../render/moderation-decision';

import Icon from './icon';

export interface ModerationGateProps {
  decision?: PostModerationDecision;
  children: ReactNode;
}

export default function ModerationGate({
  decision,
  children,
}: ModerationGateProps) {
  const [revealed, setRevealed] = useState(false);
  const mustCoverPost = decision?.visibility === 'blur';
  const noOverride = decision?.noOverride;

  if (!decision) {
    return children;
  }

  if (decision.visibility === 'hide') {
    return (
      <article className="status filtered moderation-hidden" tabIndex={-1}>
        <div className="status-filtered-badge badge-meta horizontal">
          <Trans>Content hidden by moderation settings</Trans>
        </div>
      </article>
    );
  }

  if (mustCoverPost && !revealed && !noOverride) {
    return (
      <article className="status filtered moderation-cover" tabIndex={-1}>
        <button
          type="button"
          className="status-filtered-badge clickable badge-meta horizontal"
          onClick={() => {
            setRevealed(true);
          }}
        >
          <Icon icon="eye-close" size="s" alt="" />
          <span>
            {decision.blurAlt ?? 'Content hidden by moderation settings'}
          </span>
          <span className="show-filtered">
            <Trans>Show anyway</Trans>
          </span>
        </button>
      </article>
    );
  }

  if (mustCoverPost && !revealed && noOverride) {
    return (
      <article className="status filtered moderation-cover" tabIndex={-1}>
        <div className="status-filtered-badge badge-meta horizontal">
          <Icon icon="eye-close" size="s" alt="" />
          <span>
            {decision.blurAlt ?? 'Content hidden by moderation settings'}
          </span>
        </div>
      </article>
    );
  }

  if (decision.visibility === 'show') {
    return children;
  }

  return children;
}
