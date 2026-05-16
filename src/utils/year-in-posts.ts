import type { mastodon } from 'masto';

import { api, getMastoV1Resource, getMastoV2Resource } from './api';
import db from './db';
import isSearchEnabled from './is-search-enabled';
import { sorted } from './sorted';
import store from './store';
import { getCurrentAccount, getCurrentAccountNS } from './store-utils';

const YEAR_IN_POSTS_LIST_KEY = 'year-in-posts-list';

// Entry shape stored under `YEAR_IN_POSTS_LIST_KEY`, keyed by year.
interface YearInPostsListEntry {
  count: number;
  size: number;
  fetchedAt: number;
  timezoneOffset: number;
}

type YearInPostsList = Record<string, YearInPostsListEntry>;

// `loadAvailableYears` returns this entry shape: stored metadata flattened
// with the numeric year from the map key.
export interface AvailableYear extends YearInPostsListEntry {
  year: number;
}

export interface YearInPostsRecord extends YearInPostsListEntry {
  id: string;
  posts: mastodon.v1.Status[];
  year: number;
}

export interface FetchYearPostsResult {
  posts: mastodon.v1.Status[];
  searchEnabled: boolean;
  gapsFilled: boolean;
}

// Minimal account-statuses endpoint shape we touch. The shared `MastoClient`
// interface in `api.ts` types nested members as `unknown`, and the real masto
// types use camelCase params whereas this codebase passes snake_case directly
// to the underlying client. Cast through a narrow local interface so the
// snake_case params are preserved at runtime exactly as in the JS original.
interface AccountStatusesListParams {
  limit?: number;
  exclude_replies?: boolean;
  exclude_reblogs?: boolean;
  max_id?: string;
  min_id?: string;
}

interface AccountStatusesEndpoint {
  list(params: AccountStatusesListParams): {
    values(): AsyncIterator<mastodon.v1.Status[] | undefined>;
  };
}

interface AccountsEndpoint {
  $select(id: string): { statuses: AccountStatusesEndpoint };
}

interface SearchV2Endpoint {
  list(params: {
    q: string;
    type: 'statuses';
    limit: number;
  }): Promise<{ statuses?: { id: string }[] } | null | undefined>;
}

