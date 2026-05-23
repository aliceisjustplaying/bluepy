export type AccountScope = readonly [viewerDid: string];

export type ViewerScope = readonly [
  viewerDid: string,
  appviewKey: string,
  labelersHash: string,
];

export type AtUri = string;

export type FeedFilter = 'posts' | 'posts-and-replies' | 'media';

export type FeedOpts = Readonly<Record<string, unknown>> | undefined;

export type NotifFilter = string | undefined;

export function appviewKey(appviewDid: string, origin: string): string {
  return `${appviewDid}|${origin}`;
}

export function stableHash(values: readonly string[]): string {
  const sorted = [...values].toSorted();
  let hash = 5381;
  for (const value of sorted) {
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
  }
  return (hash >>> 0).toString(36);
}

export const keys = {
  preferences: (a: AccountScope) => [...a, 'preferences'] as const,
  uiPreferences: (a: AccountScope) => [...a, 'uiPreferences'] as const,

  post: (s: ViewerScope, uri: AtUri) => [...s, 'post', uri] as const,
  profileByDid: (s: ViewerScope, did: string) =>
    [...s, 'profileByDid', did] as const,
  actorResolution: (s: ViewerScope, handle: string) =>
    [...s, 'actorResolution', handle] as const,

  timeline: (s: ViewerScope) => [...s, 'timeline'] as const,
  feed: (s: ViewerScope, generator: AtUri, opts?: FeedOpts) =>
    [...s, 'feed', generator, opts] as const,
  thread: (s: ViewerScope, uri: AtUri) => [...s, 'thread', uri] as const,
  profileFeed: (s: ViewerScope, did: string, filter?: FeedFilter) =>
    [...s, 'profileFeed', did, filter] as const,
  notifications: (s: ViewerScope, filter?: NotifFilter) =>
    [...s, 'notifications', filter] as const,
  search: (s: ViewerScope, query: string, type: 'posts' | 'actors') =>
    [...s, 'search', type, query] as const,
  bookmarks: (s: ViewerScope) => [...s, 'bookmarks'] as const,
  follows: (s: ViewerScope, subjectDid: string) =>
    [...s, 'follows', subjectDid] as const,
  followers: (s: ViewerScope, subjectDid: string) =>
    [...s, 'followers', subjectDid] as const,
} as const;
