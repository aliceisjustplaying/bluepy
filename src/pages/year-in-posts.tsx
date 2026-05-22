import './year-in-posts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import { Document as FlexSearchIndexDocument } from 'flexsearch';
import type { mastodon } from 'masto';
import type { Ref } from 'react';
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSearchParams } from 'react-router-dom';
import { useThrottledCallback } from 'use-debounce';

import yearInPostsUrl from '../assets/features/year-in-posts.png';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import MenuConfirm from '../components/menu-confirm';
import Menu2 from '../components/menu2';
import NavMenu from '../components/nav-menu';
import StatusComponent, {
  type StatusComponentProps,
} from '../components/status';
import { api } from '../utils/api';
import DateTimeFormat from '../utils/date-time-format';
import db from '../utils/db';
import getHTMLText from '../utils/get-html-text';
import niceDateTime from '../utils/nice-date-time';
import prettyBytes from '../utils/pretty-bytes';
import showToast from '../utils/show-toast';
import { sorted as sortArray } from '../utils/sorted';
import { getCurrentAccountNS } from '../utils/store-utils';
import useTitle from '../utils/useTitle';
import {
  type AvailableYear,
  fetchYearPosts,
  loadAvailableYears,
  removeYear,
  type YearInPostsRecord,
} from '../utils/year-in-posts';

type MastoStatus = mastodon.v1.Status;

type StatusWithExtras = MastoStatus & {
  quote?: { id?: string; quotedStatus?: { id?: string } } | null;
};

type StatusWithQuotes = MastoStatus & {
  quotesCount?: number;
};

interface DayCounts {
  total: number;
  original: number;
  reply: number;
  quote: number;
  boost: number;
}

interface HeatmapDay {
  day: number | null;
  count: number;
  ratio: number;
  original: number;
  reply: number;
  quote: number;
  boost: number;
}

interface MediaGridCell {
  post?: MastoStatus;
  hasMedia: boolean;
}

type MediaGridItem = MediaGridCell | null;

interface MonthTypeCounts {
  original: number;
  reply: number;
  quote: number;
  boost: number;
}

interface MonthWithPosts {
  month: number;
  count: number;
  heatmap: HeatmapDay[];
  mediaGrid: MediaGridItem[];
  original: number;
  reply: number;
  quote: number;
  boost: number;
}

function Status(props: {
  status?: unknown;
  instance?: string;
  size?: string;
  showCommentCount?: boolean;
  showQuoteCount?: boolean;
  [key: string]: unknown;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}

const MIN_YEAR = 2005; // https://en.wikipedia.org/wiki/Microblogging#Origin

function getDefaultYear(): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  // Buffer 30 days before default showing current year
  if (currentMonth === 0 && currentDay <= 30) {
    return currentYear - 1;
  }

  return currentYear;
}

