import { useLingui } from '@lingui/react/macro';
import type { RefObject } from 'react';

import haptics from '../utils/haptics';

import Icon from './icon';
import StatusButton from './status-button';
import type { LooseClickEvent } from './status-types';
import type { ContextMenuPropsShape } from './status-context-menu';

interface StatusInlineControlsProps {
  showActionsBar?: boolean;
  size: string;
  previewMode?: boolean;
  readOnly?: boolean;
  deleted?: boolean;
  isContextMenuOpen: boolean | string;
  actionsRef: RefObject<HTMLDivElement | null>;
  setContextMenuProps: (props: ContextMenuPropsShape) => void;
  setIsContextMenuOpen: (value: boolean | string) => void;
  replyStatus: (e?: LooseClickEvent) => void;
  favourited?: boolean | null;
  favouritesCount?: number;
  favouriteStatusNotify: () => Promise<void>;
  reblogged?: boolean | null;
  bookmarked?: boolean | null;
  pinned?: boolean;
}

export default function StatusInlineControls({
  showActionsBar,
  size,
  previewMode,
  readOnly,
  deleted,
  isContextMenuOpen,
  actionsRef,
  setContextMenuProps,
  setIsContextMenuOpen,
  replyStatus,
  favourited,
  favouritesCount,
  favouriteStatusNotify,
  reblogged,
  bookmarked,
  pinned,
}: StatusInlineControlsProps) {
  const { t } = useLingui();

  return (
    <>
      {showActionsBar && size !== 'l' && !previewMode && !readOnly && !deleted && (
        <div
          className={`status-actions ${
            isContextMenuOpen === 'actions-bar' ? 'open' : ''
          }`}
          ref={actionsRef as RefObject<HTMLDivElement>}
        >
          <StatusButton
            size="s"
            title={t`Reply`}
            alt={t`Reply`}
            className="reply-button"
            icon="comment"
            iconSize="m"
            onClick={(e: LooseClickEvent) => {
              void haptics.trigger('light');
              replyStatus(e);
            }}
          />
          <StatusButton
            size="s"
            checked={favourited ?? undefined}
            title={[t`Like`, t`Unlike`]}
            alt={[t`Like`, t`Liked`]}
            className="favourite-button"
            icon="heart"
            iconSize="m"
            count={favouritesCount}
            onClick={() => {
              void favouriteStatusNotify();
            }}
          />
          <button
            type="button"
            title={t`More`}
            className="plain more-button"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenuProps({
                anchorRef: {
                  current: e.currentTarget as Element,
                },
                align: 'start',
                direction: 'left',
                gap: 0,
                shift: -8,
              });
              setIsContextMenuOpen('actions-bar');
            }}
          >
            <Icon icon="more2" size="m" alt={t`More`} />
          </button>
        </div>
      )}
      {size !== 'l' && (
        <div className="status-badge">
          {reblogged && (
            <Icon className="reblog" icon="rocket" size="s" alt={t`Boosted`} />
          )}
          {favourited && (
            <Icon className="favourite" icon="heart" size="s" alt={t`Liked`} />
          )}
          {bookmarked && (
            <Icon className="bookmark" icon="bookmark" size="s" alt={t`Bookmarked`} />
          )}
          {pinned && <Icon className="pin" icon="pin" size="s" alt={t`Pinned`} />}
        </div>
      )}
    </>
  );
}
