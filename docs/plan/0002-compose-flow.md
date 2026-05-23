# Plan 0002 — Compose Flow

> **Audience**: same AFK coding agent that runs plan 0001. This plan describes the compose subsystem in detail.
> **Depends on**: plan 0001 fully landed. Compose consumes `src/data/posts.ts`, `src/data/profiles.ts`, the three-client dispatch (ADR-0004), the session provider (ADR-0010), and the cache-key factory (ADR-0009).

## Goal

Replace the compose feature inside `src/pages/compose.tsx` / `src/components/compose/` (currently ~2,147 LOC + helpers) with a rebuilt compose subsystem that:

- Reads / writes drafts from a Zustand store (`src/state/compose.ts`)
- Uses ATProto lexicon types end to end (no `AdaptedStatus`-shaped wrappers)
- Implements intent-keyed auto-multi-draft (ADR-0012)
- Uploads blobs at submit time only, with local previews (ADR-0013)
- Submits all-or-nothing for the main post; threadgate/postgate auxiliary records are warn-on-fail (ADR-0014)
- Supports a per-compose author picker for multi-account users (ADR-0015)
- Surfaces every step's progress and failure clearly

## Out of scope for this plan

- **Thread-writing mode** (composing N posts at once that chain by reply-ref): plan 0003, future. Bluepy users have the "reply to your own post" fallback for now.
- **Scheduled posts**: not in scope.
- **Polls**: ATProto has no native poll record; not in scope.
- **Custom hashtag autocomplete**: deferred (no Bluesky typeahead endpoint).

## Decisions referenced

