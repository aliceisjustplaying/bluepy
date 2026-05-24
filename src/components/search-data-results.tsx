import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useSearchActors, useSearchPosts } from '../data/search';

import Icon from './icon';
import Loader from './loader';
import PostByUri from './post-by-uri';
import PostUriFeed from './post-uri-feed';
import ProfileByDid from './profile-by-did';

const SHORT_LIMIT = 5;

export interface SearchDataResultsProps {
  query: string;
  type: string | null;
  instance?: string;
  headerStart?: ReactNode | false;
}

function SearchActorsList({
  query,
  type,
  instance = 'bsky.social',
}: SearchDataResultsProps) {
  const source = useSearchActors(query);
  const full = type === 'accounts';
  const items = full ? source.items : source.items.slice(0, SHORT_LIMIT);

  if (source.isLoading && items.length === 0) {
    return (
      <p className="ui-state">
        <Loader abrupt />
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="ui-state">
        <Trans>No accounts found.</Trans>
      </p>
    );
  }

  return (
    <>
      <ul className="timeline flat accounts-list">
        {items.map((did) => (
          <li key={did}>
            <ProfileByDid did={did} instance={instance} showStats={full} />
          </li>
        ))}
      </ul>
      {!full && (source.items.length > SHORT_LIMIT || source.hasMore) ? (
        <div className="ui-state">
          <Link
            className="plain button"
            to={`/search?q=${encodeURIComponent(query)}&type=accounts`}
          >
            <Trans>See more accounts</Trans> <Icon icon="arrow-right" />
          </Link>
        </div>
      ) : full && source.hasMore ? (
        <button
          type="button"
          className="plain block"
          onClick={() => {
            source.loadMore();
          }}
          disabled={source.isLoadingMore}
        >
          {source.isLoadingMore ? <Loader abrupt /> : <Trans>Show more…</Trans>}
        </button>
      ) : full && items.length > 0 ? (
        <p className="ui-state insignificant">
          <Trans>The end.</Trans>
        </p>
      ) : null}
    </>
  );
}

function SearchPostsPreview({
  query,
  instance = 'bsky.social',
}: SearchDataResultsProps) {
  const source = useSearchPosts(query);
  const items = useMemo(
    () => source.items.slice(0, SHORT_LIMIT),
    [source.items],
  );

  if (source.isLoading && items.length === 0) {
    return (
      <p className="ui-state">
        <Loader abrupt />
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="ui-state">
        <Trans>No posts found.</Trans>
      </p>
    );
  }

  return (
    <>
      <ul className="timeline">
        {items.map((uri) => (
          <li key={uri} className="timeline-item">
            <PostByUri uri={uri} instance={instance} showActionsBar />
          </li>
        ))}
      </ul>
      {source.items.length > SHORT_LIMIT || source.hasMore ? (
        <div className="ui-state">
          <Link
            className="plain button"
            to={`/search?q=${encodeURIComponent(query)}&type=statuses`}
          >
            <Trans>See more posts</Trans> <Icon icon="arrow-right" />
          </Link>
        </div>
      ) : null}
    </>
  );
}

function SearchPostsFeed({
  query,
  headerStart,
}: SearchDataResultsProps) {
  const { t } = useLingui();
  const source = useSearchPosts(query);

  return (
    <PostUriFeed
      source={source}
      title={t`Search: ${query} (Posts)`}
      path="/search"
      id="search-posts"
      headerStart={headerStart ?? false}
      emptyText={t`No posts found.`}
      errorText={t`Unable to load search results.`}
    />
  );
}

export default function SearchDataResults(props: SearchDataResultsProps) {
  const { query, type } = props;

  if (type === 'statuses') {
    return <SearchPostsFeed {...props} />;
  }

  if (type === 'accounts') {
    return <SearchActorsList {...props} />;
  }

  return (
    <>
      <h2 className="timeline-header">
        <Trans>Accounts</Trans>{' '}
        <Link to={`/search?q=${encodeURIComponent(query)}&type=accounts`}>
          <Icon icon="arrow-right" size="l" />
        </Link>
      </h2>
      <SearchActorsList {...props} type="preview" />
      <h2 className="timeline-header">
        <Trans>Posts</Trans>{' '}
        <Link to={`/search?q=${encodeURIComponent(query)}&type=statuses`}>
          <Icon icon="arrow-right" size="l" />
        </Link>
      </h2>
      <SearchPostsPreview {...props} />
    </>
  );
}
