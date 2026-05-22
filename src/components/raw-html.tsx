import type { ComponentPropsWithRef, ComponentType, JSX } from 'react';

import { sanitizeEmbedHtml, sanitizePostHtml } from '../utils/sanitize-html';

type SanitizeProfile = 'post' | 'embed';

const SANITIZERS: Record<
  SanitizeProfile,
  (html: string | null | undefined) => string
> = {
  post: sanitizePostHtml,
  embed: sanitizeEmbedHtml,
};

// Constrain the polymorphic element to intrinsic (host) elements only:
// `dangerouslySetInnerHTML` is meaningful only on host elements, and every
// call site renders a plain `div`/`span`/`p`. This also lets us derive the
// correct per-tag props and ref type from `ComponentPropsWithRef<T>`.
type HostTag = keyof JSX.IntrinsicElements;

type RawHtmlOwnProps<T extends HostTag> = {
  /** Untrusted HTML. Sanitized against the chosen profile before rendering. */
  html: string | null | undefined;
  /**
   * `post` (default): lenient atproto post/profile markup. `embed`: narrow
   * sandboxed-iframe profile for third-party oEmbed HTML.
   */
  profile?: SanitizeProfile;
  /** Host element to render. Defaults to `div`. */
  as?: T;
};

type RawHtmlProps<T extends HostTag> = RawHtmlOwnProps<T> &
  Omit<
    ComponentPropsWithRef<T>,
    keyof RawHtmlOwnProps<T> | 'dangerouslySetInnerHTML' | 'children'
  >;

/**
 * Renders untrusted remote HTML safely. Routes the supplied `html` through an
 * allowlist-based DOMPurify profile, then injects the sanitized result via
 * `dangerouslySetInnerHTML`. Use this for any user-controlled/remote HTML;
 * leave app-generated trusted HTML on a raw `dangerouslySetInnerHTML` with a
 * `TRUSTED-INTERNAL` comment.
 */
function RawHtml<T extends HostTag = 'div'>({
  html,
  profile = 'post',
  as,
  ...rest
}: RawHtmlProps<T>) {
  // Public props are constrained to `T` (callers get the correct per-tag attrs
  // and ref). At the render boundary, `ComponentPropsWithRef<T>` for an open
  // generic `T` is a union of every intrinsic prop shape, which JSX can't
  // accept as a single element's props. Render through a host component typed
  // to accept an arbitrary prop bag (one localized cast); the public surface
  // stays strict, only this internal render is loosened — matching the
  // `ComponentType<Record<string, unknown>>` pattern used elsewhere in the app.
  const Component = (as ?? 'div') as unknown as ComponentType<
    Record<string, unknown>
  >;
  const sanitized = SANITIZERS[profile](html);
  return (
    <Component {...rest} dangerouslySetInnerHTML={{ __html: sanitized }} />
  );
}

export default RawHtml;
