import type {
  ComponentPropsWithoutRef,
  ElementType,
  Ref,
} from 'react';

import { sanitizeEmbedHtml, sanitizePostHtml } from '../utils/sanitize-html';

type SanitizeProfile = 'post' | 'embed';

const SANITIZERS: Record<
  SanitizeProfile,
  (html: string | null | undefined) => string
> = {
  post: sanitizePostHtml,
  embed: sanitizeEmbedHtml,
};

type RawHtmlOwnProps<T extends ElementType> = {
  /** Untrusted HTML. Sanitized against the chosen profile before rendering. */
  html: string | null | undefined;
  /**
   * `post` (default): lenient atproto post/profile markup. `embed`: narrow
   * sandboxed-iframe profile for third-party oEmbed HTML.
   */
  profile?: SanitizeProfile;
  /** Element to render. Defaults to `div`. */
  as?: T;
  ref?: Ref<Element>;
};

type RawHtmlProps<T extends ElementType> = RawHtmlOwnProps<T> &
  Omit<
    ComponentPropsWithoutRef<T>,
    keyof RawHtmlOwnProps<T> | 'dangerouslySetInnerHTML' | 'children'
  >;

/**
 * Renders untrusted remote HTML safely. Routes the supplied `html` through an
 * allowlist-based DOMPurify profile, then injects the sanitized result via
 * `dangerouslySetInnerHTML`. Use this for any user-controlled/remote HTML;
 * leave app-generated trusted HTML on a raw `dangerouslySetInnerHTML` with a
 * `TRUSTED-INTERNAL` comment.
 */
function RawHtml<T extends ElementType = 'div'>({
  html,
  profile = 'post',
  as,
  ref,
  ...rest
}: RawHtmlProps<T>) {
  const Component: ElementType = as ?? 'div';
  const sanitized = SANITIZERS[profile](html);
  return (
    <Component
      ref={ref}
      {...rest}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export default RawHtml;
