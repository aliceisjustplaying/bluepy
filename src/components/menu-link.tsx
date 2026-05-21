import { FocusableItem } from '@szhsin/react-menu';
import type { AnchorHTMLAttributes, MouseEvent, Ref } from 'react';

import { assignFocusableAnchorRef } from '../utils/assign-focusable-anchor-ref';

import Link from './link';

interface MenuLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to?: string;
  href?: string;
  className?: string;
  disabled?: boolean;
}

function MenuLink(props: MenuLinkProps) {
  const { className, disabled, href, ...restProps } = props;
  return (
    <FocusableItem className={className} disabled={disabled}>
      {({
        ref,
        closeMenu,
      }: {
        ref: Ref<unknown>;
        closeMenu: (key?: string) => void;
      }) => {
        const setAnchorRef = (node: HTMLAnchorElement | null) => {
          assignFocusableAnchorRef(ref, node);
        };
        const { to, children, onClick, ...anchorProps } = restProps;
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            closeMenu(event.detail === 0 ? 'Enter' : undefined);
          }
        };
        return (
          <>
            {to ? (
              <Link
                {...anchorProps}
                to={to}
                ref={setAnchorRef}
                onClick={handleClick}
              >
                {children}
              </Link>
            ) : (
              <a
                href={href}
                {...anchorProps}
                ref={setAnchorRef}
                onClick={handleClick}
              >
                {children}
              </a>
            )}
          </>
        );
      }}
    </FocusableItem>
  );
}

export default MenuLink;
