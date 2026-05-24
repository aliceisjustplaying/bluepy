import type { ReactNode } from 'react';

import PostUriFeed, { type PostUriFeedSource } from './post-uri-feed';
import { useProfileFeed } from '../data/feeds';
import type { FeedFilter } from '../data/keys';

export interface ProfileFeedProps {
  actor: string | undefined;
  filter?: FeedFilter;
  title?: string;
  titleComponent?: ReactNode;
  path?: string | string[];
  id?: string;
  headerStart?: ReactNode | false;
  headerEnd?: ReactNode;
  timelineStart?: ReactNode;
  emptyText?: string;
  errorText?: string;
  source?: PostUriFeedSource;
}

export default function ProfileFeed({
  actor,
  filter,
  title,
  titleComponent,
  path,
  id = 'profile-feed',
  headerStart,
  headerEnd,
  timelineStart,
  emptyText,
  errorText,
  source: sourceOverride,
}: ProfileFeedProps) {
  if (sourceOverride) {
    return (
      <PostUriFeed
        source={sourceOverride}
        title={title || actor}
        titleComponent={titleComponent}
        path={path}
        id={id}
        headerStart={headerStart}
        headerEnd={headerEnd}
        timelineStart={timelineStart}
        emptyText={emptyText}
        errorText={errorText}
      />
    );
  }

  return (
    <ProfileFeedFromActor
      actor={actor}
      filter={filter}
      title={title}
      titleComponent={titleComponent}
      path={path}
      id={id}
      headerStart={headerStart}
      headerEnd={headerEnd}
      timelineStart={timelineStart}
      emptyText={emptyText}
      errorText={errorText}
    />
  );
}

function ProfileFeedFromActor({
  actor,
  filter,
  title,
  titleComponent,
  path,
  id,
  headerStart,
  headerEnd,
  timelineStart,
  emptyText,
  errorText,
}: Omit<ProfileFeedProps, 'source'> & { id: string }) {
  const source = useProfileFeed(actor, filter);

  return (
    <PostUriFeed
      source={source}
      title={title || actor}
      titleComponent={titleComponent}
      path={path}
      id={id}
      headerStart={headerStart}
      headerEnd={headerEnd}
      timelineStart={timelineStart}
      emptyText={emptyText}
      errorText={errorText}
    />
  );
}
