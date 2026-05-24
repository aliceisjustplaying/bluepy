import './status.css';

import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import debounce from 'just-debounce-it';
import pRetry from 'p-retry';
import type {
  ReactNode,
  ComponentType,
  CSSProperties,
  Ref,
  MouseEvent,
} from 'react';
import { memo } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { matchPath, useSearchParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import { getSafeViewTransitionName } from '../components/media';
import MediaModal from '../components/media-modal';
import Menu2 from '../components/menu2';
import NameText from '../components/name-text';
import PostThreadPage from '../components/post-thread-page';
import RelativeTime from '../components/relative-time';
import Status from '../components/status';
import type { AnyStatus } from '../components/status-types';
import { api, getMastoV2Resource } from '../utils/api';
import {
  getAtprotoURIFromPathname,
  isAtprotoPostURI,
  isStatusPath,
  maybeDecodeAtprotoURI,
} from '../utils/atproto-route';
import htmlContentLength from '../utils/html-content-length';
import { navigatePath } from '../utils/router';
import shortenNumber from '../utils/shorten-number';
import states, {
  getStatus,
  saveStatus,
  statusKey,
  threadifyStatus,
} from '../utils/states';
import statusPeek from '../utils/status-peek';
import { getCurrentAccount } from '../utils/store-utils';
import { ThreadCountContext } from '../utils/thread-count-context';
import {
  appendThreadDescendant,
  clearThreadDescendantReplies,
} from '../utils/thread-structure';
import useTitle from '../utils/useTitle';

// `react-intersection-observer`'s `InView` ships without working JSX
// component typings under our React component types. Re-type as a React
// component with the props this file actually uses.
type InViewProps = {
  threshold?: number;
  class?: string;
  className?: string;
  tabIndex?: number;
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
};
const InView: ComponentType<InViewProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewProps>;

const { PHANPY_DEFAULT_INSTANCE: DEFAULT_INSTANCE } = import.meta.env as {
  PHANPY_DEFAULT_INSTANCE?: string;
};

const LIMIT = 40;
const SUBCOMMENTS_OPEN_ALL_LIMIT = 10;
const MAX_WEIGHT = 5;
const COMMENTS_AUTO_EXPAND_LIMIT = 20;

// The status records this page works with originate from Masto's API but
// also pick up internal mutations from `states.ts` (e.g. `__replies`,
// `_pinned`). Keep this type loose around those extensions.
type RawStatus = AnyStatus & {
  __replies?: RawStatus[];
  _pinned?: unknown;
};

interface GhostMeta {
  inReplyToAccountId?: string | null;
}

// Internal display shape produced by `restructureContext` and stored in
// `statuses`. Hero/ancestor/descendant items share fields; some apply only to
// specific kinds (e.g. `replies` for descendants, `ghost` for missing
// ancestors).
interface DisplayStatus {
  id: string;
  account?: RawStatus['account'];
  accountID?: string;
  ancestor?: boolean;
  descendant?: boolean;
  ghost?: GhostMeta;
  isThread?: boolean;
  thread?: boolean;
  repliesCount?: number;
  weight?: number;
  level?: number;
  replies?: NestedReply[] | null;
  createdAt?: string;
}

interface NestedReply {
  id: string;
  account: RawStatus['account'];
  repliesCount?: number;
  content?: string;
  weight: number;
  level: number;
  replies?: NestedReply[] | null;
}

interface GhostStatus {
  id: string;
  ghost: GhostMeta;
  account?: undefined;
  createdAt?: undefined;
}

type StatusThreadItem = RawStatus | GhostStatus;

function isGhostStatus(status: StatusThreadItem): status is GhostStatus {
  return 'ghost' in status;
}

interface FullContext {
  ancestors: RawStatus[];
  descendants: RawStatus[];
  heroStatus: RawStatus;
}

interface RestructureResult {
  allStatuses: DisplayStatus[];
  ancestorsIsThread: boolean;
  mappedNestedDescendants: DisplayStatus[];
}

let cachedRepliesToggle: Record<string, boolean> = {};
let cachedStatusesMap: Record<string, DisplayStatus[]> = {};
let scrollPositions: Record<string, number> = {};
function resetScrollPosition(id: string): void {
  delete cachedStatusesMap[id];
  delete scrollPositions[id];
}

const scrollIntoViewOptions: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'center',
  behavior: 'instant' as ScrollBehavior,
};

// Select all statuses except those inside collapsed details/summary
// Hat-tip to @AmeliaBR@front-end.social
// https://front-end.social/@AmeliaBR/109784776146144471
const STATUSES_SELECTOR =
  '.status-link:not(details:not([open]) > summary ~ *, details:not([open]) > summary ~ * *), .status-focus:not(details:not([open]) > summary ~ *, details:not([open]) > summary ~ * *)';

const postViewState = (): 'large' | 'small' =>
  window.matchMedia('(min-width: calc(40em + 350px))').matches
    ? 'large'
    : 'small';

function rawStatusFromState(status: unknown): RawStatus | undefined {
  if (!status || typeof status !== 'object') return undefined;
  return status as RawStatus;
}

type SaveStatusInput = Parameters<typeof saveStatus>[0];
type ThreadifyStatusInput = Parameters<typeof threadifyStatus>[0];

function saveRawStatus(
  status: RawStatus,
  instance?: string | Parameters<typeof saveStatus>[1],
  opts?: Parameters<typeof saveStatus>[2],
): void {
  saveStatus(status as SaveStatusInput, instance, opts);
}

function threadifyRawStatus(status: RawStatus, instance?: string | null): void {
  threadifyStatus(status as ThreadifyStatusInput, instance);
}

function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

interface StatusPageParams {
  id: string;
  instance?: string;
}

