import { useLingui } from '@lingui/react/macro';
import { useRef } from 'react';

import Timeline from '../components/timeline';
import type { AtprotoCompat } from '../types/atproto-compat';
import { api } from '../utils/api';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

function Favourites() {
  const { t } = useLingui();
  useTitle(t`Likes`, '/favourites');
  const { compat, instance } = api();
  const favouritesIterator = useRef<
    AsyncIterator<AtprotoCompat.v1.Status[]> | undefined
  >(undefined);
  async function fetchFavourites(firstLoad?: boolean) {
    if (firstLoad || !favouritesIterator.current) {
      favouritesIterator.current = (
        compat.v1.favourites as AtprotoCompat.rest.v1.FavouritesResource
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
