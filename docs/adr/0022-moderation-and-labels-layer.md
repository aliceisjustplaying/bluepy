# ADR-0022: Moderation/labels live in a dedicated layer between data and UI

The data layer (`src/data/*.ts`) fetches lexicon views. The UI renders. In between sits a moderation layer (`src/data/moderation.ts` + `src/render/moderation-decision.ts`) that turns raw labels, accepted labelers, content-label prefs, adult-content prefs, muted words, hidden posts, and viewer relationships into **display decisions** that components consume. Without this layer, moderation checks scatter across components and the agent regresses safety/visibility behaviour.

**Why a layer, not inline.** Moderation is the most viewer-state-dependent computation in the entire app. Five separate inputs converge on every post and profile render:

1. The labels on the post/profile itself (from the AppView's `PostView.labels` / `ProfileView.labels`).
2. The viewer's **accepted labeler set** — `acceptedLabelerDids = baselineAppLabelers ∪ userSubscribedLabelersFrom(labelersPref)`. Labels from labelers outside this set are filtered out. Baseline app labelers are always accepted; user subscriptions add to that set, not replace it.
3. The viewer's per-label preferences (`contentLabelPref[]` — hide / warn / show per label, per labeler).
4. The viewer's adult-content gate (`adultContentPref.enabled` + `personalDetailsPref.birthDate`). When adult content is disabled, adult labels force hide/warn behaviour per the official ATProto label-handling semantics regardless of `contentLabelPref` value.
5. Per-instance overrides — muted words (`mutedWordsPref`), hidden posts (`hiddenPostsPref`), viewer-relationship blocks/mutes (in `PostView.viewer` / `ProfileView.viewer`).

Inlining this across timeline, thread, profile, search, quote-embed, notification renderers means the agent ports the same five-input fold N times and gets it slightly wrong somewhere.

**Baseline labelers — first-class concept.** The app ships a baseline set of labelers it always accepts. This is NOT a user preference and NOT filterable. It includes at minimum Bluesky's moderation service (the same set the official social-app uses as defaults). User-subscribed labelers from `labelersPref` are added to (never replace) this set.

"Labels from unsubscribed labelers are filtered out" applies to labelers outside `acceptedLabelerDids`. It does NOT mean "drop default moderation labels" — baseline labelers are always in the accepted set.

**Module surface.**

```ts
// src/data/moderation.ts
export interface ModerationContext {
  baselineLabelers: AppBskyLabelerDefs.LabelerViewDetailed[];   // always-accepted, app-defined
  subscribedLabelers: AppBskyLabelerDefs.LabelerViewDetailed[]; // from labelersPref
  acceptedLabelerDids: string[];                                 // baseline ∪ subscribed, deduped, sorted; matches the atproto-accept-labelers header sent on reads (ADR-0004)
  contentLabelPrefs: AppBskyActorDefs.ContentLabelPref[];
  adultContent: boolean;                                         // resolved adult gate (pref + age)
  mutedWords: AppBskyActorDefs.MutedWord[];
  hiddenPosts: string[];                                         // at-uris
}

export function useModerationContext(): ModerationContext;

// src/render/moderation-decision.ts — pure
export interface PostModerationDecision {
  visibility: 'show' | 'warn' | 'blur' | 'hide';
  cause?: 'label' | 'muted-word' | 'hidden-post' | 'blocked-by' | 'blocking' | 'muted' | 'detached' | 'not-found';
  blurAlt?: string;          // text to show in the warn/blur placeholder
  labels?: ComAtprotoLabelDefs.Label[];  // filtered to acceptedLabelerDids only
  causeLabel?: ComAtprotoLabelDefs.Label;
}
export function decidePostModeration(
  post: AppBskyFeedDefs.PostView,
  ctx: ModerationContext,
): PostModerationDecision;

export interface ProfileModerationDecision {
  visibility: 'show' | 'warn' | 'blur' | 'hide';
  cause?: 'label' | 'blocked-by' | 'blocking' | 'muted';
  avatarBlur?: boolean;
  bannerBlur?: boolean;
  displayNameBlur?: boolean;
  bioBlur?: boolean;
  labels?: ComAtprotoLabelDefs.Label[];
  causeLabel?: ComAtprotoLabelDefs.Label;
}
export function decideProfileModeration(
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
  ctx: ModerationContext,
): ProfileModerationDecision;

// React glue
export function usePostModeration(post: PostView | undefined): PostModerationDecision | undefined;
export function useProfileModeration(profile: ProfileView | undefined): ProfileModerationDecision | undefined;
```

`useModerationContext()` derives `ModerationContext` from `usePreferences()` + the resolved labeler-view fetches + the app's baseline labeler list. It memoises by viewer scope so the cost is paid once per render, not per post.

The two `decide*` functions are pure. They are the testable core (fixture-driven, spec-enumerated outputs per ADR-0019). The cause taxonomy is exhaustive — the agent does not invent new causes.

**Coupling to ADR-0004 / ADR-0009.** `acceptedLabelerDids` is the same DID set used to build the `atproto-accept-labelers` header on authenticated AppView reads (ADR-0004), AND the same set hashed into `labelersHash` in the cache key (ADR-0009). The three must agree: the request header sent, the cache key partition, and the moderation decision context are all derived from one source of truth — `useModerationContext().acceptedLabelerDids`.

**Adult-content semantics.** When `adultContent === false`, adult labels resolve to hide/warn per official ATProto label-handling semantics, regardless of the corresponding `contentLabelPref` entry. The user's age (from `personalDetailsPref.birthDate`) gates whether `adultContentPref.enabled` is allowed to be true at all; an under-age account has `adultContent === false` forced.

**Component contract.** Every post/profile-rendering component reads `usePostModeration(post)` / `useProfileModeration(profile)` and switches on `visibility`. The decision sets the wrapper (warn shield, blur, hidden placeholder, "show anyway" affordance, label badges). No component inspects `post.labels` / `profile.labels` directly.

**Existing references.** Bluepy already ships `atproto-labels` and `atproto-labeler-cache` helpers on the current branch. They are reference for label-fetching mechanics; the rebuild collapses them into this layer.

**Rejected alternatives:**
- **Inline moderation checks in each renderer.** Five-input fold ported N times; safety regressions become near-certain. The whole point of the rebuild is to remove that class of drift.
- **Moderation in the data layer (`primePosts` decorates posts with `__decision`).** Couples the cache to a viewer-only concern; preferences changes would have to invalidate every post entry instead of just the moderation context.
- **Lift the social-app `@atproto/api`-bundled moderation module verbatim.** It's a fine reference, but its API surface is broader than we need and entangled with React Native idioms; we want our own pure functions covered by Bluepy's own fixtures.
- **Filter ALL labels by subscribed labelers only (no baseline set).** Drops default/global moderation that the app always wants — adult-content gating, Bluesky's own moderation labels — when a user has no subscriptions. Wrong default.

**Implications:**
- Adding the layer is **mandatory in phase (b)**, alongside the data layer rebuild — not a phase-(c) afterthought.
- Acceptance: every post-render and profile-render path in the codebase goes through `usePostModeration` / `useProfileModeration`. Grepping for direct reads of `.labels` outside `src/render/moderation-decision.ts` returns no hits in renderable components.
- Fixtures: at least one captured response per cause in the taxonomy lives under `tests/fixtures/atproto/moderation/`. Unit tests at `tests/unit/moderation-decision.test.ts` pin the `decide*` outputs for every fixture × pref-combination of interest, including: baseline-only / baseline+subscribed labelers, adult-content on/off, media blur vs content warning, profile avatar/banner/displayName/bio blur, every cause in the taxonomy.
