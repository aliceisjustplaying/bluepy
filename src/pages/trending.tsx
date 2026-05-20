import '../components/links-bar.css';
import './trending.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { getBlurHashAverageColor } from 'fast-blurhash';
import type { mastodon } from 'masto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NameText from '../components/name-text';
import RelativeTime from '../components/relative-time';
import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { oklab2rgb, rgb2oklab } from '../utils/color-utils';
import { filteredItems } from '../utils/filters';
import getDomain from '../utils/get-domain';
import pmem from '../utils/pmem';
import shortenNumber from '../utils/shorten-number';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 20;
const TREND_CACHE_TIME = 10 * 60 * 1000; // 10 minutes

interface IteratorYield<T> {
  value: T;
  done?: boolean;
}

interface AsyncListIterator {
  next(): Promise<IteratorYield<unknown>>;
}

interface TrendingApiList {
  list(params?: Record<string, unknown>): {
    values(): AsyncListIterator;
  };
}

type MastoTrendingClient = Record<string, unknown>;

interface HashtagHistoryEntry {
  uses: number | string;
  [key: string]: unknown;
}

interface HashtagItem {
  name: string;
  history: HashtagHistoryEntry[];
  [key: string]: unknown;
}

interface AuthorAccount {
  id: string;
  acct: string;
  url: string;
  username: string;
  [key: string]: unknown;
}

interface LinkItem {
  authors?: { account?: AuthorAccount }[];
  authorName?: string;
  authorUrl?: string;
  blurhash?: string;
  description?: string;
  height?: number;
  image?: string;
  imageDescription?: string;
  language?: string;
  providerName?: string;
  providerUrl?: string;
  publishedAt?: string;
  title: string;
  type?: string;
  url: string;
  width?: number;
  [key: string]: unknown;
}

