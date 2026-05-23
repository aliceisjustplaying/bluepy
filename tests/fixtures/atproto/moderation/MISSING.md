# Missing moderation fixtures

These causes could not be captured from the main account's available data:

- blocked-by: no post where author.viewer.blockedBy = true (someone-who-blocked-you-replying-in-a-thread fixture would need to be captured separately)
- detached: no embed.$type ending in #viewDetached found in 5 timeline pages or searchPosts pool
- hidden-post: hiddenPostsPref is empty on this account; we reused the label fixture as the post-shape stand-in (moderation test sets the URI in ModerationContext.hiddenPosts)

Agent behavior: `decidePostModeration` / `decideProfileModeration` tests for these causes either
(a) reuse another captured fixture and set up the appropriate ModerationContext + viewer state at test setup time (allowed: the post is a real capture; the surrounding context is per-test), or
(b) the agent halts at M6 with STUCK-M6-VERIFY.md and we capture the missing fixtures via the test accounts in a follow-up.
