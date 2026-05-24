import {
  MenuItem,
  type MenuItemProps,
  type MenuProps,
} from '@szhsin/react-menu';
import type { ReactNode, ReactElement } from 'react';
import { cloneElement } from 'react';

import Menu2 from './menu2';
import SubMenu2 from './submenu2';

type MenuClickHandler = (
  event: Parameters<NonNullable<MenuItemProps['onClick']>>[0],
) => void;

// Extra layout props (align, gap, position, etc.) flow through to either
// MenuItem (when `!confirm && subMenu`) or Menu2/SubMenu2 (the confirm path).
// Typed as the union of those prop surfaces (Partial because all are optional
// from this component's view) plus the explicit local props.
type ConfirmItemProps = Omit<MenuItemProps, 'onClick'> & {
  [key: `data-${string}`]: unknown;
};

interface MenuConfirmProps {
  subMenu?: boolean;
  confirm?: boolean;
  confirmLabel?: ReactNode;
  confirmItemProps?: ConfirmItemProps;
  menuItemClassName?: string;
  menuFooter?: ReactNode;
  menuExtras?: ReactNode;
  children?: ReactNode;
  onClick?: MenuClickHandler;
  itemProps?: ConfirmItemProps;
  [key: string]: unknown;
}

function MenuConfirm({
  subMenu = false,
  confirm = true,
  confirmLabel,
  confirmItemProps,
  menuItemClassName,
  menuFooter,
  menuExtras,
  itemProps,
  ...props
}: MenuConfirmProps) {
  const { children, onClick, ...restProps } = props;
  if (!confirm) {
    if (subMenu) {
      return (
        <MenuItem
          {...itemProps}
          {...(restProps as MenuItemProps)}
          onClick={onClick}
        >
          {children}
        </MenuItem>
      );
    }
    if (onClick) {
      // JS contract requires `children` to be a single trigger ReactElement when
      // `onClick` is supplied without confirm; runtime crashes identically
      // on anything else.
      return cloneElement(children as ReactElement<Record<string, unknown>>, {
        onClick,
      });
    }
    return <>{children}</>;
  }
  // Menu2 and SubMenu2 share most layout props but have non-identical
  // signatures (e.g. SubMenu has no portal). JS picks at runtime, so we cast
  // through the wider Menu2 shape — the only branch that actually uses extras
  // like `portal` is the non-subMenu path.
  const Parent = (subMenu ? SubMenu2 : Menu2) as unknown as (props: {
    [key: string]: unknown;
    children?: ReactNode;
  }) => ReactElement;
  return (
    <Parent
      direction="bottom"
      overflow="auto"
      gap={-8}
      shift={8}
      menuClassName="menu-emphasized"
      {...(restProps as unknown as MenuProps)}
      {...(subMenu
        ? { itemProps, label: children, openTrigger: 'clickOnly' }
        : { menuButton: children, openTrigger: 'clickOnly' })}
    >
      <MenuItem
        {...confirmItemProps}
        className={menuItemClassName}
        onClick={onClick}
      >
        {confirmLabel}
      </MenuItem>
      {menuExtras}
      {menuFooter}
    </Parent>
  );
}

export default MenuConfirm;
