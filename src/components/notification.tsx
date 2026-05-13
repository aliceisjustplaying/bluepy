import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Plural, Select, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentChildren, ComponentType, JSX, Ref, VNode } from 'preact';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';

import { api } from '../utils/api';
import { isFiltered } from '../utils/filters';
import shortenNumber from '../utils/shorten-number';
import states, { statusKey } from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';
import useTruncated from '../utils/useTruncated';

import Avatar from './avatar';
import CustomEmoji from './custom-emoji';
import FollowRequestButtonsRaw from './follow-request-buttons';
import Icon from './icon';
import Link, { type LinkProps } from './link';
import NameTextUntyped from './name-text';
import StatusUntyped from './status';

// Shim untyped JSX peers used by this component. These are removed when the
// peer modules are converted to TypeScript in later waves.
interface AccountWithBot {
  id?: string;
  url?: string;
  avatarStatic?: string;
  displayName?: string;
  acct?: string;
  bot?: boolean;
  _types?: string[];
  [key: string]: unknown;
}

interface NameTextProps {
  account?: AccountWithBot;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (e: MouseEvent) => void;
}
const NameText = NameTextUntyped as unknown as ComponentType<NameTextProps>;

interface StatusComponentProps {
  status?: mastodon.v1.Status | null;
  statusID?: string;
  instance?: string;
  size?: 's' | 'm' | 'l';
  previewMode?: boolean;
  readOnly?: boolean;
  allowContextMenu?: boolean;
  allowFilters?: boolean;
}
const Status = StatusUntyped as unknown as ComponentType<StatusComponentProps>;

// The typed FollowRequestButtons requires `onChange`, but the JS original
// (and the `notification` use site) historically omits it; preserve that
// behavior with a shim that marks `onChange` as optional.
interface FollowRequestButtonsShimProps {
  accountID: string;
  onChange?: () => void;
}
const FollowRequestButtons =
  FollowRequestButtonsRaw as unknown as ComponentType<FollowRequestButtonsShimProps>;

// `masto.v2.notifications` is typed as `unknown` in our local MastoClient
// shim. Describe just the surface this component uses.
interface MastoV2NotificationAccountsList {
  values(): AsyncIterator<AccountWithBot[]>;
}
interface MastoV2NotificationSelector {
  accounts: {
    list(): MastoV2NotificationAccountsList;
  };
}
interface MastoV2Notifications {
  $select(groupKey: string): MastoV2NotificationSelector;
}

// Input shape for this component. Mirrors `mastodon.v1.Notification` /
// `mastodon.v2.NotificationGroup` plus client-side grouping fields injected
// by `group-notifications.ts`. The masto entity unions are too strict to
// describe the full superset, so we keep a wide local interface.
interface EmojiUrlObject {
  url?: string;
  staticUrl?: string;
}

interface AnnualReportData {
  year?: string | number;
  [key: string]: unknown;
}

interface ModerationWarningPayload {
  id?: string;
  action?: keyof typeof MODERATION_WARNING_TEXT;
  [key: string]: unknown;
}

interface SeveredRelationshipEvent {
  type?: keyof typeof SEVERED_RELATIONSHIPS_TEXT;
  targetName?: string;
  followersCount?: number;
  followingCount?: number;
  [key: string]: unknown;
}

interface NotificationReport {
  targetAccount?: AccountWithBot;
  [key: string]: unknown;
}

interface NotificationInput {
  id?: string;
  type?: string;
  createdAt?: string;
  account?: AccountWithBot;
  status?: mastodon.v1.Status | null;
  report?: NotificationReport;
  event?: SeveredRelationshipEvent;
  moderation_warning?: ModerationWarningPayload;
  annualReport?: AnnualReportData;
  emoji?: string;
  emoji_url?: string | EmojiUrlObject;
  // Client-side grouped notification
  _ids?: string;
  _accounts?: AccountWithBot[];
  _statuses?: (mastodon.v1.Status | null | undefined)[];
  _groupKeys?: string[];
  _notificationsCount?: number[];
  _sampleAccountsCount?: number[];
  // Server-side grouped notification. Entries may be `undefined` because
  // `massageNotifications2` resolves each id via `accounts.find(...)`, which
  // yields `undefined` for ids not present in the payload. The JS original
  // passed undefineds straight through, so mirror the loose entry type.
  sampleAccounts?: (AccountWithBot | undefined)[];
  notificationsCount?: number;
  groupKey?: string;
  [key: string]: unknown;
}

