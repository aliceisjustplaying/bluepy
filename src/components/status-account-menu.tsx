import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';

import { useDeletePost, useMuteThread, useUnmuteThread } from '../data/posts';
import haptics from '../utils/haptics';
import showToast from '../utils/show-toast';
import states, { getStatus, saveStatus } from '../utils/states';

import Icon from './icon';
import MenuConfirm from './menu-confirm';
import type { StatusMenuPartsArgs } from './status-menu-types';

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
  | 'username'
  | 'acct'
>;

export default function StatusAccountMenu({
  isSelf,
  mentionSelf,
  id,
  muted,
  instance,
  status,
  isSizeLarge,
}: StatusAccountMenuProps) {
  const { t } = useLingui();
  const deletePost = useDeletePost();
  const muteThread = useMuteThread();
  const unmuteThread = useUnmuteThread();
  const atprotoUri = status._atproto?.uri;
  const atprotoThreadRoot = status._atproto?.root?.uri ?? atprotoUri;

  return (
    <>
      {(isSelf || mentionSelf) && <MenuDivider />}
      {(isSelf || mentionSelf) && (
        <MenuItem
          onClick={() => {
            void haptics.trigger('light');
            void (async () => {
              try {
                if (!atprotoThreadRoot) {
                  throw new Error('Thread root URI required');
                }
                await (muted ? unmuteThread : muteThread).mutateAsync({
                  uri: atprotoThreadRoot,
                });
                const cachedStatus = getStatus(id, instance);
                if (cachedStatus) {
                  cachedStatus.muted = !muted;
                  saveStatus(cachedStatus, instance);
                }
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
      {isSelf && (
        <>
          <div className="menu-horizontal">
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
                      if (!atprotoUri) {
                        throw new Error('Post URI required');
                      }
                      await deletePost.mutateAsync({ uri: atprotoUri });
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
