// ATProto-only: quotes are a protocol-level record embed, native on every
// AppView, so there is no Mastodon version gate to consult.
export function supportsNativeQuote(): boolean {
  return true;
}
