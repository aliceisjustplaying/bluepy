import { Trans, useLingui } from '@lingui/react/macro';
import type {
  ComponentChildren,
  Ref,
  TargetedEvent,
  TargetedKeyboardEvent,
} from 'preact';
import { forwardRef } from 'preact/compat';
import { useImperativeHandle, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from 'react-router-dom';

import { api } from '../utils/api';
import { addToSearchHistory, getSearchHistory } from '../utils/search-history';

import Icon from './icon';
import Link from './link';

interface SearchItemData {
  label: ComponentChildren;
  to: string;
  icon: string;
}

interface SearchHistoryEntry {
  query: string;
  queryType: string | null;
  timestamp: number;
}

interface SearchSuggestionBase extends SearchItemData {
  queryType?: string | null;
  top?: boolean;
  hidden?: boolean;
  type?: string;
}

interface SearchSuggestionRecent extends SearchSuggestionBase {
  isRecentSearch: true;
  historyItem: SearchHistoryEntry;
}

interface SearchSuggestionFresh extends SearchSuggestionBase {
  isRecentSearch?: false;
  historyItem?: undefined;
}

type SearchSuggestionItem = SearchSuggestionRecent | SearchSuggestionFresh;

interface SearchFormHandle {
  setValue: (value: string) => void;
  focus: () => void;
  select: () => void;
  blur: () => void;
}

interface SearchFormProps {
  hidden?: boolean;
  onSubmit?: (e: Event) => void;
}

// Helper function to generate search item data (label and URL)
export const generateSearchItemData = (
  query: string,
  queryType: string | null | undefined,
  instance: string | undefined,
): SearchItemData => {
  let label: ComponentChildren;
  let to: string;
  let icon: string;

  if (queryType === 'statuses') {
    label = (
      <Trans>
        Posts with <q>{query}</q>
      </Trans>
    );
    to = `/search?q=${encodeURIComponent(query)}&type=statuses`;
    icon = 'document';
  } else if (queryType === 'accounts') {
    label = (
      <Trans>
        Accounts with <q>{query}</q>
      </Trans>
    );
    to = `/search?q=${encodeURIComponent(query)}&type=accounts`;
    icon = 'group';
  } else if (queryType === 'hashtags') {
    const [, hashSymbol = '#', hashtagText = query] = query.match(
      /^([#＃])?(.*)$/,
    ) as RegExpMatchArray;
    const hashtag = `${hashSymbol}${hashtagText}`;
    label = (
      <Trans>
        Posts tagged with <mark>{hashtag}</mark>
      </Trans>
    );
    to = `/${instance}/t/${hashtagText}`;
    icon = 'hashtag';
  } else {
    // Default/general search
    label = (
      <Trans>
        {query}{' '}
        <small class="insignificant">‒ accounts, hashtags &amp; posts</small>
      </Trans>
    );
    to = `/search?q=${encodeURIComponent(query)}`;
    icon = 'search';
  }

  return { label, to, icon };
};

const SearchForm = forwardRef(
  (props: SearchFormProps, ref: Ref<SearchFormHandle>) => {
    const { t } = useLingui();
    const { instance } = api();
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchMenuOpen, setSearchMenuOpen] = useState(false);
    const [query, setQuery] = useState(searchParams.get('q') || '');
    const type = searchParams.get('type');
    const formRef = useRef<HTMLFormElement | null>(null);

    const searchFieldRef = useRef<HTMLInputElement | null>(null);
    useImperativeHandle(ref, () => ({
      setValue: (value: string) => {
        setQuery(value);
      },
      focus: () => {
        searchFieldRef.current!.focus();
      },
      select: () => {
        searchFieldRef.current!.select();
      },
      blur: () => {
        searchFieldRef.current!.blur();
      },
    }));

    const searchHistory = useMemo(
      () => getSearchHistory({ limit: 5 }),
      [props?.hidden],
    );

    const searchSuggestionsData = useMemo(() => {
      if (!query) return [];

      const matchingHistory = searchHistory
        .filter((historyItem) => {
          // Filter out exact matches with current query
          if (historyItem.query === query) return false;
          // Check if history item contains the current query (case insensitive)
          return historyItem.query.toLowerCase().includes(query.toLowerCase());
        })
        .slice(0, 2); // Max 2 recent searches

      const recentSearchItems: SearchSuggestionRecent[] = matchingHistory.map(
        (historyItem): SearchSuggestionRecent => ({
          ...generateSearchItemData(
            historyItem.query,
            historyItem.queryType,
            instance,
          ),
          queryType: historyItem.queryType,
          isRecentSearch: true,
          historyItem,
        }),
      );

      const allItems: SearchSuggestionItem[] = [
        // General search
        {
          ...generateSearchItemData(query, null, instance),
          top: !type && !/\s/.test(query),
          hidden: !!type,
        },
        // Recent searches
        ...recentSearchItems,
        // Posts search
        {
          ...generateSearchItemData(query, 'statuses', instance),
          hidden: /^https?:/.test(query),
          top: /\s/.test(query),
          queryType: 'statuses',
        },
        // Hashtag search
        {
          ...generateSearchItemData(query, 'hashtags', instance),
          hidden:
            /^[@＠]/.test(query) || /^https?:/.test(query) || /\s/.test(query),
          top: /^[#＃]/.test(query),
          type: 'link',
          queryType: 'hashtags',
        },
        // URL lookup (unique case)
        {
          label: (
            <Trans>
              Look up <mark>{query}</mark>
            </Trans>
          ),
          to: `/${query}`,
          hidden: !/^https?:/.test(query),
          top: /^https?:/.test(query),
          type: 'link',
          icon: 'arrow-right',
        },
        // Accounts search
        {
          ...generateSearchItemData(query, 'accounts', instance),
          queryType: 'accounts',
        },
      ];

      return allItems
        .toSorted((a, b) => {
          if (type) {
            if (a.queryType === type) return -1;
            if (b.queryType === type) return 1;
          }
          if (a.top && !b.top) return -1;
          if (!a.top && b.top) return 1;
          return 0;
        })
        .filter(({ hidden }) => !hidden);
    }, [query, type, instance, searchHistory]);

    return (
      <form
        ref={formRef}
        class="search-popover-container"
        onSubmit={(e: TargetedEvent<HTMLFormElement>) => {
          e.preventDefault();

          const isSearchPage = /\/search/.test(location.hash);
          if (isSearchPage) {
            if (query) {
              const params: { q: string; type?: string } = {
                q: query,
              };
              if (type) params.type = type; // Preserve type
              setSearchParams(params);
            } else {
              setSearchParams({});
            }
          } else {
            if (query) {
              location.hash = `/search?q=${encodeURIComponent(query)}${
                type ? `&type=${type}` : ''
              }`;
            } else {
              location.hash = `/search`;
            }
          }

          addToSearchHistory(query, type);

          props?.onSubmit?.(e);
        }}
      >
        <input
          ref={searchFieldRef}
          value={query}
          name="q"
          type="search"
          // autofocus
          placeholder={t`Search`}
          dir="auto"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck={false}
          enterKeyHint="search"
          onSearch={(e: TargetedEvent<HTMLInputElement>) => {
            if (!e.currentTarget.value) {
              setSearchParams({});
            }
          }}
          onInput={(e: TargetedEvent<HTMLInputElement>) => {
            setQuery(e.currentTarget.value);
            setSearchMenuOpen(true);
          }}
          onFocus={() => {
            setSearchMenuOpen(true);
            // Focus first item
            const firstItem = formRef.current?.querySelector(
              '.search-popover-item',
            );
            if (firstItem) {
              firstItem.classList.add('focus');
            }
          }}
          onBlur={() => {
            setTimeout(() => {
              setSearchMenuOpen(false);
            }, 100);
            formRef.current
              ?.querySelector('.search-popover-item.focus')
              ?.classList.remove('focus');
          }}
          onKeyDown={(e: TargetedKeyboardEvent<HTMLInputElement>) => {
            const { key } = e;
            switch (key) {
              case 'Escape':
                setSearchMenuOpen(false);
                break;
              case 'Down':
              case 'ArrowDown':
                e.preventDefault();
                if (searchMenuOpen) {
                  const focusItem = formRef.current?.querySelector(
                    '.search-popover-item.focus',
                  );
                  if (focusItem) {
                    let nextItem: Element | null = focusItem.nextElementSibling;
                    while (nextItem && (nextItem as HTMLElement).hidden) {
                      nextItem = nextItem.nextElementSibling;
                    }
                    if (nextItem) {
                      nextItem.classList.add('focus');
                      const parent = nextItem.parentElement;
                      if (parent) {
                        const siblings = Array.from(parent.children).filter(
                          (el) => el !== nextItem,
                        );
                        siblings.forEach((el) => {
                          el.classList.remove('focus');
                        });
                      }
                    }
                  } else {
                    const firstItem = formRef.current?.querySelector(
                      '.search-popover-item',
                    );
                    if (firstItem) {
                      firstItem.classList.add('focus');
                    }
                  }
                }
                break;
              case 'Up':
              case 'ArrowUp':
                e.preventDefault();
                if (searchMenuOpen) {
                  const focusItem = document.querySelector(
                    '.search-popover-item.focus',
                  );
                  if (focusItem) {
                    let prevItem: Element | null =
                      focusItem.previousElementSibling;
                    while (prevItem && (prevItem as HTMLElement).hidden) {
                      prevItem = prevItem.previousElementSibling;
                    }
                    if (prevItem) {
                      prevItem.classList.add('focus');
                      const parent = prevItem.parentElement;
                      if (parent) {
                        const siblings = Array.from(parent.children).filter(
                          (el) => el !== prevItem,
                        );
                        siblings.forEach((el) => {
                          el.classList.remove('focus');
                        });
                      }
                    }
                  } else {
                    const items = document.querySelectorAll(
                      '.search-popover-item',
                    );
                    const lastItem = items[items.length - 1];
                    if (lastItem) {
                      lastItem.classList.add('focus');
                    }
                  }
                }
                break;
              case 'Enter':
                if (searchMenuOpen) {
                  const focusItem = document.querySelector(
                    '.search-popover-item.focus',
                  );
                  if (focusItem) {
                    e.preventDefault();
                    (focusItem as HTMLElement).click();
                  }
                  setSearchMenuOpen(false);
                  props?.onSubmit?.(e);
                }
                break;
            }
          }}
        />
        <div class="search-popover" hidden={!searchMenuOpen}>
          {/* Search History - show when no query */}
          {!query && searchHistory.length > 0 && (
            <div class="search-popover-recent-searches">
              <div class="search-popover-header">
                <Icon icon="history" size="s" />
                <Trans>Recent searches</Trans>
              </div>
              {searchHistory.map((historyItem, i) => {
                const { label, to, icon } = generateSearchItemData(
                  historyItem.query,
                  historyItem.queryType,
                  instance,
                );

                return (
                  <Link
                    key={`${historyItem.query}-${historyItem.queryType}-${historyItem.timestamp}`}
                    to={to}
                    class={`search-popover-item ${i === 0 ? 'focus' : ''}`}
                    onClick={(e: Event) => {
                      addToSearchHistory(
                        historyItem.query,
                        historyItem.queryType,
                      );
                      props?.onSubmit?.(e);
                    }}
                  >
                    <Icon icon={icon} class="more-insignificant" />
                    <span>{label}</span>
                  </Link>
                );
              })}
              <Link
                to="/search"
                class="search-popover-item search-history-see-all"
              >
                <Icon icon="more2" class="more-insignificant" />
                <span>
                  <Trans>See all</Trans>
                </span>
              </Link>
            </div>
          )}

          {/* Search Suggestions - show when there's a query */}
          {searchSuggestionsData.map(
            (
              { label, to, icon, queryType, isRecentSearch, historyItem },
              i,
            ) => (
              <Link
                key={
                  isRecentSearch && historyItem
                    ? `recent-${historyItem.query}-${historyItem.queryType}-${historyItem.timestamp}`
                    : `suggestion-${queryType || 'general'}-${i}`
                }
                to={to}
                class={`search-popover-item ${isRecentSearch ? 'search-popover-item-recent' : ''} ${i === 0 ? 'focus' : ''}`}
                onClick={(e: Event) => {
                  if (!isRecentSearch) {
                    addToSearchHistory(query, queryType);
                  }
                  props?.onSubmit?.(e);
                }}
              >
                <Icon icon={icon} class="more-insignificant" />
                <span>{label}</span>
              </Link>
            ),
          )}
        </div>
      </form>
    );
  },
);

export default SearchForm;
