import type { AppBskyNotificationListNotifications } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { notificationStatusURI } from '../utils/atproto-adapter';

import { feedReadMode } from './_internal/dispatch';
import { primePosts, primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type NotifFilter } from './keys';
import { useViewerScope } from './scope';

export type NotificationItem =
  AppBskyNotificationListNotifications.Notification;

export function useNotifications(filter?: NotifFilter) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<NotificationItem>({
    queryKey: keys.notifications(scope, filter),
    enabled: Boolean(activeDid),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.listNotifications({
        limit: 30,
        cursor: pageParam,
        ...(filter ? { reasons: [filter] } : {}),
      });
      primeProfiles(qc, scope, {
        actors: res.data.notifications.map((n) => n.author),
      });
      const postUris = [
        ...new Set(
          res.data.notifications
            .map((notification) => notificationStatusURI(notification))
            .filter(
              (uri): uri is string =>
                Boolean(uri?.includes('/app.bsky.feed.post/')),
            ),
        ),
      ];
      if (postUris.length > 0) {
        const posts = await agent.getPosts({ uris: postUris });
        primePosts(qc, scope, posts.data);
      }
      return {
        items: res.data.notifications,
        cursor: res.data.cursor,
      };
    },
  });
}

export function useUnreadNotificationCount(): {
  data?: number;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  const query = useQuery({
    queryKey: [...scope, 'notificationUnread'] as const,
    enabled: Boolean(activeDid),
    staleTime: 30_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.notification.getUnreadCount();
      return res.data.count;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}
