import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';

import Icon from './icon';
import NameText from './name-text';
import type { AnyStatus, StatusSize } from './status-types';

interface RenderRepostStatusArgs {
  statusID?: string | null;
  status?: AnyStatus | null;
  instance?: string;
  size?: StatusSize;
  contentTextWeight?: boolean;
  readOnly?: boolean;
  mediaFirst?: boolean;
  enableCommentHint?: boolean;
}

interface StatusRepostProps {
  wrapperStatus: AnyStatus;
  repost: AnyStatus;
  statusID?: string | null;
  stateKey: string;
  instance?: string;
  size?: StatusSize;
  contentTextWeight?: boolean;
  readOnly?: boolean;
  mediaFirst?: boolean;
  group?: boolean;
  onMouseEnter?: (e: React.MouseEvent) => void;
  renderStatus: (args: RenderRepostStatusArgs) => ReactNode;
}

export default function StatusRepost({
  wrapperStatus,
  repost,
  statusID,
  stateKey,
  instance,
  size,
  contentTextWeight,
  readOnly,
  mediaFirst,
  group,
  onMouseEnter,
  renderStatus,
}: StatusRepostProps) {
  const { t } = useLingui();
  const childStatus = statusID ? null : repost;
  const childStatusID = statusID ? repost.id : null;

  if (group) {
    return (
      <div
        data-state-post-id={stateKey}
        className="status-group"
        onMouseEnter={onMouseEnter}
      >
        <div className="status-pre-meta">
          <Icon icon="group" size="l" alt={t`Group`} />{' '}
          <NameText
            account={wrapperStatus.account}
            instance={instance}
            showAvatar
          />
        </div>
        {renderStatus({
          status: childStatus,
          statusID: childStatusID,
          instance,
          size,
          contentTextWeight,
          readOnly,
          mediaFirst,
        })}
      </div>
    );
  }

  return (
    <div
      data-state-post-id={stateKey}
      className="status-repost"
      onMouseEnter={onMouseEnter}
    >
      <div className="status-pre-meta">
        <Icon icon="rocket" size="l" />{' '}
        <Trans>
          <NameText
            account={wrapperStatus.account}
            instance={instance}
            showAvatar
          />{' '}
          <span>reposted</span>
        </Trans>
      </div>
      {renderStatus({
        status: childStatus,
        statusID: childStatusID,
        instance,
        size,
        contentTextWeight,
        readOnly,
        enableCommentHint: true,
        mediaFirst,
      })}
    </div>
  );
}
