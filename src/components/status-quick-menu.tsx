import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { ReactNode } from 'react';

import haptics from '../utils/haptics';
import { supportsNativeQuote } from '../utils/quote-utils';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import supports from '../utils/supports';

import Icon from './icon';
import MenuConfirm from './menu-confirm';
import { DEV } from './status-helpers';
import type { StatusMenuPartsArgs } from './status-menu-types';
import type { LooseClickEvent } from './status-types';

type StatusQuickMenuProps = Pick<
  StatusMenuPartsArgs,
  | 'reblogged'
  | 'quoteDisabled'
  | 'status'
  | 'quoteMetaText'
  | 'quoteText'
  | 'url'
  | 'menuFooter'
  | 'canBoost'
  | 'confirmBoostStatus'
  | 'canQuote'
  | 'reblogsCount'
  | 'quotesCount'
  | 'favouriteStatusNotify'
  | 'favourited'
  | 'favouritesCount'
  | 'bookmarked'
  | 'bookmarkStatusNotify'
  | 'username'
  | 'acct'
  | 'replyStatus'
> & {
  ReplyMenuContent: () => ReactNode;
  isSizeLarge: boolean;
};

export default function StatusQuickMenu({
  ReplyMenuContent,
  isSizeLarge,
  replyStatus,
  reblogged,
  quoteDisabled,
  status,
  quoteMetaText,
  quoteText,
  url,
  menuFooter,
  canBoost,
  confirmBoostStatus,
  canQuote,
  reblogsCount = 0,
  quotesCount = 0,
  favouriteStatusNotify,
  favourited,
  favouritesCount = 0,
  bookmarked,
  bookmarkStatusNotify,
  username,
  acct,
}: StatusQuickMenuProps) {
  const { t } = useLingui();

  return (
    <div className="menu-control-group-horizontal status-menu">
      <MenuItem
        onClick={(e: LooseClickEvent) => {
          void haptics.trigger('light');
          replyStatus(e);
        }}
      >
        <ReplyMenuContent />
      </MenuItem>
      <MenuConfirm
        subMenu
        confirmLabel={
          <>
            <Icon icon="rocket" />
            <span>{reblogged ? t`Undo repost` : t`Repost`}</span>
          </>
        }
        className={`menu-reblog ${reblogged ? 'checked' : ''}`}
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
                  <span>{quoteText}</span>
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
        disabled={!canBoost}
        onClick={() => {
          void haptics.trigger('light');
          void (async () => {
            try {
              const done = await confirmBoostStatus();
              if (!isSizeLarge && done) {
                showToast(
                  reblogged
                    ? t`Removed repost of @${username || acct}'s post`
                    : t`Reposted @${username || acct}'s post`,
                );
              }
            } catch (e) {
              console.error(e);
            }
          })();
        }}
      >
        {canQuote ? (
          <span className="icon">
            <Icon icon="rocket" />
            <Icon icon="quote" />
          </span>
        ) : (
          <Icon icon="rocket" />
        )}
        <span>
          {reblogsCount > 0 || quotesCount > 0
            ? `${reblogsCount > 0 ? shortenNumber(reblogsCount) : ''}${
                reblogsCount > 0 && quotesCount > 0 ? '+' : ''
              }${quotesCount > 0 ? shortenNumber(quotesCount) : ''}`
            : reblogged
              ? t`Undo repost`
              : canQuote
                ? t`Repost/Quote…`
                : t`Repost…`}
        </span>
      </MenuConfirm>
      <MenuItem
        onClick={() => {
          void favouriteStatusNotify();
        }}
        className={`menu-favourite ${favourited ? 'checked' : ''}`}
      >
        <Icon icon="heart" />
        <span>
          {favouritesCount > 0
            ? shortenNumber(favouritesCount)
            : favourited
              ? t`Unlike`
              : t`Like`}
        </span>
      </MenuItem>
      {supports('@mastodon/post-bookmark') && (
        <MenuItem
          onClick={() => {
            void bookmarkStatusNotify();
          }}
          className={`menu-bookmark ${bookmarked ? 'checked' : ''}`}
        >
          <Icon icon="bookmark" />
          <span>{bookmarked ? t`Unbookmark` : t`Bookmark`}</span>
        </MenuItem>
      )}
    </div>
  );
}
