import './custom-emojis-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type Fuse from 'fuse.js';
import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';

import getCustomEmojis from '../utils/custom-emojis';
import store from '../utils/store';

import Icon from './icon';
import Loader from './loader';

const CUSTOM_EMOJIS_COUNT = 100;
const EMOJI_SIZE_MIN = 1;
const EMOJI_SIZE_MAX = 2;
const EMOJI_SIZE_STEP = 0.5;

interface CustomEmoji {
  shortcode: string;
  url?: string;
  staticUrl?: string;
  category?: string;
  visibleInPicker?: boolean;
  [key: string]: unknown;
}

interface CustomEmojiButtonProps {
  emoji: CustomEmoji;
  onSelect: (shortcode: string) => void;
  showCode?: boolean;
}

const CustomEmojiButton = memo(
  ({ emoji, onSelect, showCode }: CustomEmojiButtonProps) => {
    const addEdges = (e: JSX.TargetedEvent<HTMLButtonElement>) => {
      // Add edge-left or edge-right class based on self position relative to scrollable parent
      // If near left edge, add edge-left, if near right edge, add edge-right
      const buffer = 88;
      const parent = e.currentTarget.closest('main');
      if (parent) {
        const rect = parent.getBoundingClientRect();
        const selfRect = e.currentTarget.getBoundingClientRect();
        const targetClassList = e.currentTarget.classList;
        if (selfRect.left < rect.left + buffer) {
          targetClassList.add('edge-left');
          targetClassList.remove('edge-right');
        } else if (selfRect.right > rect.right - buffer) {
          targetClassList.add('edge-right');
          targetClassList.remove('edge-left');
        } else {
          targetClassList.remove('edge-left', 'edge-right');
        }
      }
    };

    const handleClick = useCallback(() => {
      onSelect(`:${emoji.shortcode}:`);
    }, [onSelect, emoji.shortcode]);

    return (
      <button
        type="button"
        className="plain4"
        onClick={handleClick}
        data-title={showCode ? undefined : emoji.shortcode}
        onPointerEnter={addEdges}
        onFocus={addEdges}
      >
        <picture>
          {!!emoji.staticUrl && (
            <source
              srcSet={emoji.staticUrl}
              media="(prefers-reduced-motion: reduce)"
            />
          )}
          <img
            className="shortcode-emoji"
            src={emoji.url || emoji.staticUrl}
            alt={emoji.shortcode}
            width="24"
            height="24"
            loading="lazy"
            decoding="async"
          />
        </picture>
        {showCode && (
          <>
            {' '}
            <code>{emoji.shortcode}</code>
          </>
        )}
      </button>
    );
  },
);

interface CustomEmojisListProps {
  emojis: CustomEmoji[];
  onSelect: (shortcode: string) => void;
}

const CustomEmojisList = memo(({ emojis, onSelect }: CustomEmojisListProps) => {
  const { i18n } = useLingui();
  const [max, setMax] = useState(CUSTOM_EMOJIS_COUNT);
  const showMore = emojis.length > max;
  return (
    <section>
      {emojis.slice(0, max).map((emoji) => (
        <CustomEmojiButton
          key={emoji.shortcode}
          emoji={emoji}
          onSelect={onSelect}
        />
      ))}
      {showMore && (
        <button
          type="button"
          class="plain small"
          onClick={() => setMax(max + CUSTOM_EMOJIS_COUNT)}
        >
          <Trans>{i18n.number(emojis.length - max)} more…</Trans>
        </button>
      )}
    </section>
  );
});

const CUSTOM_EMOJI_SIZE = 'composer-customEmojiSize';

interface CustomEmojisModalProps {
  instance?: string;
  onClose?: () => void;
  onSelect?: (shortcode: string) => void;
  defaultSearchTerm?: string;
}