interface NotificationProps {
  notification: NotificationInput;
  instance?: string;
  isStatic?: boolean;
  disableContextMenu?: boolean;
}

interface SubjectProps {
  clickable?: boolean;
  children?: ComponentChildren;
  [key: string]: unknown;
}
type SubjectComponent = ComponentType<SubjectProps>;

interface ContentTextArgs {
  account?: VNode | null;
  targetAccount?: VNode | null;
  count?: number;
  postsCount?: number;
  postType?: 'reply' | 'post';
  components?: { Subject: SubjectComponent };
  name?: string;
  emoji?: string;
  emojiURL?: string | EmojiUrlObject;
  year?: string | number;
  [key: string]: unknown;
}

type ContentTextRenderer = (args: ContentTextArgs) => JSX.Element | string;

const NOTIFICATION_ICONS: Record<string, string> = {
  mention: 'comment',
  status: 'notification',
  reblog: 'rocket',
  follow: 'follow',
  follow_request: 'follow-add',
  favourite: 'heart',
  poll: 'poll',
  update: 'pencil',
  'admin.sign_up': 'account-edit',
  'admin.report': 'account-warning',
  severed_relationships: 'heart-break',
  moderation_warning: 'alert',
  emoji_reaction: 'emoji2',
  reaction: 'emoji2',
  'pleroma:emoji_reaction': 'emoji2',
  annual_report: 'celebrate',
  quote: 'quote',
  quoted_update: 'pencil',
};

/*
Notification types
==================
mention = Someone mentioned you in their status
status = Someone you enabled notifications for has posted a status
reblog = Someone boosted one of your statuses
follow = Someone followed you
follow_request = Someone requested to follow you
favourite = Someone favourited one of your statuses
poll = A poll you have voted in or created has ended
update = A status you interacted with has been edited
admin.sign_up = Someone signed up (optionally sent to admins)
admin.report = A new report has been filed
severed_relationships = Severed relationships
moderation_warning = Moderation warning
quote = Someone quoted one of your statuses
quoted_update = A status you have quoted has been edited
*/

function emojiText({ account, emoji, emojiURL }: ContentTextArgs): JSX.Element {
  let url: string | undefined;
  let staticUrl: string | undefined;
  if (typeof emojiURL === 'string') {
    url = emojiURL;
  } else {
    url = emojiURL?.url;
    staticUrl = emojiURL?.staticUrl;
  }
  const emojiObject = url ? (
    <CustomEmoji url={url} staticUrl={staticUrl} alt={emoji} />
  ) : (
    emoji
  );
  return (
    <Trans>
      {account} reacted to your post with {emojiObject}
    </Trans>
  );
}

