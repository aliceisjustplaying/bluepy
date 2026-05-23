import { RichText, type AppBskyRichtextFacet } from '@atproto/api';

function escapeHTML(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textToHTML(text: string): string {
  return escapeHTML(text).replace(/\n/g, '<br />');
}

function isSafeLinkUri(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function profilePermalink(did: string): string {
  return `/at://${did}/app.bsky.actor.profile/self`;
}

export function renderPostText(
  text: string,
  facets?: AppBskyRichtextFacet.Main[],
): string {
  if (!facets?.length) return textToHTML(text);

  const richText = new RichText({ text, facets });
  return Array.from(richText.segments())
    .map((segment) => {
      const html = textToHTML(segment.text);
      if (segment.link?.uri) {
        if (isSafeLinkUri(segment.link.uri)) {
          return `<a href="${escapeHTML(segment.link.uri)}" target="_blank" rel="nofollow noopener noreferrer">${html}</a>`;
        }
        return html;
      }
      if (segment.mention?.did) {
        return `<a href="${escapeHTML(profilePermalink(segment.mention.did))}" class="mention" rel="nofollow noopener noreferrer">${html}</a>`;
      }
      if (segment.tag?.tag) {
        return `<a href="/t/${encodeURIComponent(segment.tag.tag)}" class="mention hashtag" rel="tag">#<span>${escapeHTML(segment.tag.tag)}</span></a>`;
      }
      return html;
    })
    .join('');
}
