# ADR-0012: Compose drafts are intent-keyed (auto-multi-draft)

The compose store holds a `Map<DraftKey, Draft>` where `DraftKey` is a tuple of `{kind: 'top-level' | 'reply' | 'quote', targetUri?: AtUri}`. At most one draft per key. There is no drafts-list UI, no "save as draft" gesture; the keying is implicit.

**Effect**: replying to Alice's post always picks up your last reply-to-Alice draft; composing top-level always picks up your last top-level draft; clicking quote on Bob always picks up your last quote-of-Bob draft. Submit clears that one key. A small badge on the compose entry can surface "N unfinished drafts" with a "clear all" button when N > 0.

Rejected alternatives: **single global draft** (loses work when users switch context — the demand for "multi-draft" is mostly this one use case), **full multi-draft with explicit save + drafts-list UI** (right design eventually, wrong upfront cost — adds drawer UI, active-draft selector, stale-draft hygiene, URL semantics; +300 LOC of state and UI versus +100 LOC for intent-keyed). Full multi-draft remains a natural extension once intent-keying is in place.

**Persistence boundary** (see ADR-0013): the draft `text`, `replyTo`, `quote`, `language`, `contentWarning`, `langs`, `threadgateConfig`, `postgateConfig` are persisted across reload by Zustand's `persist` middleware. Attachments (`File` objects + `URL.createObjectURL()` previews) are in-memory only.
