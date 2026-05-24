import { AppBskyFeedDefs } from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { feedReadMode } from '../data/_internal/dispatch';
import { getReadAgent, type ClientBundle } from '../data/clients';
import { keys } from '../data/keys';
import { usePost } from '../data/posts';
import { useViewerScope } from '../data/scope';
import { postViewToDisplayStatus } from '../render/post-view-map';
import { encodeAtprotoID } from '../utils/atproto-route';
import { saveStatus } from '../utils/states';

import Status, { type StatusComponentProps } from './status';
import { StatusSkeleton } from './status-placeholders';

const BSKY_INSTANCE = 'bsky.social';

export interface PostByUriProps extends Omit<
  StatusComponentProps,
  'status' | 'statusID'
> {
  uri: string;
  pinned?: boolean;
}

function getPostRenderAgent(clients: ClientBundle, activeDid: string | null) {
  try {
    return getReadAgent(clients, feedReadMode(activeDid));
  } catch {
    return null;
  }
}

export default function PostByUri({
  pinned,
  uri,
  instance = BSKY_INSTANCE,
  ...statusProps
}: PostByUriProps) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const queryClient = useQueryClient();
  const { data: post, isLoading, error } = usePost(uri);
  const resolvePost = useCallback(
    (postUri: string) =>
      queryClient.getQueryData<AppBskyFeedDefs.PostView>(
        keys.post(scope, postUri),
      ),
    [queryClient, scope],
  );
  const agent = useMemo(
    () => getPostRenderAgent(clients, activeDid),
    [activeDid, clients],
  );
  const status = useMemo(() => {
    if (!post || !agent) return null;
    const next = postViewToDisplayStatus(post, agent, resolvePost);
    if (pinned) next._pinned = true;
    return next;
  }, [agent, pinned, post, resolvePost]);

  useEffect(() => {
    if (!status || !activeDid) return;
    saveStatus(status as Parameters<typeof saveStatus>[0], instance);
  }, [activeDid, instance, status]);

  if (isLoading) {
    return (
      <StatusSkeleton
        mediaFirst={statusProps.mediaFirst}
        size={statusProps.size ?? 'm'}
      />
    );
  }

  if (error || !post) {
    return null;
  }

  if (!status) return null;

  return (
    <Status
      {...statusProps}
      instance={instance}
      status={status}
      statusID={encodeAtprotoID(uri)}
    />
  );
}

export function isReasonRepost(
  reason: AppBskyFeedDefs.FeedViewPost['reason'],
): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonRepost';
}

export function isReasonPin(
  reason: AppBskyFeedDefs.FeedViewPost['reason'],
): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonPin';
}
