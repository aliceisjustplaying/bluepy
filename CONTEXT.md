# Bluepy

A Bluesky client whose UI descends from Phanpy (a Mastodon client) but whose data layer is being rebuilt to be ATProto-shaped end to end. This glossary captures the terms that distinguish Bluepy's ATProto-native choices from generic web-app vocabulary and from the Phanpy/Mastodon vocabulary the codebase is moving away from.

## Language

### Identifiers & permalinks

**At-URI** (`at://...`):
The ATProto-native identifier for a record. Always serialized with the `at://` prefix, never `at:/`. Full form is `at://<did-or-handle>/<collection>/<rkey>`. Bluepy uses at-URIs as both record references inside the data layer and as URLs in the browser (see Permalink).
_Avoid_: ATP URI, AT-URI without prefix, Bluesky URI

**Permalink**:
The at-URI of a record (post, profile, list, feed generator) used directly as the navigation URL — e.g. `bluepy.social/at://did:plc:.../app.bsky.feed.post/3kxabc`. Bluepy treats the at-URI as the canonical identifier *and* the canonical URL form; there is no separate web-style permalink. No legacy fallback.
_Avoid_: Bluesky URL, web URL, post URL, share link, public URL

### Services Bluepy talks to

**PDS** (Personal Data Server):
The ATProto server that holds the user's repository and signs writes. Bluepy talks to the PDS for any operation requiring identity: writes, mutes/blocks/follows, authenticated reads, blob uploads. One PDS per logged-in account.
_Avoid_: Bluesky server, home server

**AppView**:
A service that indexes ATProto records and serves Bluesky-shape lexicon queries (`app.bsky.*`) — feeds, threads, profiles, search, notifications. Bluepy treats the AppView as configurable: different users can point Bluepy at different AppView implementations.

**Active AppView**:
The AppView a given user has configured Bluepy to use. Defaults to the official Bluesky AppView, but users can switch to e.g. Blacksky's AppView. Public reads route here. The active-AppView setting is per-account.

**Bluesky AppView**:
The official Bluesky-operated AppView (`did:web:api.bsky.app#bsky_appview`, public endpoint `public.api.bsky.app`). Bluepy keeps a separate client pinned to this AppView as a fallback target for operations that the active AppView (e.g. Blacksky's) doesn't implement or implements incorrectly.

**Push Gateway**:
Bluepy-owned delivery infrastructure for Web Push notifications. It may store browser push subscriptions and delivery dedupe state, but it is not Bluepy's canonical notification inbox; canonical notification state remains AppView-shaped Bluepy data.
_Avoid_: notification server, push inbox, notification source of truth

## Example dialogue

> **A**: A user reports that trending topics don't load when they're signed into Blacksky's AppView. What's going on?
> **B**: The user's **Active AppView** is Blacksky, which doesn't implement `app.bsky.unspecced.getTrendingTopics`. That operation has to be force-routed to the **Bluesky AppView** instead. Check `src/data/feeds.ts` — it should be using the Bluesky-pinned client for that call, not the active one.
> **A**: And the share button copies the wrong link format. What should it copy?
> **B**: The **Permalink** — the at-URI form. `bluepy.social/at://did:plc:abc.../app.bsky.feed.post/3kxyz`, not `bsky.app/profile/handle/post/rkey`. No legacy URL shape.
