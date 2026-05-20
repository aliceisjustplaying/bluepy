import {
  SubMenu,
  type MenuInstance,
  type SubMenuProps,
} from '@szhsin/react-menu';
import { useLayoutEffect, useRef, useState } from 'react';

export default function SubMenu2(props: SubMenuProps) {
  const menuRef = useRef<MenuInstance | null>(null);
  const itemRef = useRef<HTMLElement | null>(null);
  const { label, direction, shift, ...restProps } = props;
  const [computedMenuProps, setComputedMenuProps] = useState({
    direction,
    shift,
  });

  // If menu item width is >50% of viewport, use bottom direction
  useLayoutEffect(() => {
    if (itemRef.current) {
      const width = itemRef.current.offsetWidth;
      const viewportWidth = window.innerWidth;
      if (width > viewportWidth * 0.5) {
        setComputedMenuProps({ direction: 'bottom', shift: shift || 8 });
      } else {
        setComputedMenuProps({ direction, shift });
      }
    }
  }, [direction, shift]);

  return (
    <SubMenu
      {...restProps}
      direction={computedMenuProps.direction}
      shift={computedMenuProps.shift}
      label={label}
      instanceRef={menuRef}
      // Test fix for bug; submenus not opening on Android
      itemProps={{
        ref: itemRef,
        onPointerMove: (e: React.PointerEvent) => {
          if (e.pointerType === 'touch') {
            menuRef.current?.openMenu?.();
          }
        },
        onPointerLeave: (e: React.PointerEvent) => {
          if (e.pointerType === 'touch') {
            menuRef.current?.openMenu?.();
          }
        },
        ...props.itemProps,
      }}
    />
  );
}
