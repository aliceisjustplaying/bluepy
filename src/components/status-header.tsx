import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';

import states from '../utils/states';
import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

import Avatar from './avatar';
import Icon from './icon';
import LazyRender from './lazy-render';
import Link from './link';
import NameText from './name-text';
import RelativeTime from './relative-time';
import type { ContextMenuPropsShape } from './status-context-menu';
import type { AnyAccount, AnyStatus } from './status-types';
import ThreadBadge from './thread-badge';

type NameTextAccountShim = Parameters<typeof NameText>[0]['account'];

interface StatusHeaderProps {
  size: string;
  accountURL?: string | null;
  acct?: string;
  avatarStatic?: string | null;
  avatar?: string | null;
  bot?: boolean | null;
  status: AnyStatus;
  instance: string;
  quoteDomain?: string;
  createdAt?: string | null;
  isSizeLarge: boolean;
  withinContext?: boolean;
  isThread: boolean;
  threadNumber?: number;
  sKey: string;
  deleted?: boolean;
  url?: string | null;
  previewMode?: boolean;
  readOnly?: boolean;
  quoted?: boolean | number;
  id: string;
  onStatusLinkClick: (e: MouseEvent | KeyboardEvent, status: AnyStatus) => void;
  setContextMenuProps: (props: ContextMenuPropsShape) => void;
  setIsContextMenuOpen: (value: boolean | string) => void;
  isContextMenuOpen: boolean | string;
  contextMenuProps: ContextMenuPropsShape;
  showCommentHint: boolean;
  showCommentCount: boolean;
  repliesCount?: number;
  visibility: keyof typeof visibilityIconsMap;
  editedAt?: string | null;
  createdAtDate: Date;
  inReplyToAccount?: AnyAccount | null;
  showReplyBadge: boolean;
}

export default function StatusHeader({
  size,
  accountURL,
  acct,
  avatarStatic,
  avatar,
  bot,
  status,
  instance,
  quoteDomain,
  createdAt,
  isSizeLarge,
  withinContext,
  isThread,
  threadNumber,
  sKey,
  deleted,
  url,
  previewMode,
  readOnly,
  quoted,
  id,
  onStatusLinkClick,
  setContextMenuProps,
  setIsContextMenuOpen,
  isContextMenuOpen,
  contextMenuProps,
  showCommentHint,
  showCommentCount,
  repliesCount = 0,
  visibility,
  editedAt,
  createdAtDate,
  inReplyToAccount,
  showReplyBadge,
}: StatusHeaderProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  function StatusTimeIcon({
    showCommentHint: timeShowCommentHint,
    showCommentCount: timeShowCommentCount,
    repliesCount: timeRepliesCount,
    visibility: timeVisibility,
    editedAt: timeEditedAt,
    size: timeSize,
  }: {
    showCommentHint: boolean;
    showCommentCount: boolean;
    repliesCount: number;
    visibility: keyof typeof visibilityIconsMap;
    editedAt?: string | null;
    size: string;
  }) {
    if (timeShowCommentHint && !timeShowCommentCount) {
      return (
        <Icon
          icon="comment2"
          size="s"
          alt={plural(timeRepliesCount, {
            one: '# reply',
            other: '# replies',
          })}
        />
      );
    }
    if (timeVisibility !== 'public' && timeVisibility !== 'direct') {
      return (
        <Icon
          icon={visibilityIconsMap[timeVisibility]}
          alt={_(visibilityText[timeVisibility])}
          size="s"
        />
      );
    }
    if (timeEditedAt && timeSize === 's') {
      return <Icon icon="pencil" size="s" alt={t`Edited`} />;
    }
    return null;
  }

  return (
    <>
      {size !== 's' && (
        <a
          href={accountURL ?? undefined}
          tabindex={-1}
          title={`@${acct}`}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            states.showAccount = {
              account: status.account,
              instance,
            } as unknown as Record<string, unknown>;
          }}
        >
          <Avatar
            url={(avatarStatic || avatar) ?? undefined}
            size="xxl"
            squircle={bot ?? undefined}
          />
        </a>
      )}
      {!!quoteDomain && (
        <div class="status-quote-meta">
          <span class="domain">{quoteDomain}</span>
        </div>
      )}
      {!!(status.account || createdAt) && (
        <div class="meta">
          <span class="meta-name">
            <NameText
              account={status.account as unknown as NameTextAccountShim}
              instance={instance}
              showAvatar={size === 's'}
              showAcct={isSizeLarge}
            />
          </span>
          {withinContext && isThread && (
            <ThreadBadge showIcon={isSizeLarge} index={threadNumber} />
          )}{' '}
          {size !== 'l' &&
            (deleted ? (
              <span class="status-deleted-tag">
                <Trans>Deleted</Trans>
              </span>
            ) : url && !previewMode && !readOnly && !quoted ? (
              <Link
                to={instance ? `/${instance}/s/${id}` : `/s/${id}`}
                onClick={(e: MouseEvent) => {
                  if (
                    e.metaKey ||
                    e.ctrlKey ||
                    e.shiftKey ||
                    e.altKey ||
                    e.button === 1
                  ) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  onStatusLinkClick?.(e, status);
                  setContextMenuProps({
                    anchorRef: {
                      current: e.currentTarget as Element,
                    },
                    align: 'end',
                    direction: 'bottom',
                    gap: 4,
                  });
                  setIsContextMenuOpen(true);
                }}
                class={`time ${
                  isContextMenuOpen && contextMenuProps?.anchorRef ? 'is-open' : ''
                }`}
              >
                <StatusTimeIcon
                  showCommentHint={showCommentHint}
                  showCommentCount={showCommentCount}
                  repliesCount={repliesCount}
                  visibility={visibility}
                  editedAt={editedAt}
                  size={size}
                />{' '}
                <RelativeTime datetime={createdAtDate} format="micro" />
                {!previewMode && !readOnly && (
                  <Icon icon="more2" class="more" alt={t`More`} />
                )}
              </Link>
            ) : (
              <span class="time">
                <StatusTimeIcon
                  showCommentHint={showCommentHint}
                  showCommentCount={showCommentCount}
                  repliesCount={repliesCount}
                  visibility={visibility}
                  editedAt={editedAt}
                  size={size}
                />{' '}
                <RelativeTime datetime={createdAtDate} format="micro" />
              </span>
            ))}
        </div>
      )}
      <LazyRender id={sKey} class="pre-content-container">
        {visibility === 'direct' && (
          <>
            <div class="status-direct-badge">
              <Trans>Private mention</Trans>
            </div>{' '}
          </>
        )}
        {!withinContext &&
          (isThread ? (
            <ThreadBadge showIcon showText index={threadNumber} />
          ) : (
            showReplyBadge && (
              <div class="status-reply-badge">
                <Icon icon="reply" />{' '}
                {inReplyToAccount ? (
                  <NameText
                    account={inReplyToAccount as unknown as NameTextAccountShim}
                    instance={instance}
                    short
                  />
                ) : (
                  <span>a post</span>
                )}
              </div>
            )
          ))}
      </LazyRender>
    </>
  );
}
