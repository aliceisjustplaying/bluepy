# ADR-0015: Compose has an author picker for multi-account users

When more than one account is logged in, the compose modal exposes a small avatar/dropdown letting the user choose which logged-in account this particular post is sent as. Selecting an author **does not** change the global active account — the next compose opens with the global active account again unless explicitly changed.

Rejected alternative: **author = active account, always**. Multi-account users dashing off a side-account post would have to perform a global account switch (cache clear, re-render, etc.) just to post once. Phanpy-style per-compose author selection is what users expect from a multi-account client.

Implementation: the compose store's `Draft` carries `authorDid: string` (defaults to global active DID when the draft is created). Submit uses `pdsAgent` for that DID — which means the compose modal needs access to a `pdsAgent` *per logged-in account*, not just the active one. `<SessionProvider>` (ADR-0010) instantiates clients for the active account by default; compose's submit path resolves the chosen author's `pdsAgent` on demand via the same client-construction helper.
