import { FocusableItem } from '@szhsin/react-menu';
import type { AnchorHTMLAttributes, Ref } from 'react';

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
          if (typeof ref === 'function') ref(node);
        };
        const { to, children, ...anchorProps } = restProps;
        return (
          <>
            {to ? (
              <Link
                {...anchorProps}
                to={to}
                ref={setAnchorRef}
                onClick={({ detail }: React.MouseEvent<HTMLAnchorElement>) => {
                  closeMenu(detail === 0 ? 'Enter' : undefined);
                }}
              />
            ) : (
              <a
                href={href}
                {...anchorProps}
                ref={setAnchorRef}
                onClick={({ detail }) => {
                  closeMenu(detail === 0 ? 'Enter' : undefined);
                }}
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