| Topic | ADR |
| --- | --- |
| Intent-keyed multi-draft | ADR-0012 |
| Upload-on-submit | ADR-0013 |
| All-or-nothing submit pipeline | ADR-0014 |
| Author picker for multi-account | ADR-0015 |
| Three-client dispatch (the active draft's `authorDid` selects which `pdsAgent`) | ADR-0004 |
| Session lifecycle / per-account active AppView | ADR-0010 |
| Render layer separation (compose uses `<PostText>` for the reply-context preview) | ADR-0011 |

## State model: `src/state/compose.ts`

```ts
type DraftKey =
  | { kind: 'top-level'; authorDid: string }
  | { kind: 'reply'; authorDid: string; targetUri: AtUri }
  | { kind: 'quote'; authorDid: string; targetUri: AtUri };

type AttachmentState =
  | { id: string; kind: 'image'; file: File; previewUrl: string; altText: string; aspectRatio: { width: number; height: number }; status: 'ready' | 'uploading' | 'failed'; error?: string }
  | { id: string; kind: 'video'; file: File; previewUrl: string; altText: string; aspectRatio: { width: number; height: number }; status: 'ready' | 'uploading' | 'failed'; error?: string };
  // Video and image share the shape; the discriminator drives upload pipeline branching.

interface Draft {
  authorDid: string;
  text: string;
  attachments: AttachmentState[];
  replyTo?: { uri: AtUri; cid: string };   // strong ref to parent
  replyRoot?: { uri: AtUri; cid: string }; // strong ref to thread root
  quote?: { uri: AtUri; cid: string };
  externalCardDismissed: boolean;          // sticky-dismiss flag for the auto link card
  langs: string[];                          // defaults to [navigator.language]
  selfLabels: string[];                     // 'sexual' | 'nudity' | 'graphic-media' | '!warn' | '!hide'
  threadgate: ThreadgateConfig;             // default: 'everyone'
  postgate: PostgateConfig;                 // default: 'everyone'
  mentionResolutions: Record<string, string>; // handle -> DID cache for this draft
  updatedAt: number;
}

interface ComposeState {
  drafts: Map<DraftKeyString, Draft>;       // DraftKeyString = canonically-serialized DraftKey (see below)
  activeKey: DraftKeyString | null;          // currently-open compose modal

  openDraft(key: DraftKey, seed?: Partial<Draft>): void;  // creates or activates
  closeDraft(): void;                        // hides modal; draft persists
  updateActive(patch: Partial<Draft>): void;
  addAttachment(att: Omit<AttachmentState, 'id' | 'status'>): void;
  removeAttachment(id: string): void;
  setAuthor(did: string): void;              // see Q28a / ADR-0015
  resetActive(): void;                       // clears the active draft after successful submit
  clearAll(): void;                           // "discard all drafts" power user action
}
```

**Persistence (Zustand `persist` middleware)**:
#### `DraftKey` canonical serializer

`DraftKey` is a discriminated union. To use it as a Map key we serialize to a canonical string. The serializer + parser live in `src/compose/draft-key.ts`:

```ts
export type DraftKeyString = `v1:${string}`;

export function draftKeyToString(key: DraftKey): DraftKeyString;
export function parseDraftKey(value: string): DraftKey | null;
```

Rules:
- Output is prefixed `v1:` so future shape changes can co-exist (`v2:` etc.); `parseDraftKey` accepts only the version it understands and returns `null` otherwise.
- Field order is **fixed by the serializer**, not JSON-key-order-dependent. The agent does NOT use raw `JSON.stringify` — runtimes differ on property iteration for objects with mixed string/numeric keys, which would silently produce duplicate draft entries for the same logical key.
- Unknown `kind` discriminants throw at serialize time; `parseDraftKey` returns `null` for unrecognized kinds.
- Unit-tested at `tests/unit/compose/draft-key.test.ts` against the full set of `DraftKey` discriminants (fresh, reply, quote, edit-draft) with fixture-driven round-trip assertions: `parse(serialize(key)) === structurallyEqual(key)` for every shape, and `serialize` outputs are stable across runs (no Date.now, no Math.random in the key).

- Persisted fields: `drafts[*].text`, `replyTo`, `replyRoot`, `quote`, `externalCardDismissed`, `langs`, `selfLabels`, `threadgate`, `postgate`, `authorDid`, `updatedAt`. Plus `activeKey`.
- **Not persisted**: `drafts[*].attachments` (File objects can't survive reload), `mentionResolutions` (cheap to recompute).
- A custom `partialize` strips attachments on save and on load.

## Sub-systems

### Facet detection — `src/compose/facets.ts`

- Debounced 300 ms after last keystroke (ADR-implied).
- Runs `RichText.detectFacets(agent)` using `appviewAgent` (mention resolution doesn't need write auth).
- For each `@handle` encountered, the resolved DID is stashed in `draft.mentionResolutions[handle]`. Resubmitting with the same draft re-uses the cache — no re-resolution.
- Cache cleared when the draft is reset or cleared.

### Mentions autocomplete — `src/compose/mentions-autocomplete.tsx`

- Triggers when the cursor is inside an `@<token>` partial.
- Calls `useSearchActorsTypeahead(term)` (defined in `src/data/profiles.ts`) — hits `app.bsky.actor.searchActorsTypeahead` on `appviewAgent`, debounced 150 ms.
- Dropdown anchored at the cursor position; keyboard nav (↑ / ↓ / Enter / Esc).
- Selecting an actor:
  - inserts `@handle.bsky.social ` at the cursor
  - stashes the actor's DID in `draft.mentionResolutions[handle]` immediately, so facet detection doesn't re-resolve it

### Link card — `src/compose/external-card.tsx`

- Watches the draft text for URLs. The **last** URL in text is the candidate.
- If `externalCardDismissed === true`, no card is fetched or shown.
- Otherwise: fetch metadata from `https://cardyb.bsky.app/v1/extract?url=<url>`. Cardyb returns `{ url, title, description, image, error? }`. Cache results per-URL in compose-store for the duration of the draft (don't re-fetch on every keystroke).
  - **Privacy note (acknowledged, not fixed in this plan).** The Cardyb fetch leaks every URL the user types into the draft to Bluesky's `cardyb.bsky.app` service, regardless of whether the user ever submits the post. We match Phanpy/social-app behaviour for now (auto-fetch on debounce). A future `linkPreviewFetch: 'auto' | 'ask' | 'off'` UI preference is tracked as a follow-up; defer until the rebuild lands. Document this in the privacy policy alongside the existing Bluesky integration.
- Render the card preview with a `×` dismiss button. Clicking `×` sets `externalCardDismissed = true` for this draft and removes the card from the UI. The URL stays in the text as a plain link.
- If the user pastes a different URL later in the same draft and `externalCardDismissed === false`, the card updates to the new (last) URL.

### Attachment management

- **Add**: user picks file(s) → for each, generate id, build `previewUrl = URL.createObjectURL(file)`, validate size + dimensions (see below), push to `draft.attachments` with `status: 'ready'`.
- **Pre-validation on add**:
  - **Image**: if `> 2 MB` or `long_edge > 4000 px`, run client-side compression (canvas resize + re-encode to JPEG/WebP). If still over limits, reject with inline error on that attachment.
  - **Video**: enforce Bluesky's video constraints (size + duration + codec; see CLAUDE.md "Bluesky image limits" for the general policy and consult the official video upload constraints at submit time).
  - **Count**: max 4 images, max 1 video, images and video are mutually exclusive.
  - **Aspect ratio**: auto-derived from image natural dimensions; stored on the attachment.
- **Remove**: drop the attachment from `draft.attachments` and revoke `URL.revokeObjectURL(previewUrl)`.
- **No upload happens at this stage.** All `File` objects are held in memory.

### Submit pipeline — `src/compose/submit.ts`

Order of operations, all-or-nothing (ADR-0014):

1. **Validate.** Text length ≤ 300 graphemes after facet substitution; at least text OR an attachment OR a quote; valid lang codes; valid threadgate / postgate config.
2. **Final facet detection.** Run `RichText.detectFacets()` once more, using `draft.mentionResolutions` to skip already-resolved mention lookups. If a mention can't be resolved, surface inline warning and ask the user to confirm posting anyway.
3. **Upload all attachments in parallel.**
   - Each attachment goes to its appropriate audience:
     - **Image**: `authorPdsAgent.com.atproto.repo.uploadBlob(file)`
     - **Video**: service-auth-token-mediated upload to `https://video.bsky.app` (see "Video upload" below)
   - Show per-attachment progress in the UI (state transitions: `ready` → `uploading` → `ready` with `blobRef` stashed).
   - If any attachment upload fails, **abort the whole submit**. The attachment's `status` becomes `'failed'` with an `error` message; the rest of the draft stays intact. Submit retries don't re-upload attachments that already succeeded (blob refs are cached in the attachment state for the lifetime of the draft session).
4. **Build embed** (per precedence in Q25 + ADR-0011 dependencies):
   - attachments + quote → `app.bsky.embed.recordWithMedia` (quote = `record`, attachments = `media`)
   - attachments only → `app.bsky.embed.images` or `app.bsky.embed.video`
   - quote only → `app.bsky.embed.record`
   - URL in text + no attachments + no quote + `externalCardDismissed === false` → `app.bsky.embed.external`. The cardyb-supplied `image` is fetched and uploaded as a blob *here* (also through the author's PDS agent), then attached to the embed's `thumb` field.
   - else: no embed
5. **Build post record.** `app.bsky.feed.post.Record` with `text`, `facets`, `embed?`, `reply?`, `langs`, `labels` (self-labels), `createdAt`.
6. **`createRecord`** the post on the author's PDS. Returns `{ uri, cid }`.
7. **Auxiliary records** (parallel, warn-on-fail):
   - If `threadgate !== 'everyone'` (default): `createRecord` `app.bsky.feed.threadgate` with `post: post.uri` and the gate config.
   - If `postgate !== 'everyone'` (default): `createRecord` `app.bsky.feed.postgate` with `post: post.uri` and the gate config.
   - Either failure surfaces a non-blocking toast; the post stays.
8. **Cache invalidation** (per ADR-0005 broad-invalidation rule on `createPost`).** Compute `scope = useViewerScope()` for the *author* — for a side-account post, build a side-account-scoped `ViewerScope = [authorDid, appviewKey, labelersHash]` via the per-account client helper (not the active-account scope). Then:
   - Invalidate every `keys.feed(scope, ...)` and `keys.timeline(scope)`.
   - If reply: also invalidate `keys.thread(scope, replyTo.uri)` and `keys.thread(scope, replyRoot.uri)`.
   - If quote: invalidate `keys.post(scope, quote.uri)` (engagement count changed).
9. **Reset draft.** Remove the entry from `drafts[activeKey]`, set `activeKey = null`.

### Video upload — `src/compose/video-upload.ts`

Verified against `~/src/a/social-app/src/lib/media/video/upload.shared.ts` and `upload.web.ts` (the current Bluesky reference flow). **Two separate service-auth tokens are minted with different audiences and lexicon-methods — the agent does not reuse one for both calls.**

- **Step 1: check upload limits.** Mint a service-auth token with `aud: 'did:web:video.bsky.app'` (the video service DID) and `lxm: 'app.bsky.video.getUploadLimits'`. Call `app.bsky.video.getUploadLimits` against the video service with that token as Bearer auth. The response includes `canUpload`, an optional `message` (rate-limit / temporary-block reasoning), and the per-account size/duration ceiling. Block the upload UI and surface `message` if `canUpload === false`.
- **Step 2: upload the blob.** Mint a second service-auth token with `aud: 'did:web:<authorPdsHostname>'` (derived from `authorPdsAgent.dispatchUrl.hostname` — the PDS host, NOT the video service DID) and `lxm: 'com.atproto.repo.uploadBlob'`, with a 30-minute `exp`. POST the raw bytes to `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=<authorDid>&name=<random>.<ext>` with the token as Bearer auth and the file's MIME type as `Content-Type`. Response is `app.bsky.video.defs#jobStatus`.
- **Step 3: poll status.** Call `app.bsky.video.getJobStatus({ jobId })` against the video service (unauthenticated read on Bluesky's AppView) until `state === 'JOB_STATE_COMPLETED'` and `blob` is present, or `state === 'JOB_STATE_FAILED'`.
- **Step 4: attach.** The completed-job `blob` is what goes into `app.bsky.embed.video.video`.

**Why the audiences differ.** The video service verifies upload-limit tokens against its own DID (it is the entity checking the limit). The actual blob upload is mediated through the PDS — the service-auth token there proves "the holder is authorised to call `com.atproto.repo.uploadBlob` against this PDS audience," and the video service forwards the blob into that PDS context. Hardcoding `aud: 'did:web:video.bsky.app'` for the blob upload step (an earlier draft of this plan said this) produces a token that the PDS will not accept and silently fails the upload.

If the service-auth token expires mid-upload, mint a fresh one and retry. This is wrapped inside the attachment's submit-time upload step.

### Author picker — `src/compose/author-picker.tsx`

Renders only when `useSessionsStore(s => s.knownDids.length > 1)`. Avatar + handle of the current draft author with a dropdown to switch. Selecting an author:

- Calls `compose.setAuthor(newDid)` which **forks the draft**: the previous draft (under the old `DraftKey` with `authorDid: oldDid`) is preserved; a new draft is created for `authorDid: newDid` with the same text/attachments/refs *copied*. This avoids a quietly-changed `authorDid` on a draft the user thought belonged to a different account.

  **Attachment forking rules** (`src/compose/attachments.ts`):
  - Forking shares the underlying `File` objects between the old and new draft (cheap, identical content).
  - Each draft has its **own** attachment IDs (so removing from one draft doesn't change the other's ID set).
  - Preview `objectURL`s are **ref-counted**: a small `Map<File, { url: string; refs: Set<attachmentId> }>` in compose-store. Adding an attachment increments the ref set for its file; removing decrements. `URL.revokeObjectURL` runs ONLY when the ref set becomes empty.
  - Closing/discarding a draft drops every attachment in that draft, which decrements ref-counts on shared files; URLs survive as long as any other draft still references them.
  - Unit-tested at `tests/unit/compose/attachment-refcount.test.ts`: fork-then-remove-from-one scenario asserts the other draft's preview URL is still resolvable.
- Submit uses the author's `pdsAgent`. `<SessionProvider>` exposes a helper `getPdsAgentFor(did)` that constructs a `pdsAgent` for any logged-in DID, not just the active one.

## Files created / modified

```
src/
  state/
    compose.ts              # Zustand store (above)
  compose/
    facets.ts               # debounced detectFacets + mention DID caching
    mentions-autocomplete.tsx
    external-card.tsx       # cardyb fetch + dismiss UI
    submit.ts               # the submit pipeline
    video-upload.ts         # service-auth video upload
    author-picker.tsx       # multi-account author selector
  pages/
    compose.tsx             # rebuilt against the new store + submit
  components/
    compose/                # rebuilt against the new store + submit
```

## Things deleted

- Existing `src/utils/states.ts` compose-related state (lives in plan 0001's delete list).
- `src/utils/atproto-adapter.ts`'s compose helpers (`uploadComposeMediaAttachments`, `createAtprotoExternalEmbed`, the `agent.post(...)` convenience, `richTextToHTML` insofar as it's used by the old compose modal — note `richTextToHTML` itself becomes `renderPostText` in `src/render/post-text.ts` per ADR-0011).

## Acceptance criteria

Phase (b) compose is done when **all** of these are true:

1. New compose subsystem exists in the file structure above; old `src/pages/compose.tsx` is rebuilt to use it.
2. `bun run typecheck` passes with zero errors. **No `as any` in any compose code.**
3. `bunx oxlint src/state/compose.ts src/compose/ src/pages/compose.tsx` passes.
4. Behavioural Playwright tests in `tests/compose/`:
   - Compose top-level → text + 1 image → submit lands the post, attachment is visible in the resulting record.
   - Compose reply → reply ref matches `parent.uri/cid`, `root.uri/cid` resolves correctly when parent is itself a reply.
   - Compose quote → quote ref matches.
   - Compose with attachments + quote → resulting embed is `recordWithMedia`.
   - Intent-keyed multi-draft: open top-level draft, type X, open reply-to-Alice draft, type Y, back to top-level — X is still there.
   - Author picker: with two accounts logged in, switch author in compose, submit — post appears under the chosen author, not the global active account.
   - Submit failure on attachment → draft preserved with `failed` attachment marker, retry works.
   - Threadgate set to "followed-only" → main post lands, gate record lands, both visible in the resulting thread settings.
   - Threadgate failure (force-fail in test by mocking) → main post lands, warning toast surfaces, post stays.
   - External link card: paste a URL → card preview renders from cardyb → dismiss `×` → card gone → submit lands post with URL as plain link, no `external` embed.
5. Logged-in walk-through against `bun run dev`:
   - Type `@al` → typeahead surfaces matching actors → select inserts handle + caches DID.
   - Type a URL → 300 ms later the link card preview appears.
   - Add 4 images → try to add a 5th → rejected with clear error.
   - Add an image, try to add a video → rejected with mutually-exclusive error.
   - Drop a 8 MB photo → client-side compression succeeds → attachment shows with reasonable file size.
   - Submit a reply where the parent was deleted between cache and submit → submit fails with clear error, draft retained.
6. Persistence walk-through: write a draft with attachments → close compose modal (don't submit) → reopen → text + reply ref + quote ref + language + threadgate config still there; attachments gone (acceptable per ADR-0013 rationale).

## Open items

- [ ] Confirm current Bluesky video upload API specifics (endpoint, JSON shape) against `~/social-app` before the agent runs. Spec drift is real here.
- [ ] If Bluesky changes the threadgate/postgate lexicon (still under iteration), update the gate-config shapes accordingly.
- [ ] Thread-writing mode → plan 0003.
