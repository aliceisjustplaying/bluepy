import { Trans } from '@lingui/react/macro';

import states from '../utils/states';

import Avatar from './avatar';
import NameText from './name-text';
import type { AnyAccount, GhostInfo, StatusSize } from './status-types';

interface PlaceholderProps {
  mediaFirst?: boolean;
  size?: StatusSize;
}

interface StatusGhostProps extends PlaceholderProps {
  ghost: GhostInfo;
}

export function StatusGhost({
  ghost,
  mediaFirst,
  size = 'm',
}: StatusGhostProps) {
  const { inReplyToAccountId } = ghost;
  const ghostAccount = (
    inReplyToAccountId ? states.accounts[inReplyToAccountId] : null
  ) as AnyAccount | null;
  return (
    <article
      class={`status ghost ${mediaFirst ? 'status-media-first small' : ''}`}
    >
      {!mediaFirst && (
        <Avatar
          size="xxl"
          url={ghostAccount?.avatarStatic || ghostAccount?.avatar}
          squircle={ghostAccount?.bot}
        />
      )}
      <div class="container">
        <div class="meta">
          {(size === 's' || mediaFirst) && (
            <Avatar
              size="m"
              url={ghostAccount?.avatarStatic || ghostAccount?.avatar}
              squircle={ghostAccount?.bot}
            />
          )}
          {ghostAccount && (
            <NameText
              account={ghostAccount as Parameters<typeof NameText>[0]['account']}
              showAvatar={false}
            />
          )}
        </div>
        <div class="content-container">
          {mediaFirst && <div class="media-first-container" />}
          <div class={`content ${mediaFirst ? 'media-first-content' : ''}`}>
            <p class="insignificant">
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
      class={`status skeleton ${mediaFirst ? 'status-media-first small' : ''}`}
    >
      {!mediaFirst && <Avatar size="xxl" />}
      <div class="container">
        <div class="meta">
          {(size === 's' || mediaFirst) && <Avatar size="m" />} ███ ████████
        </div>
        <div class="content-container">
          {mediaFirst && <div class="media-first-container" />}
          <div class={`content ${mediaFirst ? 'media-first-content' : ''}`}>
            <p>████ ████████</p>
          </div>
        </div>
      </div>
    </div>
  );
}
