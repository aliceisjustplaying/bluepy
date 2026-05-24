import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode, UIEvent } from 'react';
import { useCallback, useEffect } from 'react';

import { useActiveDid } from '../contexts/SessionProvider';
import { notificationPostUri } from '../data/_internal/notification-post-uri';
import type { NotifFilter } from '../data/keys';
import { useNotifications, type NotificationItem } from '../data/notifications';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

import Icon from './icon';
import Link from './link';
import Loader from './loader';
import NavMenu from './nav-menu';
import PostByUri from './post-by-uri';

export interface NotificationsFeedProps {
  title?: string;
  path?: string;
  id?: string;
  filter?: NotifFilter;
  headerEnd?: ReactNode;
  timelineStart?: ReactNode;
  emptyText?: string;
  errorText?: string;
  onlyFollowing?: boolean;
  postOnly?: boolean;
}

export function NotificationReasonLabel({
  reason,
}: {
  reason: NotificationItem['reason'];
}): ReactNode {
  switch (reason) {
    case 'like':
      return <Trans>liked your post</Trans>;
    case 'repost':
      return <Trans>reposted your post</Trans>;
    case 'follow':
      return <Trans>followed you</Trans>;
    case 'mention':
      return <Trans>mentioned you</Trans>;
    case 'reply':
      return <Trans>replied to you</Trans>;
    case 'quote':
      return <Trans>quoted your post</Trans>;
    case 'like-via-repost':
      return <Trans>liked your repost</Trans>;
    case 'repost-via-repost':
      return <Trans>reposted your repost</Trans>;
    case 'starterpack-joined':
      return <Trans>joined your starter pack</Trans>;
    case 'verified':
      return <Trans>verified you</Trans>;
    case 'unverified':
      return <Trans>removed your verification</Trans>;
    case 'contact-match':
      return <Trans>joined from your contacts</Trans>;
    case 'subscribed-post':
      return <Trans>posted</Trans>;
    default:
      return reason;
  }
}

export function isMutedNotification(
  item: NotificationItem,
  activeDid: string | null,
) {
  if (item.author.did === activeDid) return false;
  return Boolean(item.author.viewer?.muted || item.author.viewer?.mutedByList);
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const handle = item.author.handle || item.author.did;
  const postUri = notificationPostUri(item);

  return (
    <li className="timeline-item notification-item">
      <div className="notification-line">
        <Icon icon="notification" size="s" alt="" />
        <span>
          <Link to={`/at://${item.author.did}/app.bsky.actor.profile/self`}>
            {handle}
          </Link>{' '}
          <NotificationReasonLabel reason={item.reason} />
        </span>
      </div>
      {postUri ? (
        <PostByUri uri={postUri} size="s" readOnly showActionsBar={false} />
      ) : null}
    </li>
  );
}

export default function NotificationsFeed({
  title,
  path = '/notifications',
  id = 'notifications',
  filter,
  headerEnd,
  timelineStart,
  emptyText,
  errorText,
  onlyFollowing = false,
  postOnly = false,
}: NotificationsFeedProps) {
  const { t } = useLingui();
  const activeDid = useActiveDid();
  const { items, loadMore, hasMore, isLoadingMore, isLoading, error } =
    useNotifications(filter);
  const visibleItems = items.filter((item) => {
    if (isMutedNotification(item, activeDid)) return false;
    if (onlyFollowing && !item.author.viewer?.following) return false;
    return !postOnly || !!notificationPostUri(item);
  });

  useTitle(title || t`Notifications`, path);

  useEffect(() => {
    if (filter || !items.length) return;
    states.notificationsLast = items[0];
    states.notificationsShowNew = false;
    states.notificationsLastFetchTime = Date.now();
  }, [filter, items]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore || isLoadingMore) return;
      const element = event.currentTarget;
      const remaining =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < 800) {
        loadMore();
      }
    },
    [hasMore, isLoadingMore, loadMore],
  );

  if (!activeDid) {
    return (
      <div className="timeline-page deck-container" tabIndex={-1}>
        <div className="timeline-deck deck">
          <p>
            <Trans>Sign in to view notifications.</Trans>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id={`${id}-page`}
      className="timeline-page deck-container"
      data-timeline-id={id}
      tabIndex={-1}
      onScroll={onScroll}
    >
      <div className="timeline-deck deck">
        <header className="timeline-header">
          <NavMenu />
          <h1>{title || t`Notifications`}</h1>
          {headerEnd}
        </header>
        {timelineStart}
        {error ? (
          <p className="error-message">{errorText || error.message}</p>
        ) : isLoading && visibleItems.length === 0 ? (
          <Loader />
        ) : visibleItems.length === 0 ? (
          <p className="timeline-empty">
            {emptyText || t`Nothing to see here.`}
          </p>
        ) : (
          <ul className="timeline-list">
            {visibleItems.map((item) =>
              postOnly ? (
                <li key={item.uri} className="timeline-item">
                  <PostByUri uri={notificationPostUri(item)!} showActionsBar />
                </li>
              ) : (
                <NotificationRow key={item.uri} item={item} />
              ),
            )}
          </ul>
        )}
        {isLoadingMore ? <Loader /> : null}
        {!hasMore && visibleItems.length > 0 ? (
          <p className="timeline-end">
            <Trans>That&apos;s all for now.</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
