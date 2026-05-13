import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useRef } from 'preact/hooks';

import TimelineUntyped from '../components/timeline';
import { api } from '../utils/api';
import useTitle from '../utils/useTitle';

function Timeline(props: {
  title?: string;
  id?: string;
  emptyText?: string;
  errorText?: string;
  instance?: string;
  fetchItems?: (
    firstLoad?: boolean,
  ) => Promise<IteratorResult<mastodon.v1.Status[]>>;
}) {
  const Inner = TimelineUntyped as unknown as ComponentType<{
    title?: string;
    id?: string;
    emptyText?: string;
    errorText?: string;
    instance?: string;
    fetchItems?: (
      firstLoad?: boolean,
    ) => Promise<IteratorResult<mastodon.v1.Status[]>>;
  }>;
  return <Inner {...props} />;
}

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
      favouritesIterator.current = (
        masto.v1.favourites as mastodon.rest.v1.FavouritesResource
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