const contentText: Record<string, ContentTextRenderer> = {
  status: ({ account }) => <Trans>{account} published a post.</Trans>,
  reblog: (args) => {
    // Unwrap with locals so the Lingui macro sees plain identifiers and
    // keeps named placeholders (`{count}`) instead of switching to positional
    // (`{0}`). The JS original used implicit `any`; runtime semantics are
    // identical.
    const { account, components } = args;
    const count = args.count as number;
    const postsCount = args.postsCount as number;
    const postType = args.postType as 'reply' | 'post';
    const Subject = components!.Subject;
    return (
      <Plural
        value={count}
        _1={
          <Plural
            value={postsCount}
            _1={
              <Select
                value={postType}
                _reply={<Trans>{account} boosted your reply.</Trans>}
                other={<Trans>{account} boosted your post.</Trans>}
              />
            }
            other={
              <Trans>
                {account} boosted {postsCount} of your posts.
              </Trans>
            }
          />
        }
        other={
          <Select
            value={postType}
            _reply={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                boosted your reply.
              </Trans>
            }
            other={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                boosted your post.
              </Trans>
            }
          />
        }
      />
    );
  },
  follow: (args) => {
    const { account, components } = args;
    const count = args.count as number;
    const Subject = components!.Subject;
    return (
      <Plural
        value={count}
        _1={<Trans>{account} followed you.</Trans>}
        other={
          <Trans>
            <Subject clickable={count > 1}>
              <span title={String(count)}>{shortenNumber(count)}</span> people
            </Subject>{' '}
            followed you.
          </Trans>
        }
      />
    );
  },
  follow_request: ({ account }) => (
    <Trans>{account} requested to follow you.</Trans>
  ),
  favourite: (args) => {
    const { account, components } = args;
    const count = args.count as number;
    const postsCount = args.postsCount as number;
    const postType = args.postType as 'reply' | 'post';
    const Subject = components!.Subject;
    return (
      <Plural
        value={count}
        _1={
          <Plural
            value={postsCount}
            _1={
              <Select
                value={postType}
                _reply={<Trans>{account} liked your reply.</Trans>}
                other={<Trans>{account} liked your post.</Trans>}
              />
            }
            other={
              <Trans>
                {account} liked {postsCount} of your posts.
              </Trans>
            }
          />
        }
        other={
          <Select
            value={postType}
            _reply={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                liked your reply.
              </Trans>
            }
            other={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                liked your post.
              </Trans>
            }
          />
        }
      />
    );
  },
  poll: () => t`A poll you have voted in or created has ended.`,
  'poll-self': () => t`A poll you have created has ended.`,
  'poll-voted': () => t`A poll you have voted in has ended.`,
  update: ({ account }) =>
    account ? (
      <Trans>{account} edited a post.</Trans>
    ) : (
      t`A post you interacted with has been edited.`
    ),
  'favourite+reblog': (args) => {
    const { account, components } = args;
    const count = args.count as number;
    const postsCount = args.postsCount as number;
    const postType = args.postType as 'reply' | 'post';
    const Subject = components!.Subject;
    return (
      <Plural
        value={count}
        _1={
          <Plural
            value={postsCount}
            _1={
              <Select
                value={postType}
                _reply={<Trans>{account} boosted & liked your reply.</Trans>}
                other={<Trans>{account} boosted & liked your post.</Trans>}
              />
            }
            other={
              <Trans>
                {account} boosted & liked {postsCount} of your posts.
              </Trans>
            }
          />
        }
        other={
          <Select
            value={postType}
            _reply={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                boosted & liked your reply.
              </Trans>
            }
            other={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                boosted & liked your post.
              </Trans>
            }
          />
        }
      />
    );
  },
  quoted_update: ({ account }) => (
    <Trans>{account} edited a post you have quoted.</Trans>
  ),
  'admin.sign_up': (args) => {
    const { account, components } = args;
    const count = args.count as number;
    const Subject = components!.Subject;
    return (
      <Plural
        value={count}
        _1={<Trans>{account} signed up.</Trans>}
        other={
          <Trans>
            <Subject clickable={count > 1}>
              <span title={String(count)}>{shortenNumber(count)}</span> people
            </Subject>{' '}
            signed up.
          </Trans>
        }
      />
    );
  },
  'admin.report': ({ account, targetAccount }) => (
    <Trans>
      {account} reported {targetAccount}
    </Trans>
  ),
  severed_relationships: ({ name }) => (
    <Trans>
      Lost connections with <i>{name}</i>.
    </Trans>
  ),
  moderation_warning: () => (
    <b>
      <Trans>Moderation warning</Trans>
    </b>
  ),
  emoji_reaction: emojiText,
  reaction: emojiText,
  'pleroma:emoji_reaction': emojiText,
  annual_report: ({ year }) => <Trans>Your {year} #Wrapstodon is here!</Trans>,
};

