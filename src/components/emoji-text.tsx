import type { ReactNode } from 'react';

interface ResolvedEmoji {
  shortcode: string;
  url: string;
  staticUrl?: string;
}

interface EmojiTextProps {
  text?: string;
  emojis?: readonly ResolvedEmoji[];
  staticEmoji?: boolean;
  resolverURL?: string;
}

function EmojiText({ text }: EmojiTextProps): ReactNode {
  return text || '';
}

export default EmojiText;
