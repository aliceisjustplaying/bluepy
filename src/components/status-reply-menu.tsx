import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import { useMemo } from 'preact/hooks';

import haptics from '../utils/haptics';
import shortenNumber from '../utils/shorten-number';

import Icon from './icon';
import type { StatusMenuPartsArgs } from './status-menu-types';
import type { LooseClickEvent } from './status-types';

type StatusReplyMenuArgs = Pick<
  StatusMenuPartsArgs,
  | 'accountId'
  | 'mentions'
  | 'currentAccount'
  | 'repliesCount'
  | 'username'
  | 'acct'
  | 'replyStatus'
>;

export default function useStatusReplyMenu({
  accountId,
  mentions,
  currentAccount,
  repliesCount = 0,
  username,
  acct,
  replyStatus,
}: StatusReplyMenuArgs) {
  const { t } = useLingui();
  const mentionsCount = useMemo<number>(() => {
    if (!mentions?.length) return 0;
    const allMentions = new Set([
      accountId,
      ...mentions.map((m: mastodon.v1.StatusMention) => m.id),
    ]);
    return [...allMentions].filter((m) => m !== currentAccount).length;
  }, [accountId, mentions, currentAccount]);
  const tooManyMentions = mentionsCount > 3;
  const ReplyMenuContent = () => (
    <>
      <Icon icon="comment" />
      <span>
        {repliesCount > 0
          ? shortenNumber(repliesCount)
          : tooManyMentions
            ? t`Reply…`
            : t`Reply`}
      </span>
    </>
  );
  const replyModeMenuItems = (
    <>
      <MenuItem
        onClick={(e: LooseClickEvent) => {
          void haptics.trigger('light');
          replyStatus(e, 'all');
        }}
      >
        <small>
          <Trans>Reply all</Trans>
          <br />
          <span class="more-insignificant">
            <Plural value={mentionsCount} other="# mentions" />
          </span>
        </small>
      </MenuItem>
      <MenuItem
        onClick={(e: LooseClickEvent) => {
          void haptics.trigger('light');
          replyStatus(e, 'author-first');
        }}
      >
        <small>
          <Trans>Reply all</Trans>
          <br />
          <span class="more-insignificant">
            <Plural
              value={mentionsCount - 1}
              other={
                <Trans comment="Author mention appears first, other mentions appear below with newlines in between">
                  <span class="bidi-isolate">@{username || acct}</span> first, #
                  others below
                </Trans>
              }
            />
          </span>
        </small>
      </MenuItem>
      <MenuItem
        onClick={(e: LooseClickEvent) => {
          void haptics.trigger('light');
          replyStatus(e, 'author-only');
        }}
      >
        <small>
          <Trans>Reply</Trans>
          <br />
          <span class="more-insignificant">
            <Trans>
              Only <span class="bidi-isolate">@{username || acct}</span>
            </Trans>
          </span>
        </small>
      </MenuItem>
    </>
  );

  return { ReplyMenuContent, replyModeMenuItems, tooManyMentions };
}