interface SeveredRelationshipArgs {
  from?: string;
  targetName?: string;
  followersCount?: number;
  followingCount?: number;
  type?: string;
  [key: string]: unknown;
}

// account_suspension, domain_block, user_domain_block
const SEVERED_RELATIONSHIPS_TEXT: Record<
  string,
  (args: SeveredRelationshipArgs) => JSX.Element
> = {
  account_suspension: ({ from, targetName }) => (
    <Trans>
      An admin from <i>{from}</i> has suspended <i>{targetName}</i>, which means
      you can no longer receive updates from them or interact with them.
    </Trans>
  ),
  domain_block: ({ from, targetName, followersCount, followingCount }) => (
    <Trans>
      An admin from <i>{from}</i> has blocked <i>{targetName}</i>. Affected
      followers: {followersCount}, followings: {followingCount}.
    </Trans>
  ),
  user_domain_block: ({ targetName, followersCount, followingCount }) => (
    <Trans>
      You have blocked <i>{targetName}</i>. Removed followers: {followersCount},
      followings: {followingCount}.
    </Trans>
  ),
};

const MODERATION_WARNING_TEXT: Record<string, MessageDescriptor> = {
  none: msg`Your account has received a moderation warning.`,
  disable: msg`Your account has been disabled.`,
  mark_statuses_as_sensitive: msg`Some of your posts have been marked as sensitive.`,
  delete_statuses: msg`Some of your posts have been deleted.`,
  sensitive: msg`Your posts will be marked as sensitive from now on.`,
  silence: msg`Your account has been limited.`,
  suspend: msg`Your account has been suspended.`,
};

const AVATARS_LIMIT = 30;

