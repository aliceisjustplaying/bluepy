import './trending.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useParams } from 'react-router-dom';

import ListFeed from '../components/list-feed';
import type { AtUri } from '../data/keys';
import useTitle from '../utils/useTitle';

const WHATS_HOT_FEED =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot' as AtUri;

interface TrendingProps {
  columnMode?: boolean;
  instance?: string;
  [key: string]: unknown;
}

function Trending({ columnMode, ...props }: TrendingProps) {
  const { t } = useLingui();
  const routeParams = useParams() as Record<string, string>;
  const params = columnMode ? ({} as Record<string, string>) : routeParams;
  const instance = props?.instance || params.instance || 'bsky.social';
  const title = t`Trending (${instance})`;
  useTitle(title, `/:instance?/trending`);

  return (
    <ListFeed
      key={instance}
      listUri={WHATS_HOT_FEED}
      isFeed
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
      headerStart={false}
      emptyText={t`No trending posts.`}
      errorText={t`Unable to load posts`}
    />
  );
}

export default Trending;
