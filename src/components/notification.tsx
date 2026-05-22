import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Plural, Select, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ReactNode, ComponentType, JSX, Ref, ReactElement } from 'react';
import { Fragment } from 'react';
import { memo } from 'react';

import { api, getMastoV2Resource } from '../utils/api';
import { isFiltered } from '../utils/filters';
import { hasMutedAuthor } from '../utils/muted-post-visibility';
import shortenNumber from '../utils/shorten-number';
import states, { statusKey } from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';
import useTruncated from '../utils/useTruncated';

import Avatar from './avatar';
import Icon from './icon';
import Link, { type LinkProps } from './link';
import NameTextComponent, {
  type NameTextProps as NameTextViewProps,
} from './name-text';
import StatusComponent, {
  type StatusComponentProps as StatusViewProps,
} from './status';

// Local wrappers keep this component's wider notification payload shapes
// while forwarding through typed peers.
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
  onClick?: (e: React.MouseEvent) => void;
}
function NameText(props: NameTextProps) {
  return <NameTextComponent {...(props as NameTextViewProps)} />;
}

interface StatusComponentProps {
  status?: mastodon.v1.Status | null;
  statusID?: string;
  instance?: string;
  size?: 's' | 'm' | 'l';
  previewMode?: boolean;
  readOnly?: boolean;
  allowContextMenu?: boolean;
  allowFilters?: boolean;
  hideReplyBadge?: boolean;
  forceShowMuted?: boolean;
}
function Status(props: StatusComponentProps) {
  return <StatusComponent {...(props as StatusViewProps)} />;
}

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

export interface NotificationProps {
  notification: NotificationInput;
  instance?: string;
  isStatic?: boolean;
  disableContextMenu?: boolean;
}

interface SubjectProps {
  clickable?: boolean;
  children?: ReactNode;
  [key: string]: unknown;
}
type SubjectComponent = ComponentType<SubjectProps>;
const SubjectFallback = ({ children }: SubjectProps) => <>{children}</>;

interface ContentTextArgs {
  account?: ReactElement | null;
  targetAccount?: ReactElement | null;
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
  favourite: 'heart',
  update: 'pencil',
  'admin.sign_up': 'account-edit',
  'admin.report': 'account-warning',
  severed_relationships: 'heart-break',
  moderation_warning: 'alert',
  emoji_reaction: 'emoji2',
  reaction: 'emoji2',
  'pleroma:emoji_reaction': 'emoji2',
  quote: 'quote',
  quoted_update: 'pencil',
};

/*
Notification types
==================
mention = Someone mentioned you in their status
status = Someone you enabled notifications for has posted a status
reblog = Someone reposted one of your statuses
follow = Someone followed you
favourite = Someone liked one of your statuses
update = A status you interacted with has been edited
admin.sign_up = Someone signed up (optionally sent to admins)
admin.report = A new report has been filed
severed_relationships = Severed relationships
moderation_warning = Moderation warning
quote = Someone quoted one of your statuses
quoted_update = A status you have quoted has been edited
*/

