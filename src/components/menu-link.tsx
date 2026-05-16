import { FocusableItem } from '@szhsin/react-menu';
import type { Ref } from 'react';

import Link, { type LinkProps } from './link';

interface MenuLinkProps extends Partial<LinkProps> {
  href?: string;
  className?: string;
  disabled?: boolean;
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
        <>
        {restProps.to ? (
          <Link
            {...(restProps as LinkProps)}
            ref={ref as Ref<HTMLAnchorElement>}
            onClick={({ detail }: React.MouseEvent<HTMLAnchorElement>) => {
              closeMenu(detail === 0 ? 'Enter' : undefined);
            }}
          />
        ) : (
          <a
            {...(restProps as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
            ref={ref as Ref<HTMLAnchorElement>}
            onClick={({ detail }) => closeMenu(detail === 0 ? 'Enter' : undefined)}
          >
            {restProps.children}
          </a>
        )}
        </>
      )}
    </FocusableItem>
  );
}

export default MenuLink;
