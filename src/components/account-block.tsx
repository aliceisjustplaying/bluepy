import './account-block.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';

// import { useNavigate } from 'react-router-dom';
import enhanceContent from '../utils/enhance-content';
import niceDateTime from '../utils/nice-date-time';
import { navigatePath } from '../utils/router';
import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';

import Avatar from './avatar';
import EmojiText from './emoji-text';
import Icon from './icon';
import RawHtml from './raw-html';
import RolesTags from './roles-tags';

export interface AccountBlockProps {
  skeleton?: boolean;
  account?: mastodon.v1.Account | null;
  avatarSize?: string;
  avatarDescription?: string;
  useAvatarStatic?: boolean;
  instance?: string;
  external?: boolean;
  internal?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  showActivity?: boolean;
  showStats?: boolean;
  accountInstance?: string;
  hideDisplayName?: boolean;
  relationship?: Partial<mastodon.v1.Relationship> | null;
  excludeRelationshipAttrs?: readonly string[];
}

function AccountBlock({
  skeleton,
  account,
  avatarSize = 'xl',
  avatarDescription,
  useAvatarStatic = false,
  instance,
  external,
  internal,
  onClick,
  showActivity = false,
  showStats = false,
  accountInstance,
  hideDisplayName = false,
  relationship = {},
  excludeRelationshipAttrs = [],
}: AccountBlockProps) {
  const { t } = useLingui();
  if (skeleton) {
    return (
      <div className="account-block skeleton">
        <Avatar size={avatarSize} />
        <span>
          <b>████████</b>
          <br />
          <span className="account-block-acct">██████</span>
        </span>
      </div>
    );
  }

  if (!account) {
    return null;
  }

  // const navigate = useNavigate();

  const {
    id,
    acct,
    avatar,
    avatarStatic,
    displayName,
    username,
    emojis,
    url,
    statusesCount,
    lastStatusAt,
    bot,
    fields,
    group,
    followersCount,
    createdAt,
    locked,
    roles,
  } = account;
  let [, acct1, acct2] = acct.match(/([^@]+)(@.+)/i) || [undefined, acct];
  if (accountInstance) {
    acct2 = `@${accountInstance}`;
  }

  const verifiedField = fields?.find((f) => !!f.verifiedAt && !!f.value);

  const excludedRelationship: Record<string, unknown> = {};
  const relationshipRecord = relationship as Record<string, unknown>;
  for (const r in relationshipRecord) {
    if (!excludeRelationshipAttrs.includes(r)) {
      excludedRelationship[r] = relationshipRecord[r];
    }
  }
  const hasRelationship =
    !!excludedRelationship.following ||
    !!excludedRelationship.followedBy ||
    !!excludedRelationship.requested;

  return (
    <a
      className="account-block"
      href={url}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      title={acct2 ? acct : `@${acct}`}
      onClick={(e) => {
        if (external) return;
        e.preventDefault();
        if (onClick) {
          onClick(e);
          return;
        }
        if (internal) {
          // navigate(`/${instance}/a/${id}`);
          navigatePath(`/${instance}/a/${id}`);
        } else {
          states.showAccount = {
            account,
            instance,
          };
        }
      }}
    >
      <div className="avatar-container">
        <Avatar
          url={useAvatarStatic ? avatarStatic : avatar || avatarStatic}
          staticUrl={useAvatarStatic ? undefined : avatarStatic}
          size={avatarSize}
          squircle={bot}
          alt={avatarDescription || ''}
        />
      </div>
      <span className="account-block-content">
        {!hideDisplayName && (
          <>
            {displayName ? (
              <b>
                <EmojiText text={displayName} />
              </b>
            ) : (
              <b>{username}</b>
            )}
          </>
        )}{' '}
        <span className="account-block-acct bidi-isolate">
          {acct2 ? '' : '@'}
          {acct1}
          <wbr />
          {acct2}
          {locked && (
            <>
              {' '}
              <Icon icon="lock" size="s" alt={t`Locked`} />
            </>
          )}
        </span>
        <RolesTags roles={roles} accountUrl={url} />
        {showActivity && (
          <div className="account-block-stats">
            <Trans>Posts: {shortenNumber(statusesCount)}</Trans>
            {!!lastStatusAt && (
              <>
                {' '}
                &middot;{' '}
                <Trans>
                  Last posted:{' '}
                  {niceDateTime(lastStatusAt, {
                    hideTime: true,
                  })}
                </Trans>
              </>
            )}
          </div>
        )}
        {showStats && (
          <div className="account-block-stats">
            {bot && (
              <>
                <span className="tag collapsed">
                  <Icon icon="bot" /> <Trans>Automated</Trans>
                </span>
              </>
            )}
            {group && (
              <>
                <span className="tag collapsed">
                  <Icon icon="group" /> <Trans>Group</Trans>
                </span>
              </>
            )}
            {hasRelationship && (
              <div
                key={relationship?.id}
                className="shazam-container-horizontal"
              >
                <div className="shazam-container-inner">
                  {excludedRelationship.following &&
                  excludedRelationship.followedBy ? (
                    <span className="tag minimal">
                      <Trans>Mutual</Trans>
                    </span>
                  ) : excludedRelationship.requested ? (
                    <span className="tag minimal">
                      <Trans>Requested</Trans>
                    </span>
                  ) : excludedRelationship.following ? (
                    <span className="tag minimal">
                      <Trans>Following</Trans>
                    </span>
                  ) : excludedRelationship.followedBy ? (
                    <span className="tag minimal">
                      <Trans>Follows you</Trans>
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            {!!followersCount && (
              <span className="ib">
                <Plural
                  value={followersCount}
                  one="# follower"
                  other="# followers"
                />
              </span>
            )}
            {!!verifiedField && (
              // The verified field renders enhanceContent links inside the
              // card-level <a>. Stop click/keydown from bubbling so activating
              // an inner link opens that link instead of triggering card
              // navigation; the inner anchors keep their native behavior.
              <span
                className="verified-field"
                onClick={(e) => {
                  const anchor = (e.target as HTMLElement).closest('a');
                  // Only stop propagation for clicks on an anchor INSIDE the
                  // verified field. `closest('a')` would otherwise also match
                  // the outer card anchor for plain text/icon clicks and
                  // wrongly suppress card navigation.
                  if (anchor && e.currentTarget.contains(anchor)) {
                    e.stopPropagation();
                  }
                }}
                onKeyDown={(e) => {
                  const anchor = (e.target as HTMLElement).closest('a');
                  if (
                    (e.key === 'Enter' || e.key === ' ') &&
                    anchor &&
                    e.currentTarget.contains(anchor)
                  ) {
                    e.stopPropagation();
                  }
                }}
              >
                <Icon icon="check-circle" size="s" alt={t`Verified`} />{' '}
                <RawHtml
                  as="span"
                  html={
                    enhanceContent(verifiedField.value, { emojis }) as string
                  }
                />
              </span>
            )}
            {!bot &&
              !group &&
              !hasRelationship &&
              !followersCount &&
              !verifiedField &&
              !!createdAt && (
                <span className="created-at">
                  <Trans>
                    Joined{' '}
                    <time dateTime={createdAt}>
                      {niceDateTime(createdAt, {
                        hideTime: true,
                      })}
                    </time>
                  </Trans>
                </span>
              )}
          </div>
        )}
      </span>
    </a>
  );
}

export default AccountBlock;
