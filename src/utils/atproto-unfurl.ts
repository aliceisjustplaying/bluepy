import type { Agent } from '@atproto/api';

export const BSKY_LINK_META_PROXY = 'https://cardyb.bsky.app/v1/extract?url=';

const HTTP_URL_RE = /https?:\/\/[^\s<>"']+/i;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface AtprotoLinkMetadata {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  associatedRecord?: unknown;
  associated_record?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

interface AtprotoExternalEmbed {
  uri: string;
  title: string;
  description: string;
  associatedRecord?: Record<string, unknown>;
  thumb?: unknown;
}

export function getFirstPostURL(text: string = ''): string | null {
  const match = HTTP_URL_RE.exec(text);
  return match?.[0]?.replace(/[),.;!?]+$/, '') || null;
}

function getAssociatedRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

export async function fetchAtprotoLinkMetadata(
  uri: string,
  { fetcher = fetch as Fetcher }: { fetcher?: Fetcher } = {},
): Promise<AtprotoLinkMetadata | null> {
  if (!uri) return null;
  const res = await fetcher(
    `${BSKY_LINK_META_PROXY}${encodeURIComponent(uri)}`,
  );
  if (!res.ok) return null;
  const parsed: unknown = await res.json();
  if (parsed === null || typeof parsed !== 'object') return null;
  const metadata = parsed as AtprotoLinkMetadata;
  if (metadata.error) return null;
  return metadata;
}

export async function createAtprotoExternalEmbed(
  agent: Agent,
  uri: string,
  { fetcher = fetch as Fetcher }: { fetcher?: Fetcher } = {},
): Promise<{
  $type: 'app.bsky.embed.external';
  external: AtprotoExternalEmbed;
} | null> {
  if (!uri) return null;
  let metadata: AtprotoLinkMetadata | null;
  try {
    metadata = await fetchAtprotoLinkMetadata(uri, { fetcher });
  } catch (e) {
    console.error('Failed to fetch Bluesky link metadata', e);
    return null;
  }
  if (!metadata) return null;

  const external: AtprotoExternalEmbed = {
    uri: metadata.url || uri,
    title: metadata.title || '',
    description: metadata.description || '',
  };
  const associatedRecord = getAssociatedRecord(
    metadata.associatedRecord || metadata.associated_record,
  );
  if (associatedRecord) external.associatedRecord = associatedRecord;

  if (metadata.image) {
    try {
      const imageRes = await fetcher(metadata.image);
      if (imageRes.ok) {
        const imageBlob = await imageRes.blob();
        if (imageBlob.size > 0) {
          const uploadRes = await agent.uploadBlob(imageBlob, {
            encoding: imageBlob.type || 'image/jpeg',
          });
          if (uploadRes.data?.blob) external.thumb = uploadRes.data.blob;
        }
      }
    } catch (e) {
      console.error('Failed to upload Bluesky link thumbnail', e);
    }
  }

  return {
    $type: 'app.bsky.embed.external',
    external,
  };
}
