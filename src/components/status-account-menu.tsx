import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';

import haptics from '../utils/haptics';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { getStatus, saveStatus } from '../utils/states';
import supports from '../utils/supports';

import Icon from './icon';
import MenuConfirm from './menu-confirm';
import type { StatusMenuPartsArgs } from './status-menu-types';

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
  status,
  isSizeLarge,
  isQuotingMyPost,
  quote,
  username,
  acct,
}: StatusAccountMenuProps) {
  const { t } = useLingui();

  return (
    <>
      {(isSelf || mentionSelf) && <MenuDivider />}
      {(isSelf || mentionSelf) && (
        <MenuItem
          onClick={() => {
            void haptics.trigger('light');
            void (async () => {
              try {
                const stmtAction = masto.v1.statuses.$select(id);
                const newStatus = await (muted
                  ? stmtAction.unmute()
                  : stmtAction.mute());
                saveStatus(newStatus, instance);
                showToast(
                  muted ? t`Conversation unmuted` : t`Conversation muted`,
                );
              } catch (e) {
                console.error(e);
                showToast(
                  muted
                    ? t`Unable to unmute conversation`
                    : t`Unable to mute conversation`,
                );
              }
            })();
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
          onClick={() => {
            void haptics.trigger('light');
            void (async () => {
              try {
                const stmtAction = masto.v1.statuses.$select(id);
                const newStatus = await (pinned
                  ? stmtAction.unpin()
                  : stmtAction.pin());
                saveStatus(newStatus, instance);
                showToast(
                  pinned
                    ? t`Post unpinned from profile`
                    : t`Post pinned to profile`,
                );
              } catch (e) {
                console.error(e);
                showToast(
                  pinned ? t`Unable to unpin post` : t`Unable to pin post`,
                );
              }
            })();
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
          <div className="menu-horizontal">
            {supports('@mastodon/post-edit') && (
              <MenuItem
                onClick={() => {
                  showCompose({
                    editStatus: status,
                    quoteStatus: (
                      status.quote as mastodon.v1.Quote | null | undefined
                    )?.quotedStatus,
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
                itemProps={{
                  className: 'danger',
                  'data-testid': 'status-delete-trigger',
                }}
                confirmItemProps={{
                  'data-testid': 'status-delete-confirm',
                }}
                menuItemClassName="danger"
                onClick={() => {
                  void (async () => {
                    try {
                      await masto.v1.statuses.$select(id).remove();
                      const cachedStatus = getStatus(id, instance);
                      if (cachedStatus) {
                        cachedStatus._deleted = true;
                      }
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
                      <span className="bidi-isolate">@{username || acct}</span>
                      's post?
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
                    const quotedStatusID = (quote as mastodon.v1.Quote)
                      .quotedStatus?.id;
                    if (!quotedStatusID) {
                      throw new Error('Quoted status unavailable');
                    }
                    const quotesResource =
                      masto.v1.statuses.$select(quotedStatusID).quotes;
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