function emojiText({ account, emoji }: ContentTextArgs): JSX.Element {
  return (
    <Trans>
      {account} reacted to your post with {emoji}
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
    const Subject = components?.Subject ?? SubjectFallback;
    return (
      <Plural
        value={count}
        _1={
          <Plural
            value={postsCount}
            _1={
              <Select
                value={postType}
                _reply={<Trans>{account} reposted your reply.</Trans>}
                other={<Trans>{account} reposted your post.</Trans>}
              />
            }
            other={
              <Trans>
                {account} reposted {postsCount} of your posts.
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
                reposted your reply.
              </Trans>
            }
            other={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                reposted your post.
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
    const Subject = components?.Subject ?? SubjectFallback;
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
  favourite: (args) => {
    const { account, components } = args;
    const count = args.count as number;
    const postsCount = args.postsCount as number;
    const postType = args.postType as 'reply' | 'post';
    const Subject = components?.Subject ?? SubjectFallback;
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
    const Subject = components?.Subject ?? SubjectFallback;
    return (
      <Plural
        value={count}
        _1={
          <Plural
            value={postsCount}
            _1={
              <Select
                value={postType}
                _reply={<Trans>{account} reposted & liked your reply.</Trans>}
                other={<Trans>{account} reposted & liked your post.</Trans>}
              />
            }
            other={
              <Trans>
                {account} reposted & liked {postsCount} of your posts.
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
                reposted & liked your reply.
              </Trans>
            }
            other={
              <Trans>
                <Subject clickable={count > 1}>
                  <span title={String(count)}>{shortenNumber(count)}</span>{' '}
                  people
                </Subject>{' '}
                reposted & liked your post.
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
    const Subject = components?.Subject ?? SubjectFallback;
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

  if (type === 'follow_request') {
    return null;
  }

  if ((type === 'mention' || type === 'quote') && !status) {
    // Could be deleted
    return null;
  }

  // status = Attached when type of the notification is favourite, reblog, status, mention, or update
  const actualStatus = status?.reblog || status;
  const actualStatusID = actualStatus?.id;

  const currentAccount = getCurrentAccountID();
  const isSelf = currentAccount === account?.id;
  const isReplyToOthers =
    !!status?.inReplyToAccountId &&
    status?.inReplyToAccountId !== currentAccount &&
    status?.account?.id === currentAccount;

  let favsCount = 0;
  let reblogsCount = 0;
  if (type === 'favourite+reblog') {
    if (_accounts) {
      for (const acct of _accounts) {
        if (acct._types?.includes('favourite')) {
          favsCount++;
        }
        if (acct._types?.includes('reblog')) {
          reblogsCount++;
        }
      }
    }
    if (!reblogsCount && favsCount) type = 'favourite';
    if (!favsCount && reblogsCount) type = 'reblog';
  }

  let text: ContentTextRenderer | JSX.Element | string | undefined;
  if (type && contentText[type]) {
    text = contentText[type];
  } else {
    // Anticipate unhandled notification types, possibly from Mastodon forks or non-Mastodon instances
    // This surfaces the error to the user, hoping that users will report it
    // Preserve JS behavior: undefined `type` interpolates as the string
    // "undefined". The `t` macro placeholder type rejects `undefined`, so
    // coerce explicitly.
    text = t`[Unknown notification type: ${String(type)}]`;
  }

  const Subject: SubjectComponent = ({ clickable, ...props }) => {
    if (!clickable) return <b {...props} />;
    const { className, ...buttonProps } = props as SubjectProps & {
      className?: string;
    };
    return (
      <button
        type="button"
        className={`notification-subject-button${className ? ` ${className}` : ''}`}
        onClick={handleOpenGenericAccounts}
        {...buttonProps}
      />
    );
  };

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
      text = renderer({
        account: <NameText account={account} showAvatar />,
        emoji: notification.emoji,
      });
    } else {
      text = renderer({
        account: account ? (
          <NameText account={account} showAvatar />
        ) : sampleAccounts?.[0] ? (
          <NameText account={sampleAccounts[0]} showAvatar />
        ) : null,
        count,
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
          'favourite+reblog': t`Reposted/Liked by…`,
          favourite: t`Liked by…`,
          reblog: t`Reposted by…`,
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
          const mastoV2Notifications = getMastoV2Resource<MastoV2Notifications>(
            masto,
            'notifications',
          );
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
            const [key, keyAccountsList] = (
              keyAccount as PromiseFulfilledResult<
                [string, AccountWithBot[] | undefined]
              >
            ).value;
            const reactionType = key.startsWith('favourite')
              ? 'favourite'
              : key.startsWith('reblog')
                ? 'reblog'
                : null;
            // if (!reactionType) continue;
            // JS original iterated `_accounts` directly; an exhausted iterator
            // (undefined) would crash here. Cast preserves that contract.
            for (const acct of keyAccountsList as AccountWithBot[]) {
              const theAccount = accounts.find((a) => a.id === acct.id);
              if (theAccount && reactionType) {
                theAccount._types ??= [];
                theAccount._types.push(reactionType);
              } else {
                if (reactionType) acct._types = [reactionType];
                accounts.push(acct);
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
  const isOwnPost = status?.account?.id === currentAccount;
  if (status?.filtered) {
    const filterInfo = isFiltered(status.filtered, 'notifications');
    if (!isSelf && !isOwnPost && filterInfo && filterInfo.action === 'hide') {
      return null;
    }
  }
  if (!isSelf && !isOwnPost && status && hasMutedAuthor(status)) {
    return null;
  }

  const debugHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.shiftKey) {
      console.log({
        ...notification,
      });
    }
  };

  return (
    // TODO(oxlint:jsx-a11y/no-noninteractive-tabindex): notification card
    // is keyboard-focusable for j/k navigation and Shift+hover debug. There
    // is no interactive ARIA role that fits "selectable feed item"; using
    // `article` keeps the screen-reader landmark intact.
    <div
      className={`notification notification-${type}`}
      data-notification-id={_ids || id}
      data-group-key={_groupKeys?.join(' ') || groupKey}
      role="article"
      tabIndex={0}
      onMouseEnter={debugHover}
    >
      <div
        className={`notification-type notification-${type}`}
        title={formattedCreatedAt || undefined}
      >
        {type === 'favourite+reblog' ? (
          <>
            <Icon icon="rocket" size="xl" alt={type} className="reblog-icon" />
            <Icon
              icon="heart"
              size="xl"
              alt={type}
              className="favourite-icon"
            />
          </>
        ) : type === 'mention+quote' ? (
          <>
            <Icon
              icon="comment"
              size="xl"
              alt={type}
              className="mention-icon"
            />
            <Icon icon="quote" size="xl" alt={type} className="quote-icon" />
          </>
        ) : (
          <Icon
            icon={(type && NOTIFICATION_ICONS[type]) || 'notification'}
            size="xl"
            alt={type}
          />
        )}
      </div>
      <div className="notification-content">
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
            <p>{text as ReactNode}</p>
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
                  Reflect.apply(
                    MODERATION_WARNING_TEXT[
                      moderation_warning.action as string
                    ] as never,
                    undefined,
                    [],
                  ),
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
          </>
        )}
        {_accounts && _accounts.length > 1 && (
          <p className="avatars-stack">
            {_accounts.slice(0, AVATARS_LIMIT).map((acct) => (
              <Fragment key={acct.id}>
                <a
                  key={acct.id}
                  href={acct.url}
                  rel="noopener"
                  className="account-avatar-stack"
                  onClick={(e) => {
                    e.preventDefault();
                    states.showAccount = acct;
                  }}
                >
                  <Avatar
                    url={acct.avatarStatic}
                    size={
                      _accounts.length <= 10
                        ? 'xl'
                        : _accounts.length < 20
                          ? 'l'
                          : 'm'
                    }
                    key={acct.id}
                    alt={`${acct.displayName} @${acct.acct}`}
                    squircle={acct?.bot}
                  />
                  {type === 'favourite+reblog' && (
                    <div className="account-sub-icons">
                      {/* JS original accessed `_types` directly without a
                          guard. Preserve crash-on-missing behavior. */}
                      {(acct._types as string[]).map((iconType) => (
                        <Icon
                          key={iconType}
                          icon={NOTIFICATION_ICONS[iconType]}
                          size="s"
                          className={`${iconType}-icon`}
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
                className="small plain"
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
                className="small plain"
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
          <p className="avatars-stack">
            {/* JS original iterated sampleAccounts directly, accessing
                `account.id`, `account.url`, etc. without guards. `undefined`
                entries (from `accounts.find(...) => undefined` in
                `massageNotifications2`) would crash here in both JS and TS;
                preserve that contract with a non-null cast on the entries. */}
            {(sampleAccounts as AccountWithBot[]).map((acct) => (
              <Fragment key={acct.id}>
                <a
                  key={acct.id}
                  href={acct.url}
                  rel="noopener"
                  className="account-avatar-stack"
                  onClick={(e) => {
                    e.preventDefault();
                    states.showAccount = acct;
                  }}
                >
                  <Avatar
                    url={acct.avatarStatic}
                    size="xl"
                    key={acct.id}
                    alt={`${acct.displayName} @${acct.acct}`}
                    squircle={acct?.bot}
                  />
                  {/* {type === 'favourite+reblog' && (
                    <div className="account-sub-icons">
                      {account._types.map((type) => (
                        <Icon
                          icon={NOTIFICATION_ICONS[type]}
                          size="s"
                          className={`${type}-icon`}
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
                  className="button small plain centered"
                >
                  +{(notificationsCount as number) - sampleAccounts.length}
                  <Icon icon="chevron-right" />
                </Link>
              )}
          </p>
        )}
        {_statuses && _statuses.length > 1 && (
          <ul className="notification-group-statuses">
            {(_statuses as mastodon.v1.Status[]).map((groupStatus) => (
              <li key={groupStatus.id}>
                <TruncatedLink
                  className={`status-link status-type-${type}`}
                  to={
                    instance
                      ? `/${instance}/s/${groupStatus.id}`
                      : `/s/${groupStatus.id}`
                  }
                >
                  <Status
                    status={groupStatus}
                    size="s"
                    previewMode
                    hideReplyBadge={isReplyToOthers}
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
            className={`status-link status-type-${type}`}
            to={
              instance
                ? `/${instance}/s/${actualStatusID}`
                : `/s/${actualStatusID}`
            }
            onContextMenu={
              !disableContextMenu
                ? (e: React.MouseEvent<HTMLElement>) => {
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
                hideReplyBadge={isReplyToOthers}
                allowContextMenu
                allowFilters
              />
            ) : (
              <Status
                statusID={actualStatusID}
                size="s"
                readOnly
                hideReplyBadge={isReplyToOthers}
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
  children?: ReactNode;
  [key: string]: unknown;
};

function TruncatedLink(props: TruncatedLinkProps) {
  const { t: tt } = useLingui();
  const ref = useTruncated();
  return (
    <Link
      {...(props as LinkProps)}
      data-read-more={tt`Read more →`}
      ref={ref as Ref<HTMLAnchorElement>}
    />
  );
}

export default memo(Notification, (oldProps, newProps) => {
  return oldProps.notification?.id === newProps.notification?.id;
});
