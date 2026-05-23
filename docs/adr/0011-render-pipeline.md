# ADR-0011: Facet-text rendering and HTML sanitization stay outside the data layer

`src/data/*.ts` deals only in lexicon types (`AppBskyFeedPost.Record`, `AppBskyActorDefs.ProfileViewDetailed`, etc.). It does not produce HTML.

- **Facet-to-HTML**: `src/render/post-text.ts` exposes `renderPostText(text, facets) → string` — pure, no React, no DOM, easy to unit-test. Handles mentions (`<a href="bluepy.social/at://<did>">@handle</a>`), links (with `rel="nofollow noopener noreferrer"`), hashtags (`<a href="/t/<tag>">`), escaping all interpolated text.
- **Sanitization**: `src/utils/sanitize-html.ts` keeps the existing DOMPurify wrappers (`sanitizePostHtml`, `sanitizeEmbedHtml`). XSS regression fixtures live next to it as today.
- **Rendering**: `<PostText post={post} />` (or `<PostText record={record} />`) glues the three: `renderPostText → sanitizePostHtml → dangerouslySetInnerHTML`. Used by status card, embed preview, notification snippet, search-result excerpt.

Rejected: returning rendered HTML from the data layer (couples presentation with data, harder to test, harder to support multiple renderer surfaces).
