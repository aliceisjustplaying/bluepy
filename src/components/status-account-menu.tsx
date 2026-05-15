import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';

import haptics from '../utils/haptics';
import { supportsNativeQuote } from '../utils/quote-utils';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { getStatus, saveStatus } from '../utils/states';
import supports from '../utils/supports';

import Icon from './icon';
import MenuConfirm from './menu-confirm';
import type { StatusMenuPartsArgs } from './status-menu-types';

type SaveableStatus = Parameters<typeof saveStatus>[0];
interface StatusQuotesRevokeResource {
  $select(id: string): {
    revoke: { create(): Promise<unknown> };
  };
}

function hasQuoteRevokeResource(
  resource: object,
): resource is StatusQuotesRevokeResource {
  return '$select' in resource;
}

function toSaveableStatus(status: mastodon.v1.Status): SaveableStatus {
  const { account, quote, reblog, url, ...statusFields } = status;
  const saveableStatus: SaveableStatus = {
    ...statusFields,
    account: account ? { ...account } : account,
    reblog: reblog ? toSaveableStatus(reblog) : reblog,
  };
  return Object.assign(
    saveableStatus,
    quote === undefined ? {} : { quote },
    url === undefined ? {} : { url },
  );
}

type StatusAccountMenuProps = Pick<
  StatusMenuPartsArgs,
  | 'isSelf'
  | 'mentionSelf'
  | 'masto'
  | 'id'
  | 'muted'
  | 'instance'
  | 'pinned'
  | 'isPinnable'
  | 'visibility'
  | 'setShowQuoteSettings'
  | 'quoteApprovalPolicyMessages'
  | 'postQuoteApprovalPolicy'
  | 'status'
  | 'isSizeLarge'
  | 'isQuotingMyPost'
  | 'quote'
  | 'username'
  | 'acct'
>;