function CustomEmojisModal({
  instance: propInstance,
  onClose = () => {},
  onSelect = () => {},
  defaultSearchTerm,
}: CustomEmojisModalProps) {
  const { t } = useLingui();
  const [uiState, setUIState] = useState('default');
  const customEmojisList = useRef<CustomEmoji[]>([]);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [customInstance, setCustomInstance] = useState<string | null>(null);
  const instance = customInstance || propInstance;

  // JS original passed no deps to useMemo (re-evaluated each render); preserve
  // exact semantics by passing `undefined`. Fix the deps as a follow-up.
  const recentlyUsedCustomEmojis = useMemo<CustomEmoji[]>(
    () =>
      (store.account.get('recentlyUsedCustomEmojis') as
        | CustomEmoji[]
        | null
        | undefined) || [],
    undefined,
  );
  const searcherRef = useRef<Fuse<CustomEmoji> | null>(null);
  useEffect(() => {
    setUIState('loading');
    (async () => {
      try {
        const [emojis, searcher] = await getCustomEmojis(instance as string);
        console.log('emojis', emojis);
        searcherRef.current = searcher;
        setCustomEmojis(emojis);
        setUIState('default');
      } catch (e) {
        setUIState('error');
        console.error(e);
      }
    })();
  }, [instance]);

  const customEmojisCatList = useMemo(() => {
    const shortcodeSet = new Set(customEmojis.map((e) => e.shortcode));
    const categoryMap = new Map<string, CustomEmoji[]>();
    const othersCat: CustomEmoji[] = [];
    customEmojis.forEach((emoji) => {
      customEmojisList.current?.push?.(emoji);
      if (!emoji.category) {
        othersCat.push(emoji);
        return;
      }
      if (!categoryMap.has(emoji.category)) {
        categoryMap.set(emoji.category, []);
      }
      categoryMap.get(emoji.category)?.push(emoji);
    });
    const emojisCat: Record<string, CustomEmoji[]> = {
      '--recent--': recentlyUsedCustomEmojis.filter((emoji) =>
        shortcodeSet.has(emoji.shortcode),
      ),
    };
    if (othersCat.length) {
      emojisCat['--others--'] = othersCat;
    }
    for (const [category, list] of categoryMap) {
      emojisCat[category] = list;
    }
    return emojisCat;
  }, [customEmojis]);

  const scrollableRef = useRef<HTMLElement | null>(null);
  const [matches, setMatches] = useState<CustomEmoji[] | null>(null);
  const [emojiSize, setEmojiSize] = useState(() => {
    const stored = Number(store.local.get(CUSTOM_EMOJI_SIZE));
    return stored && stored >= EMOJI_SIZE_MIN ? stored : EMOJI_SIZE_MIN;
  });
  const onEmojiSizeDecrease = useCallback(() => {
    const newSize = Math.max(EMOJI_SIZE_MIN, emojiSize - EMOJI_SIZE_STEP);
    setEmojiSize(newSize);
    if (newSize === EMOJI_SIZE_MIN) {
      store.local.del(CUSTOM_EMOJI_SIZE);
    } else {
      store.local.set(CUSTOM_EMOJI_SIZE, newSize as unknown as string);
    }
  }, [emojiSize]);

  const onEmojiSizeIncrease = useCallback(() => {
    const newSize = Math.min(EMOJI_SIZE_MAX, emojiSize + EMOJI_SIZE_STEP);
    setEmojiSize(newSize);
    if (newSize === EMOJI_SIZE_MIN) {
      store.local.del(CUSTOM_EMOJI_SIZE);
    } else {
      store.local.set(CUSTOM_EMOJI_SIZE, newSize as unknown as string);
    }
  }, [emojiSize]);

  const onFind = useCallback(
    (e: { target: EventTarget | null } | { target: { value: string } }) => {
      const { value } = (e as { target: { value: string } }).target;
      if (value) {
        const results = searcherRef.current?.search(value, {
          limit: CUSTOM_EMOJIS_COUNT,
        });
        // Original assumed `results` non-null; preserve via non-null assertion
        setMatches((results as { item: CustomEmoji }[]).map((r) => r.item));
        scrollableRef.current?.scrollTo?.(0, 0);
      } else {
        setMatches(null);
      }
    },
    [customEmojis],
  );
  useEffect(() => {
    if (defaultSearchTerm && customEmojis?.length) {
      onFind({ target: { value: defaultSearchTerm } });
    }
  }, [defaultSearchTerm, onFind, customEmojis]);

  // Note: in the JS original this is called with the formatted shortcode
  // string `:foo:` (from CustomEmojiButton) and the recent-used path reads
  // `emoji.shortcode` — which is undefined on a string. Keeping the same
  // semantics here; the cast preserves the original (buggy) behavior rather
  // than fixing it as a drive-by.
  const onSelectEmoji = useCallback(
    (emoji: string) => {
      onSelect?.(emoji);
      onClose?.();

      queueMicrotask(() => {
        let recentlyUsedCustomEmojis =
          (store.account.get('recentlyUsedCustomEmojis') as
            | CustomEmoji[]
            | null
            | undefined) || [];
        const emojiAsObj = emoji as unknown as CustomEmoji;
        const recentlyUsedEmojiIndex = recentlyUsedCustomEmojis.findIndex(
          (e) => e.shortcode === emojiAsObj.shortcode,
        );
        if (recentlyUsedEmojiIndex !== -1) {
          // Move emoji to index 0
          recentlyUsedCustomEmojis.splice(recentlyUsedEmojiIndex, 1);
          recentlyUsedCustomEmojis.unshift(emojiAsObj);
        } else {
          recentlyUsedCustomEmojis.unshift(emojiAsObj);
          // Remove unavailable ones
          recentlyUsedCustomEmojis = recentlyUsedCustomEmojis.filter((e) =>
            customEmojisList.current?.find?.(
              (other) => other.shortcode === e.shortcode,
            ),
          );
          // Limit to 10
          recentlyUsedCustomEmojis = recentlyUsedCustomEmojis.slice(0, 10);
        }

        // Store back
        store.account.set('recentlyUsedCustomEmojis', recentlyUsedCustomEmojis);
      });
    },
    [onSelect],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Put cursor at the end
      if (inputRef.current.value) {
        inputRef.current.selectionStart = inputRef.current.value.length;
        inputRef.current.selectionEnd = inputRef.current.value.length;
      }
    }
  }, []);

  const hasCustomEmojis = !!customEmojis?.length;

  return (
    <div
      id="custom-emojis-sheet"
      class="sheet"
      style={{
        '--custom-emoji-size': emojiSize,
      }}
    >
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <div>
          <b>
            <Trans>Custom emojis</Trans>
          </b>{' '}
          {uiState === 'loading' ? (
            <Loader />
          ) : (
            <small class="insignificant">
              {' '}
              •{' '}
              {import.meta.env.DEV ? (
                <button
                  type="button"
                  class="textual"
                  onClick={() => {
                    const newInstance = prompt(
                      '[DEV] Change instance. Leave blank to reset',
                      instance,
                    );
                    if (newInstance && newInstance.trim()) {
                      setCustomInstance(newInstance.trim());
                    } else {
                      setCustomInstance(null);
                    }
                  }}
                >
                  {instance}
                </button>
              ) : (
                instance
              )}
            </small>
          )}
        </div>
        {hasCustomEmojis && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Original used `matches[0]` unchecked, which throws when
              // `matches` is null; preserve that exact behavior here.
              const emoji = (matches as unknown as CustomEmoji[])[0];
              if (emoji) {
                onSelectEmoji(`:${emoji.shortcode}:`);
              }
            }}
          >
            <input
              ref={inputRef}
              type="search"
              placeholder={t`Search emoji`}
              onInput={onFind}
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              dir="auto"
              enterKeyHint="search"
              defaultValue={defaultSearchTerm || ''}
            />
          </form>
        )}
      </header>
      <main ref={scrollableRef}>
        {hasCustomEmojis ? (
          <>
            {matches !== null ? (
              <ul class="custom-emojis-matches custom-emojis-list">
                {matches.map((emoji) => (
                  <li key={emoji.shortcode} class="custom-emojis-match">
                    <CustomEmojiButton
                      emoji={emoji}
                      onSelect={onSelectEmoji}
                      showCode
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div class="custom-emojis-list">
                {uiState === 'error' && (
                  <div class="ui-state">
                    <p>
                      <Trans>Error loading custom emojis</Trans>
                    </p>
                  </div>
                )}
                {uiState === 'default' &&
                  Object.entries(customEmojisCatList).map(
                    ([category, emojis]) =>
                      !!emojis?.length && (
                        <div class="section-container">
                          <div class="section-header">
                            {{
                              '--recent--': t`Recently used`,
                              '--others--': t`Others`,
                            }[category] || category}
                          </div>
                          <CustomEmojisList
                            emojis={emojis}
                            onSelect={onSelectEmoji}
                          />
                        </div>
                      ),
                  )}
              </div>
            )}
            <div class="size-range">
              <button
                type="button"
                class="plain4"
                onClick={onEmojiSizeDecrease}
                disabled={emojiSize <= EMOJI_SIZE_MIN}
              >
                <Icon icon="zoom-out" size="l" alt={t`Zoom out`} />
              </button>
              <button
                type="button"
                class="plain4"
                onClick={onEmojiSizeIncrease}
                disabled={emojiSize >= EMOJI_SIZE_MAX}
              >
                <Icon icon="zoom-in" size="l" alt={t`Zoom in`} />
              </button>
            </div>
          </>
        ) : (
          <div class="ui-state">
            <p>
              <Trans>Custom emojis are not available on this server.</Trans>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default CustomEmojisModal;
