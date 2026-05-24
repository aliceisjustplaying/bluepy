const RECORD_URI_PATTERN = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;

export function parseOwnedRecordUri(
  uri: string,
  activeDid: string | null,
  expectedCollection: string,
): { repo: string; rkey: string } {
  if (!activeDid) throw new Error('Active DID required');
  const match = RECORD_URI_PATTERN.exec(uri);
  if (!match) throw new Error('Record URI required');
  const [, repo, collection, rkey] = match;
  if (repo !== activeDid) {
    throw new Error('Record URI repo does not match active account');
  }
  if (collection !== expectedCollection) {
    throw new Error(
      `Record URI collection ${collection} does not match ${expectedCollection}`,
    );
  }
  return { repo, rkey };
}
