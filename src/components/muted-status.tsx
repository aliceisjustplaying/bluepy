import { Trans, useLingui } from '@lingui/react/macro';
import type { HTMLAttributes, ReactNode } from 'react';
import { useCallback } from 'react';
import { useSnapshot } from 'valtio';

import states from '../utils/states';

import Avatar from './avatar';
import Icon from './icon';
import NameText from './name-text';
import RelativeTime from './relative-time';
import type { AnyStatus } from './status-types';

interface MutedStatusProps {
  status: AnyStatus;
  instance?: string;
  containerProps?: HTMLAttributes<HTMLDivElement>;
  quoted?: number | boolean;
  renderExpandedStatus: (
    status: AnyStatus,
    instance: string | undefined,
  ) => ReactNode;
}

export default function MutedStatus({
  status,
  instance,
  containerProps = {},
  quoted,
  renderExpandedStatus,
}: MutedStatusProps) {
  const { t } = useLingui();
  const { account, createdAt, reblog } = status;
  const avatar = account?.avatar;
  const avatarStatic = account?.avatarStatic;
  const bot = account?.bot;
  const group = account?.group;
  const snapStates = useSnapshot(states);
  const revealKey = status._atproto?.uri || status.uri || status.id;
  const expanded = snapStates.revealedMutedPosts[revealKey];
  const createdAtDate = createdAt ? new Date(createdAt) : null;
  const isReblog = !!reblog;
  const className = quoted
    ? ''
    : isReblog
      ? group
        ? 'status-group'
        : 'status-reblog'
      : '';
  const mergedClassName = [className, containerProps.className]
    .filter(Boolean)
    .join(' ');
  const showPost = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      states.revealedMutedPosts[revealKey] = true;
    },
    [revealKey],
  );
  const hidePost = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      delete states.revealedMutedPosts[revealKey];
    },
    [revealKey],
  );

  return (
    <div {...containerProps} className={mergedClassName}>
      {!expanded ? (
        <article
          className={`status filtered muted ${quoted ? 'status-card' : ''}`}
          tabIndex={-1}
        >
          <button
            type="button"
            className="status-filtered-badge clickable badge-meta"
            title={t`Show muted post`}
            onClick={showPost}
          >
            <span>
              <Trans>Muted</Trans>
            </span>
            <span>
              <Trans>Show</Trans>
            </span>
          </button>{' '}
          <Avatar url={avatarStatic || avatar} squircle={bot} />
          <span className="status-filtered-info">
            <span className="status-filtered-info-1">
              <Trans>Post from muted account</Trans>
            </span>
            <span className="status-filtered-info-2">
              <NameText account={account} instance={instance} />{' '}
              {createdAtDate && (
                <RelativeTime datetime={createdAtDate} format="micro" />
              )}
            </span>
          </span>
        </article>
      ) : (
        <div className={`status-muted-expanded ${quoted ? 'status-card' : ''}`}>
          <div className="status-muted-expanded-banner">
            <span className="status-filtered-badge horizontal badge-meta">
              <span>
                <Icon icon="eye-close" size="s" /> <Trans>Muted</Trans>
              </span>
            </span>
            <button type="button" className="plain4" onClick={hidePost}>
              <Trans>Hide</Trans>
            </button>
          </div>
          {renderExpandedStatus(status, instance)}
        </div>
      )}
    </div>
  );
}
