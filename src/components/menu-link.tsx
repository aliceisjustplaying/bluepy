import { FocusableItem } from '@szhsin/react-menu';
import type { ComponentType, JSX, Ref } from 'preact';

import LinkRaw from './link';

interface MenuLinkProps {
  className?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

const Link = LinkRaw as unknown as ComponentType<
  {
    ref?: Ref<unknown>;
    onClick?: (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
  } & Record<string, unknown>
>;

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
          ref={ref}
          onClick={({ detail }: JSX.TargetedMouseEvent<HTMLAnchorElement>) =>
            closeMenu(detail === 0 ? 'Enter' : undefined)
          }
        />
      )}
    </FocusableItem>
  );
}

export default MenuLink;
