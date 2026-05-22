import '../components/links-bar.css';
import './catchup.css';

import { autoAnimate } from '@formkit/auto-animate';
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, select } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { getBlurHashAverageColor } from 'fast-blurhash';
import type { mastodon } from 'masto';
import { Fragment, type JSX } from 'react';
import { memo } from 'react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSearchParams } from 'react-router-dom';
import { uid } from 'uid/single';

import catchupUrl from '../assets/features/catch-up.png';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import Modal from '../components/modal';
import NameText, { type NameTextAccount } from '../components/name-text';
import NavMenu from '../components/nav-menu';
import RawHtml from '../components/raw-html';
import RelativeTime from '../components/relative-time';
import { api, getMastoV1Resource, getPreferences } from '../utils/api';
import { catchupPageHasItemsInRange } from '../utils/catchup-fetch';
import { compareCreatedAt } from '../utils/catchup-sort';
import { oklab2rgb, rgb2oklab } from '../utils/color-utils';
import db from '../utils/db';
import emojifyText from '../utils/emojify-text';
import { isFiltered } from '../utils/filters';
import getDomain from '../utils/get-domain';
import htmlContentLength from '../utils/html-content-length';
import mem from '../utils/mem';
import niceDateTime from '../utils/nice-date-time';
import shortenNumber from '../utils/shorten-number';
import showToast from '../utils/show-toast';
import { sorted } from '../utils/sorted';
import statusPeek from '../utils/status-peek';
import store from '../utils/store';
import { getCurrentAccountID, getCurrentAccountNS } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

// Types -----------------------------------------------------------------

// Mastodon's status type is augmented at runtime with bookkeeping flags the
// catch-up pipeline attaches. Keep the surface open via index signatures so
// downstream callers can still access the original Status fields.
type FilterInfo =
  | {
      action?: string;
      titles?: string[];
      titlesStr?: string;
    }
  | null
  | false
  | undefined;

interface CatchupBooster {
  id: string;
  avatar?: string;
  avatarStatic?: string;
  acct?: string;
  bot?: boolean;
  displayName?: string;
  [key: string]: unknown;
}

type CatchupAccount = mastodon.v1.Account & NameTextAccount & CatchupBooster;
type QuoteAccount = CatchupAccount | mastodon.v1.Status['account'];
type QuoteStatusLike =
  | mastodon.v1.Status
  | {
      id?: string | null;
      account?: QuoteAccount;
      spoilerText?: string;
      sensitive?: boolean;
      emojis?: mastodon.v1.Status['emojis'];
      mediaAttachments?: mastodon.v1.Status['mediaAttachments'];
      content?: string;
      [key: string]: unknown;
    };

interface QuoteLike {
  id?: string | null;
  quotedStatus?: QuoteStatusLike | null;
  account?: QuoteAccount;
  spoilerText?: string;
  sensitive?: boolean;
  emojis?: mastodon.v1.Status['emojis'];
  mediaAttachments?: mastodon.v1.Status['mediaAttachments'];
  content?: string;
  [key: string]: unknown;
}

type CatchupPost = mastodon.v1.Status & {
  account: CatchupAccount;
  reblog?: CatchupPost | null;
  _filtered?: FilterInfo;
  _thread?: boolean;
  __FILTER?: string;
  __HIDDEN?: boolean;
  __BOOSTERS?: Set<CatchupBooster>;
  group?: unknown;
  quotesCount?: number;
  [key: string]: unknown;
};

interface CatchupRecord {
  id: string;
  posts: CatchupPost[];
  count: number;
  startAt: number | null;
  endAt: number;
}

interface CatchupSummary {
  id: string;
  count: number;
  startAt: number | null;
  endAt: number;
}

interface CatchupSessionState {
  selectedFilterCategory?: string;
  selectedAuthor?: string | null;
  sortBy?: string;
  sortOrder?: string;
  groupBy?: string | null;
  showTopLinks?: boolean;
  scrollTop?: number;
}

interface CardLike {
  url?: string;
  image?: string | null;
  imageDescription?: string;
  blurhash?: string | null;
  title?: string;
  description?: string;
  language?: string;
  width?: number;
  height?: number;
  publishedAt?: string;
  type?: string;
  [key: string]: unknown;
}

interface LinkAggregate {
  postID: string;
  card: CardLike;
  shared: number;
  sharers: CatchupPost['account'][];
  likes: number;
  boosts: number;
  quotes?: number;
}

type TopLink = LinkAggregate & { url: string };

interface FilterCounts {
  filtered: number;
  groups: number;
  boosts: number;
  quotes: number;
  replies: number;
  original: number;
  [key: string]: number;
}

interface HomeTimelineParams {
  include_reblogs?: boolean;
  [key: string]: unknown;
}

interface HomeIterable {
  values(): AsyncIterator<mastodon.v1.Status[]>;
  params?: HomeTimelineParams | string;
}

type UIState = 'start' | 'loading' | 'results';

const FILTER_CONTEXT = 'home';
const CATCHUP_NS = 'catchup';

interface RangeEntry {
  label: MessageDescriptor;
  value: number;
  beyond?: boolean;
}

const RANGES: RangeEntry[] = [
  { label: msg`last 1 hour`, value: 1 },
  { label: msg`last 2 hours`, value: 2 },
  { label: msg`last 3 hours`, value: 3 },
  { label: msg`last 4 hours`, value: 4 },
  { label: msg`last 5 hours`, value: 5 },
  { label: msg`last 6 hours`, value: 6 },
  { label: msg`last 7 hours`, value: 7 },
  { label: msg`last 8 hours`, value: 8 },
  { label: msg`last 9 hours`, value: 9 },
  { label: msg`last 10 hours`, value: 10 },
  { label: msg`last 11 hours`, value: 11 },
  { label: msg`last 12 hours`, value: 12 },
  { label: msg`beyond 12 hours`, value: 13, beyond: true },
];

const FILTER_KEYS: Record<string, MessageDescriptor> = {
  original: msg`Original`,
  replies: msg`Replies`,
  quotes: msg`Quotes`,
  boosts: msg`Reposts`,
  groups: msg`Groups`,
  filtered: msg`Filtered`,
};
const FILTER_SORTS: string[] = [
  'createdAt',
  'repliesCount',
  'favouritesCount',
  'reblogsCount',
  // TODO: Add this later when there's enough usage
  // Sorting by quotes count seems not useful… yet?
  // And we're combining it with boosts count, so that's even weirder…
  // 'quotesCount',
  'density',
];
const FILTER_GROUPS: (string | null)[] = [null, 'account'];

const DTF = mem(
  (locale: string | undefined) =>
    new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }),
);

function hasQuote(
  quote: QuoteLike | mastodon.v1.Status['quote'] | null | undefined,
): boolean {
  if (!quote) return false;
  const quotedStatusId =
    'quotedStatus' in quote ? quote.quotedStatus?.id : undefined;
  const quoteId = 'id' in quote ? quote.id : undefined;
  return !!(quoteId || quotedStatusId);
}

function quoteLike(
  quote: QuoteLike | mastodon.v1.Status['quote'] | null | undefined,
): QuoteLike | null {
  if (!quote) return null;
  if ('quotedStatus' in quote && quote.quotedStatus) {
    return quote.quotedStatus as QuoteLike;
  }
  return quote as QuoteLike;
}

type StatusPeekInput = Parameters<typeof statusPeek>[0];

function isQuoteStatusLike(status: unknown): status is QuoteStatusLike {
  return !!status && typeof status === 'object';
}

function toStatusPeekInput(
  status: QuoteStatusLike | CatchupPost,
): StatusPeekInput {
  const quote = 'quote' in status ? status.quote : undefined;
  const quotedStatus =
    quote &&
    typeof quote === 'object' &&
    'quotedStatus' in quote &&
    isQuoteStatusLike(quote.quotedStatus)
      ? quote.quotedStatus
      : undefined;

  return {
    spoilerText: status.spoilerText,
    content: status.content,
    mediaAttachments: status.mediaAttachments?.map((attachment) => ({
      type: attachment.type,
    })),
    quote: quotedStatus
      ? {
          quotedStatus: {
            ...toStatusPeekInput(quotedStatus),
            id: quotedStatus.id ?? undefined,
          },
        }
      : null,
  };
}

function nameTextAccount(
  account: QuoteAccount | null | undefined,
): NameTextAccount | undefined {
  return account as (QuoteAccount & NameTextAccount) | undefined;
}

function quoteNameTextAccount(
  quote: QuoteLike | mastodon.v1.Status['quote'] | null | undefined,
): NameTextAccount | undefined {
  if (!quote) return undefined;
  const quotedStatusAccount =
    'quotedStatus' in quote ? quote.quotedStatus?.account : undefined;
  const quoteAccount = 'account' in quote ? quote.account : undefined;
  return nameTextAccount(quotedStatusAccount || quoteAccount);
}

