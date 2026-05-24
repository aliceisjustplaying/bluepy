import type { AppBskyFeedDefs } from '@atproto/api';

const STORAGE_KEY = 'bluepy:bookmark-overrides:v1';
const OVERRIDE_TTL_MS = 5 * 60 * 1000;

interface BookmarkOverride {
  bookmarked: boolean;
  updatedAt: number;
}

type BookmarkOverrides = Record<
  string,
  Record<string, boolean | BookmarkOverride>
>;

function readOverrides(): BookmarkOverrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as BookmarkOverrides;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: BookmarkOverrides): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Non-critical immediate-consistency cache.
  }
}

export function setBookmarkOverride(
  viewerDid: string | null | undefined,
  uri: string,
  bookmarked: boolean,
): void {
  if (!viewerDid || !uri) return;
  const overrides = readOverrides();
  overrides[viewerDid] = {
    ...overrides[viewerDid],
    [uri]: {
      bookmarked,
      updatedAt: Date.now(),
    },
  };
  writeOverrides(overrides);
}

export function clearBookmarkOverride(
  viewerDid: string | null | undefined,
  uri: string,
): void {
  if (!viewerDid || !uri) return;
  const overrides = readOverrides();
  const viewerOverrides = overrides[viewerDid];
  if (!viewerOverrides || !(uri in viewerOverrides)) return;
  delete viewerOverrides[uri];
  if (Object.keys(viewerOverrides).length === 0) {
    delete overrides[viewerDid];
  }
  writeOverrides(overrides);
}

export function getBookmarkOverride(
  viewerDid: string | null | undefined,
  uri: string,
): boolean | undefined {
  if (!viewerDid || !uri) return undefined;
  const override = readOverrides()[viewerDid]?.[uri];
  if (typeof override === 'boolean') return override;
  if (!override || Date.now() - override.updatedAt > OVERRIDE_TTL_MS) {
    clearBookmarkOverride(viewerDid, uri);
    return undefined;
  }
  return override.bookmarked;
}

export function applyBookmarkOverride(
  post: AppBskyFeedDefs.PostView,
  viewerDid: string | null | undefined,
): AppBskyFeedDefs.PostView {
  const bookmarked = getBookmarkOverride(viewerDid, post.uri);
  if (bookmarked === undefined) return post;
  return {
    ...post,
    viewer: {
      ...post.viewer,
      bookmarked,
    },
  };
}
