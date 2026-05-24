import { msg } from '@lingui/core/macro';
import type { mastodon } from 'masto';
import PQueue from 'p-queue';

import { langDetector } from '../utils/browser-translator';
import getHTMLText from '../utils/get-html-text';
import getTranslateTargetLanguage from '../utils/get-translate-target-language';
import localeMatchDefault from '../utils/locale-match';
import mem from '../utils/mem';
import pmem from '../utils/pmem';

import type { AnyStatus, MastoClientFromApi } from './status-types';

export const SHOW_COMMENT_COUNT_LIMIT = 280;
export const INLINE_TRANSLATE_LIMIT = 140;
export const REACTIONS_LIMIT = 80;
export const QUESTION_REGEX = /[??？︖❓❔⁇⁈⁉¿‽؟]/;
export const { DEV } = import.meta.env;

// `localeMatch` is called here with 2 args (omitting the required
// `defaultLocale`). The wrapper catches the resulting throw and returns
// `false`. Cast to a permissive signature reflecting that reality so we can
// keep matching the existing call shape without churning the wrapper.
type OptionalDefaultLocaleMatch = (
  requestedLocales: readonly string[],
  availableLocales: readonly (string | false)[],
  defaultLocale?: string,
) => string | false;

const localeMatch = localeMatchDefault as OptionalDefaultLocaleMatch;

type AccountFetchClient = MastoClientFromApi & {
  readonly v1: MastoClientFromApi['v1'] & {
    readonly accounts: MastoClientFromApi['v1']['accounts'] & {
      readonly $select: (id: string) => {
        readonly fetch: () => Promise<mastodon.v1.Account>;
      };
    };
  };
};

const accountQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1,
});

function fetchAccount(
  id: string,
  masto: MastoClientFromApi,
  signal?: AbortSignal,
) {
  return accountQueue.add(
    () => (masto as AccountFetchClient).v1.accounts.$select(id).fetch(),
    { signal },
  );
}

export const memFetchAccount = pmem(fetchAccount);

export const isIOS =
  window.ontouchstart !== undefined &&
  /iPad|iPhone|iPod/.test(navigator.userAgent);

interface GetPostTextOpts {
  maskCustomEmojis?: boolean;
  maskURLs?: boolean;
  hideInlineQuote?: boolean;
  htmlTextOpts?: Record<string, unknown>;
}

export function getPostText(status: AnyStatus, opts?: GetPostTextOpts): string {
  const {
    maskCustomEmojis,
    maskURLs,
    hideInlineQuote,
    htmlTextOpts = {},
  } = opts || {};
  const { spoilerText, emojis } = status;
  let { content } = status;
  if (maskCustomEmojis && emojis?.length) {
    const emojisRegex = new RegExp(
      `:(${emojis.map((e: mastodon.v1.CustomEmoji) => e.shortcode).join('|')}):`,
      'g',
    );
    content = content.replace(emojisRegex, '⬚');
  }
  const fullText = [
    spoilerText || '',
    getHTMLText(content, {
      ...htmlTextOpts,
      preProcess:
        maskURLs || hideInlineQuote
          ? (dom: DocumentFragment) => {
              // Remove links that contains text that starts with https?://
              if (maskURLs) {
                for (const a of dom.querySelectorAll('a')) {
                  const text = a.innerText.trim();
                  if (/^https?:\/\//i.test(text)) {
                    a.replaceWith('«🔗»');
                  }
                }
              }
              // Hide inline quote
              if (hideInlineQuote) {
                const reContainer = dom.querySelector('.quote-inline');
                if (reContainer) {
                  reContainer.remove();
                }
              }
            }
          : undefined,
    }),
  ]
    .join('\n\n')
    .trim();
  return fullText;
}

function forgivingQSA(
  selectors: string[] = [],
  dom: ParentNode = document,
): NodeListOf<Element> | Element[] {
  // Run QSA for list of selectors
  // If a selector return invalid selector error, try the next one
  for (const selector of selectors) {
    try {
      return dom.querySelectorAll(selector);
    } catch {}
  }
  return [];
}

export const getHTMLTextForDetectLang = mem(
  (content: string, emojis?: mastodon.v1.CustomEmoji[]): string => {
    if (!content) return '';
    if (emojis?.length) {
      const emojisRegex = new RegExp(
        `:(${emojis.map((e: mastodon.v1.CustomEmoji) => e.shortcode).join('|')}):`,
        'g',
      );
      content = content.replace(emojisRegex, '');
    }
    content = content.trim();
    if (!content) return '';
    return getHTMLText(content, {
      preProcess: (dom: DocumentFragment) => {
        // Remove anything that can skew the language detection

        // Remove .mention, .hashtag, pre, code, a:has(.invisible)
        for (const a of forgivingQSA(
          [
            '.mention, .hashtag, pre, code, a:has(.invisible)',
            '.mention, .hashtag, pre, code',
          ],
          dom,
        )) {
          a.remove();
        }

        // Remove links that contains text that starts with https?://
        for (const a of dom.querySelectorAll('a')) {
          const text = a.innerText.trim();
          if (text.startsWith('https://') || text.startsWith('http://')) {
            a.remove();
          }
        }
      },
    });
  },
);

export function isTranslateble(
  content: string,
  emojis?: mastodon.v1.CustomEmoji[],
): boolean {
  return !!getHTMLTextForDetectLang(content, emojis);
}

export const SIZE_CLASS = {
  s: 'small',
  m: 'medium',
  l: 'large',
};

export const detectLang = pmem(
  async (text: string | null | undefined): Promise<string | null> => {
    text = text?.trim();

    // Ref: https://github.com/komodojp/tinyld/blob/develop/docs/benchmark.md
    // 500 should be enough for now, also the default max chars for Mastodon
    if ((text?.length ?? 0) > 500) {
      return null;
    }

    if (langDetector) {
      const langs = await langDetector.detect(text as string);
      const lang = langs[0];
      if (
        lang?.detectedLanguage &&
        lang?.confidence !== undefined &&
        lang.confidence > 0.5
      ) {
        return lang.detectedLanguage;
      }
    }

    const { detectAll } = await import('tinyld/light');
    const langs = detectAll(text as string);
    const lang = langs[0];
    if (lang?.lang && lang?.accuracy > 0.5) {
      // If > 50% accurate, use it
      // It can be accurate if < 50% but better be safe
      // Though > 50% also can be inaccurate 🤷‍♂️
      return lang.lang;
    }
    return null;
  },
);

export const readMoreText = msg`Read more →`;

// All this work just to make sure this only lazy-run once
// Because first run is slow due to intl-localematcher
export const DIFFERENT_LANG_CHECK: Record<string, boolean> = {};
export const diffLangCheckCacheKey = (l: string, hls: string[]) =>
  `${l}:${hls.join('|')}`;
export const checkDifferentLanguage = (
  language: string | null | undefined,
  contentTranslationHideLanguages: string[] = [],
): boolean => {
  if (!language) return false;
  const cacheKey = diffLangCheckCacheKey(
    language,
    contentTranslationHideLanguages,
  );
  const targetLanguage = getTranslateTargetLanguage(true);
  const different =
    language !== targetLanguage &&
    !localeMatch([language], [targetLanguage]) &&
    !contentTranslationHideLanguages.find(
      (l: string) => language === l || localeMatch([language], [l]),
    );
  if (different) {
    DIFFERENT_LANG_CHECK[cacheKey] = true;
  }
  return different;
};
