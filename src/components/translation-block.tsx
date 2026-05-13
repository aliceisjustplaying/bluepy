import './translation-block.css';

import { Trans, useLingui } from '@lingui/react/macro';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import languages from '../data/translang-languages.json';
import {
  translate as browserTranslate,
  supportsBrowserTranslator,
  type TranslateResult as BrowserTranslateResult,
} from '../utils/browser-translator';
import getTranslateTargetLanguage from '../utils/get-translate-target-language';
import localeCode2Text from '../utils/localeCode2Text';
import pmem from '../utils/pmem';

import Icon from './icon';
import LazyShazam from './lazy-shazam';
import Loader from './loader';

interface TranslangResult {
  provider: 'translang';
  content?: string;
  detectedSourceLanguage?: string;
  pronunciation?: string;
}

interface TranslateInvocation {
  text: string;
  source?: string;
  target?: string;
  signal?: AbortSignal;
}

const sourceLanguages = Object.entries(
  (languages as { sl: Record<string, string> }).sl,
).map(([code, name]) => ({
  code,
  name,
}));

const { PHANPY_TRANSLANG_INSTANCES } = import.meta.env as {
  PHANPY_TRANSLANG_INSTANCES?: string;
};
const TRANSLANG_INSTANCES: string[] = PHANPY_TRANSLANG_INSTANCES
  ? PHANPY_TRANSLANG_INSTANCES.split(/\s+/)
  : [];

const translationQueue = new PQueue({
  concurrency: 1,
  interval: 2000,
  intervalCap: 1,
});

const TRANSLATED_MAX_AGE = 1000 * 60 * 60; // 1 hour
let currentTranslangInstance = 0;

function _translangTranslate(
  text: string,
  source: string,
  target: string,
): Promise<TranslangResult> {
  console.log('TRANSLATE', text, source, target);
  const fetchCall = () => {
    let instance = TRANSLANG_INSTANCES[currentTranslangInstance];
    const tooLong = text.length > 2000;
    let fetchPromise;
    if (tooLong) {
      // POST
      fetchPromise = fetch(`https://${instance}/api/v1/translate`, {
        method: 'POST',
        priority: 'low',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sl: source,
          tl: target,
          text,
        }),
      });
    } else {
      // GET
      fetchPromise = fetch(
        `https://${instance}/api/v1/translate?sl=${encodeURIComponent(
          source,
        )}&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}`,
        {
          priority: 'low',
          referrerPolicy: 'no-referrer',
        },
      );
    }
    return fetchPromise
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<{
          translated_text?: string;
          detected_language?: string;
          pronunciation?: string;
        }>;
      })
      .then((res): TranslangResult => {
        return {
          provider: 'translang',
          content: res.translated_text,
          detectedSourceLanguage: res.detected_language,
          pronunciation: res.pronunciation,
        };
      });
  };
  return pRetry(fetchCall, {
    retries: 3,
    onFailedAttempt: () => {
      currentTranslangInstance =
        (currentTranslangInstance + 1) % TRANSLANG_INSTANCES.length;
      console.log(
        'Retrying translation with another instance',
        currentTranslangInstance,
      );
    },
  });
}
const translangTranslate = pmem(_translangTranslate, {
  expires: TRANSLATED_MAX_AGE,
});
const throttledTranslangTranslate = pmem(
  ({ signal, text, source, target }: TranslateInvocation) =>
    translationQueue.add(
      // Preserve JS pass-through: source/target may be undefined. The
      // converted translate helpers type these as `string`, so cast at the
      // boundary to match the original runtime behavior.
      () =>
        translangTranslate(text, source as string, target as string),
      {
        signal,
      },
    ) as Promise<TranslangResult | void>,
  {
    // I know, this is double-layered memoization
    expires: TRANSLATED_MAX_AGE,
  },
);

const throttledBrowserTranslate = ({
  text,
  source,
  target,
  signal,
}: TranslateInvocation): Promise<BrowserTranslateResult | void> =>
  translationQueue.add(
    () => browserTranslate(text, source as string, target as string),
    {
      signal,
    },
  );

type TranslationResult = TranslangResult | BrowserTranslateResult;

type OnTranslateFn = (
  params: TranslateInvocation,
) => Promise<TranslationResult | void>;

interface TranslationBlockProps {
  forceTranslate?: boolean;
  sourceLanguage?: string;
  onTranslate?: OnTranslateFn;
  text?: string;
  mini?: boolean;
  autoDetected?: boolean;
}

type UIState = 'default' | 'loading' | 'error';

