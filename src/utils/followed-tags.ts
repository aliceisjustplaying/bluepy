import type { mastodon } from 'masto';

import { api } from '../utils/api';
import store from '../utils/store';

interface FollowedTagsResource {
  readonly list: (params: { readonly limit: number }) => {
    readonly values: () => AsyncIterator<mastodon.v1.Tag[]>;
  };
}

interface CachedFollowedTags {
  readonly tags: mastodon.v1.Tag[];
  readonly updatedAt: number;
}

const LIMIT = 200;
const MAX_FETCH = 10;

export async function fetchFollowedTags(): Promise<mastodon.v1.Tag[]> {
  const { masto } = api();
  const followedTags = masto.v1
    .followedTags as unknown as FollowedTagsResource;
  const iterator = followedTags
    .list({
      limit: LIMIT,
    })
    .values();
  const tags: mastodon.v1.Tag[] = [];
  let fetchCount = 0;
  do {
    const { value, done } = await iterator.next();
    if (done || value?.length === 0) break;
    tags.push(...value);
    fetchCount++;
  } while (fetchCount < MAX_FETCH);
  tags.sort((a, b) => a.name.localeCompare(b.name));
  console.log(tags);

  if (tags.length) {
    setTimeout(() => {
      // Save to local storage, with saved timestamp
      store.account.set('followedTags', {
        tags,
        updatedAt: Date.now(),
      });
    }, 1);
  }

  return tags;
}

const MAX_AGE = 24 * 60 * 60 * 1000; // 1 day
export async function getFollowedTags(): Promise<mastodon.v1.Tag[]> {
  try {
    const { tags, updatedAt } =
      store.account.get<CachedFollowedTags>('followedTags') || {};
    if (!tags?.length) return await fetchFollowedTags();
    if (updatedAt !== undefined && Date.now() - updatedAt > MAX_AGE) {
      // Stale-while-revalidate
      fetchFollowedTags();
      return tags;
    }
    return tags;
  } catch (e) {
    return [];
  }
}

const fauxDiv = document.createElement('div');
export const extractTagsFromStatus = (
  content: string | null | undefined,
): string[] => {
  if (!content) return [];
  if (content.indexOf('#') === -1) return [];
  fauxDiv.innerHTML = content;
  const hashtagLinks = fauxDiv.querySelectorAll<HTMLAnchorElement>('a.hashtag');
  if (!hashtagLinks.length) return [];
  return Array.from(hashtagLinks).map((a) =>
    a.innerText.trim().replace(/^[^#]*#+/, ''),
  );
};
