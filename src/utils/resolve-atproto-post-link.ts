import { resolveAtprotoDid } from './atproto-login-service';
import {
  getAtprotoPathFromLegacyRoute,
  getAtprotoURIFromPathname,
  isAtprotoPostURI,
  maybeDecodeAtprotoURI,
} from './atproto-route';

// Anchored to the start of the (trimmed) input so an external URL that merely
// *contains* a bsky.app post link (e.g. in a query string) is treated as an
// external link, not resolved as an internal post. Mirrors social-app's
// isBskyAppUrl/isBskyPostUrl, which require the bsky.app host at the start.
const BSKY_POST_URL_RE =
  /^https?:\/\/bsky\.app\/profile\/([^/\s?#]+)\/post\/([^/\s?#]+)\/?(?:[?#].*)?$/i;

// Resolve a pasted/typed link to a canonical, DID-based `at://` post URI, or
// null if it isn't an ATProto post link. ATProto-only: we never fall back to
// Mastodon/Fediverse search resolution. Supported inputs:
//   - bare `at://<repo>/app.bsky.feed.post/<rkey>` (repo may be a handle)
//   - bsky.app web links: `https://bsky.app/profile/<handleOrDid>/post/<rkey>`
//   - our own permalinks: `https://<host>/at://…` and legacy `/s/<at-uri>`
// Handles are resolved to DIDs so the returned URI is always canonical.
export async function resolveAtprotoPostURI(
  input: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  const text = input?.trim();
  if (!text) return null;

  // 1. Bare at:// post URI (repo may be a handle — normalize to a DID below).
  const direct = maybeDecodeAtprotoURI(text);
  if (isAtprotoPostURI(direct)) {
    return resolvePostURIRepo(direct, fetchFn);
  }

  // 2. bsky.app/profile/<handleOrDid>/post/<rkey>
  const bsky = BSKY_POST_URL_RE.exec(text);
  if (bsky) {
    const actor = decodeURIComponent(bsky[1]);
    const rkey = decodeURIComponent(bsky[2]);
    try {
      const did = await resolveAtprotoDid(actor, fetchFn);
      const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
      return isAtprotoPostURI(uri) ? uri : null;
    } catch {
      return null;
    }
  }

  // 3. Our own permalinks carrying an at:// post URI in the path
  //    (`https://<thisapp>/at://…` or the legacy `https://<thisapp>/s/<at-uri>`).
  const fromPath = getOwnPermalinkRecordURI(text);
  if (isAtprotoPostURI(fromPath)) {
    return resolvePostURIRepo(fromPath, fetchFn);
  }

  return null;
}

// Pull an at:// record URI (post/profile/list/feed) out of one of *our own*
// permalinks, covering both the native `/at://…` path shape and the legacy
// `/s/`, `/a/`, `/l/` routes. Returns null for any other host so that an
// external URL which merely embeds an at:// path in its pathname stays
// external rather than resolving to an internal record.
export function getOwnPermalinkRecordURI(text: string): string | null {
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(url.protocol)) return null;
  const ownHost = globalThis.location?.host;
  if (!ownHost || url.host !== ownHost) return null;
  const native = getAtprotoURIFromPathname(url.pathname);
  if (native) return native;
  const legacy = getAtprotoPathFromLegacyRoute(url.pathname);
  return legacy ? getAtprotoURIFromPathname(legacy) : null;
}

// Normalize a post URI whose repo is a handle into a DID-based URI.
async function resolvePostURIRepo(
  uri: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const match = /^at:\/\/([^/]+)\/(.+)$/i.exec(uri);
  if (!match) return null;
  const [, repo, rest] = match;
  if (repo.startsWith('did:')) return uri;
  try {
    const did = await resolveAtprotoDid(repo, fetchFn);
    return `at://${did}/${rest}`;
  } catch {
    return null;
  }
}
