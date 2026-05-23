# ADR-0013: Blob upload happens at submit time, not on attach

When a user attaches an image, video, or gif to a compose draft, the file is held in memory as a `File` object with a local preview via `URL.createObjectURL()`. **No upload to the PDS happens until the user clicks Post.** Submit uploads all blobs in parallel then `createRecord`s the post.

Rejected alternative: **upload-on-attach** (snappier submit because blobs are already uploaded by the time the user posts). The blocker is structural: **ATProto has no `deleteBlob` endpoint**. Once a blob is uploaded, the only way it leaves the PDS is via implementation-defined orphan-blob GC (Bluesky's reference PDS uses something like a 24-hour window). This means an upload-on-attach client cannot honour a user's "actually, remove that photo" gesture cleanly — the blob persists on the PDS for hours regardless. For accidental picks of sensitive content (NSFW, private screenshots, wrong file), that is a privacy failure with no client-side mitigation.

Upload-on-submit accepts the slower submit (parallelised, with progress UI) as the price of "removing an attachment in compose actually removes the upload". Submit retries within a single compose session **do** cache blob refs after a successful upload step, so retry-after-`createRecord`-failure is cheap.

Acknowledged downside: this is the same UX regression that makes posting via the official Bluesky social-app feel slow. We accept it on privacy grounds. If ATProto ever ships a `deleteBlob`-or-equivalent procedure, this ADR is reopened.
