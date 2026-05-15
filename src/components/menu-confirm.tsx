import {
  MenuItem,
  type MenuItemProps,
  type MenuProps,
} from '@szhsin/react-menu';
import type { ComponentChildren, VNode } from 'preact';
import { cloneElement } from 'preact';

import Menu2 from './menu2';
import SubMenu2 from './submenu2';

type MenuClickHandler = (
  event: Parameters<NonNullable<MenuItemProps['onClick']>>[0],
) => void;

// Extra layout props (align, gap, position, etc.) flow through to either
// MenuItem (when `!confirm && subMenu`) or Menu2/SubMenu2 (the confirm path).
// Typed as the union of those prop surfaces (Partial because all are optional
// from this component's view) plus the explicit local props.
type PassThroughProps = Partial<MenuProps> & Partial<MenuItemProps>;
type ConfirmItemProps = Omit<MenuItemProps, 'className' | 'onClick'>;

interface MenuConfirmProps extends PassThroughProps {
  subMenu?: boolean;
  confirm?: boolean;
  confirmLabel?: ComponentChildren;
  confirmItemProps?: ConfirmItemProps;
  menuItemClassName?: string;
  menuFooter?: ComponentChildren;
  menuExtras?: ComponentChildren;
  children?: ComponentChildren;
  onClick?: MenuClickHandler;
}

function MenuConfirm({
  subMenu = false,
  confirm = true,
  confirmLabel,
  confirmItemProps,
  menuItemClassName,
  menuFooter,
  menuExtras,
  ...props
}: MenuConfirmProps) {
  const { children, onClick, ...restProps } = props;
  if (!confirm) {
    if (subMenu) return <MenuItem {...props} />;
    if (onClick) {
      // JS contract requires `children` to be a single trigger VNode when
      // `onClick` is supplied without confirm; runtime crashes identically
      // on anything else.
      return cloneElement(children as VNode, {
        onClick,
      });
    }
    return children;
  }
  // Menu2 and SubMenu2 share most layout props but have non-identical
  // signatures (e.g. SubMenu has no portal). JS picks at runtime, so we cast
  // through the wider Menu2 shape — the only branch that actually uses extras
  // like `portal` is the non-subMenu path.
  const Parent = (subMenu ? SubMenu2 : Menu2) as typeof Menu2;
  return (
    <Parent
      openTrigger="clickOnly"
      direction="bottom"
      overflow="auto"
      gap={-8}
      shift={8}
      menuClassName="menu-emphasized"
      {...restProps}
      menuButton={subMenu ? undefined : children}
      label={subMenu ? children : undefined}
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
