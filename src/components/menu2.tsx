import { Menu, type MenuInstance, type MenuProps } from '@szhsin/react-menu';
import type { RefObject, TargetedMouseEvent } from 'preact';
import { useRef } from 'preact/hooks';

import isRTL from '../utils/is-rtl';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import useWindowSize from '../utils/useWindowSize';

// `instanceRef` is overridden to a RefObject (not the wider React.Ref union)
// because the implementation reads `.current`. The current may be null/undefined
// until react-menu writes it, matching common `useRef<T | null>(null)` usage.
type Menu2Props = MenuProps & {
  instanceRef?: RefObject<MenuInstance | null | undefined>;
};

// It's like Menu but with sensible defaults, bug fixes and improvements.
function Menu2(props: Menu2Props) {
  const { containerProps, instanceRef: externalInstanceRef, align } = props;
  const size = useWindowSize();
  const fallbackInstanceRef = useRef<MenuInstance | undefined>(undefined);
  const instanceRef = externalInstanceRef?.current
    ? externalInstanceRef
    : fallbackInstanceRef;

  // Values: start, end, center
  // Note: don't mess with 'center'
  const rtlAlign = isRTL()
    ? align === 'end'
      ? 'start'
      : align === 'start'
        ? 'end'
        : align
    : align;

  return (
    <Menu
      boundingBoxPadding={safeBoundingBoxPadding()}
      repositionFlag={`${size.width}x${size.height}`}
      unmountOnClose
      {...props}
      align={rtlAlign}
      instanceRef={instanceRef}
      containerProps={{
        onClick: (e: TargetedMouseEvent<HTMLElement>) => {
          if (e.target === e.currentTarget) {
            instanceRef.current?.closeMenu?.();
          }
          containerProps?.onClick?.(e);
        },
        ...containerProps,
      }}
    />
  );
}

export default Menu2;
