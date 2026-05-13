import PQueue from 'p-queue';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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

const fetchQueue = new PQueue({
  concurrency: 2,
  interval: 1000,
  intervalCap: 2,
});

const throttledFetch = (
  signal: AbortSignal | null | undefined,
  ...args: Parameters<typeof fetch>
) => fetchQueue.add(() => fetch(...args), { signal: signal ?? undefined });

const SHORTCODES_REGEX = /(\:(\w|\+|\-)+\:)(?=|[\!\.\?]|$)/g;

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

    const data = (await (response as Response).json()) as {
      tag?: EmojiTag[];
    };
    const emojiTags: EmojiTag[] =
      data.tag?.filter((t) => t.type === 'Emoji') || [];

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
    const elements = text.split(regex).map((word, index) => {
      const emoji = allEmojis.find((e) => e.shortcode === word);

      if (emoji) {
        const { url, staticUrl } = emoji;
        return (
          <CustomEmoji
            key={`${word}-${index}`}
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

function EmojiText({
  text,
  emojis = [],
  staticEmoji,
  resolverURL,
}: EmojiTextProps): ComponentChildren {
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

    (async () => {
      const emojis = await resolveEmojis(resolverURL);
      setResolvedEmojis(emojis);
      setLoading(false);
    })();
  }, [resolverURL, text, emojis?.length]);

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
