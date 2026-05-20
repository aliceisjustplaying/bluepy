import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ReactNode } from 'react';

import haptics from '../utils/haptics';
import { supportsNativeQuote } from '../utils/quote-utils';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';
import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

import CustomEmoji from './custom-emoji';
import Icon from './icon';
import MenuConfirm from './menu-confirm';
import Menu2 from './menu2';
import RelativeTime from './relative-time';
import StatusButton from './status-button';
import { DEV } from './status-helpers';
import type { AnyStatus, LooseClickEvent } from './status-types';

interface StatusLargeFooterProps {
  deleted?: boolean;
  visibility: keyof typeof visibilityIconsMap;
  url?: string | null;
  createdAt?: string | null;
  createdAtDate: Date;
  createdDateText?: string | false | null;
  editedAt?: string | null;
  editedAtDate: Date;
  editedDateText?: string | false | null;
  id: string;
  setShowEdited: (value: string | false) => void;
  emojiReactions?: readonly Record<string, unknown>[];
  emojis?: readonly mastodon.v1.CustomEmoji[];
  repliesCount?: number;
  replyStatus: (e?: LooseClickEvent) => void;
  canQuote?: boolean;
  repostsCount?: number;
  quotesCount?: number;
  canRepost?: boolean;
  confirmRepostStatus: () => Promise<boolean>;
  reposted?: boolean | null;
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
  visibility,
  url,
  createdAt,
  createdAtDate,
  createdDateText,
  editedAt,
  editedAtDate,
  editedDateText,
  id,
  setShowEdited,
  emojiReactions,
  emojis,
  repliesCount,
  replyStatus,
  canQuote,
  repostsCount = 0,
  quotesCount = 0,
  canRepost,
  confirmRepostStatus,
  reposted,
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
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  return (
    <>
      <div className="extra-meta">
        {deleted ? (
          <span className="status-deleted-tag">
            <Trans>Deleted</Trans>
          </span>
        ) : (
          <>
            <Icon icon={visibilityIconsMap[visibility]} alt="" />{' '}
            <span>{_(visibilityText[visibility])}</span> &bull;{' '}
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
                <button
                  type="button"
                  className="edited plain plain3"
                  onClick={() => {
                    setShowEdited(id);
                  }}
                >
                  <time dateTime={editedAtDate.toISOString()}>
                    {editedDateText}
                  </time>
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {!!emojiReactions?.length && (
        <div className="emoji-reactions">
          {emojiReactions.map((emojiReaction: Record<string, unknown>) => {
            const {
              name,
              count,
              me,
              url: reactionUrl,
              staticUrl,
            } = emojiReaction as {
              name: string;
              count?: number;
              me?: boolean;
              url?: string;
              staticUrl?: string;
            };
            if (reactionUrl) {
              return (
                <span
                  key={name}
                  className={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
                >
                  <CustomEmoji
                    alt={name}
                    url={reactionUrl}
                    staticUrl={staticUrl}
                  />{' '}
                  {count}
                </span>
              );
            }
            const isShortCode = /^:.+?:$/.test(name);
            if (isShortCode) {
              const emoji = emojis?.find(
                (e: mastodon.v1.CustomEmoji) =>
                  e.shortcode === name.replace(/^:/, '').replace(/:$/, ''),
              );
              if (emoji) {
                return (
                  <span
                    key={name}
                    className={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
                  >
                    <CustomEmoji
                      alt={name}
                      url={emoji.url}
                      staticUrl={emoji.staticUrl}
                    />{' '}
                    {count}
                  </span>
                );
              }
            }
            return (
              <span
                key={name}
                className={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
              >
                {name} {count}
              </span>
            );
          })}
        </div>
      )}
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
            canQuote && repostsCount > 0 && quotesCount > 0
              ? 'has-counts'
              : 'has-count'
          }`}
        >
          <MenuConfirm
            disabled={!canRepost}
            confirmItemProps={{ 'data-testid': 'status-repost-confirm' }}
            onClick={() => {
              void haptics.trigger('light');
              void confirmRepostStatus();
            }}
            confirmLabel={
              <>
                <Icon icon="rocket" />
                <span className="menu-grow">
                  {reposted ? t`Undo repost` : t`Repost`}
                </span>
                {repostsCount > 0 && (
                  <small className="more-insignificant">
                    {shortenNumber(repostsCount)}
                  </small>
                )}
              </>
            }
            menuExtras={
              <>
                {supportsNativeQuote() && (
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
                )}
                {(DEV || !supportsNativeQuote()) && (
                  <MenuItem
                    onClick={() => {
                      showCompose({
                        draftStatus: {
                          status: `\n${url}`,
                        },
                      });
                    }}
                  >
                    <Icon icon="quote" />
                    <span>
                      <Trans>Quote with link</Trans>
                    </span>
                    {supportsNativeQuote() && DEV && (
                      <small className="tag collapsed">DEV</small>
                    )}
                  </MenuItem>
                )}
              </>
            }
            menuFooter={menuFooter}
          >
            <StatusButton
              checked={reposted ?? undefined}
              title={[canQuote ? t`Repost/Quote…` : t`Repost…`, t`Undo repost`]}
              alt={[t`Repost`, t`Reposted`]}
              className="repost-button"
              icon={repostsCount <= 0 && quotesCount > 0 ? 'quote' : 'rocket'}
              count={repostsCount}
              extraCount={quotesCount}
              disabled={!canRepost}
              data-testid="status-repost-button"
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
                data-testid="status-more-button"
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
