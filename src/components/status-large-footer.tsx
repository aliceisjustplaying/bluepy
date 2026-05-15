import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ComponentChildren } from 'preact';

import haptics from '../utils/haptics';
import { supportsNativeQuote } from '../utils/quote-utils';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';
import supports from '../utils/supports';
import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

import CustomEmoji from './custom-emoji';
import Icon from './icon';
import MenuConfirm from './menu-confirm';
import Menu2 from './menu2';
import RelativeTime from './relative-time';
import {
  DEV,
} from './status-helpers';
import type { AnyStatus, LooseClickEvent } from './status-types';
import StatusButton from './status-button';

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
  tooManyMentions: boolean;
  repliesCount?: number;
  replyModeMenuItems: ComponentChildren;
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
  menuFooter: ComponentChildren;
  favourited?: boolean | null;
  favouritesCount?: number;
  favouriteStatus: () => Promise<boolean>;
  bookmarked?: boolean | null;
  bookmarkStatus: () => Promise<boolean>;
  menuItems: ComponentChildren;
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
  tooManyMentions,
  repliesCount,
  replyModeMenuItems,
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
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  return (
    <>
      <div class="extra-meta">
        {deleted ? (
          <span class="status-deleted-tag">
            <Trans>Deleted</Trans>
          </span>
        ) : (
          <>
            <Icon icon={visibilityIconsMap[visibility]} alt="" />{' '}
            <span>{_(visibilityText[visibility])}</span> &bull;{' '}
            <a href={url ?? undefined} target="_blank" rel="noopener">
              {Date.now() - createdAtDate.getTime() < 86400000 && (
                <>
                  <RelativeTime datetime={createdAtDate} format="micro" /> ‒{' '}
                </>
              )}
              {!!createdAt && (
                <time
                  class="created"
                  datetime={createdAtDate.toISOString()}
                  title={createdAtDate.toLocaleString()}
                >
                  {createdDateText}
                </time>
              )}
            </a>
            {editedAt && (
              <span class="edited-container">
                {' '}
                &bull; <Icon icon="pencil" alt={t`Edited`} />{' '}
                <button
                  type="button"
                  class="edited plain plain3"
                  onClick={() => {
                    setShowEdited(id);
                  }}
                >
                  <time datetime={editedAtDate.toISOString()}>
                    {editedDateText}
                  </time>
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {!!emojiReactions?.length && (
        <div class="emoji-reactions">
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
                  class={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
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
                    class={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
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
                class={`emoji-reaction tag ${me ? '' : 'insignificant'}`}
              >
                {name} {count}
              </span>
            );
          })}
        </div>
      )}
      <div class={`actions ${deleted ? 'disabled' : ''}`}>
        <div class="action has-count">
          {tooManyMentions ? (
            <Menu2
              openTrigger="clickOnly"
              direction="bottom"
              overflow="auto"
              gap={-8}
              shift={8}
              menuClassName="menu-emphasized"
              menuButton={
                <StatusButton
                  title={t`Reply`}
                  alt={t`Comments`}
                  class="reply-button"
                  icon="comment"
                  count={repliesCount}
                />
              }
            >
              {replyModeMenuItems}
            </Menu2>
          ) : (
            <StatusButton
              title={t`Reply`}
              alt={t`Comments`}
              class="reply-button"
              icon="comment"
              count={repliesCount}
              onClick={(e) => {
                void haptics.trigger('light');
                replyStatus(e as LooseClickEvent);
              }}
            />
          )}
        </div>
        <div
          class={`action ${
            canQuote && reblogsCount > 0 && quotesCount > 0
              ? 'has-counts'
              : 'has-count'
          }`}
        >
          <MenuConfirm
            disabled={!canBoost}
            confirmItemProps={{ 'data-testid': 'status-boost-confirm' }}
            onClick={() => {
              void haptics.trigger('light');
              void confirmBoostStatus();
            }}
            confirmLabel={
              <>
                <Icon icon="rocket" />
                <span class="menu-grow">
                  {reblogged ? t`Unboost` : t`Boost`}
                </span>
                {reblogsCount > 0 && (
                  <small class="more-insignificant">
                    {shortenNumber(reblogsCount)}
                  </small>
                )}
              </>
            }
            menuExtras={
              <>
                {supportsNativeQuote() && (
                  <MenuItem
                    disabled={quoteDisabled}
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
                      <span class="menu-grow">{quoteText}</span>
                    )}
                    {quotesCount > 0 && (
                      <small class="more-insignificant">
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
                      <small class="tag collapsed">DEV</small>
                    )}
                  </MenuItem>
                )}
              </>
            }
            menuFooter={menuFooter}
          >
            <StatusButton
              {...({
                checked: reblogged ?? undefined,
                title: [canQuote ? t`Boost/Quote…` : t`Boost…`, t`Unboost`],
                alt: [t`Boost`, t`Boosted`],
                class: 'reblog-button',
                icon: reblogsCount <= 0 && quotesCount > 0 ? 'quote' : 'rocket',
                count: reblogsCount,
                extraCount: quotesCount,
                disabled: !canBoost,
                'data-testid': 'status-boost-button',
              } as Parameters<typeof StatusButton>[0] & { disabled?: boolean })}
            />
          </MenuConfirm>
        </div>
        <div class="action has-count">
          <StatusButton
            checked={favourited ?? undefined}
            title={[t`Like`, t`Unlike`]}
            alt={[t`Like`, t`Liked`]}
            class="favourite-button"
            icon="heart"
            count={favouritesCount}
            onClick={() => {
              void haptics.trigger('light');
              void favouriteStatus();
            }}
          />
        </div>
        {supports('@mastodon/post-bookmark') && (
          <div class="action">
            <StatusButton
              checked={bookmarked ?? undefined}
              title={[t`Bookmark`, t`Unbookmark`]}
              alt={[t`Bookmark`, t`Bookmarked`]}
              class="bookmark-button"
              icon="bookmark"
              onClick={() => {
                void haptics.trigger('light');
                void bookmarkStatus();
              }}
            />
          </div>
        )}
        <Menu2
          portal={{
            target: document.querySelector('.status-deck') || document.body,
          }}
          align="end"
          gap={4}
          overflow="auto"
          viewScroll="close"
          menuButton={
            <div class="action">
              <button
                type="button"
                title={t`More`}
                class="plain more-button"
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
