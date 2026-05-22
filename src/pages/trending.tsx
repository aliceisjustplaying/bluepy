import './trending.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

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

interface StatusItem {
  id: string;
  filtered?: readonly mastodon.v1.FilterResult[] | null;
  account?: { id?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

function fetchTrendsStatuses(masto: MastoTrendingClient): AsyncListIterator {
  return (
    masto as { v1: { trends: { statuses: TrendingApiList } } }
  ).v1.trends.statuses
    .list({
      limit: LIMIT,
    })
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
  const title = t`Trending (${instance})`;
  useTitle(title, `/:instance?/trending`);
  // const navigate = useNavigate();
  const latestItem = useRef<string | undefined>(undefined);

  const trendIterator = useRef<AsyncListIterator | undefined>(undefined);

  async function fetchTrends(firstLoad?: boolean) {
    console.log('fetchTrend', firstLoad);
    if (firstLoad || !trendIterator.current) {
      trendIterator.current = fetchTrendsStatuses(masto as MastoTrendingClient);
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
      timelineKey={`trending-${instance}-posts`}
      instance={instance}
      emptyText={t`No trending posts.`}
      errorText={t`Unable to load posts`}
      fetchItems={fetchTrends}
      checkForUpdates={checkForUpdates}
      checkForUpdatesInterval={5 * 60 * 1000} // 5 minutes
      useItemID
      headerStart={<></>}
      boostsCarousel={snapStates.settings.boostsCarousel}
      // allowFilters
      filterContext="public"
    />
  );
}

export default Trending;