interface StatusItem {
  id: string;
  filtered?: readonly mastodon.v1.FilterResult[] | null;
  account?: { id?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

const fetchLinks = pmem(
  (masto: MastoTrendingClient, _instance?: string) => {
    return (
      masto as { v1: { trends: { links: TrendingApiList } } }
    ).v1.trends.links
      .list()
      .values()
      .next() as Promise<IteratorYield<LinkItem[]>>;
  },
  {
    expires: TREND_CACHE_TIME,
  },
);

const fetchHashtags = pmem(
  (masto: MastoTrendingClient) => {
    return (
      masto as { v1: { trends: { tags: TrendingApiList } } }
    ).v1.trends.tags
      .list()
      .values()
      .next() as Promise<IteratorYield<HashtagItem[]>>;
  },
  {
    expires: TREND_CACHE_TIME,
  },
);

function fetchTrendsStatuses(masto: MastoTrendingClient): AsyncListIterator {
  return (
    masto as { v1: { trends: { statuses: TrendingApiList } } }
  ).v1.trends.statuses
    .list({
      limit: LIMIT,
    })
    .values();
}

function fetchLinkList(
  masto: MastoTrendingClient,
  params: Record<string, unknown>,
): AsyncListIterator {
  return (
    masto as { v1: { timelines: { link: TrendingApiList } } }
  ).v1.timelines.link
    .list(params)
    .values();
}

interface TrendingProps {
  columnMode?: boolean;
  instance?: string;
  [key: string]: unknown;
}

function Trending({ columnMode, ...props }: TrendingProps) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const routeParams = useParams() as Record<string, string>;
  const params = columnMode ? ({} as Record<string, string>) : routeParams;
  const { masto, instance } = api({
    instance: props?.instance || params.instance,
  });
  const { instance: currentInstance } = api();
  const title = t`Trending (${instance})`;
  useTitle(title, `/:instance?/trending`);
  // const navigate = useNavigate();
  const latestItem = useRef<string | undefined>(undefined);

  const sameCurrentInstance = instance === currentInstance;

  const [hashtags, setHashtags] = useState<HashtagItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const trendIterator = useRef<AsyncListIterator | undefined>(undefined);

  async function fetchTrends(firstLoad?: boolean) {
    console.log('fetchTrend', firstLoad);
    if (firstLoad || !trendIterator.current) {
      trendIterator.current = fetchTrendsStatuses(masto as MastoTrendingClient);
      setHashtags([]);
      setLinks([]);
    }
    const results = await trendIterator.current.next();
    const value = results.value as StatusItem[] | undefined;
    if (value?.length) {
      if (firstLoad) {
        latestItem.current = value[0].id;
      }

      // value = filteredItems(value, 'public'); // Might not work here
      value.forEach((item: StatusItem) => {
        saveStatus(item, instance);
      });
    }
    return {
      ...results,
      value,
    };
  }

  // Link mentions
  const [currentLinkMentionsLoading, setCurrentLinkMentionsLoading] =
    useState(false);
  const currentLinkMentionsIterator = useRef<AsyncListIterator | undefined>(
    undefined,
  );
  const [currentLink, setCurrentLink] = useState<string | null>(null);
  const hasCurrentLink = !!currentLink;
  const currentLinkRef = useRef<HTMLAnchorElement | null>(null);
  const supportsTrendingLinkPosts = false;

  useEffect(() => {
    if (currentLink && currentLinkRef.current) {
      currentLinkRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentLink]);

  const prevCurrentLink = useRef<string | null>(null);
  async function fetchLinkMentions(firstLoad?: boolean) {
    if (firstLoad || !currentLinkMentionsIterator.current) {
      setCurrentLinkMentionsLoading(true);
      currentLinkMentionsIterator.current = fetchLinkList(
        masto as MastoTrendingClient,
        {
          url: currentLink,
        },
      );
    }
    prevCurrentLink.current = currentLink;
    const results = await currentLinkMentionsIterator.current.next();
    let value = results.value as StatusItem[] | undefined;
    if (value?.length) {
      value = filteredItems(value, 'public') as StatusItem[];
      value.forEach((item: StatusItem) => {
        saveStatus(item, instance);
      });
    }
    if (prevCurrentLink.current === currentLink) {
      setCurrentLinkMentionsLoading(false);
    }
    return {
      ...results,
      value,
    };
  }

  async function checkForUpdates() {
    try {
      const results = await getMastoV1Resource<{
        statuses: TrendingApiList;
      }>(masto, 'trends')
        .statuses.list({
          limit: 1,
          // NOT SUPPORTED
          // since_id: latestItem.current,
        })
        .values()
        .next();
      let value = results.value as StatusItem[] | undefined;
      value = filteredItems(value, 'public') as StatusItem[];
      if (value?.length && value[0].id !== latestItem.current) {
        latestItem.current = value[0].id;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const TimelineStart = useMemo(() => {
    return (
      <>
        {!!hashtags.length && (
          <div className="filter-bar expandable">
            <Icon icon="chart" className="insignificant" size="l" />
            {hashtags.map((tag: HashtagItem) => {
              const { name, history } = tag;
              const total = history.reduce(
                (acc: number, cur: HashtagHistoryEntry) => acc + +cur.uses,
                0,
              );
              return (
                <Link to={`/${instance}/t/${name}`} key={name}>
                  <span dir="auto">
                    <span className="more-insignificant">#</span>
                    {name}
                  </span>
                  <span className="filter-count">{shortenNumber(total)}</span>
                </Link>
              );
            })}
          </div>
        )}
        {!!links.length && (
          <div className="links-bar">
            <header>
              <h3>
                <Trans>Trending News</Trans>
              </h3>
            </header>
            {links.map((link: LinkItem) => {
              const {
                authors,
                authorName,
                authorUrl,
                blurhash,
                description,
                height,
                image,
                imageDescription,
                language,
                publishedAt,
                title: linkTitle,
                url,
                width,
              } = link;
              const author = authors?.[0]?.account?.id
                ? authors[0].account
                : null;
              const isShortTitle = linkTitle.length < 30;
              const hasAuthor = !!(authorName || author);
              const domain = getDomain(url);
              let accentColor: readonly number[] | undefined;
              if (blurhash) {
                const averageColor = getBlurHashAverageColor(blurhash);
                const labAverageColor = rgb2oklab(
                  averageColor,
                ) as readonly number[];
                accentColor = oklab2rgb([
                  0.6,
                  labAverageColor[1],
                  labAverageColor[2],
                ]) as readonly number[];
              }

              return (
                <div key={url}>
                  <a
                    ref={currentLink === url ? currentLinkRef : null}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`link-block ${
                      hasCurrentLink
                        ? currentLink === url
                          ? 'active'
                          : 'inactive'
                        : ''
                    }`}
                    style={
                      accentColor
                        ? {
                            '--accent-color': `rgb(${accentColor.join(',')})`,
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
                          src={image}
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
                          {!!linkTitle && (
                            <h1
                              className="title"
                              lang={language}
                              dir="auto"
                              title={linkTitle}
                            >
                              {linkTitle}
                            </h1>
                          )}
                        </header>
                        {!!description && (
                          <p
                            className={`description ${
                              hasAuthor && !isShortTitle ? '' : 'more-lines'
                            }`}
                            lang={language}
                            dir="auto"
                            title={description}
                          >
                            {description}
                          </p>
                        )}
                        {hasAuthor && (
                          <>
                            <hr />
                            <p className="byline">
                              <small>
                                <Trans comment="By [Author]">
                                  By{' '}
                                  {author ? (
                                    <NameText account={author} showAvatar />
                                  ) : authorUrl ? (
                                    <a
                                      href={authorUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {authorName}
                                    </a>
                                  ) : (
                                    authorName
                                  )}
                                </Trans>
                              </small>
                            </p>
                          </>
                        )}
                      </div>
                    </article>
                  </a>
                  {supportsTrendingLinkPosts && (
                    <button
                      type="button"
                      className="small plain4 block"
                      onClick={() => {
                        setCurrentLink(url);
                      }}
                      disabled={url === currentLink}
                    >
                      <Icon icon="comment2" />{' '}
                      <span>
                        <Trans>Mentions</Trans>
                      </span>{' '}
                      <Icon icon="chevron-down" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {supportsTrendingLinkPosts && !!links.length && (
          <div
            className={`timeline-header-block ${hasCurrentLink ? 'blended' : ''}`}
          >
            {hasCurrentLink ? (
              <>
                <div style={{ width: 50, flexShrink: 0, textAlign: 'center' }}>
                  {currentLinkMentionsLoading ? (
                    <Loader abrupt />
                  ) : (
                    <button
                      type="button"
                      className="light"
                      onClick={() => {
                        setCurrentLink(null);
                      }}
                    >
                      <Icon icon="x" alt={t`Back to showing trending posts`} />
                    </button>
                  )}
                </div>
                <p>
                  <Trans>
                    Showing posts mentioning{' '}
                    <span className="link-text">
                      {(currentLink ?? '')
                        .replace(/^https?:\/\/(www\.)?/i, '')
                        .replace(/\/$/, '')}
                    </span>
                  </Trans>
                </p>
              </>
            ) : (
              <p className="insignificant">
                <Trans>Trending posts</Trans>
              </p>
            )}
          </div>
        )}
      </>
    );
  }, [
    hashtags,
    links,
    currentLink,
    currentLinkMentionsLoading,
    supportsTrendingLinkPosts,
    instance,
    t,
    hasCurrentLink,
  ]);

  return (
    <Timeline
      key={instance}
      title={title}
      titleComponent={
        <h1 className="header-double-lines">
          <b>
            <Trans>Trending</Trans>
          </b>
          <div>{instance}</div>
        </h1>
      }
      id="trending"
      timelineKey={`trending-${instance}-${currentLink || 'posts'}`}
      instance={instance}
      emptyText={t`No trending posts.`}
      errorText={t`Unable to load posts`}
      fetchItems={hasCurrentLink ? fetchLinkMentions : fetchTrends}
      checkForUpdates={hasCurrentLink ? undefined : checkForUpdates}
      checkForUpdatesInterval={5 * 60 * 1000} // 5 minutes
      useItemID
      headerStart={<></>}
      repostsCarousel={snapStates.settings.repostsCarousel}
      // allowFilters
      filterContext="public"
      timelineStart={TimelineStart}
      refresh={currentLink}
      clearWhenRefresh
      view={hasCurrentLink ? 'link-mentions' : undefined}
    />
  );
}

export default Trending;
