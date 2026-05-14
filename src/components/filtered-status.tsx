import { Trans, useLingui } from '@lingui/react/macro';
import type { ComponentChildren, HTMLAttributes, RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { useLongPress } from 'use-long-press';
import { useSnapshot } from 'valtio';

import states, { statusKey } from '../utils/states';
import statusPeek from '../utils/status-peek';
import useTruncated from '../utils/useTruncated';
import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

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
  showFollowedTags?: boolean;
  quoted?: number | boolean;
  renderPeekStatus: (
    status: AnyStatus,
    instance: string | undefined,
  ) => ComponentChildren;
}

export default function FilteredStatus({
  status,
  filterInfo,
  instance,
  containerProps = {},
  showFollowedTags,
  quoted,
  renderPeekStatus,
}: FilteredStatusProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);
  const snapStates = useSnapshot(states);
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
      detect: 'touch',
      cancelOnMovement: 2, // true allows movement of up to 25 pixels
    } as unknown as Parameters<typeof useLongPress>[1],
  );

  const statusPeekRef = useTruncated() as RefObject<HTMLAnchorElement>;
  const sKey = statusKey(status.id, instance);
  const ssKey =
    statusKey(status.id, instance) +
    ' ' +
    (statusKey(reblog?.id, instance) || '');

  const actualStatusID = reblog?.id || statusID;
  const url = instance
    ? `/${instance}/s/${actualStatusID}`
    : `/s/${actualStatusID}`;
  const isFollowedTags =
    showFollowedTags &&
    !!(
      sKey &&
      (snapStates.statusFollowedTags[sKey] as readonly unknown[] | undefined)
        ?.length
    );

  return (
    <div
      class={`${
        quoted
          ? ''
          : isReblog
            ? group
              ? 'status-group'
              : 'status-reblog'
            : isFollowedTags
              ? 'status-followed-tags'
              : ''
      } visibility-${visibility}`}
      {...containerProps}
      // title={statusPeekText}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        setShowPeek(true);
      }}
      {...bindLongPressPeek()}
    >
      <article
        data-state-post-id={ssKey}
        class={`status filtered ${quoted ? 'status-card' : ''}`}
        tabindex={-1}
      >
        <button
          type="button"
          class="status-filtered-badge clickable badge-meta"
          title={filterTitleStr}
          onClick={(e: MouseEvent) => {
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
        <span class="status-filtered-info">
          <span class="status-filtered-info-1">
            {isReblog ? (
              <Trans comment="[Name] [Visibility icon] boosted">
                <NameText
                  account={status.account}
                  instance={instance}
                />{' '}
                <Icon
                  icon={
                    visibilityIconsMap[visibility]
                  }
                  alt={_(
                    visibilityText[visibility],
                  )}
                  size="s"
                />{' '}
                boosted
              </Trans>
            ) : isFollowedTags ? (
              <>
                <NameText
                  account={status.account}
                  instance={instance}
                />{' '}
                <Icon
                  icon={
                    visibilityIconsMap[visibility]
                  }
                  alt={_(
                    visibilityText[visibility],
                  )}
                  size="s"
                />{' '}
                <span>
                  {(snapStates.statusFollowedTags[sKey] as
                    | readonly string[]
                    | undefined)!
                    .slice(0, 3)
                    .map((tag: string) => (
                      <span key={tag} class="status-followed-tag-item">
                        #{tag}
                      </span>
                    ))}
                </span>
              </>
            ) : (
              <>
                <NameText
                  account={status.account}
                  instance={instance}
                />{' '}
                <Icon
                  icon={
                    visibilityIconsMap[visibility]
                  }
                  alt={_(
                    visibilityText[visibility],
                  )}
                  size="s"
                />{' '}
                <RelativeTime datetime={createdAtDate} format="micro" />
              </>
            )}
          </span>
          <span class="status-filtered-info-2">
            {isReblog && (
              <>
                <Avatar
                  url={
                    reblog.account.avatarStatic || reblog.account.avatar
                  }
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
          onClick={(e: MouseEvent) => {
            if (e.target === e.currentTarget) {
              setShowPeek(false);
            }
          }}
        >
          <div id="filtered-status-peek" class="sheet">
            <button
              type="button"
              class="sheet-close"
              onClick={() => {
                setShowPeek(false);
              }}
            >
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <b class="status-filtered-badge">
                <Trans>Filtered</Trans>
              </b>{' '}
              {filterTitleStr}
            </header>
            <main tabIndex={-1}>
              <Link
                ref={statusPeekRef}
                class="status-link"
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