function Notification({
  notification,
  instance,
  isStatic,
  disableContextMenu,
}: NotificationProps) {
  const { i18n } = useLingui();
  const { masto } = api();
  const {
    id,
    status,
    account,
    report,
    event,
    moderation_warning,
    annualReport,
    // Client-side grouped notification
    _ids,
    _accounts,
    _statuses,
    _groupKeys,
    // Server-side grouped notification
    sampleAccounts,
    notificationsCount,
    groupKey,
  } = notification;
  let { type } = notification;

  if ((type === 'mention' || type === 'quote') && !status) {
    // Could be deleted
    return null;
  }

  // status = Attached when type of the notification is favourite, reblog, status, mention, poll, or update
  const actualStatus = status?.reblog || status;
  const actualStatusID = actualStatus?.id;

  const currentAccount = getCurrentAccountID();
  const isSelf = currentAccount === account?.id;
  const isVoted = status?.poll?.voted;
  const isReplyToOthers =
    !!status?.inReplyToAccountId &&
    status?.inReplyToAccountId !== currentAccount &&
    status?.account?.id === currentAccount;

  let favsCount = 0;
  let reblogsCount = 0;
  if (type === 'favourite+reblog') {
    if (_accounts) {
      for (const account of _accounts) {
        if (account._types?.includes('favourite')) {
          favsCount++;
        }
        if (account._types?.includes('reblog')) {
          reblogsCount++;
        }
      }
    }
    if (!reblogsCount && favsCount) type = 'favourite';
    if (!favsCount && reblogsCount) type = 'reblog';
  }

  let text: ContentTextRenderer | JSX.Element | string | undefined;
  if (type === 'poll') {
    text = contentText[isSelf ? 'poll-self' : isVoted ? 'poll-voted' : 'poll'];
  } else if (type && contentText[type]) {
    text = contentText[type];
  } else {
    // Anticipate unhandled notification types, possibly from Mastodon forks or non-Mastodon instances
    // This surfaces the error to the user, hoping that users will report it
    // Preserve JS behavior: undefined `type` interpolates as the string
    // "undefined". The `t` macro placeholder type rejects `undefined`, so
    // coerce explicitly.
    text = t`[Unknown notification type: ${String(type)}]`;
  }

  const Subject: SubjectComponent = ({ clickable, ...props }) =>
    clickable ? (
      <b tabIndex={0} onClick={handleOpenGenericAccounts} {...props} />
    ) : (
      <b {...props} />
    );

  // JS original: `notificationsCount > 0 && notificationsCount > sampleAccounts?.length`.
  // When `sampleAccounts` is undefined the second comparison resolves to
  // `n > undefined` → NaN → false. Preserve that by casting the operands so
  // TS lets undefined flow through (instead of defaulting to 0, which would
  // change behavior).
  const diffCount =
    (notificationsCount as number) > 0 &&
    (notificationsCount as number) > (sampleAccounts?.length as number);
  const expandAccounts: 'remote' | 'local' = diffCount ? 'remote' : 'local';

  if (typeof text === 'function') {
    const renderer = text;
    const count =
      (type === 'favourite' || type === 'reblog' || type === 'admin.sign_up') &&
      notificationsCount
        ? diffCount
          ? notificationsCount
          : sampleAccounts?.length
        : _accounts?.length || sampleAccounts?.length || (account ? 1 : 0);
    const postsCount = _statuses?.length || (status ? 1 : 0);
    if (type === 'admin.report') {
      const targetAccount = report?.targetAccount;
      if (targetAccount) {
        text = renderer({
          account: <NameText account={account} showAvatar />,
          targetAccount: <NameText account={targetAccount} showAvatar />,
        });
      }
    } else if (type === 'severed_relationships') {
      const targetName = event?.targetName;
      if (targetName) {
        text = renderer({ name: targetName });
      }
    } else if (
      (type === 'emoji_reaction' || type === 'pleroma:emoji_reaction') &&
      notification.emoji
    ) {
      const emojiShortcode = notification.emoji
        .replace(/^:/, '')
        .replace(/:$/, '');
      const emojiURL: string | EmojiUrlObject | undefined =
        notification.emoji_url || // This is string
        status?.emojis?.find?.((emoji) => emoji?.shortcode === emojiShortcode); // Emoji object instead of string
      text = renderer({
        account: <NameText account={account} showAvatar />,
        emoji: notification.emoji,
        emojiURL,
      });
    } else if (type === 'annual_report') {
      text = renderer({
        ...notification.annualReport,
      });
    } else {
      text = renderer({
        account: account ? (
          <NameText account={account} showAvatar />
        ) : sampleAccounts?.[0] ? (
          <NameText account={sampleAccounts[0]} showAvatar />
        ) : null,
        count: count as number | undefined,
        postsCount,
        postType: isReplyToOthers ? 'reply' : 'post',
        components: { Subject },
      });
    }
  }

  const formattedCreatedAt =
    notification.createdAt && new Date(notification.createdAt).toLocaleString();

  const genericAccountsHeading =
    (type !== undefined &&
      (
        {
          'favourite+reblog': t`Boosted/Liked by…`,
          favourite: t`Liked by…`,
          reblog: t`Boosted by…`,
          follow: t`Followed by…`,
        } as Record<string, string>
      )[type]) ||
    t`Accounts`;
  const showRemoteAccounts =
    (type === 'favourite+reblog' ||
      type === 'favourite' ||
      type === 'reblog' ||
      type === 'admin.sign_up') &&
    expandAccounts === 'remote';
  const handleOpenGenericAccounts = () => {
    if (showRemoteAccounts) {
      states.showGenericAccounts = {
        heading: genericAccountsHeading,
        accounts: _accounts,
        fetchAccounts: async () => {
          const mastoV2Notifications = (
            masto.v2 as unknown as { notifications: MastoV2Notifications }
          ).notifications;
          // JS original called `.map` on `_groupKeys` directly. Preserve
          // that crash-on-missing behavior with a non-null cast.
          const keyAccounts = await Promise.allSettled(
            (_groupKeys as string[]).map(async (gKey: string) => {
              const iterator = mastoV2Notifications
                .$select(gKey)
                .accounts.list()
                .values();
              const next = await iterator.next();
              // `next.value` may be `undefined` when the async iterator is
              // exhausted. JS original passed it through and would crash on
              // the `for...of` below; preserve that with an honest type.
              return [gKey, next.value] as [
                string,
                AccountWithBot[] | undefined,
              ];
            }),
          );
          const accounts: AccountWithBot[] = [];
          for (const keyAccount of keyAccounts) {
            // The JS original accessed `.value` without checking `.status`;
            // rejected entries crashed at the destructure below. Preserve
            // that behavior via an unchecked cast.
            const [key, _accounts] = (
              keyAccount as PromiseFulfilledResult<
                [string, AccountWithBot[] | undefined]
              >
            ).value;
            const type = /^favourite/.test(key)
              ? 'favourite'
              : /^reblog/.test(key)
                ? 'reblog'
                : null;
            // if (!type) continue;
            // JS original iterated `_accounts` directly; an exhausted iterator
            // (undefined) would crash here. Cast preserves that contract.
            for (const account of _accounts as AccountWithBot[]) {
              const theAccount = accounts.find((a) => a.id === account.id);
              if (theAccount && type) {
                theAccount._types!.push(type);
              } else {
                if (type) account._types = [type];
                accounts.push(account);
              }
            }
          }
          return {
            done: true,
            value: accounts,
          };
        },
        showReactions: type === 'favourite+reblog',
        postID: statusKey(actualStatusID, instance),
      };
    } else {
      states.showGenericAccounts = {
        heading: genericAccountsHeading,
        accounts: _accounts,
        showReactions: type === 'favourite+reblog',
        excludeRelationshipAttrs: type === 'follow' ? ['followedBy'] : [],
        postID: statusKey(actualStatusID, instance),
      };
    }
  };

  console.debug('RENDER Notification', notification.id);

  // If there's a status and filter action is 'hide', then the notification is hidden
  if (!!status?.filtered) {
    const isOwnPost = status?.account?.id === currentAccount;
    const filterInfo = isFiltered(status.filtered, 'notifications');
    if (!isSelf && !isOwnPost && filterInfo && filterInfo.action === 'hide') {
      return null;
    }
  }

  const debugHover = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    if (e.shiftKey) {
      console.log({
        ...notification,
      });
    }
  };

  return (
    <div
      class={`notification notification-${type}`}
      data-notification-id={_ids || id}
      data-group-key={_groupKeys?.join(' ') || groupKey}
      tabIndex={0}
      onMouseEnter={debugHover}
    >
      <div
        class={`notification-type notification-${type}`}
        title={formattedCreatedAt || undefined}
      >
        {type === 'favourite+reblog' ? (
          <>
            <Icon icon="rocket" size="xl" alt={type} class="reblog-icon" />
            <Icon icon="heart" size="xl" alt={type} class="favourite-icon" />
          </>
        ) : type === 'mention+quote' ? (
          <>
            <Icon icon="comment" size="xl" alt={type} class="mention-icon" />
            <Icon icon="quote" size="xl" alt={type} class="quote-icon" />
          </>
        ) : (
          <Icon
            icon={(type && NOTIFICATION_ICONS[type]) || 'notification'}
            size="xl"
            alt={type}
          />
        )}
      </div>
      <div class="notification-content">
        {/* {(type === 'favourite+reblog' ||
          type === 'favourite' ||
          type === 'reblog') && (
          <>
            💥 {type} {expandAccounts}{' '}
            <mark>
              N{_notificationsCount?.join(',')} + A
              {_sampleAccountsCount?.join(',')}
            </mark>{' '}
            ‒{' '}
            <mark>
              N{notificationsCount} + A{sampleAccounts?.length}
            </mark>
          </>
        )} */}
        {type !== 'mention' && type !== 'quote' && type !== 'mention+quote' && (
          <>
            <p>{text as ComponentChildren}</p>
            {type === 'follow_request' && (
              // JS original passed `account.id` unconditionally; missing
              // account would crash here. Preserve that contract.
              <FollowRequestButtons
                accountID={(account as AccountWithBot).id!}
              />
            )}
            {type === 'severed_relationships' && (
              <div>
                {/* JS original accessed `event.type` directly without a
                    guard; missing `event` crashed here. Preserve that. */}
                {SEVERED_RELATIONSHIPS_TEXT[
                  (event as SeveredRelationshipEvent).type as string
                ]({
                  from: instance,
                  ...(event as SeveredRelationshipEvent),
                })}
                <br />
                <a
                  href={`https://${instance}/severed_relationships`}
                  target="_blank"
                  rel="noopener"
                >
                  <Trans>
                    Learn more <Icon icon="external" size="s" />
                  </Trans>
                </a>
                .
              </div>
            )}
            {type === 'moderation_warning' && !!moderation_warning && (
              <div>
                {i18n._(
                  // The JS original calls `()` on the table entry. Some
                  // historical Lingui versions returned a thunk from `msg`,
                  // others return a `MessageDescriptor` directly. Preserve
                  // the JS-original call shape verbatim — if the value is
                  // already a `MessageDescriptor` it crashes at runtime
                  // exactly as the JS original did; if it is a thunk, it
                  // resolves to the descriptor.
                  (
                    MODERATION_WARNING_TEXT[
                      moderation_warning.action as string
                    ] as unknown as () => MessageDescriptor
                  )(),
                )}
                <br />
                <a
                  href={`/disputes/strikes/${moderation_warning.id}`}
                  target="_blank"
                  rel="noopener"
                >
                  <Trans>
                    Learn more <Icon icon="external" size="s" />
                  </Trans>
                </a>
              </div>
            )}
            {type === 'annual_report' && (
              <div>
                <Link to={`/annual_report/${annualReport?.year}`}>
                  <Trans>View #Wrapstodon</Trans>
                </Link>
              </div>
            )}
          </>
        )}
        {_accounts && _accounts.length > 1 && (
          <p class="avatars-stack">
            {_accounts.slice(0, AVATARS_LIMIT).map((account) => (
              <Fragment key={account.id}>
                <a
                  key={account.id}
                  href={account.url}
                  rel="noopener"
                  class="account-avatar-stack"
                  onClick={(e) => {
                    e.preventDefault();
                    states.showAccount = account;
                  }}
                >
                  <Avatar
                    url={account.avatarStatic}
                    size={
                      _accounts.length <= 10
                        ? 'xxl'
                        : _accounts.length < 20
                          ? 'xl'
                          : 'l'
                    }
                    key={account.id}
                    alt={`${account.displayName} @${account.acct}`}
                    squircle={account?.bot}
                  />
                  {type === 'favourite+reblog' && (
                    <div class="account-sub-icons">
                      {/* JS original accessed `_types` directly without a
                          guard. Preserve crash-on-missing behavior. */}
                      {(account._types as string[]).map((type) => (
                        <Icon
                          icon={NOTIFICATION_ICONS[type]}
                          size="s"
                          class={`${type}-icon`}
                        />
                      ))}
                    </div>
                  )}
                </a>{' '}
              </Fragment>
            ))}
            {showRemoteAccounts ? (
              <button
                type="button"
                class="small plain"
                data-group-keys={_groupKeys?.join(' ')}
                onClick={handleOpenGenericAccounts}
              >
                +
                {(type === 'favourite' ||
                  type === 'reblog' ||
                  type === 'admin.sign_up') &&
                  (notificationsCount as number) - _accounts.length}
                <Icon icon="chevron-down" />
              </button>
            ) : (
              <button
                type="button"
                class="small plain"
                onClick={handleOpenGenericAccounts}
              >
                {_accounts.length > AVATARS_LIMIT &&
                  `+${_accounts.length - AVATARS_LIMIT}`}
                <Icon icon="chevron-down" />
              </button>
            )}
          </p>
        )}
        {!_accounts?.length && sampleAccounts && sampleAccounts.length > 1 && (
          <p class="avatars-stack">
            {/* JS original iterated sampleAccounts directly, accessing
                `account.id`, `account.url`, etc. without guards. `undefined`
                entries (from `accounts.find(...) => undefined` in
                `massageNotifications2`) would crash here in both JS and TS;
                preserve that contract with a non-null cast on the entries. */}
            {(sampleAccounts as AccountWithBot[]).map((account) => (
              <Fragment key={account.id}>
                <a
                  key={account.id}
                  href={account.url}
                  rel="noopener"
                  class="account-avatar-stack"
                  onClick={(e) => {
                    e.preventDefault();
                    states.showAccount = account;
                  }}
                >
                  <Avatar
                    url={account.avatarStatic}
                    size="xxl"
                    key={account.id}
                    alt={`${account.displayName} @${account.acct}`}
                    squircle={account?.bot}
                  />
                  {/* {type === 'favourite+reblog' && (
                    <div class="account-sub-icons">
                      {account._types.map((type) => (
                        <Icon
                          icon={NOTIFICATION_ICONS[type]}
                          size="s"
                          class={`${type}-icon`}
                        />
                      ))}
                    </div>
                  )} */}
                </a>{' '}
              </Fragment>
            ))}
            {(notificationsCount ?? 0) > sampleAccounts.length &&
              status?.id && (
                <Link
                  to={
                    instance ? `/${instance}/s/${status.id}` : `/s/${status.id}`
                  }
                  class="button small plain centered"
                >
                  +{(notificationsCount as number) - sampleAccounts.length}
                  <Icon icon="chevron-right" />
                </Link>
              )}
          </p>
        )}
        {_statuses && _statuses.length > 1 && (
          <ul class="notification-group-statuses">
            {(_statuses as mastodon.v1.Status[]).map((status) => (
              <li key={status.id}>
                <TruncatedLink
                  class={`status-link status-type-${type}`}
                  to={
                    instance ? `/${instance}/s/${status.id}` : `/s/${status.id}`
                  }
                >
                  <Status
                    status={status}
                    size="s"
                    previewMode
                    allowContextMenu
                    allowFilters
                  />
                </TruncatedLink>
              </li>
            ))}
          </ul>
        )}
        {status && (!_statuses?.length || _statuses?.length <= 1) && (
          <TruncatedLink
            class={`status-link status-type-${type}`}
            to={
              instance
                ? `/${instance}/s/${actualStatusID}`
                : `/s/${actualStatusID}`
            }
            onContextMenu={
              !disableContextMenu
                ? (e: JSX.TargetedMouseEvent<HTMLElement>) => {
                    const target = e.target as HTMLElement | null;
                    const post = target?.querySelector('.status');
                    if (post) {
                      // Fire a custom event to open the context menu
                      if (e.metaKey) return;
                      e.preventDefault();
                      post.dispatchEvent(
                        new MouseEvent('contextmenu', {
                          clientX: e.clientX,
                          clientY: e.clientY,
                        }),
                      );
                    }
                  }
                : undefined
            }
          >
            {isStatic ? (
              <Status
                status={actualStatus}
                size="s"
                readOnly
                allowContextMenu
                allowFilters
              />
            ) : (
              <Status
                statusID={actualStatusID}
                size="s"
                readOnly
                allowContextMenu
                allowFilters
              />
            )}
          </TruncatedLink>
        )}
      </div>
    </div>
  );
}

type TruncatedLinkProps = LinkProps & {
  children?: ComponentChildren;
  [key: string]: unknown;
};

function TruncatedLink(props: TruncatedLinkProps) {
  const { t } = useLingui();
  const ref = useTruncated();
  return (
    <Link
      {...(props as LinkProps)}
      data-read-more={t`Read more →`}
      ref={ref as Ref<HTMLAnchorElement>}
    />
  );
}

export default memo(Notification, (oldProps, newProps) => {
  return oldProps.notification?.id === newProps.notification?.id;
});
