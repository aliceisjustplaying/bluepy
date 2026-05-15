import type { HTMLAttributes, Ref, TargetedMouseEvent } from 'preact';
import { forwardRef } from 'preact/compat';
import { useInRouterContext, useLocation } from 'react-router-dom';

import states from '../utils/states';

/* NOTES
   =====
   Initially this uses <NavLink> from react-router-dom, but it doesn't work:
   1. It interferes with nested <a> inside <a> and it's difficult to preventDefault/stopPropagation from the nested <a>
   2. isActive doesn't work properly with the weird routes that's set up in this app, due to the faux "location" to make the modals work and prevent unmounting
   3. Not using <Link state/> because it modifies history.state that *persists* across page reloads. I don't need that, so using valtio's states instead.
*/

// Permissive Props. Link has ~39 downstream importers (most still .jsx);
// narrowing here would block converted callers. `to` is required; everything
// else mirrors anchor attributes via JSX.HTMLAttributes plus an index
// signature for ad-hoc props (e.g. `data-*`, valtio snapshot fields).
export interface LinkProps extends Omit<
  HTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  to: string;
  [key: string]: unknown;
}

// useLocation throws if Link renders outside a Router (static previews).
// useInRouterContext is documented as safe to call anywhere and returns a
// boolean; gating on it keeps both render branches hook-rule compliant
// because each inner component (with vs without useLocation) is itself
// consistent across all of its own renders.
const LinkInsideRouter = forwardRef<HTMLAnchorElement, LinkProps>(
  (props: LinkProps, ref: Ref<HTMLAnchorElement>) => {
    const routerLocation = useLocation();
    return <LinkBody {...props} ref={ref} routerLocation={routerLocation} />;
  },
);

const LinkOutsideRouter = forwardRef<HTMLAnchorElement, LinkProps>(
  (props: LinkProps, ref: Ref<HTMLAnchorElement>) => {
    return <LinkBody {...props} ref={ref} routerLocation={undefined} />;
  },
);

interface LinkBodyProps extends LinkProps {
  routerLocation: ReturnType<typeof useLocation> | undefined;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  (props: LinkProps, ref: Ref<HTMLAnchorElement>) => {
    const inRouter = useInRouterContext();
    return inRouter ? (
      <LinkInsideRouter {...props} ref={ref} />
    ) : (
      <LinkOutsideRouter {...props} ref={ref} />
    );
  },
);

const LinkBody = forwardRef<HTMLAnchorElement, LinkBodyProps>(
  (props: LinkBodyProps, ref: Ref<HTMLAnchorElement>) => {
    let hash = (location.hash || '').replace(/^#/, '').trim();
    if (hash === '') hash = '/';
    const { to, children, routerLocation, ...restProps } = props;

    // Handle encodeURIComponent of searchParams values
    if (!!hash && hash !== '/' && hash.includes('?')) {
      const parsedHash = URL.parse(hash, location.origin); // Fake base URL
      if (parsedHash?.searchParams?.size) {
        const searchParamsStr = Array.from(parsedHash.searchParams.entries())
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&');
        hash = parsedHash.pathname + '?' + searchParamsStr;
      }
    }

    const isActive = hash === to || decodeURIComponent(hash) === to;
    const classProp = props.class;
    const classStr = typeof classProp === 'string' ? classProp : '';
    return (
      <a
        ref={ref}
        href={`#${to}`}
        {...(restProps as HTMLAttributes<HTMLAnchorElement>)}
        class={`${classStr} ${isActive ? 'is-active' : ''}`}
        onClick={(e: TargetedMouseEvent<HTMLAnchorElement>) => {
          const parent = e.currentTarget?.parentNode as Element | null;
          if (parent?.closest?.('a')) {
            // If this <a> is nested inside another <a>
            e.stopPropagation();
          }
          if (routerLocation) {
            // react-router Location has typed fields that don't widen to
            // PrevLocation's unknown index signature; spread into the
            // PrevLocation shape to satisfy both types without a shim.
            states.prevLocation = { ...routerLocation };
          }
          (
            props.onClick as
              | ((ev: TargetedMouseEvent<HTMLAnchorElement>) => void)
              | undefined
          )?.(e);
        }}
      >
        {children}
      </a>
    );
  },
);

export default Link;