function TranslationBlock({
  forceTranslate,
  sourceLanguage,
  onTranslate,
  text = '',
  mini,
  autoDetected,
}: TranslationBlockProps): ComponentChildren {
  const { t } = useLingui();
  const targetLangRaw = getTranslateTargetLanguage(true);
  const targetLang: string | undefined = targetLangRaw || undefined;
  const [uiState, setUIState] = useState<UIState>('default');
  const [pronunciationContent, setPronunciationContent] = useState<
    string | null
  >(null);
  const [translatedContent, setTranslatedContent] = useState<string | null>(
    null,
  );
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sourceLangText = sourceLanguage
    ? localeCode2Text(sourceLanguage)
    : null;
  const targetLangText = targetLang ? localeCode2Text(targetLang) : undefined;
  const apiSourceLang = useRef<string>('auto');

  if (!onTranslate) {
    onTranslate = async ({ text, source, target, signal }) => {
      if (supportsBrowserTranslator) {
        const result = await throttledBrowserTranslate({
          text,
          source,
          target,
          signal,
        });
        if (result && !result.error) {
          return result;
        }
      }
      return mini
        ? await throttledTranslangTranslate({ signal, text, source, target })
        : await translangTranslate(text, source as string, target as string);
    };
  }

  const translate = async () => {
    setUIState('loading');
    try {
      const result = await onTranslate!({
        text,
        source: apiSourceLang.current,
        target: targetLang,
        signal: abortControllerRef.current?.signal,
      });
      const { content, detectedSourceLanguage, provider } = (result ??
        {}) as Partial<TranslationResult>;
      const error =
        result && 'error' in result ? result.error : undefined;
      const pronunciation =
        result && 'pronunciation' in result ? result.pronunciation : undefined;
      if (content) {
        if (detectedSourceLanguage) {
          const detectedLangText = localeCode2Text(detectedSourceLanguage);
          setDetectedLang(detectedLangText ?? null);
        }
        if (provider === 'translang') {
          if (pronunciation) {
            setPronunciationContent(pronunciation);
          }
        }
        setTranslatedContent(content);
        setUIState('default');
        if (!mini && content.trim() !== text.trim() && detailsRef.current) {
          detailsRef.current.open = true;
          detailsRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }
      } else {
        if (error) console.error(error);
        setUIState('error');
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        console.error(e);
        setUIState('error');
      }
    }
  };

  useEffect(() => {
    if (forceTranslate) {
      translate();
    }
  }, [forceTranslate]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (mini) {
    if (
      !!translatedContent &&
      translatedContent.trim() !== text.trim() &&
      detectedLang !== targetLangText
    ) {
      return (
        <LazyShazam>
          <div class="status-translation-block-mini">
            <Icon
              icon="translate"
              alt={t`Auto-translated from ${sourceLangText ?? ''}`}
            />
            <output
              lang={targetLang}
              dir="auto"
              title={pronunciationContent || ''}
            >
              {translatedContent}
            </output>
          </div>
        </LazyShazam>
      );
    }
    return null;
  }

  return (
    <div
      class="status-translation-block"
      onClick={(e) => {
        e.preventDefault();
      }}
    >
      <details ref={detailsRef}>
        <summary>
          <button
            type="button"
            class={uiState === 'loading' ? 'loading-mask' : ''}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (detailsRef.current) {
                detailsRef.current.open = !detailsRef.current.open;
              }
              if (uiState === 'loading') return;
              if (!translatedContent) translate();
            }}
          >
            <Icon icon="translate" />{' '}
            <span>
              {uiState === 'loading'
                ? t`Translating…`
                : sourceLanguage && sourceLangText && !detectedLang
                  ? autoDetected
                    ? t`Translate from ${sourceLangText} (auto-detected)`
                    : t`Translate from ${sourceLangText}`
                  : t`Translate`}
            </span>
          </button>
        </summary>
        <div class="translated-block">
          <div class="translation-info insignificant">
            <select
              class="translated-source-select"
              disabled={uiState === 'loading'}
              onChange={(e) => {
                apiSourceLang.current = (e.currentTarget as HTMLSelectElement)
                  .value;
                translate();
              }}
            >
              {sourceLanguages.map((l) => {
                const common = localeCode2Text({
                  code: l.code,
                  fallback: l.name,
                });
                const native = localeCode2Text({
                  code: l.code,
                  locale: l.code,
                });
                const showCommon = native && common !== native;
                return (
                  <option value={l.code}>
                    {l.code === 'auto'
                      ? t`Auto (${detectedLang ?? '…'})`
                      : showCommon
                        ? `${native} - ${common}`
                        : common}
                  </option>
                );
              })}
            </select>{' '}
            <span>→ {targetLangText}</span>
            <Loader abrupt hidden={uiState !== 'loading'} />
          </div>
          {uiState === 'error' ? (
            <p class="ui-state">
              <Trans>Failed to translate</Trans>
            </p>
          ) : (
            !!translatedContent && (
              <>
                <output
                  class="translated-content"
                  lang={targetLang}
                  dir="auto"
                >
                  {translatedContent}
                </output>
                {!!pronunciationContent && (
                  <output
                    class="translated-pronunciation-content"
                    tabIndex={-1}
                    onClick={(e) => {
                      (e.currentTarget as HTMLElement).classList.toggle(
                        'expand',
                      );
                    }}
                  >
                    {pronunciationContent}
                  </output>
                )}
              </>
            )
          )}
        </div>
      </details>
    </div>
  );
}

export default TRANSLANG_INSTANCES?.length ? TranslationBlock : () => null;
