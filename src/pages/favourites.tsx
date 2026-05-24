import { useLingui } from '@lingui/react/macro';

import { useActiveDid } from '../contexts/SessionProvider';
import { useActorLikes } from '../data/search';

import PostUriFeed from '../components/post-uri-feed';
import useTitle from '../utils/useTitle';

function Favourites() {
  const { t } = useLingui();
  const activeDid = useActiveDid();
  useTitle(t`Likes`, '/f');
  const source = useActorLikes(activeDid ?? undefined);

  return (
    <PostUriFeed
      source={source}
      title={t`Likes`}
      path="/f"
      id="favourites"
      emptyText={t`No likes yet. Go like something!`}
      errorText={t`Unable to load likes.`}
    />
  );
}

export default Favourites;
