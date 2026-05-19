function encodeAtprotoID(id: string): string {
  return encodeURIComponent(id);
}

function isAtprotoPostURI(uri: string | null | undefined): uri is string {
  return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/i.test(uri || '');
}

function isAtprotoProfileURI(uri: string | null | undefined): uri is string {
  return /^at:\/\/[^/]+\/app\.bsky\.actor\.profile\/self$/i.test(uri || '');
}

function isAtprotoListURI(uri: string | null | undefined): uri is string {
  return /^at:\/\/[^/]+\/app\.bsky\.graph\.list\/[^/?#]+$/i.test(uri || '');
}

function isAtprotoFeedGeneratorURI(
  uri: string | null | undefined,
): uri is string {
  return /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/[^/?#]+$/i.test(uri || '');
}

function isAtprotoRecordURI(uri: string | null | undefined): uri is string {
  return (
    isAtprotoPostURI(uri) ||
    isAtprotoProfileURI(uri) ||
    isAtprotoListURI(uri) ||
    isAtprotoFeedGeneratorURI(uri)
  );
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

function buildAtprotoRecordPath(uri: string): string {
  return `/${uri}`;
}

function buildAtprotoPostPath(uri: string): string {
  return buildAtprotoRecordPath(uri);
}

function buildAtprotoPostPermalink(
  uri: string,
  origin: string = location.origin,
): string {
  return new URL(buildAtprotoPostPath(uri), origin).href;
}

function buildAtprotoProfileURI(repo: string): string {
  return `at://${repo}/app.bsky.actor.profile/self`;
}

function isAtprotoHandleID(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
    value,
  );
}

function isAtprotoRepoID(value: string): boolean {
  return /^did:[^/]+$/i.test(value) || isAtprotoHandleID(value);
}

function getAtprotoRepo(uri: string | null | undefined): string | null {
  return /^at:\/\/([^/]+)/i.exec(uri || '')?.[1] || null;
}

function getAtprotoPathFromLegacyRoute(path: string): string | null {
  const statusMatch = path.match(
    /^\/(?:(bsky\.social)\/)?s\/([^?#]+)([?#].*)?$/i,
  );
  if (statusMatch) {
    const uri = maybeDecodeAtprotoURI(statusMatch[2]);
    if (isAtprotoPostURI(uri)) {
      return `${buildAtprotoRecordPath(uri)}${statusMatch[3] || ''}`;
    }
  }

  const accountMatch = path.match(
    /^\/(?:(bsky\.social)\/)?a\/([^?#]+)([?#].*)?$/i,
  );
  if (accountMatch) {
    const id = decodeURIComponent(accountMatch[2]);
    if (isAtprotoRepoID(id)) {
      return `${buildAtprotoRecordPath(buildAtprotoProfileURI(id))}${
        accountMatch[3] || ''
      }`;
    }
  }

  const listMatch = path.match(
    /^\/(?:(bsky\.social)\/)?l\/([^?#]+)([?#].*)?$/i,
  );
  if (listMatch) {
    const uri = maybeDecodeAtprotoURI(listMatch[2]);
    if (isAtprotoListURI(uri) || isAtprotoFeedGeneratorURI(uri)) {
      return `${buildAtprotoRecordPath(uri)}${listMatch[3] || ''}`;
    }
  }

  return null;
}

export {
  buildAtprotoProfileURI,
  buildAtprotoRecordPath,
  buildAtprotoPostPermalink,
  buildAtprotoPostPath,
  encodeAtprotoID,
  getAtprotoPathFromLegacyRoute,
  getAtprotoRepo,
  isAtprotoFeedGeneratorURI,
  isAtprotoListURI,
  isAtprotoPostURI,
  isAtprotoProfileURI,
  isAtprotoRecordURI,
  maybeDecodeAtprotoURI,
};
