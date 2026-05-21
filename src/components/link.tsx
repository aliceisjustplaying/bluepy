import type { HTMLAttributes, Ref } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';

import {
  canonicalizeAppPath,
  currentAppPath,
  getPrevLocationSnapshot,
  isModifiedClick,
  navigatePath,
} from '../utils/router';
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
  ref?: Ref<HTMLAnchorElement>;
  to: string;
  class?: string;
  className?: string;
  preservePrevLocation?: boolean;
  target?: string;
  [key: `data-${string}`]: unknown;
  [key: `aria-${string}`]: unknown;
}

// useLocation throws if Link renders outside a Router (static previews).
// useInRouterContext is documented as safe to call anywhere and returns a
// boolean; gating on it keeps both render branches hook-rule compliant
// because each inner component (with vs without useLocation) is itself
// consistent across all of its own renders.
function LinkInsideRouter(props: LinkProps) {
  const routerLocation = useLocation();
  return <LinkBody {...props} routerLocation={routerLocation} />;
}

function LinkOutsideRouter(props: LinkProps) {
  return <LinkBody {...props} routerLocation={undefined} />;
}

interface LinkBodyProps extends LinkProps {
  routerLocation: ReturnType<typeof useLocation> | undefined;
}

function Link(props: LinkProps) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <LinkInsideRouter {...props} />
  ) : (
    <LinkOutsideRouter {...props} />
  );
}

function LinkBody(props: LinkBodyProps) {
  const {
    to,
    children,
    routerLocation,
    class: classProp,
    className,
    preservePrevLocation,
    ref,
    ...restProps
  } = props;
  let currentPath = currentAppPath();
  const href = canonicalizeAppPath(to);

  // Handle encodeURIComponent of searchParams values
  if (currentPath !== '/' && currentPath.includes('?')) {
    const parsedPath = URL.parse(currentPath, location.origin);
    if (parsedPath?.searchParams?.size) {
      const searchParamsStr = Array.from(parsedPath.searchParams.entries())
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      currentPath = parsedPath.pathname + '?' + searchParamsStr;
    }
  }

  const isActive =
    currentPath === href || decodeURIComponent(currentPath) === href;
  const classStr =
    typeof (className || classProp) === 'string' ? className || classProp : '';
  return (
    <a
      ref={ref}
      href={href}
      {...(restProps as HTMLAttributes<HTMLAnchorElement>)}
      className={`${classStr} ${isActive ? 'is-active' : ''}`}
      onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
        const parent = e.currentTarget?.parentNode as Element | null;
        if (parent?.closest?.('a')) {
          // If this <a> is nested inside another <a>
          e.stopPropagation();
        }
        (
          props.onClick as
            | ((ev: React.MouseEvent<HTMLAnchorElement>) => void)
            | undefined
        )?.(e);
        if (e.defaultPrevented || isModifiedClick(e)) {
          return;
        }
        const target = props.target || '';
        if (target && target !== '_self') return;
        if (routerLocation && !preservePrevLocation) {
          states.prevLocation = getPrevLocationSnapshot();
        }
        e.preventDefault();
        navigatePath(href);
      }}
    >
      {children}
    </a>
  );
}

export default Link;
