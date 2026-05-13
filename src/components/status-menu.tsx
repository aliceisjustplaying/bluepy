import { MenuDivider } from '@szhsin/react-menu';

import StatusAccountMenu from './status-account-menu';
import StatusActivityMenu from './status-activity-menu';
import StatusQuickMenu from './status-quick-menu';
import useStatusReplyMenu from './status-reply-menu';
import type { StatusMenuPartsArgs } from './status-menu-types';
import StatusUtilityMenu from './status-utility-menu';

export default function useStatusMenuParts({
  accountId,
  mentions,
  currentAccount,
  repliesCount = 0,
  username,
  acct,
  replyStatus,
  isSizeLarge,
  sameInstance,
  showActionsBar,
  authenticated,
  ...menuProps
}: StatusMenuPartsArgs) {
  const { ReplyMenuContent, replyModeMenuItems, tooManyMentions } =
    useStatusReplyMenu({
      accountId,
      mentions,
      currentAccount,
      repliesCount,
      username,
      acct,
      replyStatus,
    });
  const showActivityItems = isSizeLarge || showActionsBar;
  const showTranslateDivider =
    isSizeLarge ||
    (!menuProps.mediaFirst &&
      (menuProps.enableTranslate ||
        !menuProps.language ||
        menuProps.differentLanguage));

  const statusMenuItems = (
    <>
      {!isSizeLarge && sameInstance && (
        <StatusQuickMenu
          {...menuProps}
          ReplyMenuContent={ReplyMenuContent}
          replyModeMenuItems={replyModeMenuItems}
          tooManyMentions={tooManyMentions}
          replyStatus={replyStatus}
          isSizeLarge={isSizeLarge}
          username={username}
          acct={acct}
        />
      )}
      {!isSizeLarge && sameInstance && showActivityItems && <MenuDivider />}
      {showActivityItems && <StatusActivityMenu {...menuProps} />}
      {showTranslateDivider && <MenuDivider />}
      <StatusUtilityMenu
        {...menuProps}
        isSizeLarge={isSizeLarge}
        sameInstance={sameInstance}
        username={username}
        acct={acct}
      />
      {authenticated && (
        <StatusAccountMenu
          {...menuProps}
          isSizeLarge={isSizeLarge}
          username={username}
          acct={acct}
        />
      )}
    </>
  );

  return { replyModeMenuItems, statusMenuItems, tooManyMentions };
}
