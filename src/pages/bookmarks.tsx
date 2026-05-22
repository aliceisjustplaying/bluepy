import { useLingui } from '@lingui/react/macro';
import { useRef } from 'react';

import Timeline from '../components/timeline';
import type { AtprotoCompat } from '../types/atproto-compat';
import { api } from '../utils/api';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

function Bookmarks() {
  const { t } = useLingui();
  useTitle(t`Bookmarks`, '/b');
  const { compat, instance } = api();
  const bookmarksIterator = useRef<
    AsyncIterator<AtprotoCompat.v1.Status[]> | undefined
  >(undefined);
  async function fetchBookmarks(firstLoad?: boolean) {
    if (firstLoad || !bookmarksIterator.current) {
      bookmarksIterator.current = (
        compat.v1.bookmarks as AtprotoCompat.rest.v1.BookmarksResource
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
