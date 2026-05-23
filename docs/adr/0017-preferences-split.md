# ADR-0017: Two preference surfaces — ATProto server-backed and device-local

The data layer exposes two distinct preference hooks. They never merge into a single surface; components read whichever applies.

**`usePreferences()` / `useUpdatePreference(type)` — ATProto server-backed.** Backed by `app.bsky.actor.getPreferences` / `putPreferences`. Private (PDS-scoped account state, not on firehose). Cross-device automatically. Lives in `src/data/preferences.ts`. Read as a normalized object: the hook fans the union array out by `$type` and returns `{adultContent, contentLabels, savedFeeds, mutedWords, threadView, feedView, postInteractionSettings, hiddenPosts, personalDetails, labelers}`. Writes use the SDK's read-modify-write loop (`agent.updatePreferences(callback)`); each pref-type mutation hook is a thin wrapper. Cache key: `keys.preferences(did)`.

**`useUiPreferences()` / `setUiPreference(field, value)` — device-local.** Backed by Zustand with `persist` middleware against `localStorage`, keyed per-DID. Lives in `src/state/ui-preferences.ts`. Holds the Phanpy-inherited UI fields that have no ATProto analog: `autoRefresh`, `shortcutsViewMode`, `shortcutsColumnsMode`, `boostsCarousel`, `contentTranslation`, `contentTranslationTargetLanguage`, `contentTranslationHideLanguages`, `contentTranslationAutoInline`, `mediaAltGenerator`, `composerGIFPicker`, `cloakMode`, `noAnimations`, `mutedPostVisibility`. Does not cross devices.

**Why this split.** ATProto `putPreferences` rejects any `$type` outside the `app.bsky.*` namespace (PDS transactor enforces it). The lexicon union is technically open and we *could* squat `app.bsky.actor.defs#x-bluepy-*` for private custom storage — it works today via the namespace gate + open-union pass-through — but the entire mechanism is one validation change away from breaking silently. Bluesky's own social-app stores its UI prefs (colorMode, darkTheme, kawaii mode, disableHaptics, language) device-local for the same reason. We follow them.

**Field-to-surface map.** The agent does not infer this — the map is exhaustive:

ATProto preferences (must implement for parity):
- `adultContentPref` — adult content gate
- `contentLabelPref[]` — per-labeler label preferences
- `savedFeedsPrefV2` — pinned/saved feed-generator list (renders as the Phanpy shortcut bar's feed entries)
- `mutedWordsPref` — muted words list (cross-device, distinct from the *display behavior* in `mutedPostVisibility`)
- `threadViewPref` — thread sort
- `feedViewPref` (keyed per feed) — hideReplies, hideRepliesByUnfollowed, hideReposts, hideQuotePosts
- `postInteractionSettingsPref` — default reply/quote restrictions on new posts
- `hiddenPostsPref` — per-post hide list
- `personalDetailsPref` — birth date (needed for adult content gating)
- `labelersPref` — subscribed labelers

ATProto preference types we do not implement (Bluesky-app-specific or not user-facing in Bluepy):
- `bskyAppStatePref` — Bluesky-app NUX queue, irrelevant to Bluepy
- `interestsPref` — Bluesky onboarding tags, no Bluepy UI for this
- `verificationPrefs` — handle verification visibility, defer until UX is designed
- `liveEventPreferences` — defer
- `declaredAgePref` — subsumed by `personalDetailsPref` for our purposes

Device-local UI prefs (all 13 Phanpy fields above).

**Rejected alternatives:**
- **Merged surface.** Single `usePreferences()` returning both — hides cross-device vs device-local, makes mutation routing ambiguous.
- **Squat `app.bsky.actor.defs#x-bluepy-*` for UI prefs.** Works today; one PDS validation change away from breaking silently. Not worth the cross-device convenience for prefs Bluesky themselves keep local.
- **Custom `social.bluepy.preferences` repo record.** Public on firehose. Leaks per-toggle setting changes.

**Implications:**
- Account switch: `usePreferences` invalidates and refetches (it's account-scoped via `keys.preferences(did)`); `useUiPreferences` swaps to the per-DID Zustand slice.
- Initial boot: both fire in parallel; UI renders against `useUiPreferences` immediately (synchronous from localStorage) and reveals server-pref-gated UI (e.g. adult content visibility) when `usePreferences` resolves.
- The Phanpy shortcut bar (covered separately) renders from a combination of `savedFeedsPrefV2` (feed entries) and `useUiPreferences().shortcutsViewMode` (display mode). See follow-on grill for shortcut-bar architecture.
