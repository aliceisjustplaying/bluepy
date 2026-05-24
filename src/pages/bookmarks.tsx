import { useLingui } from '@lingui/react/macro';

import PostUriFeed from '../components/post-uri-feed';
import { useBookmarks } from '../data/bookmarks';
import useTitle from '../utils/useTitle';

function Bookmarks() {
  const { t } = useLingui();
  useTitle(t`Bookmarks`, '/b');
  const source = useBookmarks();

  return (
    <PostUriFeed
      source={source}
      title={t`Bookmarks`}
      path="/b"
      id="bookmarks"
      emptyText={t`No bookmarks yet. Go bookmark something!`}
      errorText={t`Unable to load bookmarks.`}
    />
  );
}

export default Bookmarks;
