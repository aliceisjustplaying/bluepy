import DOMPurify from 'dompurify';

// Centralized, allowlist-based HTML sanitization for untrusted remote HTML
// (atproto post/profile content, oEmbed cards). All consumers render
// client-side only, so the browser-backed `dompurify` build is sufficient —
// `isomorphic-dompurify` is not needed.
//
// Two profiles:
//  - `sanitizePostHtml`: lenient post/profile markup (links, mentions,
//    hashtags, custom-emoji <img>, inline code). NO <iframe>.
//  - `sanitizeEmbedHtml`: narrow oEmbed profile that permits a sandboxed
//    <iframe> and nothing script-bearing.
//
// `javascript:`/`data:` URIs are rejected by ALLOWED_URI_REGEXP; inline event
// handlers (onerror/onload/onclick/...) and <script>/<style>/<svg> are dropped
// because they are not on the tag/attribute allowlists.

// Tags emitted by `enhanceContent` + `emojifyText` for post/profile content:
// anchors, inline formatting, paragraphs, lists, blockquotes, code blocks, and
// the custom-emoji <img>. We deliberately do NOT allow <picture>/<source>:
// DOMPurify cannot sanitize individual `srcset` candidates (a malformed
// candidate could carry a `javascript:` URL past ALLOWED_URI_REGEXP), and the
// emoji <img> renders fine on its own — DOMPurify keeps an allowed child when
// it removes the disallowed parent.
const POST_ALLOWED_TAGS = [
  'a',
  'b',
  'strong',
  'i',
  'em',
  's',
  'del',
  'u',
  'span',
  'p',
  'br',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'img',
];

// Attributes the link/mention/emoji handlers and renderer rely on. `class`
// carries the `mention`/`hashtag`/`u-url`/`shortcode-emoji` hooks used by
// `handleContentLinks`; `width`/`height` back the custom-emoji enlarge check.
// `style` is intentionally NOT allowed — arbitrary inline CSS enables
// clickjacking overlays (`position:fixed;inset:0`) and `url(...)` tricks. The
// only thing it carried for posts was a cosmetic `--original-aspect-ratio`
// hint on emoji <img>, which is an acceptable loss. `srcset` is omitted for the
// same reason <source> is (per-candidate URLs are not URI-checked).
const POST_ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'class',
  'dir',
  'title',
  'lang',
  'src',
  'alt',
  'width',
  'height',
  'loading',
  'decoding',
  'tabindex',
];

// Only http(s), mailto, tel, plus relative paths and in-page anchors. Anything
// else (notably `javascript:` and `data:`) is rejected.
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

// Narrow oEmbed iframe attribute allowlist. `sandbox` and `allow` are force-set
// by the hook below regardless of what the provider sent, so neither needs to
// be on the input allowlist. `style` is omitted (clickjacking risk).
const EMBED_ALLOWED_TAGS = ['iframe', 'div', 'span', 'p', 'br', 'a'];
const EMBED_ALLOWED_ATTR = [
  'src',
  'width',
  'height',
  'title',
  'allowfullscreen',
  'frameborder',
  'loading',
  'class',
  'href',
  'target',
  'rel',
];

// Mirrors the hardcoded sandbox the `iframeUrl` branch of <EmbedModal> already
// imposes on first-party embeds. Forced onto every sanitized oEmbed iframe so a
// provider can never opt out of the sandbox.
const EMBED_IFRAME_SANDBOX =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts';

// Force a conservative `allow` policy onto every embed iframe — matches the
// first-party `iframeUrl` branch and prevents oEmbed HTML from requesting
// camera/microphone/geolocation/etc.
const EMBED_IFRAME_ALLOW = 'clipboard-write; fullscreen';

// Force the same referrer policy the first-party iframe path uses, so a
// provider cannot opt into `referrerpolicy="unsafe-url"`.
const EMBED_IFRAME_REFERRERPOLICY = 'strict-origin-when-cross-origin';

let hooksRegistered = false;

function registerHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  // Force safe rel on any anchor that opens a new context, and lock down every
  // surviving iframe (only the embed profile allows iframes).
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node;
    const tag = el.tagName;

    if (tag === 'A') {
      const target = el.getAttribute('target');
      if (target) {
        el.setAttribute('rel', 'noopener noreferrer nofollow ugc');
      }
    }

    if (tag === 'IFRAME') {
      // The iframe sandbox keeps `allow-same-origin` (third-party providers
      // need it to run their own player). That makes it critical the frame can
      // never point back at OUR origin — otherwise sandboxed scripts would be
      // same-origin to bluepy. Require an absolute HTTPS URL on a different
      // origin; drop the iframe entirely otherwise (relative/protocol-relative
      // `/settings`, `//evil`, `http://` downgrade, `javascript:`, missing
      // src, etc.).
      const src = el.getAttribute('src');
      let ok = false;
      // Require a literal absolute https URL. We deliberately do NOT pass a base
      // to `new URL`, so protocol-relative (`//provider/embed`), root-relative
      // (`/settings`), and scheme-relative inputs do not resolve and are
      // rejected — only a fully-qualified cross-origin https frame survives.
      // `http://` is rejected too (mixed content / downgrade).
      if (src && /^https:\/\//i.test(src)) {
        try {
          const u = new URL(src);
          ok = u.protocol === 'https:' && u.origin !== window.location.origin;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        el.remove();
        return;
      }
      el.setAttribute('sandbox', EMBED_IFRAME_SANDBOX);
      el.setAttribute('allow', EMBED_IFRAME_ALLOW);
      el.setAttribute('referrerpolicy', EMBED_IFRAME_REFERRERPOLICY);
    }
  });
}

const isBrowser = typeof document !== 'undefined';

/**
 * Sanitize untrusted atproto post/profile HTML against the lenient post
 * allowlist. Returns a sanitized string suitable for `dangerouslySetInnerHTML`.
 * No-op pass-through is intentionally NOT provided: outside a browser there is
 * no DOM to sanitize against, so we return an empty string rather than emit
 * unsanitized HTML.
 */
export function sanitizePostHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (!isBrowser) return '';
  registerHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: POST_ALLOWED_TAGS,
    ALLOWED_ATTR: POST_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // DOMPurify allows arbitrary `data-*` by default; the link/mention/emoji
    // handlers rely only on `class`, so keep the attribute surface to the
    // explicit allowlist.
    ALLOW_DATA_ATTR: false,
    // Defense in depth: never resolve <use>/<template> etc. and never keep
    // script-bearing content even if a tag slips onto the list.
    FORBID_TAGS: ['script', 'style', 'iframe', 'template', 'noscript'],
    FORBID_ATTR: ['srcdoc'],
  });
}

/**
 * Sanitize third-party oEmbed/iframe HTML against the narrow embed allowlist.
 * Permits a single sandboxed <iframe> (sandbox is force-applied) but no
 * scripts, styles, or event handlers.
 */
export function sanitizeEmbedHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (!isBrowser) return '';
  registerHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EMBED_ALLOWED_TAGS,
    ALLOWED_ATTR: EMBED_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ADD_TAGS: ['iframe'],
    FORBID_TAGS: ['script', 'style', 'template', 'noscript', 'object', 'embed'],
    FORBID_ATTR: ['srcdoc'],
  });
}
