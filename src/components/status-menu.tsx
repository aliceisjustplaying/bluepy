import { MenuDivider } from '@szhsin/react-menu';

import StatusAccountMenu from './status-account-menu';
import StatusActivityMenu from './status-activity-menu';
import type { StatusMenuPartsArgs } from './status-menu-types';
import StatusQuickMenu from './status-quick-menu';
import useStatusReplyMenu from './status-reply-menu';
import StatusUtilityMenu from './status-utility-menu';

export default function useStatusMenuParts({
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
  const { ReplyMenuContent } = useStatusReplyMenu({ repliesCount });
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

  return { statusMenuItems };
}
