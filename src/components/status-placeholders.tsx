import { Trans } from '@lingui/react/macro';

import states from '../utils/states';

import Avatar from './avatar';
import NameText, { type NameTextAccount } from './name-text';
import type { GhostInfo, StatusSize } from './status-types';

interface PlaceholderProps {
  mediaFirst?: boolean;
  size?: StatusSize;
}

interface StatusGhostProps extends PlaceholderProps {
  ghost: GhostInfo;
}

function isNameTextAccount(value: unknown): value is NameTextAccount {
  return (
    !!value &&
    typeof value === 'object' &&
    'acct' in value &&
    typeof value.acct === 'string' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'url' in value &&
    typeof value.url === 'string' &&
    'username' in value &&
    typeof value.username === 'string'
  );
}

export function StatusGhost({
  ghost,
  mediaFirst,
  size = 'm',
}: StatusGhostProps) {
  const { inReplyToAccountId } = ghost;
  const account = inReplyToAccountId ? states.accounts[inReplyToAccountId] : null;
  const ghostAccount = isNameTextAccount(account) ? account : null;
  return (
    <article
      className={`status ghost ${mediaFirst ? 'status-media-first small' : ''}`}
    >
      {!mediaFirst && (
        <Avatar
          size="xxl"
          url={ghostAccount?.avatarStatic || ghostAccount?.avatar}
          squircle={ghostAccount?.bot}
        />
      )}
      <div className="container">
        <div className="meta">
          {(size === 's' || mediaFirst) && (
            <Avatar
              size="m"
              url={ghostAccount?.avatarStatic || ghostAccount?.avatar}
              squircle={ghostAccount?.bot}
            />
          )}
          {ghostAccount && (
            <NameText account={ghostAccount} showAvatar={false} />
          )}
        </div>
        <div className="content-container">
          {mediaFirst && <div className="media-first-container" />}
          <div className={`content ${mediaFirst ? 'media-first-content' : ''}`}>
            <p className="insignificant">
              <Trans>Post unavailable</Trans>
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

export function StatusSkeleton({ mediaFirst, size = 'm' }: PlaceholderProps) {
  return (
    <div
      className={`status skeleton ${mediaFirst ? 'status-media-first small' : ''}`}
    >
      {!mediaFirst && <Avatar size="xxl" />}
      <div className="container">
        <div className="meta">
          {(size === 's' || mediaFirst) && <Avatar size="m" />} ███ ████████
        </div>
        <div className="content-container">
          {mediaFirst && <div className="media-first-container" />}
          <div className={`content ${mediaFirst ? 'media-first-content' : ''}`}>
            <p>████ ████████</p>
          </div>
        </div>
      </div>
    </div>
  );
}
