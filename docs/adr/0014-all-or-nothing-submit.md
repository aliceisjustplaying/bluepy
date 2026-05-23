# ADR-0014: Compose submit is all-or-nothing

When the user clicks Post, the submit pipeline is: validate → final facet detection (with cached mention DIDs) → upload all attachments in parallel → build embed (per precedence rules) → build post record → `createRecord` for the post. Any failure in any step aborts the submit; the draft is preserved with text, attachments, and refs intact; an inline error surfaces *where* the failure happened (specific blob upload failed, network timeout, rate limit, stale reply parent, etc.).

Posts are atomic with respect to user intent: what the user composed is what gets sent. Partial success (post lands with 3 of 4 attachments because one upload failed) is the trap that bites every social-app user who realises post-hoc "wait, I didn't post the image I meant to". We do not do partial success.

**Exception**: threadgate and postgate auxiliary records (`app.bsky.feed.threadgate`, `app.bsky.feed.postgate`) are created *after* the main post lands, in parallel. If either auxiliary create fails, the main post stays and a non-blocking warning surfaces ("Post created, but reply settings couldn't be applied — try again from the post menu"). The semantics are: the post is the load-bearing artifact; the gates are settings that can be retried out-of-band without re-posting.
