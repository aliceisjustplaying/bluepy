import type { AppBskyNotificationListNotifications } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { notificationPostUri } from './_internal/notification-post-uri';

import { feedReadMode } from './_internal/dispatch';
import { primePosts, primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type NotifFilter } from './keys';
import { useViewerScope } from './scope';

export type NotificationItem =
  AppBskyNotificationListNotifications.Notification;

const GET_POSTS_LIMIT = 25;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export function useNotifications(filter?: NotifFilter) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<NotificationItem>({
    queryKey: keys.notifications(scope, filter),
    enabled: Boolean(activeDid && clients.activeAppViewProxyAgent),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.listNotifications({
        limit: 30,
        cursor: pageParam,
        ...(filter
          ? { reasons: Array.isArray(filter) ? [...filter] : [filter] }
          : {}),
      });
      primeProfiles(qc, scope, {
        actors: res.data.notifications.map((n) => n.author),
      });
      const postUris = [
        ...new Set(
          res.data.notifications
            .map((notification) => notificationPostUri(notification))
            .filter(
              (uri): uri is string =>
                Boolean(uri?.includes('/app.bsky.feed.post/')),
            ),
        ),
      ];
      if (postUris.length > 0) {
        for (const batch of chunks(postUris, GET_POSTS_LIMIT)) {
          const posts = await agent.getPosts({ uris: batch });
          primePosts(qc, scope, posts.data);
        }
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
    enabled: Boolean(activeDid && clients.activeAppViewProxyAgent),
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
