function encodeAtprotoID(id: string): string {
  return encodeURIComponent(id);
}

function isAtprotoPostURI(uri: string | null | undefined): uri is string {
  return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/i.test(uri || '');
}

function maybeDecodeAtprotoURI(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith('at://') ? decoded : null;
  } catch {
    return value.startsWith('at://') ? value : null;
  }
}

function buildAtprotoPostPath(uri: string): string {
  return `/${uri}`;
}

function buildAtprotoPostPermalink(
  uri: string,
  origin: string = location.origin,
): string {
  return new URL(buildAtprotoPostPath(uri), origin).href;
}

function getAtprotoPostPathFromStatusRoute(path: string): string | null {
  const match = path.match(/^\/bsky\.social\/s\/([^?#]+)([?#].*)?$/i);
  if (!match) return null;
  const uri = maybeDecodeAtprotoURI(match[1]);
  if (!isAtprotoPostURI(uri)) return null;
  return `${buildAtprotoPostPath(uri)}${match[2] || ''}`;
}

export {
  buildAtprotoPostPermalink,
  encodeAtprotoID,
  getAtprotoPostPathFromStatusRoute,
  isAtprotoPostURI,
  maybeDecodeAtprotoURI,
};
