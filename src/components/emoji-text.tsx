import type { ReactNode } from 'react';

interface EmojiTextProps {
  text?: string;
}

function EmojiText({ text }: EmojiTextProps): ReactNode {
  return text || '';
}

export default EmojiText;
