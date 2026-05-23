# ADR-0011: Facet-text rendering and HTML sanitization stay outside the data layer

`src/data/*.ts` deals only in lexicon types (`AppBskyFeedPost.Record`, `AppBskyActorDefs.ProfileViewDetailed`, etc.). It does not produce HTML.

- **Facet-to-HTML**: `src/render/post-text.ts` exposes `renderPostText(text, facets) → string` — pure, no React, no DOM, easy to unit-test. Handles mentions, links (with `rel="nofollow noopener noreferrer"`), hashtags (`<a href="/t/<tag>">`), escaping all interpolated text.
- **Sanitization**: `src/utils/sanitize-html.ts` keeps the existing DOMPurify wrappers (`sanitizePostHtml`, `sanitizeEmbedHtml`). XSS regression fixtures live next to it as today.
- **Rendering**: `<PostText post={post} />` (or `<PostText record={record} />`) glues the three: `renderPostText → sanitizePostHtml → dangerouslySetInnerHTML`. Used by status card, embed preview, notification snippet, search-result excerpt.

**Mention/profile-link form.** Mentions and profile permalinks resolve to the **full profile-record at-URI**, never a bare `at://<did>` path-with-DID:

```
<a href="bluepy.social/at://<did>/app.bsky.actor.profile/self">@handle</a>
```

The bare form (`at://<did>`) is not a valid at-URI per the glossary — at-URIs have the shape `at://<authority>/<collection>/<rkey>`. Using a DID-as-path for profile links was an earlier draft that contradicted ADR-0001 and the glossary; replaced with the profile-record URI form so every Bluepy URL in the address bar is a valid at-URI without exceptions. The router treats `app.bsky.actor.profile/self` as the canonical profile route for a DID.

Rejected: returning rendered HTML from the data layer (couples presentation with data, harder to test, harder to support multiple renderer surfaces); a separate non-at-URI "actor route" for profiles (introduces a second URL shape that disagrees with ADR-0001's "URL is the record identifier" principle).
