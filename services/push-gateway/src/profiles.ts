import type { Db } from './db.js';

export interface ProfilePreview {
  did: string;
  handle?: string;
  displayName?: string;
}

function cacheExpiry(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function getCachedProfile(db: Db, did: string): ProfilePreview | null {
  const row = db
    .prepare('SELECT did, handle, display_name FROM profile_cache WHERE did = ? AND expires_at > ?')
    .get(did, new Date().toISOString()) as
    | { did: string; handle: string | null; display_name: string | null }
    | undefined;
  if (!row) return null;
  return {
    did: row.did,
    handle: row.handle ?? undefined,
    displayName: row.display_name ?? undefined,
  };
}

export function storeProfile(db: Db, profile: ProfilePreview, ttlMs = 60 * 60 * 1000): void {
  db.prepare(
    `INSERT INTO profile_cache (did, handle, display_name, expires_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(did) DO UPDATE SET
       handle = excluded.handle,
       display_name = excluded.display_name,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(profile.did, profile.handle ?? null, profile.displayName ?? null, cacheExpiry(ttlMs));
}

export async function fetchProfilePreview(did: string, appViewUrl = 'https://public.api.bsky.app'): Promise<ProfilePreview | null> {
  const url = new URL('/xrpc/app.bsky.actor.getProfile', appViewUrl);
  url.searchParams.set('actor', did);
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { did?: unknown; handle?: unknown; displayName?: unknown };
  if (body.did !== did) return null;
  return {
    did,
    handle: typeof body.handle === 'string' ? body.handle : undefined,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
  };
}

export async function getOrFetchProfilePreview(db: Db, did: string, appViewUrl?: string): Promise<ProfilePreview | null> {
  const cached = getCachedProfile(db, did);
  if (cached) return cached;
  const fetched = await fetchProfilePreview(did, appViewUrl).catch(() => null);
  if (fetched) storeProfile(db, fetched);
  return fetched;
}