export default function StatusAccountMenu({
  isSelf,
  mentionSelf,
  masto,
  id,
  muted,
  instance,
  pinned,
  isPinnable,
  visibility,
  setShowQuoteSettings,
  quoteApprovalPolicyMessages,
  postQuoteApprovalPolicy,
  status,
  isSizeLarge,
  isQuotingMyPost,
  quote,
  username,
  acct,
}: StatusAccountMenuProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  return (
    <>
      {(isSelf || mentionSelf) && <MenuDivider />}
      {(isSelf || mentionSelf) && (
        <MenuItem
          onClick={async () => {
            void haptics.trigger('light');
            try {
              const stmtAction = masto.v1.statuses.$select(id);
              const newStatus = await (muted
                ? stmtAction.unmute()
                : stmtAction.mute());
              saveStatus(toSaveableStatus(newStatus), instance);
              showToast(muted ? t`Conversation unmuted` : t`Conversation muted`);
            } catch (e) {
              console.error(e);
              showToast(
                muted
                  ? t`Unable to unmute conversation`
                  : t`Unable to mute conversation`,
              );
            }
          }}
        >
          {muted ? (
            <>
              <Icon icon="unmute" />
              <span>
                <Trans>Unmute conversation</Trans>
              </span>
            </>
          ) : (
            <>
              <Icon icon="mute" />
              <span>
                <Trans>Mute conversation</Trans>
              </span>
            </>
          )}
        </MenuItem>
      )}
      {isSelf && isPinnable && (
        <MenuItem
          onClick={async () => {
            void haptics.trigger('light');
            try {
              const stmtAction = masto.v1.statuses.$select(id);
              const newStatus = await (pinned ? stmtAction.unpin() : stmtAction.pin());
              saveStatus(toSaveableStatus(newStatus), instance);
              showToast(
                pinned ? t`Post unpinned from profile` : t`Post pinned to profile`,
              );
            } catch (e) {
              console.error(e);
              showToast(pinned ? t`Unable to unpin post` : t`Unable to pin post`);
            }
          }}
        >
          {pinned ? (
            <>
              <Icon icon="unpin" />
              <span>
                <Trans>Unpin from profile</Trans>
              </span>
            </>
          ) : (
            <>
              <Icon icon="pin" />
              <span>
                <Trans>Pin to profile</Trans>
              </span>
            </>
          )}
        </MenuItem>
      )}
      {isSelf && (
        <>
          {supportsNativeQuote() && !['private', 'direct'].includes(visibility) && (
            <MenuItem
              onClick={() => {
                setShowQuoteSettings(true);
              }}
            >
              <Icon icon="quote2" />
              <small>
                <Trans>Quote settings</Trans>
                <br />
                <span class="more-insignificant">
                  {_(
                    quoteApprovalPolicyMessages[
                      postQuoteApprovalPolicy as keyof typeof quoteApprovalPolicyMessages
                    ],
                  )}
                </span>
              </small>
            </MenuItem>
          )}
          <div class="menu-horizontal">
            {supports('@mastodon/post-edit') && (
              <MenuItem
                onClick={() => {
                  showCompose({
                    editStatus: status,
                    quoteStatus: (status.quote as mastodon.v1.Quote | null | undefined)
                      ?.quotedStatus,
                  } as Parameters<typeof showCompose>[0]);
                }}
              >
                <Icon icon="pencil" />
                <span>
                  <Trans>Edit</Trans>
                </span>
              </MenuItem>
            )}
            {isSizeLarge && (
              <MenuConfirm
                subMenu
                confirmLabel={
                  <>
                    <Icon icon="trash" />
                    <span>
                      <Trans>Delete this post?</Trans>
                    </span>
                  </>
                }
                itemProps={{ className: 'danger' }}
                menuItemClassName="danger"
                onClick={() => {
                  void (async () => {
                    try {
                      await masto.v1.statuses.$select(id).remove();
                      const cachedStatus = getStatus(id, instance)!;
                      cachedStatus._deleted = true;
                      showToast(t`Post deleted`);
                    } catch (e) {
                      console.error(e);
                      showToast(t`Unable to delete post`);
                    }
                  })();
                }}
              >
                <Icon icon="trash" />
                <span>
                  <Trans>Delete…</Trans>
                </span>
              </MenuConfirm>
            )}
          </div>
        </>
      )}
      {!isSelf && isSizeLarge && (
        <>
          <MenuDivider />
          {isQuotingMyPost && (
            <MenuConfirm
              subMenu
              confirmLabel={
                <>
                  <Icon icon="quote" />
                  <span>
                    <Trans>
                      Remove my post from{' '}
                      <span class="bidi-isolate">@{username || acct}</span>'s post?
                    </Trans>
                  </span>
                </>
              }
              itemProps={{ className: 'danger' }}
              menuItemClassName="danger"
              onClick={() => {
                void haptics.trigger('light');
                void (async () => {
                  try {
                    const quotedStatusID = (quote as mastodon.v1.Quote).quotedStatus!
                      .id;
                    const quotesResource = masto.v1.statuses.$select(
                      quotedStatusID,
                    ).quotes;
                    if (!hasQuoteRevokeResource(quotesResource)) {
                      throw new Error('Quote revoke endpoint unavailable');
                    }
                    await quotesResource.$select(id).revoke.create();
                    showToast(t`Quote removed`);
                    states.reloadStatusPage++;
                  } catch (e) {
                    console.error(e);
                    showToast(t`Unable to remove quote`);
                  }
                })();
              }}
            >
              <Icon icon="quote" />
              <Trans>Remove quote…</Trans>
            </MenuConfirm>
          )}
          <MenuItem
            className="danger"
            onClick={() => {
              states.showReportModal = {
                account: status.account,
                post: status,
              };
            }}
          >
            <Icon icon="flag" />
            <span>
              <Trans>Report post…</Trans>
            </span>
          </MenuItem>
        </>
      )}
    </>
  );
}
