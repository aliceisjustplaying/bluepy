import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode, HTMLAttributes, RefObject } from 'react';
import { useState } from 'react';
import { LongPressEventType, useLongPress } from 'use-long-press';

import { statusKey } from '../utils/states';
import statusPeek from '../utils/status-peek';
import useTruncated from '../utils/useTruncated';

import Avatar from './avatar';
import Icon from './icon';
import Link from './link';
import Modal from './modal';
import NameText from './name-text';
import RelativeTime from './relative-time';
import { readMoreText } from './status-helpers';
import type { AnyStatus } from './status-types';

interface FilteredStatusProps {
  status: AnyStatus;
  filterInfo?: {
    action?: 'hide' | 'blur' | 'warn';
    titles?: string[];
    titlesStr?: string;
  };
  instance?: string;
  containerProps?: HTMLAttributes<HTMLDivElement>;
  quoted?: number | boolean;
  renderPeekStatus: (
    status: AnyStatus,
    instance: string | undefined,
  ) => ReactNode;
}

export default function FilteredStatus({
  status,
  filterInfo,
  instance,
  containerProps = {},
  quoted,
  renderPeekStatus,
}: FilteredStatusProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);
  const { id: statusID, account, createdAt, visibility, reblog } = status;
  const { avatar, avatarStatic, bot, group } = account || {};
  const isReblog = !!reblog;
  const filterTitleStr = filterInfo?.titlesStr || '';
  const createdAtDate = new Date(createdAt);
  const statusPeekText = statusPeek(reblog || status);

  const [showPeek, setShowPeek] = useState(false);
  const bindLongPressPeek = useLongPress(
    () => {
      setShowPeek(true);
    },
    {
      threshold: 600,
      captureEvent: true,
      detect: LongPressEventType.Touch,
      cancelOnMovement: 2, // true allows movement of up to 25 pixels
    },
  );

  const statusPeekRef = useTruncated() as RefObject<HTMLAnchorElement>;
  const ssKey =
    statusKey(status.id, instance) +
    ' ' +
    (statusKey(reblog?.id, instance) || '');

  const actualStatusID = reblog?.id || statusID;
  const url = instance
    ? `/${instance}/s/${actualStatusID}`
    : `/s/${actualStatusID}`;
  return (
    <div
      className={`${
        quoted ? '' : isReblog ? (group ? 'status-group' : 'status-reblog') : ''
      } visibility-${visibility}`}
      {...containerProps}
      // title={statusPeekText}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        setShowPeek(true);
      }}
      {...bindLongPressPeek()}
    >
      <article
        data-state-post-id={ssKey}
        className={`status filtered ${quoted ? 'status-card' : ''}`}
        tabIndex={-1}
      >
        <button
          type="button"
          className="status-filtered-badge clickable badge-meta"
          title={filterTitleStr}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            setShowPeek(true);
          }}
        >
          <span>
            <Trans>Filtered</Trans>
          </span>
          <span>{filterTitleStr}</span>
        </button>{' '}
        <Avatar url={avatarStatic || avatar} squircle={bot} />
        <span className="status-filtered-info">
          <span className="status-filtered-info-1">
            {isReblog ? (
              <Trans comment="[Name] reposted">
                <NameText account={status.account} instance={instance} />{' '}
                reposted
              </Trans>
            ) : (
              <>
                <NameText account={status.account} instance={instance} />{' '}
                <RelativeTime datetime={createdAtDate} format="micro" />
              </>
            )}
          </span>
          <span className="status-filtered-info-2">
            {isReblog && (
              <>
                <Avatar
                  url={reblog.account.avatarStatic || reblog.account.avatar}
                  squircle={bot}
                />{' '}
              </>
            )}
            {statusPeekText}
          </span>
        </span>
      </article>
      {showPeek && (
        <Modal
          onClick={(e: React.MouseEvent) => {
            if (e.target === e.currentTarget) {
              setShowPeek(false);
            }
          }}
        >
          <div id="filtered-status-peek" className="sheet">
            <button
              type="button"
              className="sheet-close"
              onClick={() => {
                setShowPeek(false);
              }}
            >
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <b className="status-filtered-badge">
                <Trans>Filtered</Trans>
              </b>{' '}
              {filterTitleStr}
            </header>
            <main tabIndex={-1}>
              <Link
                ref={statusPeekRef}
                className="status-link"
                to={url}
                onClick={() => {
                  setShowPeek(false);
                }}
                data-read-more={_(readMoreText)}
              >
                {renderPeekStatus(status, instance)}
              </Link>
            </main>
          </div>
        </Modal>
      )}
    </div>
  );
}
