import { getPdsEndpoint, isValidDidDoc } from '@atproto/common-web';

const BSKY_APPVIEW = 'https://public.api.bsky.app';
export const BSKY_PDS = 'https://bsky.social';

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizeAtprotoService(
  service: string | null | undefined,
): string | null {
  if (!service) return null;
  const normalized = service
    .trim()
    .replace(/^at:\/\//, '')
    .replace(/\/+$/, '');
  if (!normalized) return null;
  return /^https?:\/\//.test(normalized) ? normalized : `https://${normalized}`;
}

function normalizeAtprotoIdentifier(
  identifier: string | null | undefined,
): string {
  return (identifier || '').trim().replace(/^@/, '');
}

function isBskyHostedPds(service: string): boolean {
  try {
    const { hostname } = new URL(service);
    return (
      hostname === 'bsky.social' || hostname.endsWith('.host.bsky.network')
    );
  } catch {
    return false;
  }
}

export async function resolveAtprotoDid(
  identifier: string,
  fetchFn: Fetcher,
): Promise<string> {
  if (identifier.startsWith('did:')) return identifier;

  const url = new URL('/xrpc/com.atproto.identity.resolveHandle', BSKY_APPVIEW);
  url.searchParams.set('handle', identifier);
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to resolve Bluesky handle`);
  const data: unknown = await res.json();
  const did =
    data !== null && typeof data === 'object'
      ? (data as { did?: unknown }).did
      : undefined;
  if (typeof did !== 'string' || !did) {
    throw new Error(`Bluesky handle has no DID`);
  }
  return did;
}

async function resolveAtprotoDidDoc(
  did: string,
  fetchFn: Fetcher,
): Promise<Parameters<typeof getPdsEndpoint>[0]> {
  let url: string;
  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const host = did
      .slice('did:web:'.length)
      .split(':')
      .map(decodeURIComponent)
      .join('/');
    url = `https://${host}/.well-known/did.json`;
  } else {
    throw new Error(`Unsupported Bluesky DID method`);
  }

  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to resolve Bluesky DID document`);
  const didDoc: unknown = await res.json();
  if (!isValidDidDoc(didDoc)) throw new Error(`Invalid Bluesky DID document`);
  return didDoc;
}

export interface ResolveAtprotoLoginServiceOptions {
  identifier?: string | null;
  service?: string | null;
  fetch?: Fetcher;
}

export async function resolveAtprotoLoginService({
  identifier,
  service,
  fetch: fetchFn = globalThis.fetch,
}: ResolveAtprotoLoginServiceOptions): Promise<string> {
  const explicitService = normalizeAtprotoService(service);
  if (explicitService) return explicitService;

  const normalizedIdentifier = normalizeAtprotoIdentifier(identifier);
  if (!normalizedIdentifier || normalizedIdentifier.includes('@')) {
    return BSKY_PDS;
  }

  try {
    const did = await resolveAtprotoDid(normalizedIdentifier, fetchFn);
    const didDoc = await resolveAtprotoDidDoc(did, fetchFn);
    const pdsEndpoint = getPdsEndpoint(didDoc);
    if (!pdsEndpoint) return BSKY_PDS;
    return isBskyHostedPds(pdsEndpoint) ? BSKY_PDS : pdsEndpoint;
  } catch (e) {
    console.warn(e);
    return BSKY_PDS;
  }
}
