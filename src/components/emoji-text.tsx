import PQueue from 'p-queue';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { getGifFirstFrame } from '../utils/get-gif-first-frame';
import mem from '../utils/mem';

import CustomEmoji from './custom-emoji';

interface ResolvedEmoji {
  shortcode: string;
  url: string;
  staticUrl?: string;
}

interface EmojiTag {
  type?: string;
  name: string;
  icon: { url: string; mediaType?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function emojiTag(value: unknown): EmojiTag | undefined {
  if (!isRecord(value) || !isRecord(value.icon)) return undefined;
  if (typeof value.name !== 'string' || typeof value.icon.url !== 'string') {
    return undefined;
  }
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    name: value.name,
    icon: {
      url: value.icon.url,
      mediaType:
        typeof value.icon.mediaType === 'string'
          ? value.icon.mediaType
          : undefined,
    },
  };
}

function isEmojiTag(value: EmojiTag | undefined): value is EmojiTag {
  return value?.type === 'Emoji';
}

const fetchQueue = new PQueue({
  concurrency: 2,
  interval: 1000,
  intervalCap: 2,
});

const throttledFetch = (
  signal: AbortSignal | null | undefined,
  ...args: Parameters<typeof fetch>
) => fetchQueue.add(() => fetch(...args), { signal: signal ?? undefined });

const SHORTCODES_REGEX = /(:(\w|\+|-)+:)(?=|[!.?]|$)/g;

const shortcodesRegexp = mem((shortcodes: readonly string[]) => {
  return new RegExp(`:(${shortcodes.join('|')}):`, 'g');
});

const resolvedEmojisCache = new Map<string, ResolvedEmoji[]>();
const MAX_CACHE_SIZE = 30;

const resolveEmojis = async (resolverURL: string): Promise<ResolvedEmoji[]> => {
  const cached = resolvedEmojisCache.get(resolverURL);
  if (cached) {
    return cached;
  }

  try {
    const response = await throttledFetch(null, resolverURL, {
      headers: { accept: 'application/activity+json' },
      referrerPolicy: 'no-referrer',
    });

    const data: unknown = await response.json();
    const tag = isRecord(data) && Array.isArray(data.tag) ? data.tag : [];
    const emojiTags: EmojiTag[] = [];
    for (const item of tag) {
      const tagItem = emojiTag(item);
      if (isEmojiTag(tagItem)) emojiTags.push(tagItem);
    }

    const emojis: ResolvedEmoji[] = emojiTags.length
      ? await Promise.all(
          emojiTags.map(async (t) => {
            const emoji: ResolvedEmoji = {
              shortcode: t.name.replace(/^:|:$/g, ''),
              url: t.icon.url,
            };
            if (t.icon?.mediaType === 'image/gif') {
              const staticUrl = await getGifFirstFrame(emoji.url);
              if (staticUrl) emoji.staticUrl = staticUrl;
            }
            return emoji;
          }),
        )
      : [];

    if (resolvedEmojisCache.size >= MAX_CACHE_SIZE) {
      const firstKey = resolvedEmojisCache.keys().next().value;
      if (firstKey !== undefined) {
        resolvedEmojisCache.delete(firstKey);
      }
    }

    resolvedEmojisCache.set(resolverURL, emojis);
    return emojis;
  } catch (error) {
    console.error('Failed to resolve emojis:', error);
    return [];
  }
};

const renderEmojiText = mem(
  (
    text: string,
    allEmojis: readonly ResolvedEmoji[],
    staticEmoji?: boolean,
  ) => {
    if (!text) return '';
    if (!text.includes(':')) return text;
    if (!allEmojis.length) return text;

    const regex = shortcodesRegexp(allEmojis.map((e) => e.shortcode));
    const shortcodeCounts = new Map<string, number>();
    const elements = text.split(regex).map((word) => {
      const emoji = allEmojis.find((e) => e.shortcode === word);

      if (emoji) {
        const { url, staticUrl } = emoji;
        const count = shortcodeCounts.get(word) ?? 0;
        shortcodeCounts.set(word, count + 1);
        return (
          <CustomEmoji
            key={`${word}-${count}`}
            staticUrl={staticEmoji ? undefined : staticUrl}
            url={staticEmoji ? staticUrl || url : url}
            alt={word}
          />
        );
      }

      return word;
    });

    return elements;
  },
);

interface EmojiTextProps {
  text?: string;
  emojis?: readonly ResolvedEmoji[];
  staticEmoji?: boolean;
  resolverURL?: string;
}

const EMPTY_EMOJIS: readonly ResolvedEmoji[] = [];

function EmojiText({
  text,
  emojis = EMPTY_EMOJIS,
  staticEmoji,
  resolverURL,
}: EmojiTextProps): ReactNode {
  const [resolvedEmojis, setResolvedEmojis] = useState<ResolvedEmoji[]>(
    () => (resolverURL && resolvedEmojisCache.get(resolverURL)) || [],
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!resolverURL || !text?.includes(':')) return;

    const matches = text.match(SHORTCODES_REGEX);
    if (!matches) return;

    const hasUnresolved = matches.some((match) => {
      const shortcode = match.slice(1, -1);
      return !emojis.some((e) => e.shortcode === shortcode);
    });
    if (!hasUnresolved) return;

    if (resolvedEmojisCache.has(resolverURL)) return;

    setLoading(true);

    void (async () => {
      const resolved = await resolveEmojis(resolverURL);
      setResolvedEmojis(resolved);
      setLoading(false);
    })();
  }, [resolverURL, text, emojis]);

  if (!text) return '';
  if (!text.includes(':')) return text;

  if (resolverURL && loading) {
    return text.replace(SHORTCODES_REGEX, '');
  }

  const allEmojis = [
    ...resolvedEmojis.filter(
      (resolved) =>
        !emojis.some((emoji) => emoji.shortcode === resolved.shortcode),
    ),
    ...emojis,
  ];

  return renderEmojiText(text, allEmojis, staticEmoji);
}

export default EmojiText;
