import type { JSX, Ref } from 'preact';
import { forwardRef } from 'preact/compat';
import { useLocation } from 'react-router-dom';

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
export interface LinkProps
  extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  [key: string]: unknown;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  (props: LinkProps, ref: Ref<HTMLAnchorElement>) => {
    let routerLocation: ReturnType<typeof useLocation> | undefined;
    try {
      routerLocation = useLocation();
    } catch (e) {}
    let hash = (location.hash || '').replace(/^#/, '').trim();
    if (hash === '') hash = '/';
    const { to, ...restProps } = props;

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
    return (
      <a
        ref={ref}
        href={`#${to}`}
        {...(restProps as JSX.HTMLAttributes<HTMLAnchorElement>)}
        class={`${props.class || ''} ${isActive ? 'is-active' : ''}`}
        onClick={(e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
          const parent = e.currentTarget?.parentNode as Element | null;
          if (parent?.closest?.('a')) {
            // If this <a> is nested inside another <a>
            e.stopPropagation();
          }
          if (routerLocation)
            states.prevLocation = routerLocation as unknown as NonNullable<
              typeof states.prevLocation
            >;
          (
            props.onClick as
              | ((
                  ev: JSX.TargetedMouseEvent<HTMLAnchorElement>,
                ) => void)
              | undefined
          )?.(e);
        }}
      />
    );
  },
);

export default Link;
