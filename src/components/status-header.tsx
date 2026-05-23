import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';

import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

import Icon from './icon';
import LazyRender from './lazy-render';
import Link from './link';
import NameText from './name-text';
import RelativeTime from './relative-time';
import type { ContextMenuPropsShape } from './status-context-menu';
import type { AnyAccount, AnyStatus } from './status-types';
import ThreadBadge from './thread-badge';

interface StatusHeaderProps {
  size: string;
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
  onStatusLinkClick: (
    e: React.MouseEvent | KeyboardEvent,
    status: AnyStatus,
  ) => void;
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

interface StatusTimeIconProps {
  showCommentHint: boolean;
  showCommentCount: boolean;
  repliesCount: number;
  visibility: keyof typeof visibilityIconsMap;
  editedAt?: string | null;
  size: string;
}

function StatusTimeIcon({
  showCommentHint,
  showCommentCount,
  repliesCount,
  visibility,
  editedAt,
  size,
}: StatusTimeIconProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  if (showCommentHint && !showCommentCount) {
    return (
      <Icon
        icon="comment2"
        size="s"
        alt={plural(repliesCount, {
          one: '# reply',
          other: '# replies',
        })}
      />
    );
  }
  if (visibility !== 'everybody') {
    return (
      <Icon
        icon={visibilityIconsMap[visibility]}
        alt={_(visibilityText[visibility])}
        size="s"
      />
    );
  }
  if (editedAt && size === 's') {
    return <Icon icon="pencil" size="s" alt={t`Edited`} />;
  }
  return null;
}

export default function StatusHeader({
  size,
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
  const { t } = useLingui();

  return (
    <>
      {!!quoteDomain && (
        <div className="status-quote-meta">
          <span className="domain">{quoteDomain}</span>
        </div>
      )}
      {!!(status.account || createdAt) && (
        <div className="meta">
          <span className="meta-name">
            <NameText
              account={status.account}
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
              <span className="status-deleted-tag">
                <Trans>Deleted</Trans>
              </span>
            ) : url && !previewMode && !readOnly && !quoted ? (
              <Link
                to={instance ? `/${instance}/s/${id}` : `/s/${id}`}
                onClick={(e: React.MouseEvent) => {
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
                className={`time ${
                  isContextMenuOpen && contextMenuProps?.anchorRef
                    ? 'is-open'
                    : ''
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
                  <Icon icon="more2" className="more" alt={t`More`} />
                )}
              </Link>
            ) : (
              <span className="time">
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
      <LazyRender id={sKey} className="pre-content-container">
        {!withinContext &&
          (isThread ? (
            <ThreadBadge showIcon showText index={threadNumber} />
          ) : (
            showReplyBadge && (
              <div className="status-reply-badge">
                <Icon icon="reply" />{' '}
                {inReplyToAccount ? (
                  <NameText
                    account={inReplyToAccount}
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
