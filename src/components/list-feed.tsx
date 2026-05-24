import type { ReactNode } from 'react';

import { useGeneratorFeed } from '../data/feeds';
import { useListFeed } from '../data/lists';
import type { AtUri } from '../data/keys';

import PostUriFeed, { type PostUriFeedSource } from './post-uri-feed';

export interface ListFeedProps {
  listUri: AtUri | undefined;
  isFeed?: boolean;
  title?: string;
  titleComponent?: ReactNode;
  path?: string;
  id?: string;
  headerStart?: ReactNode | false;
  headerEnd?: ReactNode;
  emptyText?: string;
  errorText?: string;
}

export function useListFeedSource(
  listUri: AtUri | undefined,
  isFeed: boolean,
): PostUriFeedSource {
  const listSource = useListFeed(isFeed ? undefined : listUri);
  const feedSource = useGeneratorFeed(isFeed ? listUri : undefined);
  return isFeed ? feedSource : listSource;
}

export default function ListFeed({
  listUri,
  isFeed = false,
  title,
  titleComponent,
  path,
  id = 'list',
  headerStart,
  headerEnd,
  emptyText,
  errorText,
}: ListFeedProps) {
  const source = useListFeedSource(listUri, isFeed);

  return (
    <PostUriFeed
      source={source}
      title={title}
      titleComponent={titleComponent}
      path={path}
      id={id}
      headerStart={headerStart}
      headerEnd={headerEnd}
      emptyText={emptyText}
      errorText={errorText}
    />
  );
}
