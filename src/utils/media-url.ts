export function getMediaURLObj(url: string, baseURL?: string) {
  const base =
    baseURL ||
    (typeof location === 'undefined'
      ? 'https://bluepy.local'
      : location.origin);
  return URL.parse(url, base);
}

export function isHlsPlaylistURL(
  url: string | null | undefined,
  baseURL?: string,
) {
  if (!url) return false;
  const parsed = getMediaURLObj(url, baseURL);
  return !!parsed && /\.m3u8$/i.test(parsed.pathname);
}

export function getBlueskyVideoFallbackURL(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  const parsed = getMediaURLObj(url);
  if (
    !parsed ||
    parsed.hostname !== 'video.blacksky.community' ||
    !parsed.pathname.startsWith('/stream/')
  ) {
    return undefined;
  }
  parsed.protocol = 'https:';
  parsed.host = 'video.bsky.app';
  parsed.pathname = parsed.pathname.replace(/^\/stream\//, '/watch/');
  return parsed.href;
}