export function loadAvailableYears(): AvailableYear[] {
  try {
    const list =
      store.account.get<YearInPostsList>(YEAR_IN_POSTS_LIST_KEY) || {};
    const sortedYears = sorted(
      Object.entries(list).map(([year, data]) =>
        Object.assign({ year: parseInt(year, 10) }, data),
      ),
      (a, b) => b.year - a.year,
    );
    return sortedYears;
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function removeYear(yearToRemove: number): Promise<boolean> {
  try {
    const NS = getCurrentAccountNS();
    const dataId = `${NS}-${yearToRemove}`;
    await db.yearInPosts.del(dataId);

    const list =
      store.account.get<YearInPostsList>(YEAR_IN_POSTS_LIST_KEY) || {};
    delete list[yearToRemove];
    store.account.set(YEAR_IN_POSTS_LIST_KEY, list);

    return true;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

function isPostInYear(createdAt: string, year: number): boolean {
  const postDate = new Date(createdAt);
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  return postDate >= startOfYear && postDate <= endOfYear;
}

export async function fetchYearPosts(
  year: number,
): Promise<FetchYearPostsResult> {
  const { masto, instance } = api();
  const allResults: mastodon.v1.Status[] = [];
  let gapsFilled = false;

  const account = getCurrentAccount();
  if (!account) {
    throw new Error('No current account');
  }
  const accountId = account.info.id;
  const accountAcct = account.info.acct as string | undefined;

  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

  const searchEnabled = await isSearchEnabled(instance);

  const accountsEndpoint = getMastoV1Resource<AccountsEndpoint>(
    masto,
    'accounts',
  );

  // Use search strategies if available
  let maxId: string | null = null;
  if (searchEnabled) {
    try {
      const latestPostIterator = accountsEndpoint
        .$select(accountId)
        .statuses.list({
          limit: 1,
          exclude_replies: false,
          exclude_reblogs: false,
        })
        .values();
      const latestResult = await latestPostIterator.next();

      if (latestResult?.value?.length) {
        const latestPost = latestResult.value[0];
        if (!isPostInYear(latestPost.createdAt, year)) {
          // Use "before" search to find last post before year ends
          const beforeStr = `${year + 1}-01-02`;
          try {
            const searchEndpoint = getMastoV2Resource<SearchV2Endpoint>(
              masto,
              'search',
            );
            const beforeResults = await searchEndpoint.list({
              q: `from:${accountAcct} before:${beforeStr}`,
              type: 'statuses',
              limit: 1,
            });

            if (beforeResults?.statuses?.length) {
              maxId = beforeResults.statuses[0].id;
            }
          } catch (e) {
            console.error('Before search failed', e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch latest post', e);
    }
  }

  const statusIterator = accountsEndpoint
    .$select(accountId)
    .statuses.list({
      limit: 40,
      exclude_replies: false,
      exclude_reblogs: false,
      max_id: maxId || undefined,
    })
    .values();

  let stillAfterYear = true;
  fetchLoop: while (true) {
    try {
      const result = await statusIterator.next();
      const { value, done } = result;

      if (done || !value?.length) break fetchLoop;

      let foundInYear = false;
      for (const status of value) {
        const createdAt = new Date(status.createdAt);
        if (createdAt > endOfYear) {
          continue;
        } else {
          stillAfterYear = false;
        }
        if (createdAt >= startOfYear) {
          allResults.push(status);
          foundInYear = true;
        }
      }

      // Only break if we didn't find any posts in the year in this batch
      if (!foundInYear && !stillAfterYear) break fetchLoop;

      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    } catch (e) {
      console.error(e);
      break fetchLoop;
    }
  }

  allResults.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Forward verification to check for gaps
  if (allResults.length > 0) {
    try {
      const earliestFetched = allResults[0];
      const earliestId = earliestFetched.id;

      // Loop to fetch all posts forward from earliest within the year
      const gapCheckIterator = accountsEndpoint
        .$select(accountId)
        .statuses.list({
          limit: 40,
          min_id: earliestId,
          exclude_replies: false,
          exclude_reblogs: false,
        })
        .values();

      gapFillLoop: while (true) {
        try {
          const result = await gapCheckIterator.next();
          const { value, done } = result;

          if (done || !value?.length) break gapFillLoop;

          let foundInYear = false;
          for (const status of value) {
            const createdAt = new Date(status.createdAt);
            if (createdAt < startOfYear) {
              continue;
            }
            if (createdAt <= endOfYear) {
              if (!allResults.find((s) => s.id === status.id)) {
                allResults.push(status);
                gapsFilled = true;
              }
              foundInYear = true;
            }
          }

          // Only break if we didn't find any posts in the year in this batch
          if (!foundInYear) break gapFillLoop;

          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
        } catch (e) {
          console.error(e);
          break gapFillLoop;
        }
      }

      if (gapsFilled) {
        allResults.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }
    } catch (e) {
      console.error('Gap check failed', e);
    }
  }

  let totalSize = 0;
  try {
    totalSize = new TextEncoder().encode(JSON.stringify(allResults)).length;
  } catch (e) {
    console.error('Error calculating total size:', e);
  }

  const NS = getCurrentAccountNS();
  const dataId = `${NS}-${year}`;
  const timezoneOffset = new Date().getTimezoneOffset();

  const record: YearInPostsRecord = {
    id: dataId,
    posts: allResults,
    count: allResults.length,
    year,
    size: totalSize,
    fetchedAt: Date.now(),
    timezoneOffset,
  };
  await db.yearInPosts.set(dataId, record);

  const list = store.account.get<YearInPostsList>(YEAR_IN_POSTS_LIST_KEY) || {};
  list[year] = {
    count: allResults.length,
    size: totalSize,
    fetchedAt: Date.now(),
    timezoneOffset,
  };
  store.account.set(YEAR_IN_POSTS_LIST_KEY, list);

  return {
    posts: allResults,
    searchEnabled,
    gapsFilled,
  };
}
