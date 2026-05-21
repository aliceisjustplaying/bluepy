import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useRef } from 'react';

import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

function Bookmarks() {
  const { t } = useLingui();
  useTitle(t`Bookmarks`, '/b');
  const { masto, instance } = api();
  const bookmarksIterator = useRef<
    AsyncIterator<mastodon.v1.Status[]> | undefined
  >(undefined);
  async function fetchBookmarks(firstLoad?: boolean) {
    if (firstLoad || !bookmarksIterator.current) {
      bookmarksIterator.current =
        getMastoV1Resource<mastodon.rest.v1.BookmarksResource>(
          masto,
          'bookmarks',
        )
          .list({ limit: LIMIT })
          .values();
    }
    return await bookmarksIterator.current.next();
  }

  return (
    <Timeline
      title={t`Bookmarks`}
      id="bookmarks"
      emptyText={t`No bookmarks yet. Go bookmark something!`}
      errorText={t`Unable to load bookmarks.`}
      instance={instance}
      fetchItems={fetchBookmarks}
    />
  );
}

export default Bookmarks;
