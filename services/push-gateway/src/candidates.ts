export type CandidateType = 'reply' | 'mention';

export interface JetstreamPostEvent {
  kind: string;
  did: string;
  time_us?: number;
  commit?: {
    operation?: string;
    collection?: string;
    rkey?: string;
    cid?: string;
    record?: unknown;
  };
}

export interface Candidate {
  recipientDid: string;
  type: CandidateType;
  sourceAtUri: string;
  sourceCid: string;
  actorDid: string;
  actorHandle?: string;
  actorDisplayName?: string;
  textExcerpt: string;
}

function isDid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('did:') && !hasControlCharacter(value);
}

function isRecordKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._~-]+$/.test(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function parseDidFromAtUri(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^at:\/\/(did:[a-z0-9:%._-]+)\/app\.bsky\.feed\.post\/[a-zA-Z0-9._~-]+$/);
  return match?.[1] ?? null;
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function isMentionFeature(value: unknown): value is { did: string } {
  if (!value || typeof value !== 'object') return false;
  const feature = value as { $type?: unknown; did?: unknown };
  return feature.$type === 'app.bsky.richtext.facet#mention' && isDid(feature.did);
}

export function validateTargetAtUri(value: string): boolean {
  return parseDidFromAtUri(value) !== null && !hasControlCharacter(value);
}

export function extractCandidates(event: JetstreamPostEvent): Candidate[] {
  if (event.kind !== 'commit') return [];
  if (event.commit?.operation !== 'create') return [];
  if (event.commit.collection !== 'app.bsky.feed.post') return [];
  const record = event.commit.record as { text?: unknown; facets?: unknown; reply?: unknown } | null;
  if (!record || typeof record !== 'object') return [];
  if (!isDid(event.did)) return [];
  if (typeof event.commit.cid !== 'string' || hasControlCharacter(event.commit.cid)) return [];
  if (!isRecordKey(event.commit.rkey)) return [];

  const recipients = new Map<string, CandidateType>();
  const facets = Array.isArray(record.facets) ? record.facets : [];
  for (const facet of facets) {
    const features = (facet as { features?: unknown }).features;
    if (!Array.isArray(features)) continue;
    for (const feature of features) {
      if (isMentionFeature(feature)) recipients.set(feature.did, 'mention');
    }
  }

  const reply = record.reply as { root?: { uri?: unknown }; parent?: { uri?: unknown } } | undefined;
  for (const ref of [reply?.root?.uri, reply?.parent?.uri]) {
    const did = parseDidFromAtUri(ref);
    if (did && recipients.get(did) !== 'mention') recipients.set(did, 'reply');
  }

  recipients.delete(event.did);
  const sourceAtUri = `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`;
  const sourceCid = event.commit.cid;
  return [...recipients].map(([recipientDid, type]) => ({
    recipientDid,
    type,
    sourceAtUri,
    sourceCid,
    actorDid: event.did,
    textExcerpt: plainText(record.text),
  }));
}
