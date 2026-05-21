import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useRef } from 'react';

import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

function Favourites() {
  const { t } = useLingui();
  useTitle(t`Likes`, '/favourites');
  const { masto, instance } = api();
  const favouritesIterator = useRef<
    AsyncIterator<mastodon.v1.Status[]> | undefined
  >(undefined);
  async function fetchFavourites(firstLoad?: boolean) {
    if (firstLoad || !favouritesIterator.current) {
      favouritesIterator.current =
        getMastoV1Resource<mastodon.rest.v1.FavouritesResource>(
          masto,
          'favourites',
        )
          .list({ limit: LIMIT })
          .values();
    }
    return await favouritesIterator.current.next();
  }

  return (
    <Timeline
      title={t`Likes`}
      id="favourites"
      emptyText={t`No likes yet. Go like something!`}
      errorText={t`Unable to load likes.`}
      instance={instance}
      fetchItems={fetchFavourites}
    />
  );
}

export default Favourites;
