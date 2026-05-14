import { FocusableItem } from '@szhsin/react-menu';
import type { Ref, TargetedMouseEvent } from 'preact';

import Link from './link';

interface MenuLinkProps {
  className?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

function MenuLink(props: MenuLinkProps) {
  const { className, disabled, ...restProps } = props;
  return (
    <FocusableItem className={className} disabled={disabled}>
      {({
        ref,
        closeMenu,
      }: {
        ref: Ref<unknown>;
        closeMenu: (key?: string) => void;
      }) => (
        <Link
          {...restProps}
          ref={ref as Ref<HTMLAnchorElement>}
          onClick={({ detail }: TargetedMouseEvent<HTMLAnchorElement>) => {
            closeMenu(detail === 0 ? 'Enter' : undefined);
          }}
        />
      )}
    </FocusableItem>
  );
}

export default MenuLink;