function canonicalCatchupPostId(post: CatchupPost): string {
  return post.reblog?.id || post.id;
}

function catchupBoosterLabel(account: CatchupBooster): string {
  if (account.displayName && account.acct) {
    return `${account.displayName} (@${account.acct})`;
  }
  return account.displayName || account.acct || account.id;
}

function addCatchupBooster(
  boosters: Set<CatchupBooster>,
  account: CatchupBooster,
): void {
  if (![...boosters].some((booster) => booster.id === account.id)) {
    boosters.add(account);
  }
}

function catchupBoostersSignature(post: CatchupPost): string {
  return [...(post.__BOOSTERS || [])]
    .map((booster) => booster.id)
    .toSorted()
    .join(',');
}

function Catchup() {
  // The macro-typed `useLingui` strips `_`, but the runtime forwards it from
  // I18nContext. Bind through `i18n` so the method keeps its receiver.
  const { i18n, t } = useLingui();
  const _: I18n['_'] = i18n._.bind(i18n);
  const dtf = DTF(i18n.locale);

  useTitle(`Catch-up`, '/catchup');
  const { masto, instance } = api();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get('id');
  const [uiState, setUIState] = useState<UIState>('start');
  const [showTopLinks, setShowTopLinks] = useState(false);

  const currentAccount = useMemo(() => {
    return getCurrentAccountID();
  }, []);
  const isSelf = useCallback(
    (accountID: string | null | undefined): boolean =>
      accountID === currentAccount,
    [currentAccount],
  );

  const fetchHome = useCallback(
    async ({
      maxCreatedAt,
    }: {
      maxCreatedAt: number | null;
    }): Promise<CatchupPost[]> => {
      console.debug('fetchHome', maxCreatedAt);
      const allResults: CatchupPost[] = [];
      const timelines = getMastoV1Resource<{
        home: {
          list(options: { limit: number }): HomeIterable;
        };
      }>(masto, 'timelines');
      const homeIterable = timelines.home.list({ limit: 40 });
      const homeIterator = homeIterable.values();
      mainloop: while (true) {
        try {
          const results = await homeIterator.next();
          const { value } = results as { value: CatchupPost[] | undefined };
          if (value?.length) {
            for (let i = 0; i < value.length; i++) {
              const item = value[i];
              const createdAtTime = Date.parse(item.createdAt);
              if (!maxCreatedAt || createdAtTime >= maxCreatedAt) {
                // Filtered
                const selfPost = isSelf(
                  item.reblog?.account?.id || item.account.id,
                );
                const filterInfo =
                  !selfPost &&
                  isFiltered(
                    item.reblog?.filtered || item.filtered,
                    FILTER_CONTEXT,
                  );
                if (filterInfo && filterInfo.action === 'hide') continue;
                item._filtered = filterInfo as FilterInfo;

                allResults.push(item);
              } else {
                // Don't immediately stop, still add the other items that might still be within range
                // break mainloop;
              }
            }
            // Only stop when ALL items are outside of range. Hidden filtered
            // posts still count as in-range so they don't truncate catch-up.
            if (!catchupPageHasItemsInRange(value, maxCreatedAt)) {
              break mainloop;
            }
          } else {
            break mainloop;
          }
          // Pause 1s
          await new Promise((resolve) => {
            setTimeout(resolve, 1000);
          });
        } catch (e) {
          console.error(e);
          break mainloop;
        }
      }

      // Post-process all results
      // 1. Threadify - tag 1st-post in a thread
      allResults.forEach((status) => {
        if (status?.inReplyToId) {
          const replyToStatus = allResults.find(
            (s) => s.id === status.inReplyToId,
          );
          if (replyToStatus && !replyToStatus.inReplyToId) {
            replyToStatus._thread = true;
          }
        }
      });

      return allResults;
    },
    [masto, isSelf],
  );

  const [posts, setPosts] = useState<CatchupPost[]>([]);
  const catchupRangeRef = useRef<HTMLInputElement | null>(null);
  const catchupLastRef = useRef<HTMLInputElement | null>(null);
  const NS = useMemo(() => getCurrentAccountNS(), []);
  const handleCatchupClick = useCallback(
    async ({ duration }: { duration?: number } = {}): Promise<void> => {
      const now = Date.now();
      const maxCreatedAt = duration ? now - duration : null;
      console.log('CATCHUP', {
        duration,
        durationHuman: duration ? `${duration / 1000 / 60 / 60}h` : null,
        maxCreatedAt,
        maxCreatedAtHuman: maxCreatedAt
          ? dtf.format(new Date(maxCreatedAt))
          : null,
      });
      setUIState('loading');
      const results = await fetchHome({ maxCreatedAt });
      // Namespaced by account ID
      // Possible conflict if ID matches between different accounts from different instances
      const catchupID = `${NS}-${uid()}`;
      try {
        await db.catchup.set(catchupID, {
          id: catchupID,
          posts: results,
          count: results.length,
          startAt: maxCreatedAt,
          endAt: now,
        });
        setSearchParams({ id: catchupID });
      } catch (e) {
        console.error(e, results);
      }
    },
    [dtf, fetchHome, NS, setSearchParams],
  );

  const syncRouteCatchup = useEffectEvent(() => {
    if (id) {
      void (async () => {
        const catchup = (await db.catchup.get(id)) as CatchupRecord | undefined;
        if (catchup) {
          catchup.posts.sort(compareCreatedAt);
          setPosts(catchup.posts);
          setUIState('results');
        }
      })();
    } else if (uiState === 'results') {
      setPosts([]);
      setUIState('start');
    }
  });
  useEffect(() => {
    syncRouteCatchup();
  }, [id, uiState]);

  const [reloadCatchupsCount, setReloadCatchupsCount] = useState(0);
  const reloadCatchups = useCallback(() => {
    setReloadCatchupsCount((c) => c + 1);
  }, []);
  const [lastCatchupEndAt, setLastCatchupEndAt] = useState<number | null>(null);
  const [prevCatchups, setPrevCatchups] = useState<CatchupSummary[]>([]);

  useEffect(() => {
    const catchupIds = new Set(prevCatchups.map((pc) => pc.id));
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`${CATCHUP_NS}-`)) {
        const catchupId = key.replace(`${CATCHUP_NS}-`, '');
        if (!catchupIds.has(catchupId)) {
          store.session.del(key);
        }
      }
    }
  }, [prevCatchups]);

  useEffect(() => {
    void (async () => {
      try {
        const catchups = (await db.catchup.keys()) as string[];
        if (catchups.length) {
          const ns = getCurrentAccountNS();
          const ownKeys = catchups.filter((key) => key.startsWith(`${ns}-`));
          if (ownKeys.length) {
            let ownCatchups: CatchupRecord[] | null = (await db.catchup.getMany(
              ownKeys,
            )) as CatchupRecord[];
            ownCatchups.sort((a, b) => b.endAt - a.endAt);

            // Split to 1st 3 last catchups, and the rest
            let lastCatchups: CatchupRecord[] | null = ownCatchups.slice(0, 3);
            let restCatchups: CatchupRecord[] | null = ownCatchups.slice(3);

            const trimmedCatchups: CatchupSummary[] = lastCatchups.map((c) => {
              const { id: catchupId, count, startAt, endAt } = c;
              return {
                id: catchupId,
                count,
                startAt,
                endAt,
              };
            });
            setPrevCatchups(trimmedCatchups);
            setLastCatchupEndAt(lastCatchups[0].endAt);

            // GC time
            ownCatchups = null;
            lastCatchups = null;

            queueMicrotask(() => {
              if (restCatchups && restCatchups.length) {
                // delete them
                db.catchup
                  .delMany(restCatchups.map((c) => c.id))
                  .then(() => {
                    // GC time
                    restCatchups = null;
                    return undefined;
                  })
                  .catch((e) => {
                    console.error(e);
                  });
              }
            });

            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
      setPrevCatchups([]);
    })();
  }, [reloadCatchupsCount]);
  useEffect(() => {
    if (uiState === 'start') {
      reloadCatchups();
    }
  }, [uiState, reloadCatchups]);

  const [filterCounts, links] = useMemo((): [FilterCounts, TopLink[]] => {
    let filtered = 0,
      groups = 0,
      boosts = 0,
      quotes = 0,
      replies = 0,
      original = 0;
    const linksMap: Record<string, LinkAggregate> = {};
    for (const post of posts) {
      if (post._filtered && post._filtered.action !== 'blur') {
        filtered++;
        post.__FILTER = 'filtered';
      } else if (post.group) {
        groups++;
        post.__FILTER = 'groups';
      } else if (post.reblog) {
        boosts++;
        post.__FILTER = 'boosts';
      } else if (hasQuote(post.quote)) {
        quotes++;
        post.__FILTER = 'quotes';
      } else if (
        post.inReplyToId &&
        post.inReplyToAccountId !== post.account?.id
      ) {
        replies++;
        post.__FILTER = 'replies';
      } else {
        original++;
        post.__FILTER = 'original';
      }

      const thePost: CatchupPost =
        (post.reblog as CatchupPost | null | undefined) || post;
      const card = thePost.card as CardLike | null | undefined;
      if (
        post.__FILTER !== 'filtered' &&
        card?.url &&
        card?.image &&
        card?.type === 'link'
      ) {
        const { favouritesCount, reblogsCount } = thePost;
        let url = card.url.replace(/\/$/, '');
        if (!linksMap[url]) {
          linksMap[url] = {
            postID: thePost.id,
            card,
            shared: 1,
            sharers: [post.account],
            likes: favouritesCount,
            boosts: reblogsCount,
          };
        } else {
          if (linksMap[url].sharers.find((a) => a?.id === post.account.id)) {
            continue;
          }
          linksMap[url].shared++;
          linksMap[url].sharers.push(post.account);
          if (linksMap[url].postID !== thePost.id) {
            linksMap[url].likes += favouritesCount;
            linksMap[url].boosts += reblogsCount;
          }
        }
      }
    }

    let topLinks: TopLink[] = [];
    for (const link in linksMap) {
      topLinks.push({
        ...linksMap[link],
        url: link,
      });
    }
    topLinks.sort((a, b) => {
      if (a.shared > b.shared) return -1;
      if (a.shared < b.shared) return 1;
      if (a.boosts > b.boosts) return -1;
      if (a.boosts < b.boosts) return 1;
      if (a.likes > b.likes) return -1;
      if (a.likes < b.likes) return 1;
      if ((a.quotes ?? 0) > (b.quotes ?? 0)) return -1;
      if ((a.quotes ?? 0) < (b.quotes ?? 0)) return 1;
      return 0;
    });

    // Slice links to shared > 1 but min 10 links
    if (topLinks.length > 10) {
      linksLoop: for (let i = 10; i < topLinks.length; i++) {
        const { shared } = topLinks[i];
        if (shared <= 1) {
          topLinks = topLinks.slice(0, i);
          break linksLoop;
        }
      }
    }

    return [
      {
        filtered,
        groups,
        boosts,
        quotes,
        replies,
        original,
      },
      topLinks,
    ];
  }, [posts]);

  const [selectedFilterCategory, setSelectedFilterCategory] =
    useState<string>('all');
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);

  const [range, setRange] = useState<number>(1);

  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<string>('asc');
  const [groupBy, setGroupBy] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const savedState = store.session.getJSON<CatchupSessionState>(
      `${CATCHUP_NS}-${id}`,
    );
    if (savedState) {
      if (savedState.selectedFilterCategory !== undefined) {
        setSelectedFilterCategory(savedState.selectedFilterCategory);
      }
      if (savedState.selectedAuthor !== undefined) {
        setSelectedAuthor(savedState.selectedAuthor);
      }
      if (savedState.sortBy !== undefined) {
        setSortBy(savedState.sortBy);
      }
      if (savedState.sortOrder !== undefined) {
        setSortOrder(savedState.sortOrder);
      }
      if (savedState.groupBy !== undefined) {
        setGroupBy(savedState.groupBy);
      }
      if (savedState.showTopLinks !== undefined) {
        setShowTopLinks(savedState.showTopLinks);
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id || uiState !== 'results') return;
    const state = {
      selectedFilterCategory,
      selectedAuthor,
      sortBy,
      sortOrder,
      groupBy,
      showTopLinks,
    };
    store.session.setJSON(`${CATCHUP_NS}-${id}`, state);
  }, [
    id,
    uiState,
    selectedFilterCategory,
    selectedAuthor,
    sortBy,
    sortOrder,
    groupBy,
    showTopLinks,
  ]);

  const [filteredPosts, authors, authorCounts] = useMemo((): [
    CatchupPost[],
    Record<string, CatchupPost['account']>,
    Record<string, number>,
  ] => {
    const authorsHash: Record<string, CatchupPost['account']> = {};
    const authorCountsMap = new Map<string, number>();

    let filtered = posts.filter((post) => {
      const postFilterMatches =
        selectedFilterCategory === 'all' ||
        post.__FILTER === selectedFilterCategory;

      if (postFilterMatches) {
        authorsHash[post.account.id] = post.account;
        authorCountsMap.set(
          post.account.id,
          (authorCountsMap.get(post.account.id) || 0) + 1,
        );
      }

      return postFilterMatches;
    });

    // Deduplicate the same canonical post across originals and repost wrappers.
    const seenPosts: Record<string, CatchupPost> = {};
    filtered.forEach((post) => {
      delete post.__HIDDEN;
      delete post.__BOOSTERS;
    });
    filtered.forEach((post) => {
      const postId = canonicalCatchupPostId(post);
      const existing = seenPosts[postId];
      if (!existing) {
        seenPosts[postId] = post;
        return;
      }

      if (post.reblog) {
        const existingBoosters =
          existing.__BOOSTERS || (existing.__BOOSTERS = new Set());
        addCatchupBooster(existingBoosters, post.account);
        post.__HIDDEN = true;
        return;
      }

      if (existing.reblog) {
        const existingBoosters =
          existing.__BOOSTERS || new Set<CatchupBooster>();
        addCatchupBooster(existingBoosters, existing.account);
        post.__BOOSTERS = existingBoosters;
        existing.__HIDDEN = true;
        seenPosts[postId] = post;
        return;
      }

      post.__HIDDEN = true;
    });

    if (selectedAuthor && authorCountsMap.has(selectedAuthor)) {
      filtered = filtered.filter(
        (post) =>
          post.account.id === selectedAuthor ||
          [...(post.__BOOSTERS || [])].find((a) => a.id === selectedAuthor),
      );
    }

    return [filtered, authorsHash, Object.fromEntries(authorCountsMap)];
  }, [selectedFilterCategory, selectedAuthor, posts]);

  const filteredPostsMap = useMemo((): Record<string, CatchupPost> => {
    const map: Record<string, CatchupPost> = {};
    filteredPosts.forEach((post) => {
      map[post.id] = post;
    });
    return map;
  }, [filteredPosts]);

  const authorCountsList = useMemo(
    () =>
      Object.keys(authorCounts).sort(
        (a, b) => authorCounts[b] - authorCounts[a],
      ),
    [authorCounts],
  );

  const sortedFilteredPosts = useMemo((): CatchupPost[] => {
    const authorIndices: Record<string, number> = {};
    authorCountsList.forEach((authorID, index) => {
      authorIndices[authorID] = index;
    });
    return sorted(
      filteredPosts.filter((post) => !post.__HIDDEN),
      (aIn, bIn) => {
        let a: CatchupPost = aIn;
        let b: CatchupPost = bIn;
        if (groupBy === 'account') {
          const aAccountID = a.account.id;
          const bAccountID = b.account.id;
          const aIndex = authorIndices[aAccountID];
          const bIndex = authorIndices[bAccountID];
          const order = aIndex - bIndex;
          if (order !== 0) {
            return order;
          }
        }
        if (sortBy !== 'createdAt') {
          a = (a.reblog as CatchupPost | null | undefined) || a;
          b = (b.reblog as CatchupPost | null | undefined) || b;
          if (sortBy !== 'density' && a[sortBy] === b[sortBy]) {
            return compareCreatedAt(a, b);
          }
        }
        if (sortBy === 'density') {
          const aDensity = postDensity(a);
          const bDensity = postDensity(b);
          if (sortOrder === 'asc') {
            return aDensity > bDensity ? 1 : -1;
          } else {
            return bDensity > aDensity ? 1 : -1;
          }
        }
        if (sortOrder === 'asc') {
          if (sortBy === 'createdAt') return compareCreatedAt(a, b);
          return (a[sortBy] as number | string) > (b[sortBy] as number | string)
            ? 1
            : -1;
        } else {
          if (sortBy === 'createdAt') return compareCreatedAt(b, a);
          return (b[sortBy] as number | string) > (a[sortBy] as number | string)
            ? 1
            : -1;
        }
      },
    );
  }, [filteredPosts, sortBy, sortOrder, groupBy, authorCountsList]);

  const sortedFilteredPostRows = useMemo(() => {
    const keyCounts = new Map<string, number>();
    return sortedFilteredPosts.map((post) => {
      const baseKey = [
        post.id,
        post.reblog?.id ?? '',
        post.createdAt,
        post.reblog?.createdAt ?? '',
        post.account.id,
        catchupBoostersSignature(post),
      ].join('|');
      const keyCount = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, keyCount + 1);
      return {
        post,
        renderKey: keyCount ? `${baseKey}|${keyCount}` : baseKey,
      };
    });
  }, [sortedFilteredPosts]);

  const prevGroup = useRef<string | null>(null);

  const authorsListParent = useRef<HTMLDivElement | null>(null);
  const autoAnimated = useRef<boolean>(false);
  useEffect(() => {
    if (posts.length > 100 || autoAnimated.current) return;
    if (authorsListParent.current) {
      autoAnimate(authorsListParent.current, {
        duration: 200,
      });
      autoAnimated.current = true;
    }
  }, [posts, authorsListParent]);

  const postsBarType = posts.length > 160 ? '3d' : '2d';

  const postsBar = useMemo(() => {
    if (postsBarType !== '2d') return null;
    return posts.map((post) => {
      // If part of filteredPosts
      const postIsFiltered = filteredPostsMap[post.id];
      return (
        <span
          key={post.id}
          className={`post-dot ${postIsFiltered ? 'post-dot-highlight' : ''}`}
        />
      );
    });
  }, [filteredPostsMap, posts, postsBarType]);

  const postsBins = useMemo(() => {
    if (postsBarType !== '3d') return null;
    if (!posts?.length) return null;
    const bins = binByTime(posts, 'createdAt', 320);
    return bins.map((postsInBin, i) => {
      return (
        <div className="posts-bin" key={i}>
          {postsInBin.map((post) => {
            const postIsFiltered = filteredPostsMap[post.id];
            return (
              <span
                key={post.id}
                className={`post-dot ${postIsFiltered ? 'post-dot-highlight' : ''}`}
              />
            );
          })}
        </div>
      );
    });
  }, [filteredPostsMap, posts, postsBarType]);

  const scrollableRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!id || uiState !== 'results' || !scrollableRef.current)
      return undefined;
    if (!sortedFilteredPosts.length) return undefined;

    const savedState = store.session.getJSON<CatchupSessionState>(
      `${CATCHUP_NS}-${id}`,
    );
    if (savedState?.scrollTop !== undefined && savedState.scrollTop > 0) {
      const timeoutId = setTimeout(() => {
        if (scrollableRef.current) {
          scrollableRef.current.scrollTo({
            top: savedState.scrollTop,
            behavior: 'instant' as ScrollBehavior,
          });
        }
      }, 100);

      return () => {
        clearTimeout(timeoutId);
      };
    }
    return undefined;
  }, [id, uiState, sortedFilteredPosts.length]);

  useEffect(() => {
    if (!id || uiState !== 'results' || !scrollableRef.current)
      return undefined;

    const handleScroll = () => {
      if (!scrollableRef.current) return;
      const savedState =
        store.session.getJSON<CatchupSessionState>(`${CATCHUP_NS}-${id}`) ||
        ({} as CatchupSessionState);
      savedState.scrollTop = scrollableRef.current.scrollTop;
      store.session.setJSON(`${CATCHUP_NS}-${id}`, savedState);
    };

    const scrollElement = scrollableRef.current;
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [id, uiState]);

  // if range value exceeded lastCatchupEndAt, show error
  const lastCatchupRange = useMemo(() => {
    // return hour, not ms
    if (!lastCatchupEndAt) return null;
    return (Date.now() - lastCatchupEndAt) / 1000 / 60 / 60;
  }, [lastCatchupEndAt]);

  useEffect(() => {
    if (uiState !== 'results') return undefined;
    const authorUsername =
      selectedAuthor && authors[selectedAuthor]
        ? authors[selectedAuthor].username
        : '';
    const sortOrderIndex = sortOrder === 'asc' ? 0 : 1;
    const groupByText = {
      account: 'authors',
    };
    // Unused locals retained for behavioral parity with the original JS.
    void authorUsername;
    void sortOrderIndex;
    void groupByText;
    const toast = showToast({
      duration: 5_000, // 5 seconds
      // Note: I'm sorry, translators
      text: t`Showing ${select(selectedFilterCategory, {
        all: 'all posts',
        original: 'original posts',
        replies: 'replies',
        boosts: 'reposts',
        quotes: 'quotes',
        groups: 'groups',
        filtered: 'filtered posts',
        other: '',
      })}, ${select(sortBy, {
        createdAt: select(sortOrder, {
          asc: 'oldest',
          desc: 'latest',
          other: '',
        }),
        reblogsCount: select(sortOrder, {
          asc: 'fewest reposts',
          desc: 'most reposts',
          other: '',
        }),
        favouritesCount: select(sortOrder, {
          asc: 'fewest likes',
          desc: 'most likes',
          other: '',
        }),
        repliesCount: select(sortOrder, {
          asc: 'fewest replies',
          desc: 'most replies',
          other: '',
        }),
        density: select(sortOrder, {
          asc: 'least dense',
          desc: 'most dense',
          other: '',
        }),
        other: '',
      })} first${select(groupBy ?? '', {
        account: ', grouped by authors',
        other: '',
      })}`,
    });
    return () => {
      (toast as { hideToast?: () => void } | null | undefined)?.hideToast?.();
    };
  }, [
    uiState,
    selectedFilterCategory,
    selectedAuthor,
    sortBy,
    sortOrder,
    groupBy,
    authors,
    t,
  ]);

  const scrollSelectedAuthorIntoView = useEffectEvent(() => {
    if (selectedAuthor) {
      if (authors[selectedAuthor]) {
        // Check if author is visible and within the scrollable area viewport
        const authorsList = authorsListParent.current;
        const authorElement = authorsList?.querySelector<HTMLElement>(
          `[data-author="${selectedAuthor}"]`,
        );
        const scrollableRect =
          authorsListParent.current?.getBoundingClientRect();
        const authorRect = authorElement?.getBoundingClientRect();
        if (!scrollableRect || !authorRect || !authorElement) return;
        console.log({
          sLeft: scrollableRect.left,
          sRight: scrollableRect.right,
          aLeft: authorRect.left,
          aRight: authorRect.right,
        });
        if (
          authorRect.left < scrollableRect.left ||
          authorRect.right > scrollableRect.right
        ) {
          authorElement.scrollIntoView({
            block: 'nearest',
            inline: 'center',
            behavior: 'smooth',
          });
        } else if (authorRect.top < 0) {
          authorElement.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'smooth',
          });
        }
      }
    }
  });
  useEffect(() => {
    scrollSelectedAuthorIntoView();
  }, [selectedAuthor, authors]);

  const [showHelp, setShowHelp] = useState(false);

  const itemsSelector = '.catchup-list > li > a';
  const jRef = useHotkeys<HTMLDivElement>(
    'j',
    () => {
      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ??
          [],
      );
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        const nextItem = allItems[activeItemIndex + 1];
        if (nextItem) {
          nextItem.focus();
          nextItem.scrollIntoView({
            block: 'center',
            inline: 'center',
            behavior: 'instant' as ScrollBehavior,
          });
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView({
            block: 'nearest',
            inline: 'center',
            behavior: 'instant' as ScrollBehavior,
          });
        }
      }
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'j',
    },
  );

  const kRef = useHotkeys<HTMLDivElement>(
    'k',
    () => {
      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ??
          [],
      );
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        const prevItem = allItems[activeItemIndex - 1];
        if (prevItem) {
          prevItem.focus();
          prevItem.scrollIntoView({
            block: 'center',
            inline: 'center',
            behavior: 'instant' as ScrollBehavior,
          });
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView({
            block: 'nearest',
            inline: 'center',
            behavior: 'instant' as ScrollBehavior,
          });
        }
      }
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  const hlRef = useHotkeys<HTMLDivElement>(
    'h, l',
    (_e, handler) => {
      // Go next/prev selectedAuthor in authorCountsList list
      const key = handler.keys?.[0];
      if (selectedAuthor) {
        const index = authorCountsList.indexOf(selectedAuthor);
        if (key === 'h') {
          if (index > 0 && index < authorCountsList.length) {
            setSelectedAuthor(authorCountsList[index - 1]);
            scrollableRef.current?.focus();
          }
        } else if (key === 'l') {
          if (index < authorCountsList.length - 1 && index >= 0) {
            setSelectedAuthor(authorCountsList[index + 1]);
            scrollableRef.current?.focus();
          }
        }
      } else if (key === 'l') {
        setSelectedAuthor(authorCountsList[0]);
        scrollableRef.current?.focus();
      }
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        !['h', 'l'].includes(e.key.toLowerCase()),
      enableOnFormTags: ['input'],
    },
  );

  const escRef = useHotkeys<HTMLDivElement>(
    'esc',
    () => {
      setSelectedAuthor(null);
      scrollableRef.current?.focus();
    },
    {
      preventDefault: true,
      ignoreEventWhen: (e) => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
      enableOnFormTags: ['input'],
      useKey: true,
    },
  );

  const dotRef = useHotkeys<HTMLDivElement>(
    '.',
    () => {
      scrollableRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) => {
        // Allow '.' even with Shift (some keyboard layouts require Shift for '.')
        if (e.key === '.') return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
      enableOnFormTags: ['input'],
    },
  );

  const handleArrowKeys = useCallback((e: React.KeyboardEvent) => {
    const activeElement = document.activeElement as
      | (HTMLElement & { type?: string })
      | null;
    const isRadio =
      activeElement?.tagName === 'INPUT' && activeElement.type === 'radio';
    const isArrowKeys =
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight';
    if (isArrowKeys && isRadio) {
      // Note: page scroll won't trigger on first arrow key press due to this. Subsequent presses will.
      activeElement?.blur();
      return;
    }
  }, []);

  return (
    <div
      ref={(node) => {
        scrollableRef.current = node;
        jRef.current = node;
        kRef.current = node;
        hlRef.current = node;
        escRef.current = node;
        dotRef.current = node;
      }}
      id="catchup-page"
      className="deck-container"
      tabIndex={-1}
    >
      <div className="timeline-deck deck wide">
        {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
            click-to-scroll on the header; semantically a non-interactive
            scrollback affordance, not a button. Keyboard equivalent is the
            standard browser Home key on the focusable container. */}
        <header
          className={uiState === 'loading' ? 'loading' : ''}
          role="presentation"
          onClick={(e) => {
            if (!(e.target as HTMLElement | null)?.closest('a, button')) {
              scrollableRef.current?.scrollTo({
                top: 0,
                behavior: 'smooth',
              });
            }
          }}
        >
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              {uiState === 'results' && (
                <Link to="/catchup" className="button plain">
                  <Icon icon="history2" size="l" alt={t`Catch-up`} />
                </Link>
              )}
              {uiState === 'start' && (
                <Link to="/" className="button plain">
                  <Icon icon="home" size="l" alt={t`Home`} />
                </Link>
              )}
            </div>
            <h1>
              {uiState !== 'start' && (
                <Trans>
                  Catch-up <sup>beta</sup>
                </Trans>
              )}
            </h1>
            <div className="header-side">
              {uiState !== 'start' && uiState !== 'loading' && (
                <button
                  type="button"
                  className="plain"
                  onClick={() => {
                    setShowHelp(true);
                  }}
                >
                  <Trans>Help</Trans>
                </button>
              )}
            </div>
          </div>
        </header>
        <main onKeyDown={handleArrowKeys}>
          {uiState === 'start' && (
            <div className="catchup-start">
              <h1>
                <Trans>
                  Catch-up <sup>beta</sup>
                </Trans>
              </h1>
              <details>
                <summary>
                  <Trans>What is this?</Trans>
                </summary>
                <p>
                  <Trans>
                    Catch-up is a separate timeline for your followings,
                    offering a high-level view at a glance, with a simple,
                    email-inspired interface to effortlessly sort and filter
                    through posts.
                  </Trans>
                </p>
                <img
                  src={catchupUrl}
                  width="1200"
                  height="900"
                  alt={t`Preview of Catch-up UI`}
                />
                <p>
                  <button
                    type="button"
                    onClick={(e) => {
                      (
                        (e.target as HTMLElement).closest(
                          'details',
                        ) as HTMLDetailsElement
                      ).open = false;
                    }}
                  >
                    <Trans>Let's catch up</Trans>
                  </button>
                </p>
              </details>
              <p>
                <Trans>Let's catch up on the posts from your followings.</Trans>
              </p>
              <p>
                <b>
                  <Trans>Show me all posts from…</Trans>
                </b>
              </p>
              <div className="catchup-form">
                <input
                  ref={catchupRangeRef}
                  type="range"
                  value={range}
                  min={RANGES[0].value}
                  max={RANGES[RANGES.length - 1].value}
                  step="1"
                  list="catchup-ranges"
                  onChange={(e) => {
                    setRange(+(e.target as HTMLInputElement).value);
                  }}
                />{' '}
                <span
                  style={{
                    width: '8em',
                  }}
                >
                  {_(RANGES[range - 1].label)}
                  <br />
                  <small className="insignificant">
                    {range == RANGES[RANGES.length - 1].value
                      ? t`until the max`
                      : niceDateTime(
                          new Date(Date.now() - range * 60 * 60 * 1000),
                        )}
                  </small>
                </span>
                <datalist id="catchup-ranges">
                  {RANGES.map(({ label, value }) => (
                    <option key={value} value={value} label={_(label)} />
                  ))}
                </datalist>{' '}
                <button
                  type="button"
                  onClick={() => {
                    let duration: number | undefined;
                    const beyondRange = RANGES.find((r) => r.beyond);
                    if (beyondRange && range < beyondRange.value) {
                      // Within range
                      duration = range * 60 * 60 * 1000;
                    } else {
                      // Beyond range
                      const untilLastCatchup = catchupLastRef.current?.checked;
                      if (untilLastCatchup) {
                        // Until last catch-up's end time
                        duration = Date.now() - (lastCatchupEndAt as number);
                      } else {
                        // Go beyond range until max, even after last catch-up's end time
                        // Don't need to set duration
                      }
                    }
                    void handleCatchupClick({ duration });
                  }}
                >
                  <Trans>Catch up</Trans>
                </button>
              </div>
              {lastCatchupRange && range > lastCatchupRange ? (
                <p className="catchup-info">
                  <Icon icon="info" />{' '}
                  <Trans>Overlaps with your last catch-up</Trans>
                </p>
              ) : range === RANGES[RANGES.length - 1].value &&
                lastCatchupEndAt ? (
                <p className="catchup-info">
                  <label>
                    <input
                      type="checkbox"
                      {...({ switch: true } as { switch?: boolean })}
                      checked
                      ref={catchupLastRef}
                    />{' '}
                    <Trans>
                      Until the last catch-up (
                      {dtf.format(new Date(lastCatchupEndAt))})
                    </Trans>
                  </label>
                </p>
              ) : null}
              <p className="insignificant">
                <small>
                  <Trans>
                    Note: the Home timeline might only show a limited number of
                    posts regardless of the time range.
                  </Trans>
                </small>
              </p>
              {!!prevCatchups?.length && (
                <div className="catchup-prev">
                  <p>
                    <Trans>Previously…</Trans>
                  </p>
                  <ul>
                    {prevCatchups.map((pc) => (
                      <li key={pc.id}>
                        <Link to={`/catchup?id=${pc.id}`}>
                          <Icon icon="history2" />{' '}
                          <span>
                            {pc.startAt
                              ? dtf.formatRange(
                                  new Date(pc.startAt),
                                  new Date(pc.endAt),
                                )
                              : `… – ${dtf.format(new Date(pc.endAt))}`}
                          </span>
                        </Link>{' '}
                        <span>
                          <small className="ib insignificant">
                            <Plural
                              value={pc.count}
                              one="# post"
                              other="# posts"
                            />
                          </small>{' '}
                          <button
                            type="button"
                            className="light danger small"
                            onClick={() => {
                              const yes = confirm(t`Remove this catch-up?`);
                              if (!yes) return;
                              void (async () => {
                                let st = showToast(
                                  t`Removing Catch-up ${pc.id}`,
                                );
                                await db.catchup.del(pc.id);
                                st?.hideToast?.();
                                showToast(t`Catch-up ${pc.id} removed`);
                                reloadCatchups();
                              })();
                            }}
                          >
                            <Icon icon="x" alt={t`Remove`} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {prevCatchups.length >= 3 && (
                    <p>
                      <small>
                        <Trans>
                          Note: Only max 3 will be stored. The rest will be
                          automatically removed.
                        </Trans>
                      </small>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {uiState === 'loading' && (
            <div className="ui-state catchup-start">
              <Loader abrupt />
              <p className="insignificant">
                <Trans>Fetching posts…</Trans>
              </p>
              <p className="insignificant">
                <Trans>This might take a while.</Trans>
              </p>
            </div>
          )}
          {uiState === 'results' && (
            <>
              <div className="catchup-header">
                {posts.length > 0 && (
                  <p>
                    <b className="ib">
                      {dtf.formatRange(
                        new Date(posts[0].createdAt),
                        new Date(posts[posts.length - 1].createdAt),
                      )}
                    </b>
                  </p>
                )}
                <aside>
                  <button
                    hidden={
                      selectedFilterCategory === 'all' &&
                      !selectedAuthor &&
                      sortBy === 'createdAt' &&
                      sortOrder === 'asc'
                    }
                    type="button"
                    className="plain4 small"
                    onClick={() => {
                      setSelectedFilterCategory('all');
                      setSelectedAuthor(null);
                      setSortBy('createdAt');
                      setGroupBy(null);
                      setSortOrder('asc');
                    }}
                  >
                    <Trans>Reset filters</Trans>
                  </button>
                  {links?.length > 0 && (
                    <button
                      type="button"
                      className="plain small"
                      onClick={() => {
                        setShowTopLinks(!showTopLinks);
                      }}
                    >
                      <Trans>Top links</Trans>{' '}
                      <Icon
                        icon="chevron-down"
                        style={{
                          transform: showTopLinks
                            ? 'rotate(180deg)'
                            : 'rotate(0deg)',
                        }}
                      />
                    </button>
                  )}
                </aside>
              </div>
              <div
                className="shazam-container no-animation"
                hidden={!showTopLinks}
              >
                <div className="shazam-container-inner">
                  <div className="catchup-top-links links-bar">
                    {links.map((link) => {
                      const { card, sharers } = link;
                      const {
                        blurhash,
                        title,
                        description,
                        url,
                        image,
                        imageDescription,
                        language,
                        width,
                        height,
                        publishedAt,
                      } = card;
                      const domain = getDomain(url as string);
                      let accentColor;
                      if (blurhash) {
                        const averageColor = getBlurHashAverageColor(blurhash);
                        const labAverageColor = rgb2oklab(averageColor);
                        accentColor = oklab2rgb([
                          0.6,
                          labAverageColor[1],
                          labAverageColor[2],
                        ]);
                      }

                      return (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link-block"
                          style={
                            accentColor
                              ? {
                                  '--accent-color': `rgb(${accentColor.join(
                                    ',',
                                  )})`,
                                  '--accent-alpha-color': `rgba(${accentColor.join(
                                    ',',
                                  )}, 0.4)`,
                                }
                              : {}
                          }
                        >
                          <article>
                            <figure>
                              <img
                                src={image ?? undefined}
                                alt={imageDescription}
                                width={width}
                                height={height}
                                loading="lazy"
                              />
                            </figure>
                            <div className="article-body">
                              <header>
                                <div className="article-meta">
                                  <span className="domain">{domain}</span>{' '}
                                  {!!publishedAt && <>&middot; </>}
                                  {!!publishedAt && (
                                    <>
                                      <RelativeTime
                                        dateTime={publishedAt}
                                        format="micro"
                                      />
                                    </>
                                  )}
                                </div>
                                {!!title && (
                                  <h1
                                    className="title"
                                    lang={language}
                                    dir="auto"
                                    title={title}
                                  >
                                    {title}
                                  </h1>
                                )}
                              </header>
                              {!!description && (
                                <p
                                  className="description"
                                  lang={language}
                                  dir="auto"
                                  title={description}
                                >
                                  {description}
                                </p>
                              )}
                              <hr />
                              <p
                                style={{
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <Trans>
                                  Shared by{' '}
                                  {sharers.map((s) => {
                                    const {
                                      id: sharerId,
                                      avatarStatic,
                                      displayName,
                                    } = s;
                                    return (
                                      <button
                                        key={sharerId}
                                        type="button"
                                        className="plain"
                                        style={{
                                          padding: 0,
                                        }}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          // Reset and filter to author
                                          setSelectedAuthor(sharerId);
                                          setSelectedFilterCategory('all');
                                        }}
                                      >
                                        <Avatar
                                          url={avatarStatic}
                                          size="s"
                                          alt={displayName}
                                        />
                                      </button>
                                    );
                                  })}
                                </Trans>
                              </p>
                            </div>
                          </article>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
              {posts.length >= 5 &&
                (postsBarType === '3d' ? (
                  <div className="catchup-posts-viz-time-bar">{postsBins}</div>
                ) : (
                  <div className="catchup-posts-viz-bar">{postsBar}</div>
                ))}
              {posts.length >= 2 && (
                <div className="catchup-filters">
                  <label className="filter-cat">
                    <input
                      type="radio"
                      name="filter-cat"
                      checked={selectedFilterCategory.toLowerCase() === 'all'}
                      onChange={() => {
                        setSelectedFilterCategory('all');
                      }}
                    />
                    <Trans>All</Trans>{' '}
                    <span className="count">{posts.length}</span>
                  </label>
                  {Object.entries(FILTER_KEYS).map(
                    ([key, label]) =>
                      !!filterCounts[key] && (
                        <label
                          className="filter-cat"
                          key={_(label)}
                          title={
                            ((filterCounts[key] / posts.length) * 100).toFixed(
                              2,
                            ) + '%'
                          }
                        >
                          <input
                            type="radio"
                            name="filter-cat"
                            checked={
                              selectedFilterCategory.toLowerCase() ===
                              key.toLowerCase()
                            }
                            onChange={() => {
                              setSelectedFilterCategory(key);
                              if (key === 'boosts') {
                                setSortBy('reblogsCount');
                                setSortOrder('desc');
                                setGroupBy(null);
                              }
                              // setSelectedAuthor(null);
                            }}
                          />
                          {_(label)}{' '}
                          <span className="count">{filterCounts[key]}</span>
                        </label>
                      ),
                  )}
                </div>
              )}
              {posts.length >= 2 && !!authorCounts && (
                <div
                  className="catchup-filters authors-filters"
                  ref={authorsListParent}
                >
                  {authorCountsList.map((author) => (
                    <label
                      className="filter-author"
                      data-author={author}
                      key={`${author}-${authorCounts[author]}`}
                      // Keep the extra key stable across reordered grouped authors`author`
                      // Legacy ordering note removed during React migration
                    >
                      <input
                        type="radio"
                        name="filter-author"
                        checked={selectedAuthor === author}
                        onChange={() => {
                          setSelectedAuthor(author);
                          // setGroupBy(null);
                        }}
                        onClick={() => {
                          if (selectedAuthor === author) {
                            setSelectedAuthor(null);
                          }
                        }}
                      />
                      <Avatar
                        url={
                          authors[author].avatarStatic || authors[author].avatar
                        }
                        size="xxl"
                        alt={`${authors[author].displayName} (@${authors[author].acct})`}
                      />{' '}
                      <span className="count">{authorCounts[author]}</span>
                      <span className="username">
                        {authors[author].username}
                      </span>
                    </label>
                  ))}
                  {authorCountsList.length > 5 && (
                    <small
                      key="authors-count"
                      style={{
                        whiteSpace: 'nowrap',
                        paddingInline: '1em',
                        opacity: 0.33,
                      }}
                    >
                      <Plural
                        value={authorCountsList.length}
                        one="# author"
                        other="# authors"
                      />
                    </small>
                  )}
                </div>
              )}
              {posts.length >= 2 && (
                <div className="catchup-filters">
                  <span className="filter-label">
                    <Trans>Sort</Trans>
                  </span>{' '}
                  <fieldset className="radio-field-group">
                    {FILTER_SORTS.map((key) => (
                      <label
                        className="filter-sort"
                        key={key}
                        onClick={(e) => {
                          if (sortBy === key) {
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
                            const order =
                              /(replies|favourites|reblogs|quotes)/.test(key)
                                ? 'desc'
                                : 'asc';
                            setSortOrder(order);
                          }}
                        />
                        {
                          {
                            createdAt: t`Date`,
                            repliesCount: t`Replies`,
                            favouritesCount: t`Likes`,
                            reblogsCount: t`Reposts`,
                            quotesCount: t`Quotes`,
                            density: t`Density`,
                          }[key]
                        }
                        {sortBy === key && (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                      </label>
                    ))}
                  </fieldset>
                  {/* <fieldset className="radio-field-group">
                    {['asc', 'desc'].map((key) => (
                      <label className="filter-sort" key={key}>
                        <input
                          type="radio"
                          name="filter-sort-dir"
                          checked={sortOrder === key}
                          onChange={() => {
                            setSortOrder(key);
                          }}
                        />
                        {key === 'asc' ? '↑' : '↓'}
                      </label>
                    ))}
                  </fieldset> */}
                  <span className="filter-label">
                    <Trans id="group.filter">Group</Trans>
                  </span>{' '}
                  <fieldset className="radio-field-group">
                    {FILTER_GROUPS.map((key) => (
                      <label className="filter-group" key={key || 'none'}>
                        <input
                          type="radio"
                          name="filter-group"
                          checked={groupBy === key}
                          onChange={() => {
                            setGroupBy(key);
                          }}
                          disabled={!!(key === 'account' && selectedAuthor)}
                        />
                        {(key !== null &&
                          (
                            {
                              account: t`Authors`,
                            } as Record<string, string>
                          )[key]) ||
                          t`None`}
                      </label>
                    ))}
                  </fieldset>
                  {
                    selectedAuthor && authorCountsList.length > 1 ? (
                      <button
                        type="button"
                        className="plain6 small"
                        onClick={() => {
                          setSelectedAuthor(null);
                        }}
                        style={{
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Trans>Show all authors</Trans>
                      </button>
                    ) : null
                    // <button
                    //   type="button"
                    //   className="plain4 small"
                    //   onClick={() => {}}
                    // >
                    //   Group by authors
                    // </button>
                  }
                </div>
              )}
              <ul
                className={`catchup-list catchup-filter-${
                  selectedFilterCategory || ''
                } ${sortBy ? `catchup-sort-${sortBy}` : ''} ${
                  selectedAuthor && authors[selectedAuthor]
                    ? `catchup-selected-author`
                    : ''
                } ${groupBy ? `catchup-group-${groupBy}` : ''}`}
              >
                {sortedFilteredPostRows.map(({ post, renderKey }, i) => {
                  const postId = post.reblog?.id || post.id;
                  let showSeparator = false;
                  if (groupBy === 'account') {
                    if (
                      prevGroup.current &&
                      post.account.id !== prevGroup.current &&
                      i > 0
                    ) {
                      showSeparator = true;
                    }
                    prevGroup.current = post.account.id;
                  }
                  return (
                    <Fragment key={`${renderKey}-${showSeparator}`}>
                      {showSeparator && <li className="separator" />}
                      <li>
                        <Link to={`/${instance}/s/${postId}`}>
                          <PostLine post={post} />
                        </Link>
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
              <footer>
                {filteredPosts.length > 5 && (
                  <p>
                    {selectedFilterCategory === 'boosts'
                      ? t`You don't have to read everything.`
                      : t`That's all.`}{' '}
                    <button
                      type="button"
                      className="textual"
                      onClick={() => {
                        if (scrollableRef.current) {
                          scrollableRef.current.scrollTop = 0;
                        }
                      }}
                    >
                      <Trans>Back to top</Trans>
                    </button>
                    .
                  </p>
                )}
              </footer>
            </>
          )}
        </main>
      </div>
      {showHelp && (
        <Modal
          onClose={() => {
            setShowHelp(false);
          }}
        >
          <div className="sheet" id="catchup-help-sheet">
            <button
              type="button"
              className="sheet-close"
              onClick={() => {
                setShowHelp(false);
              }}
            >
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <h2>
                <Trans>Help</Trans>
              </h2>
            </header>
            <main>
              <dl>
                <dt>
                  <Trans>Top links</Trans>
                </dt>
                <dd>
                  <Trans>
                    Links shared by followings, sorted by shared counts, reposts
                    and likes.
                  </Trans>
                </dd>
                <dt>
                  <Trans>Sort: Density</Trans>
                </dt>
                <dd>
                  <Trans>
                    Posts are sorted by information density or depth. Shorter
                    posts are "lighter" while longer posts are "heavier". Posts
                    with photos are "heavier" than posts without photos.
                  </Trans>
                </dd>
                <dt>
                  <Trans>Group: Authors</Trans>
                </dt>
                <dd>
                  <Trans>
                    Posts are grouped by authors, sorted by posts count per
                    author.
                  </Trans>
                </dd>
                <dt>
                  <Trans>Keyboard shortcuts</Trans>
                </dt>
                {/* <dd>
                  <kbd>j</kbd>: <Trans>Next post</Trans>
                </dd>
                <dd>
                  <kbd>k</kbd>: <Trans>Previous post</Trans>
                </dd>
                <dd>
                  <kbd>l</kbd>: <Trans>Next author</Trans>
                </dd>
                <dd>
                  <kbd>h</kbd>: <Trans>Previous author</Trans>
                </dd>
                <dd>
                  <kbd>Enter</kbd>: <Trans>Open post details</Trans>
                </dd>
                <dd>
                  <kbd>.</kbd>: <Trans>Scroll to top</Trans>
                </dd> */}
                <dd>
                  <table>
                    <tbody>
                      <tr>
                        <td>
                          <Trans>Next post</Trans>
                        </td>
                        <td>
                          <kbd>j</kbd>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <Trans>Previous post</Trans>
                        </td>
                        <td>
                          <kbd>k</kbd>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <Trans>Next author</Trans>
                        </td>
                        <td>
                          <kbd>l</kbd>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <Trans>Previous author</Trans>
                        </td>
                        <td>
                          <kbd>h</kbd>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <Trans>Open post details</Trans>
                        </td>
                        <td>
                          <kbd>Enter</kbd>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <Trans>Scroll to top</Trans>
                        </td>
                        <td>
                          <kbd>.</kbd>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </dd>
              </dl>
            </main>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface PostLineProps {
  post: CatchupPost;
}

const PostLine = memo(
  function ({ post }: PostLineProps) {
    const {
      account,
      group,
      reblog,
      quote,
      inReplyToId,
      inReplyToAccountId,
      _filtered: filterInfo,
      visibility,
      __BOOSTERS,
    } = post;
    const isReplyTo = inReplyToId && inReplyToAccountId !== account.id;
    const postIsFiltered = !!filterInfo && filterInfo.action !== 'blur';

    const debugHover = (e: React.MouseEvent) => {
      if (e.shiftKey) {
        console.log({
          ...post,
        });
      }
    };

    return (
      <article
        className={`post-line ${
          group
            ? 'group'
            : reblog
              ? 'reblog'
              : hasQuote(quote)
                ? 'quote'
                : ''
        } ${isReplyTo ? 'reply-to' : ''} ${
          postIsFiltered ? 'filtered' : ''
        } visibility-${visibility}`}
        onMouseEnter={debugHover}
      >
        <span className="post-author">
          {reblog ? (
            <span className="post-reblog-avatar">
              <Avatar
                url={account.avatarStatic || account.avatar}
                alt={catchupBoosterLabel(account)}
                squircle={account.bot}
              />
              {__BOOSTERS && __BOOSTERS.size > 0
                ? [...__BOOSTERS].map((b) => (
                    <Avatar
                      key={b.id}
                      url={b.avatarStatic || b.avatar}
                      alt={catchupBoosterLabel(b)}
                      squircle={b.bot}
                    />
                  ))
                : ''}{' '}
              <Icon icon="rocket" />{' '}
              {/* <Avatar
              url={reblog.account.avatarStatic || reblog.account.avatar}
              squircle={reblog.account.bot}
            /> */}
              <NameText account={reblog.account} showAvatar />
            </span>
          ) : hasQuote(quote) ? (
            <span className="post-quote-avatar">
              {__BOOSTERS && __BOOSTERS.size > 0
                ? [...__BOOSTERS].map((b) => (
                    <Avatar
                      key={b.id}
                      url={b.avatarStatic || b.avatar}
                      alt={catchupBoosterLabel(b)}
                      squircle={b.bot}
                    />
                  ))
                : null}
              <Avatar
                url={account.avatarStatic || account.avatar}
                squircle={account.bot}
              />{' '}
              <Icon icon="quote" />{' '}
              <NameText account={quoteNameTextAccount(quote)} showAvatar />
            </span>
          ) : __BOOSTERS && __BOOSTERS.size > 0 ? (
            <span className="post-reblog-avatar">
              {[...__BOOSTERS].map((b) => (
                <Avatar
                  key={b.id}
                  url={b.avatarStatic || b.avatar}
                  alt={catchupBoosterLabel(b)}
                  squircle={b.bot}
                />
              ))}{' '}
              <Icon icon="rocket" /> <NameText account={account} showAvatar />
            </span>
          ) : (
            <NameText account={account} showAvatar />
          )}
        </span>
        <PostPeek
          post={(reblog as CatchupPost | null | undefined) || post}
          filterInfo={filterInfo}
        />
        <span className="post-meta">
          <PostStats
            post={(reblog as CatchupPost | null | undefined) || post}
          />{' '}
          <RelativeTime
            dateTime={new Date(reblog?.createdAt || post.createdAt)}
            format="micro"
          />
        </span>
      </article>
    );
  },
  (oldProps, newProps) => {
    return oldProps?.post?.id === newProps?.post?.id;
  },
);

// A media speak a thousand words
const MEDIA_DENSITY = 8;
const CARD_DENSITY = 8;
function postDensity(post: CatchupPost): number {
  const { spoilerText, content, mediaAttachments, card } = post;
  const density =
    (spoilerText.length + htmlContentLength(content)) / 140 +
    (mediaAttachments?.length
      ? MEDIA_DENSITY * mediaAttachments.length
      : (card as CardLike | null | undefined)?.image
        ? CARD_DENSITY
        : 0);
  return density;
}

const MEDIA_SIZE = 48;

interface PostPeekProps {
  post: CatchupPost;
  filterInfo?: FilterInfo;
}

function PostPeek({ post, filterInfo }: PostPeekProps) {
  const { t } = useLingui();
  let {
    spoilerText,
    sensitive,
    content,
    emojis,
    mediaAttachments,
    card,
    inReplyToId,
    inReplyToAccountId,
    account,
    _thread,
    quote,
  } = post;
  const isThread =
    (inReplyToId && inReplyToAccountId === account.id) || !!_thread;
  let theQuote: QuoteLike | null = hasQuote(quote)
    ? quoteLike(quote)
    : null;
  if (theQuote?.spoilerText || theQuote?.sensitive) theQuote = null;
  if (theQuote?.emojis) emojis.push(...theQuote.emojis);
  if (!mediaAttachments?.length && theQuote?.mediaAttachments?.length) {
    mediaAttachments = theQuote.mediaAttachments;
  }
  const cardLike = card as CardLike | null | undefined;

  const prefs = getPreferences();
  const readingExpandSpoilers = !!prefs['reading:expand:spoilers'];
  // const readingExpandSpoilers = true;
  const showMedia =
    readingExpandSpoilers ||
    (!spoilerText &&
      !sensitive &&
      (filterInfo ? filterInfo.action !== 'blur' : true));
  const postText = content ? statusPeek(toStatusPeekInput(post)) : '';

  const showPostContent = !spoilerText || readingExpandSpoilers;

  return (
    <div className="post-peek" title={!spoilerText ? postText : ''}>
      <span className="post-peek-content">
        {isThread && !showPostContent && (
          <>
            <span className="post-peek-tag post-peek-thread">Thread</span>{' '}
          </>
        )}
        {!!filterInfo && filterInfo?.action !== 'blur' ? (
          <span className="post-peek-filtered">
            {/* Filtered{filterInfo?.titlesStr ? `: ${filterInfo.titlesStr}` : ''} */}
            {filterInfo?.titlesStr
              ? t`Filtered: ${filterInfo.titlesStr}`
              : t`Filtered`}
          </span>
        ) : (
          <>
            {!!spoilerText && (
              <span className="post-peek-spoiler">
                <Icon icon={readingExpandSpoilers ? 'eye-open' : 'eye-close'} />{' '}
                {spoilerText}
              </span>
            )}
            {showPostContent && (
              <div className="post-peek-html">
                {isThread && (
                  <>
                    <span className="post-peek-tag post-peek-thread">
                      <Trans>Thread</Trans>
                    </span>{' '}
                  </>
                )}
                {!!content && (
                  <RawHtml
                    html={
                      emojifyText(content, emojis) +
                      (theQuote?.content
                        ? `<blockquote class="post-peek-quote">${theQuote.content}</blockquote>`
                        : '')
                    }
                  />
                )}
                {!content &&
                  mediaAttachments?.length === 1 &&
                  mediaAttachments[0].description && (
                    <>
                      <span className="post-peek-tag post-peek-alt">ALT</span>{' '}
                      <div>{mediaAttachments[0].description}</div>
                    </>
                  )}
              </div>
            )}
          </>
        )}
      </span>
      {(!filterInfo || filterInfo?.action === 'blur') && (
        <span className="post-peek-post-content">
          {mediaAttachments?.length
            ? mediaAttachments.map((m: mastodon.v1.MediaAttachment) => {
                const mediaURL = m.previewUrl || m.url;
                const remoteMediaURL = m.previewRemoteUrl || m.remoteUrl;
                const mMeta = m.meta as
                  | {
                      original?: { width?: number; height?: number };
                      small?: { width?: number; height?: number };
                    }
                  | null
                  | undefined;
                const width = mMeta?.original
                  ? mMeta.original.width
                  : mMeta?.small?.width || mMeta?.original?.width;
                const height = mMeta?.original
                  ? mMeta.original.height
                  : mMeta?.small?.height || mMeta?.original?.height;
                const mediaByType: Record<string, JSX.Element> = {
                  image:
                    (mediaURL || remoteMediaURL) && showMedia ? (
                      <img
                        src={mediaURL ?? undefined}
                        width={MEDIA_SIZE}
                        height={MEDIA_SIZE}
                        alt={m.description ?? undefined}
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const { src } = target;
                          if (
                            src === mediaURL &&
                            remoteMediaURL &&
                            mediaURL !== remoteMediaURL
                          ) {
                            target.src = remoteMediaURL;
                          }
                        }}
                        style={{
                          '--anim-duration': `${Math.min(
                            Math.max(
                              Math.max(width ?? 0, height ?? 0) / 100,
                              5,
                            ),
                            120,
                          )}s`,
                        }}
                      />
                    ) : (
                      <span className="post-peek-faux-media">🖼</span>
                    ),
                  gifv:
                    (mediaURL || remoteMediaURL) && showMedia ? (
                      <img
                        src={mediaURL ?? undefined}
                        width={MEDIA_SIZE}
                        height={MEDIA_SIZE}
                        alt={m.description ?? undefined}
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const { src } = target;
                          if (
                            src === mediaURL &&
                            remoteMediaURL &&
                            mediaURL !== remoteMediaURL
                          ) {
                            target.src = remoteMediaURL;
                          }
                        }}
                      />
                    ) : (
                      <span className="post-peek-faux-media">🎞️</span>
                    ),
                  video:
                    (mediaURL || remoteMediaURL) && showMedia ? (
                      <img
                        src={mediaURL ?? undefined}
                        width={MEDIA_SIZE}
                        height={MEDIA_SIZE}
                        alt={m.description ?? undefined}
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const { src } = target;
                          if (
                            src === mediaURL &&
                            remoteMediaURL &&
                            mediaURL !== remoteMediaURL
                          ) {
                            target.src = remoteMediaURL;
                          }
                        }}
                      />
                    ) : (
                      <span className="post-peek-faux-media">📹</span>
                    ),
                  audio: <span className="post-peek-faux-media">🎵</span>,
                };
                return (
                  <span key={m.id} className="post-peek-media">
                    {mediaByType[m.type as string] || null}
                  </span>
                );
              })
            : !!cardLike &&
              cardLike.image &&
              showMedia && (
                <span
                  className={`post-peek-media post-peek-card card-${
                    cardLike.type || ''
                  }`}
                >
                  {cardLike.image ? (
                    <img
                      src={cardLike.image}
                      width={MEDIA_SIZE}
                      height={MEDIA_SIZE}
                      alt={
                        cardLike.title ||
                        cardLike.description ||
                        cardLike.imageDescription
                      }
                      loading="lazy"
                      style={{
                        '--anim-duration':
                          cardLike.width &&
                          cardLike.height &&
                          `${Math.min(
                            Math.max(
                              Math.max(cardLike.width, cardLike.height) / 100,
                              5,
                            ),
                            120,
                          )}s`,
                      }}
                    />
                  ) : (
                    <span className="post-peek-faux-media">🔗</span>
                  )}
                </span>
              )}
        </span>
      )}
    </div>
  );
}

interface PostStatsProps {
  post: CatchupPost;
}

function PostStats({ post }: PostStatsProps) {
  const { t } = useLingui();
  const { reblogsCount, repliesCount, favouritesCount, quotesCount } = post;
  const safeQuotesCount = quotesCount ?? 0;
  return (
    <span className="post-stats">
      {repliesCount > 0 && (
        <span className="post-stat-replies">
          <Icon icon="comment2" size="s" alt={t`Replies`} />{' '}
          {shortenNumber(repliesCount)}
        </span>
      )}
      {favouritesCount > 0 && (
        <span className="post-stat-likes">
          <Icon icon="heart" size="s" alt={t`Likes`} />{' '}
          {shortenNumber(favouritesCount)}
        </span>
      )}
      {reblogsCount > 0 || safeQuotesCount > 0 ? (
        <span className="post-stat-boosts">
          <Icon icon="rocket" size="s" alt={t`Reposts`} />{' '}
          {reblogsCount > 0 || safeQuotesCount > 0
            ? `${reblogsCount > 0 ? shortenNumber(reblogsCount) : ''}${
                reblogsCount > 0 && safeQuotesCount > 0 ? '+' : ''
              }${safeQuotesCount > 0 ? shortenNumber(quotesCount) : ''}`
            : shortenNumber(reblogsCount)}
        </span>
      ) : null}
    </span>
  );
}

function binByTime<K extends string, T extends Record<K, string>>(
  data: T[],
  key: K,
  numBins: number,
): T[][] {
  // Extract dates from data objects
  const dates = data.map((item) => new Date(item[key]));

  // Find minimum and maximum dates directly (avoiding Math.min/max)
  const minDate = dates.reduce(
    (acc, date) => (date < acc ? date : acc),
    dates[0],
  );
  const maxDate = dates.reduce(
    (acc, date) => (date > acc ? date : acc),
    dates[0],
  );

  // Calculate the time span in milliseconds
  const range = Math.min(maxDate.getTime(), Date.now()) - minDate.getTime();

  // Create empty bins and loop through data
  const bins: T[][] = Array.from({ length: numBins }, () => [] as T[]);
  data.forEach((item) => {
    const dateTime = Date.parse(item[key]);
    if (dateTime > Date.now()) {
      // Future dates go into the last bin
      bins[bins.length - 1].push(item);
    } else {
      const normalized = (dateTime - minDate.getTime()) / range;
      const binIndex = Math.floor(normalized * (numBins - 1));
      bins[binIndex].push(item);
    }
  });

  return bins;
}

export default Catchup;