function formatTimezoneOffset(offset: number): string {
  // offset is in minutes, negative for east of UTC
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  return `UTC${sign}${hours}${minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

function getCurrentTimezoneOffset(): number {
  return new Date().getTimezoneOffset();
}

type FilterKey = 'all' | 'original' | 'replies' | 'quotes' | 'boosts' | 'media';

const FILTER_KEYS: Record<FilterKey, string> = {
  all: 'All',
  original: 'Original',
  replies: 'Replies',
  quotes: 'Quotes',
  boosts: 'Reposts',
  media: 'Media',
};

type SortKey =
  | 'relevance'
  | 'createdAt'
  | 'repliesCount'
  | 'favouritesCount'
  | 'reblogsCount';

interface SortOption {
  key: SortKey;
  condition?: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'relevance', condition: 'searchQuery' },
  { key: 'createdAt' },
  { key: 'repliesCount' },
  { key: 'favouritesCount' },
  { key: 'reblogsCount' },
];

function getMonthName(
  month: number,
  locale?: string,
  format: Intl.DateTimeFormatOptions['month'] = 'short',
): string {
  const date = new Date(2000, month, 1);
  return DateTimeFormat(locale as string, { month: format }).format(date);
}

function getYear(year: string | number | null | undefined): number | null {
  const parsed = parseInt(year as string, 10);
  return parsed >= MIN_YEAR && parsed <= new Date().getFullYear()
    ? parsed
    : null;
}

function getMonth(month: string | number | null | undefined): number | null {
  const parsed = parseInt(month as string, 10);
  return parsed >= 0 && parsed <= 11 ? parsed : null;
}

const SEARCH_RESULT_PAGE_SIZE = 30;

type UIState =
  | 'default'
  | 'loading'
  | 'generating'
  | 'results'
  | 'no-data'
  | 'error';

type SortOrder = 'asc' | 'desc';

interface SearchFieldHandle {
  focus: () => void;
  setValue: (val: string) => void;
  isFocused: () => boolean;
}

function YearInPosts() {
  const { i18n, t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get('year');
  const monthParam = searchParams.get('month');
  const [postType, setPostType] = useState<FilterKey>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const year = getYear(yearParam);
  const month = getMonth(monthParam);

  useTitle(
    searchQuery
      ? `Year in Posts ${year} - Search: ${searchQuery}`
      : year
        ? month !== null
          ? `Year in Posts ${year} - ${getMonthName(month, i18n.locale)}`
          : `Year in Posts ${year}`
        : 'Year in Posts',
    '/yip',
  );

  const { instance } = api();
  const [uiState, setUIState] = useState<UIState>('default');
  const [posts, setPosts] = useState<MastoStatus[]>([]);
  const [availableYears, setAvailableYears] = useState<AvailableYear[]>([]);
  const [searchEnabled] = useState<boolean>(true);
  const [showSearchField, setShowSearchField] =
    useState<boolean>(!!searchQuery);
  const [searchLimit, setSearchLimit] = useState<number>(
    SEARCH_RESULT_PAGE_SIZE,
  );
  const [sortBy, setSortBy] = useState<SortKey>(
    searchQuery ? 'relevance' : 'createdAt',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const searchFieldRef = useRef<SearchFieldHandle | null>(null);
  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const NS = useMemo(() => getCurrentAccountNS(), []);

  // Intercept slash key to focus search field on this page
  useHotkeys(
    ['Slash', '/'],
    () => {
      if (!showSearchField) {
        setShowSearchField(true);
        setTimeout(() => {
          searchFieldRef.current?.focus();
        }, 100);
      } else {
        // If search field is already shown, just focus it
        searchFieldRef.current?.focus();
      }
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) => {
        const hasModal = !!document.querySelector('#modal-container > *');
        const target = e.target as HTMLElement | null;
        const isInput = ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '');
        // Allow '/' even with Shift (e.g. German keyboards)
        if (e.key === '/') return false;
        return (
          hasModal ||
          isInput ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey
        );
      },
    },
  );

  const totalPosts = posts.length;

  useEffect(() => {
    if (!searchQuery) {
      // Only hide search field if it's not focused
      const isSearchFieldFocused = searchFieldRef.current?.isFocused();
      if (!isSearchFieldFocused) {
        setShowSearchField(false);
      }
    }
  }, [searchQuery, monthParam, postType, sortBy, sortOrder]);

  function loadYears() {
    const years = loadAvailableYears();
    setAvailableYears(years);
  }

  useEffect(() => {
    if (year) return;
    loadYears();
  }, [year]);

  const handleGenerate = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const yearInput = form.elements.namedItem('year');
    if (!(yearInput instanceof HTMLInputElement)) return;
    const generateYear = getYear(yearInput.value);
    if (generateYear) {
      try {
        const dataId = `${NS}-${generateYear}`;
        const existingData = (await db.yearInPosts.get(dataId)) as
          | YearInPostsRecord
          | undefined;

        if (existingData && existingData.year === generateYear) {
          // Year already generated, go straight to year view
          setSearchParams({ year: String(generateYear) });
        } else {
          // Year not generated, show generating UI and fetch data
          setUIState('generating');
          await fetchYearPosts(generateYear);
          setSearchParams({ year: String(generateYear) });
        }
      } catch (error) {
        setUIState('error');
        console.error('Failed to generate year posts:', error);
        showToast('Unable to generate year posts. Please try again.');
      } finally {
        if (uiState === 'generating') {
          setUIState('default');
        }
      }
    } else {
      showToast('Invalid year.');
    }
  };

  async function handleRegenerate(yearToRegen: number) {
    try {
      setUIState('generating');
      await fetchYearPosts(yearToRegen);
      setSearchParams({ year: String(yearToRegen) });
    } catch {
      setUIState('error');
      // Preserve original JS behavior: the pre-conversion source referenced
      // an undeclared identifier `error` here, which throws ReferenceError
      // before showToast runs. Reproduce that exact runtime behavior.
      const undeclared: { readonly error: unknown } = {
        get error(): unknown {
          throw new ReferenceError('error is not defined');
        },
      };
      console.error('Failed to regenerate year posts:', undeclared.error);
      showToast('Unable to regenerate year posts. Please try again.');
    } finally {
      if (uiState === 'generating') {
        setUIState('default');
      }
    }
  }

  async function handleRemoveYear(yearToRemove: number) {
    if (!confirm(`Remove year ${yearToRemove} posts?`)) return;
    try {
      await removeYear(yearToRemove);
      setAvailableYears((years) =>
        years.filter((y) => y.year !== yearToRemove),
      );
    } catch (e) {
      console.error(e);
      alert('Failed to remove year data');
    }
  }

  const monthHeatmaps = useMemo(() => {
    const heatmaps: Record<number, Record<number, DayCounts>> = {};
    posts.forEach((post) => {
      const date = new Date(post.createdAt);
      const m = date.getMonth();
      const day = date.getDate();
      if (!heatmaps[m]) {
        heatmaps[m] = {};
      }
      if (!heatmaps[m][day]) {
        heatmaps[m][day] = {
          total: 0,
          original: 0,
          reply: 0,
          quote: 0,
          boost: 0,
        };
      }

      // Categorize post type
      const dayData = heatmaps[m][day];
      dayData.total++;

      const p = post as StatusWithExtras;
      if (p.reblog) {
        dayData.boost++;
      } else if (p.quote?.id || p.quote?.quotedStatus?.id) {
        dayData.quote++;
      } else if (p.inReplyToId) {
        dayData.reply++;
      } else {
        dayData.original++;
      }
    });

    const result: Record<string, HeatmapDay[]> = {};
    Object.keys(heatmaps).forEach((mKey) => {
      const days = heatmaps[Number(mKey)];
      const maxCount = Math.max(...Object.values(days).map((d) => d.total));

      const firstDayOfMonth = new Date(year ?? 0, parseInt(mKey), 1);
      const firstDayOfWeek = firstDayOfMonth.getDay();

      const calendar: HeatmapDay[] = [];

      for (let i = 0; i < firstDayOfWeek; i++) {
        calendar.push({
          day: null,
          count: 0,
          ratio: 0,
          original: 0,
          reply: 0,
          quote: 0,
          boost: 0,
        });
      }

      for (let day = 1; day <= 31; day++) {
        const dayData = days[day];
        const count = dayData?.total || 0;
        const ratio = count && maxCount > 0 ? count / maxCount : 0;
        calendar.push({
          day,
          count,
          ratio,
          original: dayData?.original || 0,
          reply: dayData?.reply || 0,
          quote: dayData?.quote || 0,
          boost: dayData?.boost || 0,
        });
      }

      result[mKey] = calendar;
    });

    return result;
  }, [posts, year]);

  const monthMediaGrids = useMemo<Record<string, MediaGridItem[]>>(() => {
    if (postType !== 'media') return {};
    const grids: Record<number, Record<number, MastoStatus[]>> = {};
    posts.forEach((post) => {
      const date = new Date(post.createdAt);
      const m = date.getMonth();
      const d = date.getDate();
      if (!grids[m]) grids[m] = {};
      if (!grids[m][d]) grids[m][d] = [];
      grids[m][d].push(post);
    });

    const result: Record<string, MediaGridItem[]> = {};
    Object.keys(grids).forEach((mKey) => {
      const days = grids[Number(mKey)];
      const firstDayOfMonth = new Date(year ?? 0, parseInt(mKey), 1);
      const firstDayOfWeek = firstDayOfMonth.getDay();

      const calendar: MediaGridItem[] = [];

      for (let i = 0; i < firstDayOfWeek; i++) {
        calendar.push(null);
      }

      for (let day = 1; day <= 31; day++) {
        const dayPosts: MastoStatus[] = days[day] || [];
        let bestPost: MastoStatus | null = null;
        let hasMedia = false;
        if (dayPosts.length > 0) {
          const postsWithMedia = dayPosts.filter((post) => {
            const actualPost = post.reblog || post;
            return (
              !post.reblog &&
              actualPost.mediaAttachments?.some(
                (media) =>
                  media.previewUrl ||
                  media.url ||
                  media.previewRemoteUrl ||
                  media.remoteUrl,
              )
            );
          });

          if (postsWithMedia.length > 0) {
            bestPost = postsWithMedia.reduce<MastoStatus | null>(
              (topPost, post) => {
                const actualPost = post as StatusWithQuotes;
                const totalCount =
                  (actualPost.favouritesCount || 0) +
                  (actualPost.reblogsCount || 0) +
                  (actualPost.repliesCount || 0) +
                  (actualPost.quotesCount || 0);

                const topTotalCount = topPost
                  ? ((topPost as StatusWithQuotes).favouritesCount || 0) +
                    ((topPost as StatusWithQuotes).reblogsCount || 0) +
                    ((topPost as StatusWithQuotes).repliesCount || 0) +
                    ((topPost as StatusWithQuotes).quotesCount || 0)
                  : -1;

                if (totalCount > topTotalCount) return post;
                if (totalCount === topTotalCount) return topPost || post;
                return topPost;
              },
              null,
            );
            hasMedia = true;
          }
        }
        calendar.push(bestPost ? { post: bestPost, hasMedia } : { hasMedia });
      }

      result[mKey] = calendar;
    });

    return result;
  }, [posts, year, postType]);

  const monthsWithPosts = useMemo<MonthWithPosts[]>(() => {
    const monthCounts: Record<number, number> = {};
    const monthTypes: Record<number, MonthTypeCounts> = {};
    posts.forEach((post) => {
      const m = new Date(post.createdAt).getMonth();
      monthCounts[m] = (monthCounts[m] || 0) + 1;

      if (!monthTypes[m]) {
        monthTypes[m] = {
          original: 0,
          reply: 0,
          quote: 0,
          boost: 0,
        };
      }

      const p = post as StatusWithExtras;
      if (p.reblog) {
        monthTypes[m].boost++;
      } else if (p.quote?.id || p.quote?.quotedStatus?.id) {
        monthTypes[m].quote++;
      } else if (p.inReplyToId) {
        monthTypes[m].reply++;
      } else {
        monthTypes[m].original++;
      }
    });
    return sortArray(
      Object.entries(monthCounts).map(([mKey, count]) => {
        const types = monthTypes[Number(mKey)];
        return {
          month: parseInt(mKey),
          count,
          heatmap: monthHeatmaps[mKey] || [],
          mediaGrid: monthMediaGrids[mKey] || [],
          original: types.original,
          reply: types.reply,
          quote: types.quote,
          boost: types.boost,
        };
      }),
      (a, b) => a.month - b.month,
    );
  }, [posts, monthHeatmaps, monthMediaGrids]);

  interface FlexSearchDocument {
    add(doc: Record<string, unknown>): void;
    search(
      query: string,
      options?: { limit?: number },
    ): Array<{ field?: string; result: Array<string | number> }>;
  }

  const searchIndexRef = useRef<FlexSearchDocument | null>(null);
  useEffect(() => {
    if (totalPosts > 0) {
      const index = new FlexSearchIndexDocument({
        preset: 'match',
        document: {
          id: 'id',
          index: ['content', 'spoilerText', 'media', 'card'],
        },
      }) as FlexSearchDocument;
      posts.forEach((p) => {
        const status = p.reblog || p;
        const mediaText = status.mediaAttachments
          ?.map((m) => m.description)
          .join(' ');
        const cardText = status.card
          ? `${status.card.title} ${status.card.description} ${status.card.url}`
          : '';
        index.add({
          id: p.id,
          content: getHTMLText(status.content),
          spoilerText: status.spoilerText,
          media: mediaText,
          card: cardText,
        });
      });
      searchIndexRef.current = index;
    }
  }, [posts, totalPosts]);

  const searchedPosts = useMemo<MastoStatus[]>(() => {
    if (!searchQuery) return posts;
    if (!searchIndexRef.current) return [];
    console.time(`search: '${searchQuery}'`);
    const allResults = searchIndexRef.current.search(searchQuery, {
      limit: totalPosts,
    });
    console.timeEnd(`search: '${searchQuery}'`);
    const orderedIds = allResults.flatMap((r) => r.result);
    const uniqueOrderedIds = [...new Set(orderedIds)];

    const postsMap = new Map<string, MastoStatus>(posts.map((p) => [p.id, p]));
    const postResults = uniqueOrderedIds
      .map((id) => postsMap.get(String(id)))
      .filter((p): p is MastoStatus => Boolean(p));
    return postResults;
  }, [posts, searchQuery, totalPosts]);

  useEffect(() => {
    setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
    if (searchQuery) {
      if (!['relevance', 'createdAt'].includes(sortBy)) {
        setSortBy('relevance');
      }
    } else {
      if (sortBy === 'relevance') {
        setSortBy('createdAt');
      }
    }
  }, [searchQuery, sortBy]);

  type FilterCounts = Record<FilterKey, number>;

  const [filterCounts, monthPosts] = useMemo<
    [FilterCounts, MastoStatus[]]
  >(() => {
    const monthFilteredPosts = searchedPosts.filter((post) => {
      if (searchQuery) return true;
      const postMonth = new Date(post.createdAt).getMonth();
      return month !== null && postMonth === month;
    });

    const counts: FilterCounts = {
      all: monthFilteredPosts.length,
      original: 0,
      replies: 0,
      quotes: 0,
      boosts: 0,
      media: 0,
    };

    monthFilteredPosts.forEach((post) => {
      const p = post as StatusWithExtras;
      if (p.reblog) {
        counts.boosts++;
      } else if (p.quote?.id || p.quote?.quotedStatus?.id) {
        counts.quotes++;
      } else if (p.inReplyToId) {
        counts.replies++;
      } else {
        counts.original++;
      }

      const status = p.reblog || p;
      if (!p.reblog && (status.mediaAttachments?.length ?? 0) > 0) {
        counts.media++;
      }
    });

    return [counts, monthFilteredPosts];
  }, [searchedPosts, month, searchQuery]);

  const [filteredPosts, hasMore] = useMemo<[MastoStatus[], boolean]>(() => {
    const filtered = monthPosts.filter((post) => {
      const p = post as StatusWithExtras;
      if (postType === 'boosts') {
        return !!p.reblog;
      } else if (postType === 'media') {
        const status = p.reblog || p;
        return !p.reblog && (status.mediaAttachments?.length ?? 0) > 0;
      } else if (postType === 'quotes') {
        return !!(p.quote?.id || p.quote?.quotedStatus?.id);
      } else if (postType === 'replies') {
        return !!p.inReplyToId;
      } else if (postType === 'original') {
        return (
          !p.reblog &&
          !(p.quote?.id || p.quote?.quotedStatus?.id) &&
          !p.inReplyToId
        );
      }

      return true;
    });

    // Sort the filtered posts
    let sorted = filtered;
    if (sortBy !== 'relevance') {
      sorted = sortArray(filtered, (a, b) => {
        const postA = a.reblog || a;
        const postB = b.reblog || b;
        let valueA: number | Date;
        let valueB: number | Date;

        if (sortBy === 'createdAt') {
          valueA = new Date(a.createdAt);
          valueB = new Date(b.createdAt);
        } else {
          valueA = (postA[sortBy] as number | undefined) || 0;
          valueB = (postB[sortBy] as number | undefined) || 0;
        }

        if (sortOrder === 'asc') {
          return valueA > valueB ? 1 : -1;
        } else {
          return valueB > valueA ? 1 : -1;
        }
      });
    }

    if (searchQuery) {
      return [sorted.slice(0, searchLimit), sorted.length > searchLimit];
    }
    return [sorted, false];
  }, [monthPosts, postType, searchQuery, searchLimit, sortBy, sortOrder]);

  // Auto-switch to 'all' when filtered results are empty but there are results in other categories
  useEffect(() => {
    if (
      searchQuery &&
      postType !== 'all' &&
      filteredPosts.length === 0 &&
      filterCounts.all > 0
    ) {
      setPostType('all');
    }
  }, [searchQuery, postType, filteredPosts.length, filterCounts.all]);

  const currentMonthIndex = monthsWithPosts.findIndex((m) => m.month === month);
  const prevMonth =
    currentMonthIndex > 0 ? monthsWithPosts[currentMonthIndex - 1] : null;
  const nextMonth =
    currentMonthIndex < monthsWithPosts.length - 1
      ? monthsWithPosts[currentMonthIndex + 1]
      : null;

  useEffect(() => {
    if (!year) {
      setUIState('default');
      setPosts([]);
      return;
    }

    void (async () => {
      setUIState('loading');
      try {
        const dataId = `${NS}-${year}`;
        console.time(`fetchYearPosts-${year}`);
        const data = (await db.yearInPosts.get(dataId)) as
          | YearInPostsRecord
          | undefined;
        console.timeEnd(`fetchYearPosts-${year}`);
        if (data && data.year === year) {
          data.posts.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          setPosts(data.posts);
          setUIState('results');
        } else {
          setUIState('no-data');
        }
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, [year, NS]);

  useEffect(() => {
    if (month !== null && uiState === 'results') {
      const monthFilter = document.querySelector<HTMLElement>(
        `.calendar-bar .month-filter[data-month="${month}"]`,
      );
      monthFilter?.focus();
      monthFilter?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [month, uiState]);

  return (
    <div
      ref={scrollableRef}
      id="year-in-posts-page"
      className="deck-container"
      tabIndex={-1}
      style={{
        '--month': month || 0,
      }}
    >
      <div className="timeline-deck deck">
        {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
            header click is a tap-to-scroll-to-top affordance for touch; keyboard
            users press Home. Adding a stub keyboard handler would be no-op. */}
        <header
          className={uiState === 'loading' ? 'loading' : ''}
          role="presentation"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a, button')) {
              scrollableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        >
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              {year && month !== null ? (
                <Link
                  to={`/yip?year=${year}`}
                  className="button plain"
                  onClick={() => {
                    setSearchQuery('');
                  }}
                >
                  <Icon icon="grid" size="l" alt="Year in Posts" />
                </Link>
              ) : year ? (
                <Link
                  to="/yip"
                  className="button plain"
                  onClick={() => {
                    setSearchQuery('');
                  }}
                >
                  <Icon icon="month" size="l" alt="Year in Posts" />
                </Link>
              ) : (
                <Link to="/" className="button plain">
                  <Icon icon="home" size="l" alt="Home" />
                </Link>
              )}
            </div>
            {year && (
              <>
                {showSearchField ? (
                  <SearchField
                    ref={searchFieldRef}
                    placeholder={`Search posts in ${year}…`}
                    searchQuery={searchQuery}
                    onSearch={(val) => {
                      setSearchQuery(val);
                      setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
                    }}
                    onEscape={() => {
                      if (!searchQuery.trim()) {
                        setShowSearchField(false);
                        setSearchQuery('');
                      }
                    }}
                  />
                ) : (
                  <h1 className="header-double-lines">
                    <b>{year}</b>
                    {uiState === 'results' && (
                      <div>
                        {/* <Plural
                          value={posts.length}
                          one="# post"
                          other="# posts"
                        /> */}
                        {month !== null
                          ? `${getMonthName(month)} – ${monthsWithPosts[month].count} posts`
                          : `${posts.length} posts`}
                        {/* TODO: Use Plural above when finalized */}
                      </div>
                    )}
                  </h1>
                )}
              </>
            )}
            <div className="header-side">
              {year && (
                <>
                  <button
                    type="button"
                    className={`plain ${showSearchField ? 'is-active' : ''}`}
                    onClick={() => {
                      if (showSearchField) {
                        setShowSearchField(false);
                        setSearchQuery('');
                      } else {
                        setShowSearchField(true);
                        setTimeout(() => {
                          searchFieldRef.current?.focus();
                        }, 100);
                      }
                    }}
                  >
                    <Icon icon="search" size="l" alt="Search" />
                  </button>
                  <Menu2
                    align="end"
                    menuButton={
                      <button type="button" className="plain">
                        <Icon icon="more" size="l" alt="More" />
                      </button>
                    }
                  >
                    <MenuItem
                      type="checkbox"
                      checked={postType === 'media'}
                      onClick={() => {
                        setPostType(postType === 'media' ? 'all' : 'media');
                      }}
                    >
                      <Icon icon="check-circle" alt="☑️" />{' '}
                      <span className="menu-grow">Media only</span>
                    </MenuItem>
                  </Menu2>
                </>
              )}
            </div>
          </div>
        </header>

        <main>
          {!year && (
            <div className="year-in-posts-start">
              {uiState !== 'generating' ? (
                <>
                  <h1>
                    Year in Posts <sup>beta</sup>
                  </h1>
                  <p>A year-at-a-glance view of your posts.</p>
                  <details>
                    <summary>What is this?</summary>
                    <p>
                      Year in Posts is a simple, searchable archive of your
                      posts, offering a year-at-a-glance view with calendar
                      visualizations and straight-forward interface to sort and
                      filter through posts.
                    </p>
                    <img
                      src={yearInPostsUrl}
                      width="1200"
                      height="900"
                      alt="Preview of Year in Posts UI"
                    />
                    <p>
                      <button
                        type="button"
                        onClick={(e) => {
                          const details = (e.target as HTMLElement).closest(
                            'details',
                          ) as HTMLDetailsElement;
                          details.open = false;
                        }}
                      >
                        Let's explore my posts
                      </button>
                    </p>
                  </details>

                  <form
                    className="year-generate"
                    onSubmit={(e) => {
                      void handleGenerate(e);
                    }}
                  >
                    {/* TODO(oxlint:jsx-a11y/label-has-associated-control): rule false positive on
                        wrapped <input>; the input is the implicit control here. */}
                    <label>
                      <input
                        type="number"
                        aria-label={t`Year`}
                        min={MIN_YEAR}
                        max={new Date().getFullYear()}
                        name="year"
                        defaultValue={getDefaultYear()}
                        disabled={(uiState as string) === 'generating'}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={(uiState as string) === 'generating'}
                    >
                      <Icon icon="arrow-right" alt="Generate" size="l" />
                    </button>
                  </form>
                  <div className="insignificant">
                    <small>
                      <p>
                        This downloads your posts (excluding media files) from
                        Bluesky and saves them locally. It may take a longer
                        time and require more disk space.
                      </p>
                      <p>
                        Once archived, updated or deleted posts are not
                        reflected in the archive until regenerated.
                      </p>
                    </small>
                  </div>
                  {!searchEnabled && (
                    <p className="insignificant">
                      <small>
                        ⚠️ Advanced search is unavailable, so this will make
                        more requests to Bluesky and take much longer time.
                      </small>
                    </p>
                  )}
                </>
              ) : (
                <div className="ui-state year-in-posts-start">
                  <Loader abrupt />
                  <p className="insignificant">Generating Year in Posts…</p>
                  <p className="insignificant">This might take a while.</p>
                </div>
              )}

              {availableYears.length > 0 && uiState !== 'generating' && (
                <div className="year-selection">
                  <p>Archived Year in Posts:</p>
                  <ul>
                    {availableYears.map(
                      ({
                        year: archivedYear,
                        count,
                        fetchedAt,
                        size,
                        timezoneOffset,
                      }) => {
                        const currentOffset = getCurrentTimezoneOffset();
                        const tzMismatch =
                          timezoneOffset !== undefined &&
                          timezoneOffset !== currentOffset;

                        return (
                          <li key={archivedYear}>
                            <Link
                              to={`/yip?year=${archivedYear}`}
                              className="year-card available"
                            >
                              <Icon icon="month" /> {archivedYear}
                            </Link>{' '}
                            <small className="ib insignificant">
                              {/* <Plural value={count} one="# post" other="# posts" /> */}
                              {count} posts{' '}
                              {/* TODO: Use Plural above when finalized */}
                            </small>{' '}
                            {size && (
                              <small
                                className="tag insignificant collapsed"
                                title={`${size.toLocaleString(i18n.locale || undefined)} bytes`}
                              >
                                ~{prettyBytes(size)}
                              </small>
                            )}{' '}
                            <MenuConfirm
                              align="end"
                              confirmLabel={
                                <span>Regenerate {archivedYear} posts?</span>
                              }
                              onClick={() => {
                                void handleRegenerate(archivedYear);
                              }}
                            >
                              <button
                                type="button"
                                className="light small"
                                disabled={uiState === 'loading'}
                                title={String(fetchedAt)}
                              >
                                <Icon
                                  icon="refresh"
                                  size="s"
                                  className="insignificant"
                                />{' '}
                                <span className="insignificant">
                                  {new Date(fetchedAt).toLocaleDateString(
                                    i18n.locale,
                                    {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                    },
                                  )}
                                </span>{' '}
                                {timezoneOffset !== undefined && (
                                  <small
                                    className={`tag insignificant collapsed ${tzMismatch ? 'warn' : ''}`}
                                    title={
                                      tzMismatch
                                        ? `Generated in ${formatTimezoneOffset(timezoneOffset)}, current timezone is ${formatTimezoneOffset(currentOffset)}`
                                        : formatTimezoneOffset(timezoneOffset)
                                    }
                                  >
                                    {tzMismatch && <Icon icon="time" />}
                                    {formatTimezoneOffset(timezoneOffset)}
                                  </small>
                                )}
                              </button>
                            </MenuConfirm>
                            <button
                              type="button"
                              className="light danger small"
                              onClick={(e) => {
                                e.preventDefault();
                                void handleRemoveYear(archivedYear);
                              }}
                            >
                              <Icon icon="x" alt="Remove" />
                            </button>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {year && uiState === 'loading' && (
            <div className="ui-state year-in-posts-start">
              <Loader abrupt />
            </div>
          )}

          {year && uiState === 'results' && (
            <>
              {!searchQuery && monthsWithPosts.length > 0 && (
                <>
                  <CalendarBar
                    year={year}
                    month={month}
                    monthsWithPosts={monthsWithPosts}
                    postType={postType}
                  />
                  {month === null && <CalendarLegend />}
                </>
              )}

              {(month !== null || searchQuery) && (
                <div className="post-type-filters">
                  {(Object.entries(FILTER_KEYS) as [FilterKey, string][]).map(
                    ([key, label]) =>
                      filterCounts[key] > 0 && (
                        <button
                          key={key}
                          type="button"
                          className={`filter-cat plain ${postType === key ? 'is-active' : ''}`}
                          onClick={() => {
                            setPostType(key);
                          }}
                        >
                          {label}{' '}
                          <span className="count">{filterCounts[key]}</span>
                        </button>
                      ),
                  )}
                </div>
              )}

              {(month !== null || searchQuery) && filteredPosts.length > 1 && (
                <div className="sort-controls">
                  <span className="filter-label">Sort</span>{' '}
                  <fieldset className="radio-field-group">
                    {SORT_OPTIONS.filter((o) => {
                      if (o.key === 'relevance') return !!searchQuery;
                      if (o.key === 'createdAt') return true;
                      return !searchQuery;
                    }).map(({ key }) => (
                      <label
                        className="filter-sort"
                        key={key}
                        onClick={(e) => {
                          if (sortBy === key && key !== 'relevance') {
                            e.preventDefault();
                            e.stopPropagation();
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          }
                        }}
                      >
                        <input
                          type="radio"
                          name="filter-sort-cat"
                          checked={sortBy === key}
                          onChange={() => {
                            setSortBy(key);
                            const order = /(replies|favourites|reblogs)/.test(
                              key,
                            )
                              ? 'desc'
                              : 'asc';
                            setSortOrder(order);
                          }}
                        />
                        {
                          {
                            relevance: `Relevance`,
                            createdAt: `Date`,
                            repliesCount: `Replies`,
                            favouritesCount: `Likes`,
                            reblogsCount: `Reposts`,
                          }[key]
                        }
                        {sortBy === key &&
                          key !== 'relevance' &&
                          (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}

              {(month !== null || searchQuery) && (
                <>
                  <ul className="timeline">
                    {filteredPosts.length === 0 ? (
                      <p className="ui-state insignificant">…</p>
                    ) : (
                      filteredPosts.map((post, index) => {
                        const currentDate = new Date(post.createdAt);
                        const previousPost = filteredPosts[index - 1];
                        const previousDate = previousPost
                          ? new Date(previousPost.createdAt)
                          : null;
                        const showDateHeader =
                          sortBy === 'createdAt' &&
                          (!previousDate ||
                            currentDate.toDateString() !==
                              previousDate.toDateString());

                        return (
                          <>
                            {showDateHeader && (
                              <li className="date-header" key={post.createdAt}>
                                <h2>
                                  <span>
                                    {niceDateTime(post.createdAt, {
                                      hideTime: true,
                                      formatOpts: {
                                        year: undefined,
                                      },
                                    })}
                                  </span>{' '}
                                  <small className="insignificant bidi-isolate">
                                    {niceDateTime(post.createdAt, {
                                      forceOpts: {
                                        weekday: 'long',
                                      },
                                    })}
                                  </small>
                                </h2>
                              </li>
                            )}
                            <li key={post.id}>
                              {totalPosts > 20 ? (
                                <IntersectionPostItem
                                  key={post.id}
                                  root={scrollableRef.current}
                                  post={post}
                                  instance={instance}
                                  defaultShow={index < 3}
                                />
                              ) : (
                                <Link
                                  className="status-link timeline-item"
                                  to={
                                    post.reblog
                                      ? `/${instance}/s/${post.reblog.id}`
                                      : `/${instance}/s/${post.id}`
                                  }
                                >
                                  <Status
                                    status={post}
                                    instance={instance}
                                    size="m"
                                    showCommentCount
                                    showQuoteCount
                                  />
                                </Link>
                              )}
                            </li>
                          </>
                        );
                      })
                    )}
                  </ul>

                  {searchQuery && hasMore && (
                    <div className="ui-state">
                      <button
                        type="button"
                        className="plain6 block"
                        onClick={() => {
                          setSearchLimit((l) => l + SEARCH_RESULT_PAGE_SIZE);
                        }}
                      >
                        More…
                      </button>
                    </div>
                  )}

                  {!searchQuery && (
                    <div className="year-in-posts-nav">
                      {prevMonth ? (
                        <Link
                          to={`/yip?year=${year}&month=${prevMonth.month}`}
                          className="button light"
                          onClick={() => {
                            scrollableRef.current?.scrollTo({
                              top: 0,
                              behavior: 'instant',
                            });
                          }}
                        >
                          <Icon icon="arrow-left" />{' '}
                          {getMonthName(prevMonth.month, i18n.locale, 'long')}
                        </Link>
                      ) : (
                        <span />
                      )}
                      {nextMonth && (
                        <Link
                          to={`/yip?year=${year}&month=${nextMonth.month}`}
                          className="button light"
                          onClick={() => {
                            scrollableRef.current?.scrollTo({
                              top: 0,
                              behavior: 'instant',
                            });
                          }}
                        >
                          {getMonthName(nextMonth.month, i18n.locale, 'long')}{' '}
                          <Icon icon="arrow-right" />
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      <div className={`tron-grid ${month === null ? 'animated' : ''}`} />
    </div>
  );
}

interface IntersectionPostItemProps {
  root: Element | null;
  post: MastoStatus;
  instance: string;
  defaultShow: boolean;
}

const IntersectionPostItem = ({
  root,
  post,
  instance,
  defaultShow,
}: IntersectionPostItemProps) => {
  const ref = useRef<HTMLLIElement | null>(null);
  const [show, setShow] = useState<boolean>(defaultShow);

  useEffect(() => {
    if (defaultShow) return undefined;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          queueMicrotask(() => {
            setShow(true);
          });
          if (node) observer.unobserve(node);
        }
      },
      {
        root,
        rootMargin: `${Math.max(320, screen.height * 0.75)}px`,
      },
    );
    if (node) observer.observe(node);
    return () => {
      if (node) observer.unobserve(node);
    };
  }, [defaultShow, root]);

  const statusId = post.reblog?.id || post.id;

  return (
    <li
      ref={ref}
      style={{
        height: show ? undefined : '10em',
      }}
    >
      {show ? (
        <Link
          className="status-link timeline-item"
          to={`/${instance}/s/${statusId}`}
        >
          <Status
            status={post}
            instance={instance}
            size="m"
            showCommentCount
            showQuoteCount
          />
        </Link>
      ) : (
        <>&nbsp;</>
      )}
    </li>
  );
};

interface CalendarBarProps {
  year: number;
  month: number | null;
  monthsWithPosts: MonthWithPosts[];
  postType: FilterKey;
}

function CalendarBar({
  year,
  month,
  monthsWithPosts,
  postType,
}: CalendarBarProps) {
  const { i18n } = useLingui();
  return (
    <div
      className={`calendar-bar ${month === null ? 'grid' : 'horizontal'} ${postType === 'media' ? 'media-grid' : ''}`}
    >
      {monthsWithPosts.map(
        ({
          month: m,
          count,
          heatmap,
          mediaGrid,
          original,
          reply,
          quote,
          boost,
        }) => {
          const originalRatio = count > 0 ? original / count : 0;
          const replyRatio = count > 0 ? reply / count : 0;
          const quoteRatio = count > 0 ? quote / count : 0;
          const boostRatio = count > 0 ? boost / count : 0;

          return (
            <Link
              to={`/yip?year=${year}&month=${m}${postType !== 'all' ? `&postType=${postType}` : ''}`}
              key={m}
              className={`button plain ${
                month === m ? 'is-active month-filter' : 'month-filter'
              }`}
              style={{
                '--month-original-ratio': originalRatio,
                '--month-reply-ratio': replyRatio,
                '--month-quote-ratio': quoteRatio,
                '--month-boost-ratio': boostRatio,
              }}
              data-month={m}
            >
              <div className="month-name">{getMonthName(m, i18n.locale)}</div>
              {postType === 'media'
                ? mediaGrid.length > 0 && (
                    <div className="month-media-grid">
                      {mediaGrid.map((item, i) => {
                        if (!item)
                          return <span key={i} className="media-day empty" />;
                        if (!item.hasMedia)
                          return (
                            <span key={i} className="media-day no-media" />
                          );
                        const status = item.post as MastoStatus;
                        // hasMedia guarantees mediaAttachments[0] exists.
                        const media = (status.mediaAttachments ?? [])[0] as {
                          previewUrl?: string | null;
                          url?: string | null;
                          previewRemoteUrl?: string | null;
                          remoteUrl?: string | null;
                        };
                        return (
                          <span key={i} className="media-day">
                            <img
                              src={(media.previewUrl || media.url) as string}
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                const { src } = target;
                                if (
                                  src === media.previewUrl ||
                                  src === media.url
                                ) {
                                  target.src = (media.previewRemoteUrl ||
                                    media.remoteUrl) as string;
                                } else {
                                  target.remove();
                                }
                              }}
                              alt=""
                            />
                          </span>
                        );
                      })}
                    </div>
                  )
                : heatmap.length > 0 && (
                    <div className="month-heatmap">
                      {heatmap.map((dayData, i) => {
                        const total = dayData.count || 0;
                        const dayOriginalRatio =
                          total > 0 ? dayData.original / total : 0;
                        const dayReplyRatio =
                          total > 0 ? dayData.reply / total : 0;
                        const dayQuoteRatio =
                          total > 0 ? dayData.quote / total : 0;
                        const dayBoostRatio =
                          total > 0 ? dayData.boost / total : 0;

                        return (
                          <span
                            key={i}
                            className={`heatmap-day ${dayData.day === null ? 'empty' : ''} ${i % 7 === 0 || i % 7 === 6 ? 'weekend' : ''}`}
                            data-ratio={dayData.ratio}
                            style={{
                              '--ratio': dayData.ratio,
                              '--original-ratio': dayOriginalRatio,
                              '--reply-ratio': dayReplyRatio,
                              '--quote-ratio': dayQuoteRatio,
                              '--boost-ratio': dayBoostRatio,
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
              <div className="month-metadata">
                {/* <Plural value={count} one="# post" other="# posts" /> */}
                {count} posts {/* TODO: Use Plural above when finalized */}
              </div>
            </Link>
          );
        },
      )}
    </div>
  );
}

function CalendarLegend() {
  return (
    <div className="calendar-bar-legends">
      <span className="ib">
        <span className="calendar-bar-legend-item calendar-bar-original" />{' '}
        <Trans>Original</Trans>
      </span>{' '}
      <span className="ib">
        <span className="calendar-bar-legend-item calendar-bar-reply" />{' '}
        <Trans>Replies</Trans>
      </span>{' '}
      <span className="ib">
        <span className="calendar-bar-legend-item calendar-bar-quote" />{' '}
        <Trans>Quotes</Trans>
      </span>{' '}
      <span className="ib">
        <span className="calendar-bar-legend-item calendar-bar-boost" />{' '}
        <Trans>Reposts</Trans>
      </span>
    </div>
  );
}

interface SearchFieldProps {
  ref?: Ref<SearchFieldHandle>;
  searchQuery: string;
  onSearch: (val: string) => void;
  placeholder?: string;
  onEscape?: () => void;
}

function SearchField({
  ref,
  searchQuery,
  onSearch,
  placeholder,
  onEscape,
}: SearchFieldProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      searchInputRef.current?.focus();
    },
    setValue: (val: string) => {
      // Original JS dereferenced without null-check; preserve.
      (searchInputRef.current as HTMLInputElement).value = val;
    },
    isFocused: () => {
      return document.activeElement === searchInputRef.current;
    },
  }));

  const throttledSearch = useThrottledCallback(onSearch, 150);

  return (
    <form
      className="search-field"
      onSubmit={(e) => {
        e.preventDefault();
        const q = (searchInputRef.current as HTMLInputElement).value.trim();
        throttledSearch?.cancel();
        throttledSearch(q);
      }}
    >
      <input
        ref={searchInputRef}
        type="search"
        name="q"
        className="block"
        placeholder={placeholder || 'Search posts…'}
        defaultValue={searchQuery}
        dir="auto"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        onInput={(e) => {
          const val = (e.target as HTMLInputElement).value;
          throttledSearch(val);
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Escape' &&
            !(e.target as HTMLInputElement).value.trim()
          ) {
            onEscape?.();
          }
        }}
      />
    </form>
  );
}

export default YearInPosts;