function StatusPage(params: StatusPageParams) {
  const { id } = params;
  const [searchParams, setSearchParams] = useSearchParams();
  const mediaParam = searchParams.get('media');
  const mediaOnlyParam = searchParams.get('media-only');
  const mediaIndex = parseInt((mediaParam || mediaOnlyParam) as string, 10);
  let showMedia = mediaIndex > 0;
  const showMediaOnly = showMedia && !!mediaOnlyParam;
  const postUri = maybeDecodeAtprotoURI(id);
  const useDataLayerThread =
    isAtprotoPostURI(postUri) && !showMedia && !showMediaOnly;

  const { masto, instance } = api({ instance: params.instance });
  const snapStates = useSnapshot(states);
  const mediaStatusID = searchParams.get('mediaStatusID');
  const mediaStatus = getStatus(mediaStatusID, instance);
  if (mediaStatusID && !mediaStatus) {
    showMedia = false;
  }

  // `id` is always present on this route
  const sKey: string = statusKey(id, instance) ?? id;
  const [heroStatus, setHeroStatus] = useState<RawStatus | undefined>(
    rawStatusFromState(states.statuses[sKey]),
  );
  useEffect(() => {
    const cachedStatus = rawStatusFromState(states.statuses[sKey]);
    if (cachedStatus) {
      setHeroStatus(cachedStatus);
    }
  }, [sKey]);

  // Set canonical link, not for SEO, but for sharing
  useEffect(() => {
    if (!heroStatus || !heroStatus.url) return undefined;

    const existingCanonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    let originalHref: string | null = null;
    let canonicalLink: HTMLLinkElement | undefined;

    if (existingCanonical) {
      originalHref = existingCanonical.href;
      existingCanonical.href = heroStatus.url;
    } else {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      canonicalLink.href = heroStatus.url;
      document.head.appendChild(canonicalLink);
    }

    return () => {
      if (existingCanonical && originalHref) {
        existingCanonical.href = originalHref;
      } else if (canonicalLink) {
        document.head.removeChild(canonicalLink);
      }
    };
  }, [heroStatus]);

  const closeLink = useMemo(() => {
    const { prevLocation } = snapStates;
    const lastFeedPath = safeInternalPath(
      window.sessionStorage.getItem('bluepy:last-feed-path'),
    );
    const fromParam = searchParams.get('from');
    const safeFromParam = safeInternalPath(fromParam);
    if (safeFromParam) return safeFromParam;
    const prevPathname = prevLocation?.pathname || '';
    const prevSearch = prevLocation?.search;
    const prevSearchStr = typeof prevSearch === 'string' ? prevSearch : '';
    const pathname = prevPathname + prevSearchStr;
    const atprotoURI = getAtprotoURIFromPathname(prevPathname);
    const matchStatusPath =
      matchPath('/:instance/s/:id', prevPathname) ||
      matchPath('/s/:id', prevPathname) ||
      isAtprotoPostURI(atprotoURI);
    if (!pathname) {
      return lastFeedPath || '/';
    }
    if (matchStatusPath) {
      return lastFeedPath || '/';
    }
    return pathname;
  }, [searchParams, snapStates.prevLocation]);

  // Latest-value refs so the media-only fetch effect can guard on the
  // current hero status (without re-running on every status mutation) and
  // redirect to the latest closeLink (computed on-demand from the live
  // prevLocation snapshot via useMemo above) on error.
  const closeLinkRef = useRef(closeLink);
  closeLinkRef.current = closeLink;
  const heroStatusLatestRef = useRef(heroStatus);
  heroStatusLatestRef.current = heroStatus;

  useEffect(() => {
    if (!heroStatusLatestRef.current && showMedia) {
      // Snapshot mutable values BEFORE the await so we don't mix an `id`
      // fetched at request-time with an `instance` read after navigation.
      // `closeLink` is recreated each render but its value is stable for a
      // given prevLocation snapshot, so we still read it through a ref to
      // avoid retriggering this effect when unrelated state churns.
      const snapshotId = id;
      const snapshotInstance = instance;
      const snapshotCloseLink = closeLinkRef.current;
      const statusesEndpoint = masto.v1.statuses as {
        $select(id: string): { fetch(): Promise<RawStatus> };
      };
      let stale = false;
      void (async () => {
        try {
          const status = await statusesEndpoint.$select(snapshotId).fetch();
          if (stale) return;
          saveRawStatus(status, snapshotInstance);
          setHeroStatus(status);
        } catch (err) {
          if (stale) return;
          console.error(err);
          alert('Unable to load post.');
          navigatePath(snapshotCloseLink);
        }
      })();
      return () => {
        stale = true;
      };
    }
    return undefined;
  }, [showMedia, id, instance, masto]);

  const mediaStatusKey = statusKey(mediaStatusID, instance);
  const mediaAttachments = mediaStatusID
    ? mediaStatusKey
      ? rawStatusFromState(snapStates.statuses[mediaStatusKey])
          ?.mediaAttachments
      : undefined
    : heroStatus?.mediaAttachments;

  const mediaClose = useCallback(() => {
    console.log('xxx', {
      postViewState: postViewState(),
      showMediaOnly,
    });
    if (
      !showMediaOnly &&
      postViewState() === 'small' &&
      snapStates.prevLocation
    ) {
      history.back();
    } else {
      if (showMediaOnly) {
        navigatePath(closeLink);
      } else {
        searchParams.delete('media');
        searchParams.delete('mediaStatusID');
        setSearchParams(searchParams);
      }
    }
  }, [
    showMediaOnly,
    closeLink,
    snapStates.prevLocation,
    searchParams,
    setSearchParams,
  ]);
  const handleMediaClose = useCallback(
    (
      _e: unknown,
      currentIndex: number | undefined,
      currentMediaAttachments:
        | readonly {
            id?: string;
            blurhash?: string | null;
            url?: string | null;
          }[]
        | undefined,
      carouselRef: { current: HTMLElement | null | undefined } | undefined,
    ) => {
      if (postViewState() === 'large' && !showMediaOnly) {
        mediaClose();
        return;
      }
      if (
        showMedia &&
        document.startViewTransition &&
        currentMediaAttachments &&
        typeof currentIndex === 'number'
      ) {
        const media = currentMediaAttachments[currentIndex];
        const { id: mediaId, blurhash, url } = media;
        const mediaVTN = getSafeViewTransitionName(
          (mediaId || blurhash || url) as string,
        );
        const els = document.querySelectorAll(
          `.status .media [data-view-transition-name="${mediaVTN}"]`,
        );
        const foundEls = [...els]?.filter?.((el) => {
          const elBounds = el.getBoundingClientRect();
          return (
            elBounds.top < window.innerHeight &&
            elBounds.bottom > 0 &&
            elBounds.left < window.innerWidth &&
            elBounds.right > 0
          );
        });
        // If more than one, get the one in status page
        const el = (
          foundEls.length === 1
            ? foundEls[0]
            : foundEls.find((candidate) => !!candidate.closest('.status-deck'))
        ) as HTMLElement | undefined;

        console.log('xxx', { media, id, els, el });
        if (el) {
          const transition = document.startViewTransition(() => {
            el.style.viewTransitionName = mediaVTN;
            if (carouselRef?.current) {
              carouselRef.current
                .querySelectorAll('.media img, .media video')
                ?.forEach((nested) => {
                  (nested as HTMLElement).style.viewTransitionName = '';
                });
            }
            mediaClose();
          });
          void transition.ready.finally(() => {
            el.style.viewTransitionName = '';
            el.dataset.viewTransitioned = mediaVTN;
          });
        } else {
          mediaClose();
        }
      } else {
        mediaClose();
      }
    },
    [showMedia, showMediaOnly, id, mediaClose],
  );

  useEffect(() => {
    let timer = setTimeout(() => {
      // carouselRef.current?.focus?.();
      const $carousel = document.querySelector<HTMLElement>('.carousel');
      if ($carousel) {
        $carousel.focus();
      }
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [showMediaOnly]);

  useEffect(() => {
    const $deckContainers =
      document.querySelectorAll<HTMLElement>('.deck-container');
    const scrollTops = new Map<HTMLElement, number>();
    $deckContainers.forEach(($deckContainer) => {
      scrollTops.set($deckContainer, $deckContainer.scrollTop);
      $deckContainer.setAttribute('inert', '');
    });
    return () => {
      $deckContainers.forEach(($deckContainer) => {
        $deckContainer.removeAttribute('inert');
      });
      requestAnimationFrame(() => {
        scrollTops.forEach((scrollTop, $deckContainer) => {
          $deckContainer.scrollTop = scrollTop;
        });
      });
    };
  }, []);

  if (useDataLayerThread && postUri) {
    return (
      <div className="deck-backdrop">
        <Link to={closeLink} preservePrevLocation />
        <PostThreadPage
          uri={postUri}
          closeLink={closeLink}
          instance={params.instance ?? 'bsky.social'}
        />
      </div>
    );
  }

  return (
    <div className="deck-backdrop">
      {showMedia ? (
        mediaAttachments?.length ? (
          <MediaModal
            mediaAttachments={mediaAttachments}
            statusID={mediaStatusID || id}
            instance={instance}
            lang={heroStatus?.language ?? undefined}
            index={mediaIndex - 1}
            onClose={handleMediaClose}
          />
        ) : (
          <div className="media-modal-container loading">
            <Loader abrupt />
          </div>
        )
      ) : (
        <Link to={closeLink} preservePrevLocation />
      )}
      {!showMediaOnly && (
        <StatusThread
          id={id}
          instance={params.instance}
          closeLink={closeLink}
        />
      )}
    </div>
  );
}

interface StatusParentProps {
  linkable: boolean;
  to: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  children?: ReactNode;
}
function StatusParent(props: StatusParentProps) {
  const { linkable, to, onClick, ...restProps } = props;
  return linkable ? (
    <Link
      className="status-link"
      to={to}
      onClick={onClick}
      preservePrevLocation
      {...restProps}
    />
  ) : (
    <div className="status-focus" tabIndex={-1} role="article" {...restProps} />
  );
}

// oldest first
function createdAtSort(
  a: { createdAt?: string | null },
  b: { createdAt?: string | null },
): number {
  return Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '');
}

function formatTimeGap(months: number): string {
  if (months < 12) {
    return plural(months, {
      one: '# month later',
      other: '# months later',
    });
  }
  const years = Math.floor(months / 12);
  return plural(years, {
    one: '# year later',
    other: '# years later',
  });
}

const MONTH_IN_MS = 1000 * 60 * 60 * 24 * 30;
const segmenter =
  typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter() : null;

interface StatusThreadProps {
  id: string;
  closeLink?: string;
  instance?: string;
}

function StatusThread({
  id,
  closeLink = '/',
  instance: propInstance,
}: StatusThreadProps) {
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const mediaParam = searchParams.get('media');
  const mediaStatusID = searchParams.get('mediaStatusID');
  const showMedia = parseInt(mediaParam as string, 10) > 0;
  const firstLoad = useRef(
    !states.prevLocation &&
      (history.length === 1 ||
        ('navigation' in window &&
          (
            navigation as {
              entries?: () => { length: number };
            }
          )?.entries?.()?.length === 1)),
  );
  const [viewMode, setViewMode] = useState<string | null>(
    searchParams.get('view') || firstLoad.current ? 'full' : null,
  );
  const translate = !!parseInt(searchParams.get('translate') as string);
  const { masto, instance } = api({ instance: propInstance });
  const {
    masto: currentMasto,
    instance: currentInstance,
    authenticated,
  } = api();
  // Latest-value ref so the memoized renderStatus can call the current masto
  // v2 search without having to depend on the masto proxy (whose `.v2.search`
  // accessor returns a fresh identity per access and would churn the memo).
  const currentMastoRef = useRef(currentMasto);
  currentMastoRef.current = currentMasto;
  const sameInstance = instance === currentInstance;
  const snapStates = useSnapshot(states);
  const [statuses, setStatuses] = useState<DisplayStatus[]>([]);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const heroStatusRef = useRef<HTMLLIElement | null>(null);
  const sKey: string = statusKey(id, instance) ?? id;
  const totalDescendants = useRef(0);

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollableRef.current?.focus();
  }, []);
  const isLoading = uiState === 'loading';
  useEffect(() => {
    const onScroll = debounce(() => {
      // console.log('onScroll');
      if (!scrollableRef.current) return;
      const { scrollTop } = scrollableRef.current;
      if (!isLoading) {
        scrollPositions[id] = scrollTop;
      }
    }, 50);
    const scrollEl = scrollableRef.current;
    scrollEl?.addEventListener('scroll', onScroll, {
      passive: true,
    });
    onScroll();
    return () => {
      onScroll.cancel();
      scrollEl?.removeEventListener('scroll', onScroll);
    };
  }, [id, isLoading]);

  const scrollOffsets = useRef<{
    offsetTop?: number;
    scrollTop?: number;
  } | null>(null);
  const lastInitContextTS = useRef<number | undefined>(undefined);
  const [threadsCount, setThreadsCount] = useState(0);
  const fullContext = useRef<FullContext | null>(null);
  const restructureContext = (): RestructureResult | undefined => {
    console.log({ fullContext: fullContext.current });
    if (!fullContext.current) return undefined;
    let ancestors: StatusThreadItem[] = fullContext.current.ancestors;
    const { descendants, heroStatus } = fullContext.current;

    ancestors.sort(createdAtSort);
    descendants.sort(createdAtSort);

    totalDescendants.current = descendants?.length || 0;

    // Ghost posts - detect missing ancestors
    const missingAncestorIds = new Set<string>();
    fullContext.current.ancestors.forEach((status) => {
      saveRawStatus(status, instance, {
        skipThreading: true,
      });
      if (
        status.inReplyToId &&
        !ancestors.find((s) => s.id === status.inReplyToId)
      ) {
        missingAncestorIds.add(status.inReplyToId);
      }
    });
    if (
      heroStatus.inReplyToId &&
      !ancestors.find((s) => s.id === heroStatus.inReplyToId)
    ) {
      missingAncestorIds.add(heroStatus.inReplyToId);
    }

    // Insert ghost statuses
    missingAncestorIds.forEach((missingId) => {
      const referencingStatus: RawStatus | null =
        ancestors.find(
          (s): s is RawStatus =>
            !isGhostStatus(s) && s.inReplyToId === missingId,
        ) || (heroStatus.inReplyToId === missingId ? heroStatus : null);
      if (referencingStatus) {
        const ghostStatus: GhostStatus = {
          id: missingId,
          ghost: {
            inReplyToAccountId: referencingStatus.inReplyToAccountId,
          },
        };
        if (referencingStatus === heroStatus) {
          ancestors.push(ghostStatus);
        } else {
          const insertIndex = ancestors.indexOf(referencingStatus);
          ancestors.splice(insertIndex, 0, ghostStatus);
        }
      }
    });

    const missingStatuses = new Set<string>();
    const ancestorsIsThread = ancestors.every(
      (s) => isGhostStatus(s) || s.account?.id === heroStatus.account?.id,
    );
    const nestedDescendants: RawStatus[] = [];
    clearThreadDescendantReplies(descendants);
    descendants.forEach((status) => {
      saveRawStatus(status, instance, {
        // skipThreading: true,
      });

      if (
        status.inReplyToId &&
        !descendants.find((s) => s.id === status.inReplyToId) &&
        status.inReplyToId !== heroStatus.id
      ) {
        missingStatuses.add(status.inReplyToId);
      }

      appendThreadDescendant(
        status,
        heroStatus,
        descendants,
        nestedDescendants,
      );
    });

    // sort hero author to top
    nestedDescendants.sort((a, b) => {
      const heroAccountID = heroStatus.account?.id;
      if (a.account?.id === heroAccountID && b.account?.id !== heroAccountID)
        return -1;
      if (b.account?.id === heroAccountID && a.account?.id !== heroAccountID)
        return 1;
      return 0;
    });

    console.log({ ancestors, descendants, nestedDescendants });
    if (missingStatuses.size) {
      console.error('Missing statuses', [...missingStatuses]);
    }

    let descendantLevelsCount = 1;
    function expandReplies(
      _replies: RawStatus[] | undefined,
      level: number,
    ): NestedReply[] | undefined {
      const nextLevel = level + 1;
      if (nextLevel > descendantLevelsCount) {
        descendantLevelsCount = level;
      }
      return _replies?.map((_r) => ({
        id: _r.id,
        account: _r.account,
        repliesCount: _r.repliesCount,
        content: _r.content,
        weight: calcStatusWeight(_r),
        level: nextLevel,
        replies: expandReplies(_r.__replies, nextLevel),
      }));
    }

    const mappedNestedDescendants: DisplayStatus[] = nestedDescendants.map(
      (s) => ({
        id: s.id,
        account: s.account,
        accountID: s.account?.id,
        descendant: true,
        thread: s.account?.id === heroStatus.account?.id,
        weight: calcStatusWeight(s),
        level: 1,
        replies: expandReplies(s.__replies, 1),
        createdAt: s.createdAt,
      }),
    );
    const allStatuses: DisplayStatus[] = [
      ...ancestors.map<DisplayStatus>((s) => {
        const isGhost = isGhostStatus(s);
        const ghost = isGhost ? s.ghost : undefined;
        const repliesCount = isGhost ? undefined : s.repliesCount;
        return {
          id: s.id,
          ancestor: true,
          ghost,
          isThread: ancestorsIsThread && !ghost,
          accountID: s.account?.id,
          account: s.account,
          repliesCount,
          weight: isGhost ? 0 : calcStatusWeight(s),
          createdAt: s.createdAt,
        };
      }),
      {
        id,
        accountID: heroStatus.account?.id,
        weight: calcStatusWeight(heroStatus),
        createdAt: heroStatus.createdAt,
      },
      ...mappedNestedDescendants,
    ];

    console.log({ allStatuses, descendantLevelsCount });
    return { allStatuses, ancestorsIsThread, mappedNestedDescendants };
  };

  interface StatusContextResource {
    $select(id: string): {
      fetch(): Promise<RawStatus>;
      context: { fetch(): Promise<FullContext> };
    };
  }

  const initContext = ({
    reloadHero,
  }: { reloadHero?: boolean } = {}): (() => void) => {
    console.debug('initContext', id);
    setUIState('loading');

    const cachedStatuses = cachedStatusesMap[id];
    if (cachedStatuses) {
      // Case 1: It's cached, let's restore them to make it snappy
      const reallyCachedStatuses = cachedStatuses.filter(
        (_s) => states.statuses[sKey],
        // Some are not cached in the global state, so we need to filter them out
      );
      setStatuses(reallyCachedStatuses);
    } else {
      // const heroIndex = statuses.findIndex((s) => s.id === id);
      // if (heroIndex !== -1) {
      //   // Case 2: It's in current statuses. Slice off all descendant statuses after the hero status to be safe
      //   const slicedStatuses = statuses.slice(0, heroIndex + 1);
      //   setStatuses(slicedStatuses);
      // } else {
      // Case 3: Not cached and not in statuses, let's start from scratch
      setStatuses([{ id }]);
      // }
    }

    void (async () => {
      const statusesEndpoint = masto.v1.statuses as StatusContextResource;
      const heroFetch = () =>
        pRetry(() => statusesEndpoint.$select(id).fetch(), {
          retries: 4,
        });
      const contextFetch = pRetry(
        () => statusesEndpoint.$select(id).context.fetch(),
        {
          retries: 8,
        },
      );

      const hasStatus = !!snapStates.statuses[sKey];
      let heroStatus = rawStatusFromState(snapStates.statuses[sKey]);
      if (hasStatus && !reloadHero) {
        console.debug('Hero status is cached');
      } else {
        try {
          heroStatus = await heroFetch();
          saveRawStatus(heroStatus, instance);
          // Give time for context to appear
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
          });
        } catch (e) {
          console.error(e);
          setUIState('error');
          return;
        }
      }

      try {
        const context = await contextFetch;
        const { ancestors } = context;
        if (!heroStatus) {
          setUIState('error');
          return;
        }
        fullContext.current = { ...context, heroStatus };
        const restructured = restructureContext();
        if (!restructured) return;
        const { allStatuses, ancestorsIsThread, mappedNestedDescendants } =
          restructured;

        const descendantsThread =
          ancestors.length && !ancestorsIsThread
            ? []
            : mappedNestedDescendants.filter((s) => s.thread);
        const computedThreadsCount =
          (ancestorsIsThread ? ancestors.length : 0) + descendantsThread.length;
        if (computedThreadsCount > 0 && computedThreadsCount < 100) {
          // Cap at 100 because there's no point showing 100+
          // Include hero as part of thread count
          setThreadsCount(computedThreadsCount + 1);
        }

        setUIState('default');
        scrollOffsets.current = {
          offsetTop: heroStatusRef.current?.offsetTop,
          scrollTop: scrollableRef.current?.scrollTop,
        };

        // Set limit to hero's index
        // const heroLimit = allStatuses.findIndex((s) => s.id === id);
        const heroLimit = ancestors.length || 0; // 0-indexed
        if (heroLimit >= limit) {
          setLimit(heroLimit + 1);
        }

        setStatuses(allStatuses);
        cachedStatusesMap[id] = allStatuses;

        // Let's threadify this one
        // Note that all non-hero statuses will trigger saveStatus which will threadify them too
        // By right, at this point, all descendant statuses should be cached
        threadifyRawStatus(heroStatus, instance);
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();

    lastInitContextTS.current = Date.now();

    return () => {};
  };

  // Latest-value refs so the effects below can dispatch the current
  // initContext / restructureContext without re-running on every render
  // (both are recreated each render but their observable behavior depends
  // only on the explicit deps below).
  const initContextRef = useRef(initContext);
  initContextRef.current = initContext;
  const restructureContextRef = useRef(restructureContext);
  restructureContextRef.current = restructureContext;

  useEffect(() => {
    return initContextRef.current();
  }, [id, masto]);

  useEffect(() => {
    try {
      const restructured = restructureContextRef.current();
      if (restructured) setStatuses(restructured.allStatuses);
    } catch {}
  }, []);

  const [showRefresh, setShowRefresh] = useState(false);
  useEffect(() => {
    let interval = setInterval(() => {
      const now = Date.now();
      if (
        lastInitContextTS.current &&
        now - lastInitContextTS.current >= 60_000
      ) {
        setShowRefresh(true);
      }
    }, 60_000); // 1 minute
    return () => {
      clearInterval(interval);
    };
  }, []);

  useLayoutEffect(() => {
    if (!statuses.length) return;
    console.debug('STATUSES', statuses);
    const scrollPosition = scrollPositions[id];
    console.debug('scrollPosition', scrollPosition);
    const scrollable = scrollableRef.current;
    if (!scrollable) return;
    if (scrollPosition) {
      console.debug('Case 1', {
        id,
        scrollPosition,
      });
      scrollable.scrollTop = scrollPosition;
    } else if (scrollOffsets.current) {
      const newScrollOffsets = {
        offsetTop: heroStatusRef.current?.offsetTop,
        scrollTop: scrollableRef.current?.scrollTop,
      };
      const newScrollTop =
        (newScrollOffsets.offsetTop as number) -
        (scrollOffsets.current.offsetTop as number) +
        (newScrollOffsets.scrollTop as number);
      console.debug('Case 2', {
        scrollOffsets: scrollOffsets.current,
        newScrollOffsets,
        newScrollTop,
        statuses: [...statuses],
      });
      scrollable.scrollTop = newScrollTop;
    } else if (statuses.length === 1) {
      console.debug('Case 3', {
        id,
      });
      scrollable.scrollTop = 0;
    }

    // RESET
    scrollOffsets.current = null;
  }, [statuses, id]);

  useEffect(() => {
    if (snapStates.reloadStatusPage <= 0) return;
    // Delete the cache for the context
    void (async () => {
      try {
        const currentAccount = getCurrentAccount();
        if (!currentAccount) return;
        const { instanceURL } = currentAccount;
        const contextURL = `https://${instanceURL}/api/v1/statuses/${id}/context`;
        console.log('Clear cache', contextURL);
        const apiCache = await caches.open('api');
        await apiCache.delete(contextURL, { ignoreVary: true });

        initContextRef.current({
          reloadHero: true,
        });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [snapStates.reloadStatusPage, id]);

  useEffect(() => {
    return () => {
      // RESET
      scrollPositions = {};
      states.reloadStatusPage = 0;
      cachedStatusesMap = {};
      cachedRepliesToggle = {};
      statusWeightCache.clear();
    };
    // TODO(oxlint:react-hooks/exhaustive-deps): mount/unmount-only cleanup of
    // module-level caches. Empty deps array is intentional.
  }, []);

  const heroStatus =
    rawStatusFromState(snapStates.statuses[sKey]) ||
    rawStatusFromState(snapStates.statuses[id]);
  const heroDisplayName = useMemo(() => {
    // Remove shortcodes from display name
    if (!heroStatus) return '';
    const account = heroStatus.account;
    const div = document.createElement('div');
    div.innerHTML = (account?.displayName as string | undefined) ?? '';
    return div.innerText.trim();
  }, [heroStatus]);
  const heroContentText = useMemo(() => {
    if (!heroStatus) return '';
    let text = statusPeek(heroStatus);
    if (text.length > 64) {
      // "The title should ideally be less than 64 characters in length"
      // https://www.w3.org/Provider/Style/TITLE.html
      text =
        (segmenter
          ? [...segmenter.segment(text)].map((s) => s.segment)
          : Array.from(text)
        )
          .slice(0, 64)
          .join('') + '…';
    }
    return text;
  }, [heroStatus]);
  useTitle(
    heroDisplayName && heroContentText
      ? `${heroDisplayName}: "${heroContentText}"`
      : t({
          id: 'post.title',
          message: 'Post',
        }),
    ['/:instance?/s/:id', '/s/:id', '/:scheme://*', '/:atUri'],
  );

  const [limit, setLimit] = useState(LIMIT);
  const showMore = useMemo(() => {
    // return number of statuses to show
    return statuses.length - limit;
  }, [statuses.length, limit]);

  const hasDescendants = statuses.some((s) => s.descendant);
  const ancestors = statuses.filter((s) => s.ancestor);

  const [heroInView, setHeroInView] = useState(true);
  const heroPointer = useMemo(() => {
    // get top offset of heroStatus
    if (!heroStatusRef.current || heroInView) return null;
    const { top } = heroStatusRef.current.getBoundingClientRect();
    return top > 0 ? 'down' : 'up';
  }, [heroInView]);

  useHotkeys(
    'esc',
    () => {
      navigatePath(closeLink);
    },
    {
      // If media is open, esc to close media first
      // Else close the status page
      enabled: !showMedia,
      ignoreEventWhen: (e): boolean => {
        const hasModal = !!document.querySelector('#modal-container > *');
        return hasModal || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
      useKey: true,
    },
  );
  // For backspace, will always close both media and status page
  useHotkeys(
    'backspace',
    () => {
      navigatePath(closeLink);
    },
    {
      useKey: true,
      ignoreEventWhen: (e) => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );

  useHotkeys(
    'j',
    () => {
      const activeStatus = document.activeElement?.closest<HTMLElement>(
        '.status-link, .status-focus',
      );
      const activeStatusRect = activeStatus?.getBoundingClientRect();
      const scrollable = scrollableRef.current;
      if (!scrollable) return;
      const allStatusLinks = Array.from(
        scrollable.querySelectorAll<HTMLElement>(STATUSES_SELECTOR),
      );
      console.log({ allStatusLinks });
      if (
        activeStatus &&
        activeStatusRect &&
        activeStatusRect.top < scrollable.clientHeight &&
        activeStatusRect.bottom > 0
      ) {
        const activeStatusIndex = allStatusLinks.indexOf(activeStatus);
        let nextStatus = allStatusLinks[activeStatusIndex + 1];
        if (nextStatus) {
          nextStatus.focus();
          nextStatus.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        // If active status is not in viewport, get the topmost status-link in viewport
        const topmostStatusLink = allStatusLinks.find((statusLink) => {
          const statusLinkRect = statusLink.getBoundingClientRect();
          return statusLinkRect.top >= 44 && statusLinkRect.left >= 0; // 44 is the magic number for header height, not real
        });
        if (topmostStatusLink) {
          topmostStatusLink.focus();
          topmostStatusLink.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'j',
    },
  );

  useHotkeys(
    'k',
    () => {
      const activeStatus = document.activeElement?.closest<HTMLElement>(
        '.status-link, .status-focus',
      );
      const activeStatusRect = activeStatus?.getBoundingClientRect();
      const scrollable = scrollableRef.current;
      if (!scrollable) return;
      const allStatusLinks = Array.from(
        scrollable.querySelectorAll<HTMLElement>(STATUSES_SELECTOR),
      );
      if (
        activeStatus &&
        activeStatusRect &&
        activeStatusRect.top < scrollable.clientHeight &&
        activeStatusRect.bottom > 0
      ) {
        const activeStatusIndex = allStatusLinks.indexOf(activeStatus);
        let prevStatus = allStatusLinks[activeStatusIndex - 1];
        if (prevStatus) {
          prevStatus.focus();
          prevStatus.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        // If active status is not in viewport, get the topmost status-link in viewport
        const topmostStatusLink = allStatusLinks.find((statusLink) => {
          const statusLinkRect = statusLink.getBoundingClientRect();
          return statusLinkRect.top >= 44 && statusLinkRect.left >= 0; // 44 is the magic number for header height, not real
        });
        if (topmostStatusLink) {
          topmostStatusLink.focus();
          topmostStatusLink.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  // NOTE: I'm not sure if 'x' is the best shortcut for this, might change it later
  // IDEA: x is for expand
  useHotkeys(
    'x',
    () => {
      const activeStatus = document.activeElement?.closest(
        '.status-link, .status-focus',
      );
      if (activeStatus) {
        const details =
          activeStatus.nextElementSibling as HTMLDetailsElement | null;
        if (details && details.tagName.toLowerCase() === 'details') {
          details.open = !details.open;
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'x',
    },
  );

  useHotkeys(
    'o',
    () => {
      // open media of active status (not inside status-card)
      const activeStatus = document.activeElement?.closest(
        '.status-link, .status-focus',
      );
      if (activeStatus) {
        const mediaLink = activeStatus.querySelector<HTMLAnchorElement>(
          'a.media:not(.status-card a.media)',
        );
        if (mediaLink) {
          mediaLink.click();
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'o',
    },
  );

  const [reachTopPost, setReachTopPost] = useState(false);
  // const { nearReachStart } = useScroll({
  //   scrollableRef,
  //   distanceFromStartPx: 16,
  // });

  const initialPageState = useRef<string | null>(
    showMedia ? 'media+status' : 'status',
  );

  const handleMediaClick = useCallback(
    (
      e: React.MouseEvent,
      i: number,
      _media: unknown,
      status: { id: string },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setSearchParams({
        media: String(i + 1),
        mediaStatusID: status.id,
      });
    },
    [setSearchParams],
  );

  const handleStatusLinkClick = useCallback(
    (_e: MouseEvent | globalThis.KeyboardEvent, status: AnyStatus) => {
      resetScrollPosition(status.id);
    },
    [],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (mediaStatusID && showMedia) {
      timer = setTimeout(() => {
        const status = scrollableRef.current?.querySelector<HTMLElement>(
          `.status-link[href*="/${mediaStatusID}"]`,
        );
        if (status) {
          status.scrollIntoView(scrollIntoViewOptions);
        }
      }, 400); // After CSS transition
    }
    return () => {
      clearTimeout(timer);
    };
  }, [mediaStatusID, showMedia]);

  const renderStatus = useCallback(
    (status: DisplayStatus, i: number) => {
      const {
        id: statusID,
        ancestor,
        ghost,
        isThread,
        descendant,
        thread,
        replies,
        repliesCount,
        weight,
        level,
      } = status;
      const isHero = statusID === id;
      const isLinkable = !!(
        !ghost &&
        (isThread || ancestor || descendant || thread)
      );

      return (
        <li
          key={statusID}
          ref={isHero ? heroStatusRef : null}
          className={`${ancestor ? 'ancestor' : ''} ${
            descendant ? 'descendant' : ''
          } ${thread ? 'thread' : ''} ${isHero ? 'hero' : ''}`}
        >
          {isHero ? (
            <>
              <InView
                threshold={0.1}
                onChange={(inView) => {
                  queueMicrotask(() => {
                    requestAnimationFrame(() => {
                      setHeroInView(inView);
                    });
                  });
                }}
                className="status-focus"
                tabIndex={0}
              >
                <Status
                  statusID={statusID}
                  instance={instance}
                  withinContext
                  size="l"
                  enableTranslate
                  forceTranslate={translate}
                />
              </InView>
              {uiState !== 'loading' && !authenticated ? (
                <div className="post-status-banner">
                  <p>
                    <Trans>
                      You're not logged in. Interactions (reply, repost, etc)
                      are not possible.
                    </Trans>
                  </p>
                  <Link
                    to={
                      DEFAULT_INSTANCE
                        ? `/login?instance=${DEFAULT_INSTANCE}&submit=1`
                        : '/login'
                    }
                    className="button"
                  >
                    <Trans>Log in</Trans>
                  </Link>
                </div>
              ) : (
                !sameInstance && (
                  <div className="post-status-banner">
                    <p>
                      <Trans>
                        This post is from another PDS (<b>{instance}</b>).
                        Interactions (reply, repost, etc) are not possible.
                      </Trans>
                    </p>
                    <button
                      type="button"
                      disabled={uiState === 'loading'}
                      onClick={() => {
                        setUIState('loading');
                        void (async () => {
                          try {
                            if (!heroStatus?.url) {
                              throw new Error('No status URL');
                            }
                            const results = await getMastoV2Resource<{
                              list(params: {
                                q: string;
                                type: 'statuses';
                                resolve: boolean;
                                limit: number;
                              }): Promise<{ statuses?: { id: string }[] }>;
                            }>(currentMastoRef.current, 'search').list({
                              q: heroStatus.url,
                              type: 'statuses',
                              resolve: true,
                              limit: 1,
                            });
                            const resultStatuses =
                              (
                                results as {
                                  statuses?: { id: string }[];
                                } | null
                              )?.statuses ?? [];
                            if (resultStatuses.length) {
                              const resolvedStatus = resultStatuses[0];
                              navigatePath(
                                currentInstance
                                  ? `/${currentInstance}/s/${resolvedStatus.id}`
                                  : `/s/${resolvedStatus.id}`,
                              );
                            } else {
                              throw new Error('No results');
                            }
                          } catch (e) {
                            setUIState('default');
                            alert(t`Error: ${e}`);
                            console.error(e);
                          }
                        })();
                      }}
                    >
                      <Icon icon="transfer" />{' '}
                      <Trans>Switch to my PDS to enable interactions</Trans>
                    </button>
                  </div>
                )
              )}
            </>
          ) : (
            <StatusParent
              linkable={isLinkable}
              to={instance ? `/${instance}/s/${statusID}` : `/s/${statusID}`}
              onClick={() => {
                resetScrollPosition(statusID);
              }}
            >
              {/* <Link
              className="status-link"
              to={instance ? `/${instance}/s/${statusID}` : `/s/${statusID}`}
              onClick={() => {
                resetScrollPosition(statusID);
              }}
            > */}
              {ghost ? (
                <Status
                  statusID={statusID}
                  instance={instance}
                  withinContext
                  size="m"
                  ghost={ghost}
                />
              ) : i === 0 && ancestor ? (
                <InView
                  threshold={0.5}
                  onChange={(inView) => {
                    queueMicrotask(() => {
                      requestAnimationFrame(() => {
                        setReachTopPost(inView);
                      });
                    });
                  }}
                >
                  <Status
                    statusID={statusID}
                    instance={instance}
                    withinContext
                    size={thread || ancestor ? 'm' : 's'}
                    enableTranslate
                    onMediaClick={handleMediaClick}
                    onStatusLinkClick={handleStatusLinkClick}
                  />
                </InView>
              ) : (
                <Status
                  statusID={statusID}
                  instance={instance}
                  withinContext
                  size={thread || ancestor ? 'm' : 's'}
                  enableTranslate
                  onMediaClick={handleMediaClick}
                  onStatusLinkClick={handleStatusLinkClick}
                  showActionsBar={!!descendant}
                />
              )}
              {ancestor && repliesCount !== undefined && repliesCount > 1 && (
                <div className="replies-link">
                  <Icon icon="comment2" alt={t`Replies`} />{' '}
                  <span title={String(repliesCount)}>
                    {shortenNumber(repliesCount)}
                  </span>
                </div>
              )}{' '}
              {/* {replies?.length > LIMIT && (
                        <div className="replies-link">
                          <Icon icon="comment" />{' '}
                          <span title={replies.length}>
                            {shortenNumber(replies.length)}
                          </span>
                        </div>
                      )} */}
            </StatusParent>
            // </Link>
          )}
          {descendant && !!replies?.length && (
            <SubComments
              instance={instance}
              replies={replies}
              hasParentThread={thread}
              level={level ?? 1}
              accWeight={weight ?? 0}
              openAll={totalDescendants.current < SUBCOMMENTS_OPEN_ALL_LIMIT}
              lazyRenderReplies={totalDescendants.current > LIMIT}
              parentLink={{
                to: instance ? `/${instance}/s/${statusID}` : `/s/${statusID}`,
                onClick: () => {
                  resetScrollPosition(statusID);
                },
              }}
            />
          )}
          {uiState === 'loading' &&
            isHero &&
            !!heroStatus?.repliesCount &&
            !hasDescendants && (
              <div className="status-loading">
                <Loader abrupt={heroStatus.repliesCount >= 3} />
              </div>
            )}
          {uiState === 'error' &&
            isHero &&
            !!heroStatus?.repliesCount &&
            !hasDescendants && (
              <div className="status-error">
                <Trans>Unable to load replies.</Trans>
                <br />
                <button
                  type="button"
                  className="plain"
                  onClick={() => {
                    states.reloadStatusPage++;
                  }}
                >
                  <Trans>Try again</Trans>
                </button>
              </div>
            )}
        </li>
      );
    },
    [
      id,
      instance,
      uiState,
      authenticated,
      sameInstance,
      translate,
      handleMediaClick,
      handleStatusLinkClick,
      hasDescendants,
      t,
      currentInstance,
      heroStatus?.url,
      heroStatus?.repliesCount,
    ],
  );

  // Computed inline: depends only on imperative globals (Navigation API
  // entries + states.prevLocation), neither of which are React deps. The
  // check is cheap (a regex test on at most two short strings) so memoization
  // was not load-bearing.
  const prevLocationIsStatusPage = ((): boolean => {
    if ('navigation' in window && navigation?.entries) {
      const prevEntry =
        navigation.entries()[(navigation.currentEntry?.index ?? 0) - 1];
      if (prevEntry?.url) {
        return isStatusPath(URL.parse(prevEntry.url)?.pathname ?? '');
      }
    }
    return isStatusPath(states.prevLocation?.pathname ?? '');
  })();

  interface StatusKeyish {
    id?: string;
    quote?: { quotedStatus?: { id?: string }; id?: string } | null;
    replies?: StatusKeyish[] | null;
  }

  const allStatusesKeys = useMemo(() => {
    const ids: string[] = [];
    function getIDs(status: StatusKeyish): void {
      if (status.id) ids.push(status.id);
      const quoteId = status.quote?.quotedStatus?.id || status.quote?.id;
      if (quoteId) {
        ids.push(quoteId);
      }
      if (status.replies) {
        status.replies.forEach(getIDs);
      }
    }
    statuses.forEach(getIDs);
    return ids.map((sId) => statusKey(sId, instance));
  }, [statuses, instance]);

  const statusesList = useMemo(() => {
    const result = [];
    const slicedStatuses = statuses.slice(0, limit);

    for (let i = 0; i < slicedStatuses.length; i++) {
      const status = slicedStatuses[i];

      // Add time gap indicator if needed
      if (i > 0) {
        const prevStatus = slicedStatuses[i - 1];

        const { createdAt, descendant, thread, id: statusItemId } = status;

        if (prevStatus?.createdAt && createdAt) {
          const currentDate = Date.parse(createdAt);
          if (isFinite(currentDate) && currentDate > MONTH_IN_MS) {
            const prevDate = Date.parse(prevStatus.createdAt);

            if (prevDate && isFinite(prevDate)) {
              const { ancestor, id: prevID } = prevStatus;
              const timeDiff = currentDate - prevDate;
              const monthsDiff = ~~(timeDiff / MONTH_IN_MS);

              if (monthsDiff > 0) {
                result.push(
                  <li
                    key={`time-gap-${statusItemId}-${prevID}`}
                    style={{
                      '--time-gap-range': Math.min(12, monthsDiff),
                    }}
                    className={`time-gap ${ancestor ? 'ancestor' : ''} ${descendant ? 'descendant' : ''} ${
                      thread ? 'thread' : ''
                    }`}
                  >
                    {formatTimeGap(monthsDiff)}
                  </li>,
                );
              } else {
                // NOTE: For testing purposes
                // result.push(
                //   <li
                //     key={`time-gap-${id}`}
                //     className={`time-gap ${ancestor ? 'ancestor' : ''} ${descendant ? 'descendant' : ''} ${
                //       thread ? 'thread' : ''
                //     }`}
                //   >
                //     One eternity later
                //   </li>,
                // );
              }
            }
          }
        }
      }

      result.push(renderStatus(status, i));
    }

    return result;
  }, [statuses, limit, renderStatus]);

  // If there's spoiler in hero status, auto-expand it
  useEffect(() => {
    let timer = setTimeout(() => {
      if (!heroStatusRef.current) return;
      const spoilerButton = heroStatusRef.current.querySelector<HTMLElement>(
        '.spoiler-button:not(.spoiling), .spoiler-media-button:not(.spoiling)',
      );
      if (spoilerButton) spoilerButton.click();
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [id]);

  return (
    <ThreadCountContext.Provider value={threadsCount}>
      <div
        tabIndex={-1}
        ref={scrollableRef}
        className={`status-deck deck contained ${
          statuses.length > 1 ? 'padded-bottom' : ''
        } ${
          initialPageState.current === 'status' && !firstLoad.current
            ? 'slide-in'
            : ''
        } ${viewMode ? `deck-view-${viewMode}` : ''}`}
        onAnimationEnd={() => {
          // Fix the bounce effect when switching viewMode
          // `slide-in` animation kicks in when switching viewMode
          if (initialPageState.current === 'status') {
            // e.target.classList.remove('slide-in');
            initialPageState.current = null;
          }
        }}
      >
        <header
          className={uiState === 'loading' ? 'loading' : ''}
          onDoubleClick={() => {
            // reload statuses
            states.reloadStatusPage++;
          }}
        >
          {/* <div>
            <Link className="button plain deck-close" href={closeLink}>
              <Icon icon="chevron-left" size="xl" />
            </Link>
          </div> */}
          <div className="header-grid header-grid-2">
            <h1>
              {prevLocationIsStatusPage && (
                <button
                  type="button"
                  className="plain deck-back"
                  onClick={() => {
                    history.back();
                  }}
                >
                  <Icon icon="chevron-left" size="xl" alt={t`Back`} />
                </button>
              )}
              {!heroInView && heroStatus && uiState !== 'loading' ? (
                <>
                  <span className="hero-heading">
                    <NameText
                      account={heroStatus.account}
                      instance={instance}
                      showAvatar
                      short
                    />{' '}
                    <span className="insignificant">
                      &bull;{' '}
                      <RelativeTime
                        dateTime={heroStatus.createdAt}
                        format="micro"
                      />
                    </span>
                  </span>{' '}
                  <button
                    type="button"
                    className="ancestors-indicator light small"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      heroStatusRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                    title={t`Go to main post`}
                  >
                    <Icon
                      icon={heroPointer === 'down' ? 'arrow-down' : 'arrow-up'}
                    />
                  </button>
                </>
              ) : (
                <>
                  <Trans id="post.title">Post</Trans>{' '}
                  <button
                    type="button"
                    className="ancestors-indicator light small"
                    onClick={(e) => {
                      // Scroll to top
                      e.preventDefault();
                      e.stopPropagation();
                      scrollableRef.current?.scrollTo({
                        top: 0,
                        behavior: 'smooth',
                      });
                    }}
                    hidden={!ancestors.length || reachTopPost}
                    title={t`${ancestors.length} posts above ‒ Go to top`}
                  >
                    <Icon icon="arrow-up" />
                    {ancestors
                      .filter((a) => !a.ghost)
                      .filter(
                        (a, i, arr) =>
                          arr.findIndex((b) => b.accountID === a.accountID) ===
                          i,
                      )
                      .slice(0, 3)
                      .map((ancestor) => {
                        const acct = ancestor.account as
                          | (Record<string, unknown> & {
                              id?: string;
                              avatarStatic?: string;
                              avatar?: string;
                              displayName?: string;
                              bot?: boolean;
                            })
                          | undefined;
                        return (
                          <Avatar
                            key={acct?.id}
                            url={acct?.avatarStatic || acct?.avatar}
                            alt={acct?.displayName}
                            squircle={acct?.bot}
                          />
                        );
                      })}
                    {/* <Icon icon="comment" />{' '} */}
                    {ancestors.length > 3 && (
                      <>
                        {' '}
                        <span className="insignificant">
                          {shortenNumber(ancestors.length)}
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}
            </h1>
            <div className="header-side">
              <button
                type="button"
                className="plain4 button-switch-view"
                style={{
                  display: viewMode === 'full' ? '' : 'none',
                }}
                onClick={() => {
                  setViewMode(null);
                  searchParams.delete('media');
                  searchParams.delete('media-only');
                  searchParams.delete('view');
                  setSearchParams(searchParams);
                }}
                title={t`Switch to Side Peek view`}
              >
                <Icon icon="layout4" size="l" />
              </button>
              {showRefresh && (
                <button
                  type="button"
                  className="plain button-refresh"
                  onClick={() => {
                    states.reloadStatusPage++;
                    setShowRefresh(false);
                  }}
                >
                  <Icon icon="refresh" size="l" alt={t`Refresh`} />
                </button>
              )}
              <Menu2
                align="end"
                portal={{
                  // Need this, else the menu click will cause scroll jump
                  target: scrollableRef.current,
                }}
                menuButton={
                  <button type="button" className="button plain4">
                    <Icon icon="more" alt={t`More`} size="xl" />
                  </button>
                }
              >
                <MenuItem
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    states.reloadStatusPage++;
                  }}
                >
                  <Icon icon="refresh" />
                  <span>
                    <Trans>Refresh</Trans>
                  </span>
                </MenuItem>
                <MenuItem
                  className="menu-switch-view"
                  onClick={() => {
                    setViewMode(viewMode === 'full' ? null : 'full');
                    searchParams.delete('media');
                    searchParams.delete('media-only');
                    if (viewMode === 'full') {
                      searchParams.delete('view');
                    } else {
                      searchParams.set('view', 'full');
                    }
                    setSearchParams(searchParams);
                  }}
                >
                  <Icon
                    icon={
                      (
                        {
                          '': 'layout5',
                          full: 'layout4',
                        } as Record<string, string>
                      )[viewMode || '']
                    }
                  />
                  <span>
                    {viewMode === 'full'
                      ? t`Switch to Side Peek view`
                      : t`Switch to Full view`}
                  </span>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    // Click all buttons with class .spoiler but not .spoiling
                    const buttons = Array.from(
                      scrollableRef.current?.querySelectorAll<HTMLElement>(
                        '.spoiler-button:not(.spoiling), .spoiler-media-button:not(.spoiling)',
                      ) ?? [],
                    );
                    buttons.forEach((button) => {
                      button.click();
                    });
                  }}
                >
                  <Icon icon="eye-open" />{' '}
                  <span>
                    <Trans>Show all sensitive content</Trans>
                  </span>
                </MenuItem>
              </Menu2>
              <Link
                className="button plain deck-close"
                to={closeLink}
                preservePrevLocation
              >
                <Icon icon="x" size="xl" alt={t`Close`} />
              </Link>
            </div>
          </div>
        </header>
        {!!statuses.length && heroStatus ? (
          <ul
            className={`timeline flat contextual grow ${
              uiState === 'loading' ? 'loading' : ''
            }`}
          >
            {statusesList}
            {showMore > 0 && (
              <li className="descendant descendant-more">
                <button
                  type="button"
                  className="plain block show-more"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    setLimit((l) => l + LIMIT);
                  }}
                  style={{ marginBlockEnd: '6em' }}
                >
                  <div className="ib avatars-bunch">
                    {/* show avatars for first 5 statuses */}
                    {statuses.slice(limit, limit + 5).map((status) => (
                      <Avatar
                        key={status.id}
                        url={
                          (
                            status.account as
                              | { avatarStatic?: string }
                              | undefined
                          )?.avatarStatic
                        }
                        // title={`${status.avatar.displayName} (@${status.avatar.acct})`}
                      />
                    ))}
                  </div>{' '}
                  <div className="ib">
                    <Trans>Show more…</Trans>{' '}
                    <span className="tag">
                      {showMore > LIMIT ? `${LIMIT}+` : showMore}
                    </span>
                  </div>
                </button>
              </li>
            )}
          </ul>
        ) : (
          <>
            {uiState === 'loading' && (
              <ul className="timeline flat contextual grow loading">
                <li>
                  <Status skeleton size="l" />
                </li>
              </ul>
            )}
            {uiState === 'error' && (
              <p className="ui-state">
                <Trans>Unable to load post</Trans>
                <br />
                <br />
                <button
                  type="button"
                  onClick={() => {
                    states.reloadStatusPage++;
                  }}
                >
                  <Trans>Try again</Trans>
                </button>
              </p>
            )}
          </>
        )}
        <div data-state-post-ids={allStatusesKeys.join(' ')} hidden />
      </div>
    </ThreadCountContext.Provider>
  );
}

interface SubCommentsParentLink {
  to: string;
  onClick?: () => void;
}

interface SubCommentsProps {
  replies: NestedReply[];
  instance?: string;
  hasParentThread?: boolean;
  level: number;
  accWeight: number;
  openAll?: boolean;
  parentLink?: SubCommentsParentLink;
  lazyRenderReplies?: boolean;
}

// Total comments count, including sub-replies
const diveDeep = (innerReplies: NestedReply[] | undefined | null): number => {
  return (innerReplies ?? []).reduce<number>((acc, reply) => {
    const { repliesCount, replies: nested } = reply;
    const count = nested?.length || repliesCount || 0;
    return acc + count + diveDeep(nested || []);
  }, 0);
};

function SubComments({
  replies,
  instance,
  hasParentThread,
  level,
  accWeight,
  openAll,
  parentLink,
  lazyRenderReplies,
}: SubCommentsProps) {
  const { t } = useLingui();
  const [, setSearchParams] = useSearchParams();

  const totalComments = replies.length + diveDeep(replies);
  const sameCount = replies.length === totalComments;

  // Get the first 3 accounts, unique by id
  const accounts = replies
    .map((r) => r.account)
    .filter((a, i, arr) => arr.findIndex((b) => b?.id === a?.id) === i)
    .slice(0, 3);

  const totalWeight = useMemo<number>(() => {
    return (replies ?? []).reduce<number>((acc, reply) => {
      return acc + (reply?.weight ?? 0);
    }, accWeight);
  }, [accWeight, replies]);

  let open = false;
  if (openAll) {
    open = true;
  } else if (totalComments <= COMMENTS_AUTO_EXPAND_LIMIT) {
    open = true;
  } else if (totalWeight <= MAX_WEIGHT) {
    open = true;
  } else if (!hasParentThread && totalComments === 1) {
    const shortReply = calcStatusWeight(replies[0]) < 2;
    if (shortReply) open = true;
  }
  const openBefore = cachedRepliesToggle[replies[0].id];

  const handleMediaClick = useCallback(
    (
      e: React.MouseEvent,
      i: number,
      _media: unknown,
      status: { id: string },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setSearchParams({
        media: String(i + 1),
        mediaStatusID: status.id,
      });
    },
    [setSearchParams],
  );

  const handleStatusLinkClick = useCallback(
    (_e: MouseEvent | globalThis.KeyboardEvent, status: AnyStatus) => {
      resetScrollPosition(status.id);
    },
    [],
  );

  // The Container element is either `div` or `details` depending on `open`.
  // Use a permissive ref type to satisfy both branches of the JSX union.
  const detailsRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    function handleScroll(e: Event) {
      // NOTE: this scrollLeft works for RTL too
      // Browsers do the magic for us
      const target = e.target as HTMLElement | null;
      if (target) {
        target.dataset.scrollLeft = String(target.scrollLeft);
      }
    }
    const detailsEl = detailsRef.current;
    detailsEl?.addEventListener('scroll', handleScroll, {
      passive: true,
    });
    return () => {
      detailsEl?.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const [isOpen, setIsOpen] = useState(openBefore || open);

  // If lazyRenderReplies, only render when open; else always render
  const shouldRenderReplies = lazyRenderReplies ? isOpen : true;
  const [renderReplies, setRenderReplies] = useState(shouldRenderReplies);
  useEffect(() => {
    setRenderReplies(shouldRenderReplies);
  }, [shouldRenderReplies]);

  const Container = open ? 'div' : 'details';
  const isDetails = !open;

  return (
    <Container
      ref={detailsRef as Ref<HTMLDetailsElement> & Ref<HTMLDivElement>}
      className="replies"
      open={isDetails ? openBefore || open : undefined}
      onToggle={
        isDetails
          ? (e: React.SyntheticEvent) => {
              const target = e.target as HTMLDetailsElement | null;
              const newOpen = !!target?.open;
              setIsOpen(newOpen);
              // use first reply as ID
              cachedRepliesToggle[replies[0].id] = newOpen;
            }
          : undefined
      }
      style={
        {
          '--comments-level': level,
        } as CSSProperties
      }
      data-comments-level={level}
      data-comments-level-overflow={level > 4}
    >
      {!open && (
        <summary className="replies-summary" hidden={open}>
          <span className="avatars">
            {accounts.map((a) => (
              <Avatar
                key={a.id}
                url={a.avatarStatic}
                title={`${a.displayName} @${a.username}`}
                squircle={a?.bot}
              />
            ))}
          </span>
          <span className="replies-counts">
            <b>
              <Plural
                value={replies.length}
                one="# reply"
                other={
                  <Trans>
                    <span title={String(replies.length)}>
                      {shortenNumber(replies.length)}
                    </span>{' '}
                    replies
                  </Trans>
                }
              />
            </b>
            {!sameCount && totalComments > 1 && (
              <>
                {' '}
                &middot;{' '}
                <span>
                  <Plural
                    value={totalComments}
                    one="# comment"
                    other={
                      <Trans>
                        <span title={String(totalComments)}>
                          {shortenNumber(totalComments)}
                        </span>{' '}
                        comments
                      </Trans>
                    }
                  />
                </span>
              </>
            )}
          </span>
          <Icon icon="chevron-down" className="replies-summary-chevron" />
          {!!parentLink && (
            <Link
              className="replies-parent-link"
              to={parentLink.to}
              onClick={parentLink.onClick}
              preservePrevLocation
              title={t`View post with its replies`}
            >
              &raquo;
            </Link>
          )}
        </summary>
      )}
      {renderReplies && (
        <ul>
          {replies.map((r) => (
            <li key={r.id}>
              <StatusParent
                linkable
                to={instance ? `/${instance}/s/${r.id}` : `/s/${r.id}`}
                onClick={() => {
                  resetScrollPosition(r.id);
                }}
              >
                <Status
                  statusID={r.id}
                  instance={instance}
                  withinContext
                  size="s"
                  enableTranslate
                  onMediaClick={handleMediaClick}
                  onStatusLinkClick={handleStatusLinkClick}
                  showActionsBar
                />
                {!r.replies?.length &&
                  r.repliesCount !== undefined &&
                  r.repliesCount > 0 && (
                    <div className="replies-link">
                      <Icon icon="comment2" alt={t`Replies`} />{' '}
                      <span title={String(r.repliesCount)}>
                        {shortenNumber(r.repliesCount)}
                      </span>
                    </div>
                  )}
              </StatusParent>
              {!!r.replies?.length && (
                <SubComments
                  instance={instance}
                  replies={r.replies}
                  level={r.level}
                  accWeight={!open ? r.weight : totalWeight}
                  openAll={openAll}
                  lazyRenderReplies={lazyRenderReplies}
                  parentLink={{
                    to: instance ? `/${instance}/s/${r.id}` : `/s/${r.id}`,
                    onClick: () => {
                      resetScrollPosition(r.id);
                    },
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

const MEDIA_VIRTUAL_LENGTH = 140;
const CARD_VIRTUAL_LENGTH = 70;
const WEIGHT_SEGMENT = 140;
const statusWeightCache = new Map<string, number>();

// Loose shape: callers pass either a full `RawStatus` or a `NestedReply`
// (which only carries `id`, `content`, and a few other reply-specific
// fields). The original JS relied on `undefined + content` coercing to
// `"undefined" + content` (9 extra characters); preserve that arithmetic
// here so cached/computed weights match the prior behavior exactly.
interface CalcStatusWeightInput {
  id: string;
  spoilerText?: unknown;
  content?: unknown;
  mediaAttachments?: { length?: number } | null;
  card?: unknown;
}

function calcStatusWeight(status: CalcStatusWeightInput | RawStatus): number {
  const cachedWeight = statusWeightCache.get(status.id);
  if (cachedWeight) return cachedWeight;
  const { spoilerText, content, mediaAttachments, card } = status;
  // Preserve original JS string-concat semantics: `undefined + content`
  // yields `"undefined" + content`. Cast via `String()` to keep that
  // coercion under TypeScript's checker.
  const length = htmlContentLength(String(spoilerText) + String(content));
  const mediaLength = mediaAttachments?.length ? MEDIA_VIRTUAL_LENGTH : 0;
  // A link card is only rendered when there's a card and no media taking its
  // place, so only that case adds card height. Previously the condition was
  // inverted: every card-less post (the common case) was charged CARD_VIRTUAL_LENGTH.
  const cardLength =
    card && !mediaAttachments?.length ? CARD_VIRTUAL_LENGTH : 0;
  const totalLength = length + mediaLength + cardLength;
  const weight = totalLength / WEIGHT_SEGMENT;
  statusWeightCache.set(status.id, weight);
  return weight;
}

export default memo(StatusPage);
