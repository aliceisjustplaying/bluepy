# ADR-0012: Compose drafts are intent-keyed (auto-multi-draft)

The compose store holds a `Map<DraftKeyString, Draft>` where `DraftKey` is a discriminated union including `authorDid`:

```ts
type DraftKey =
  | { kind: 'top-level'; authorDid: string }
  | { kind: 'reply'; authorDid: string; targetUri: AtUri }
  | { kind: 'quote'; authorDid: string; targetUri: AtUri };
```

At most one draft per `(authorDid, kind, targetUri?)` tuple. There is no drafts-list UI, no "save as draft" gesture; the keying is implicit. **`authorDid` is part of the key**, not a draft body field, so that side-account and active-account top-level drafts don't collide and so author-switch can fork cleanly without overwriting (see ADR-0015).

**Effect**: replying to Alice's post **as the active account** always picks up your last active-account-reply-to-Alice draft; switching the author in the same compose modal lands you on the side account's reply-to-Alice draft (a different key); composing top-level as the active account picks up your last top-level draft for that account. Submit clears that one key. A small badge on the compose entry can surface "N unfinished drafts" with a "clear all" button when N > 0.

Map keys must be canonical strings, not object references. `DraftKey` is canonically serialized to `DraftKeyString` (see plan 0002 — `src/compose/draft-key.ts`, prefix `v1:`, fixed field order, no JSON.stringify); the Map is typed `Map<DraftKeyString, Draft>`.

Rejected alternatives: **single global draft** (loses work when users switch context — the demand for "multi-draft" is mostly this one use case), **full multi-draft with explicit save + drafts-list UI** (right design eventually, wrong upfront cost — adds drawer UI, active-draft selector, stale-draft hygiene, URL semantics; +300 LOC of state and UI versus +100 LOC for intent-keyed), **DraftKey without `authorDid`** (causes multi-account collisions — replying to Alice as account A and then as account B silently overwrites one of them).

**Persistence boundary** (see ADR-0013): the draft `text`, `replyTo`, `quote`, `language`, `contentWarning`, `langs`, `threadgateConfig`, `postgateConfig`, and `authorDid` are persisted across reload by Zustand's `persist` middleware. Attachments (`File` objects + `URL.createObjectURL()` previews) are in-memory only.
