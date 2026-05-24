import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { ReactNode } from 'react';

import haptics from '../utils/haptics';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';

import Icon from './icon';
import MenuConfirm from './menu-confirm';
import Menu2 from './menu2';
import RelativeTime from './relative-time';
import StatusButton from './status-button';
import type { AnyStatus, LooseClickEvent } from './status-types';

interface StatusLargeFooterProps {
  deleted?: boolean;
  url?: string | null;
  createdAt?: string | null;
  createdAtDate: Date;
  createdDateText?: string | false | null;
  editedAt?: string | null;
  editedAtDate: Date;
  editedDateText?: string | false | null;
  repliesCount?: number;
  replyStatus: (e?: LooseClickEvent) => void;
  canQuote?: boolean;
  reblogsCount?: number;
  quotesCount?: number;
  canBoost?: boolean;
  confirmBoostStatus: () => Promise<boolean>;
  reblogged?: boolean | null;
  quoteDisabled?: boolean | null;
  quoteText?: string;
  quoteMetaText?: string | null;
  status: AnyStatus;
  menuFooter: ReactNode;
  favourited?: boolean | null;
  favouritesCount?: number;
  favouriteStatus: () => Promise<boolean>;
  bookmarked?: boolean | null;
  bookmarkStatus: () => Promise<boolean>;
  menuItems: ReactNode;
}

export default function StatusLargeFooter({
  deleted,
  url,
  createdAt,
  createdAtDate,
  createdDateText,
  editedAt,
  editedAtDate,
  editedDateText,
  repliesCount,
  replyStatus,
  canQuote,
  reblogsCount = 0,
  quotesCount = 0,
  canBoost,
  confirmBoostStatus,
  reblogged,
  quoteDisabled,
  quoteText,
  quoteMetaText,
  status,
  menuFooter,
  favourited,
  favouritesCount,
  favouriteStatus,
  bookmarked,
  bookmarkStatus,
  menuItems,
}: StatusLargeFooterProps) {
  const { t } = useLingui();

  return (
    <>
      <div className="extra-meta">
        {deleted ? (
          <span className="status-deleted-tag">
            <Trans>Deleted</Trans>
          </span>
        ) : (
          <>
            <a href={url ?? undefined} target="_blank" rel="noopener">
              {Date.now() - createdAtDate.getTime() < 86400000 && (
                <>
                  <RelativeTime datetime={createdAtDate} format="micro" />{' '}
                  ‒{' '}
                </>
              )}
              {!!createdAt && (
                <time
                  className="created"
                  dateTime={createdAtDate.toISOString()}
                  title={createdAtDate.toLocaleString()}
                >
                  {createdDateText}
                </time>
              )}
            </a>
            {editedAt && (
              <span className="edited-container">
                {' '}
                &bull; <Icon icon="pencil" alt={t`Edited`} />{' '}
                <time
                  className="edited"
                  dateTime={editedAtDate.toISOString()}
                >
                  {editedDateText}
                </time>
              </span>
            )}
          </>
        )}
      </div>
      <div className={`actions ${deleted ? 'disabled' : ''}`}>
        <div className="action has-count">
          <StatusButton
            title={t`Reply`}
            alt={t`Comments`}
            className="reply-button"
            icon="comment"
            count={repliesCount}
            onClick={(e) => {
              void haptics.trigger('light');
              replyStatus(e as LooseClickEvent);
            }}
          />
        </div>
        <div
          className={`action ${
            canQuote && reblogsCount > 0 && quotesCount > 0
              ? 'has-counts'
              : 'has-count'
          }`}
        >
          <MenuConfirm
            disabled={!canBoost}
            onClick={() => {
              void haptics.trigger('light');
              void confirmBoostStatus();
            }}
            confirmLabel={
              <>
                <Icon icon="rocket" />
                <span className="menu-grow">
                  {reblogged ? t`Undo repost` : t`Repost`}
                </span>
                {reblogsCount > 0 && (
                  <small className="more-insignificant">
                    {shortenNumber(reblogsCount)}
                  </small>
                )}
              </>
            }
            menuExtras={
              <MenuItem
                disabled={!!quoteDisabled}
                onClick={() => {
                  showCompose({
                    quoteStatus: status,
                  });
                }}
              >
                <Icon icon="quote" />
                {quoteMetaText ? (
                  <small>
                    {quoteText}
                    <br />
                    {quoteMetaText}
                  </small>
                ) : (
                  <span className="menu-grow">{quoteText}</span>
                )}
                {quotesCount > 0 && (
                  <small className="more-insignificant">
                    {shortenNumber(quotesCount)}
                  </small>
                )}
              </MenuItem>
            }
            menuFooter={menuFooter}
          >
            <StatusButton
              checked={reblogged ?? undefined}
              title={[canQuote ? t`Repost/Quote…` : t`Repost…`, t`Undo repost`]}
              alt={[t`Repost`, t`Reposted`]}
              className="reblog-button"
              icon={reblogsCount <= 0 && quotesCount > 0 ? 'quote' : 'rocket'}
              count={reblogsCount}
              extraCount={quotesCount}
              disabled={!canBoost}
            />
          </MenuConfirm>
        </div>
        <div className="action has-count">
          <StatusButton
            checked={favourited ?? undefined}
            title={[t`Like`, t`Unlike`]}
            alt={[t`Like`, t`Liked`]}
            className="favourite-button"
            icon="heart"
            count={favouritesCount}
            onClick={() => {
              void haptics.trigger('light');
              void favouriteStatus();
            }}
          />
        </div>
        <div className="action">
          <StatusButton
            checked={bookmarked ?? undefined}
            title={[t`Bookmark`, t`Unbookmark`]}
            alt={[t`Bookmark`, t`Bookmarked`]}
            className="bookmark-button"
            icon="bookmark"
            onClick={() => {
              void haptics.trigger('light');
              void bookmarkStatus();
            }}
          />
        </div>
        <Menu2
          portal={{
            target: document.querySelector('.status-deck') || document.body,
          }}
          align="end"
          gap={4}
          overflow="auto"
          viewScroll="close"
          menuButton={
            <div className="action">
              <button
                type="button"
                title={t`More`}
                className="plain more-button"
              >
                <Icon icon="more2" size="l" alt={t`More`} />
              </button>
            </div>
          }
        >
          {menuItems}{' '}
        </Menu2>
      </div>
    </>
  );
}
