import type { AppBskyRichtextFacet } from '@atproto/api';

import { renderPostText } from '../render/post-text';
import { sanitizePostHtml } from '../utils/sanitize-html';

export interface PostTextProps {
  text: string;
  facets?: AppBskyRichtextFacet.Main[];
  className?: string;
}

export default function PostText({ text, facets, className }: PostTextProps) {
  const html = sanitizePostHtml(renderPostText(text, facets));
  return (
    <div
      className={className}
      dir="auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
