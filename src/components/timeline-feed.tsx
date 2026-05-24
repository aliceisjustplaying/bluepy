import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import { useTimelineFeed } from '../data/feeds';
import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { feedReadMode } from '../data/_internal/dispatch';
import { getReadAgent } from '../data/clients';
import states from '../utils/states';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';

import Icon from './icon';
import PostUriFeed from './post-uri-feed';

export function getTimelineScrollContainer(id: string): HTMLElement | null {
  return (
    document.getElementById(`${id}-page`) ??
    document.querySelector<HTMLElement>('#list-page')
  );
}

export interface TimelineFeedProps {
  title?: string;
  path?: string;
  id?: string;
  headerStart?: boolean;
  headerEnd?: ReactNode;
}

export default function TimelineFeed({
  title,
  path = '/',
  id = 'home',
  headerStart = true,
  headerEnd,
}: TimelineFeedProps) {
  const { t } = useLingui();
  const clients = useClients();
  const activeDid = useActiveDid();
  const snapStates = useSnapshot(states);
  const source = useTimelineFeed();
  const latestItem = useRef<string | undefined>(undefined);
  const [visible, setVisible] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const isActiveRoute = useCallback(() => {
    const expectedPath = typeof path === 'string' ? path : '/';
    return window.location.pathname === expectedPath;
  }, [path]);

  useEffect(() => {
    const firstItem = source.items[0];
    const firstUri = typeof firstItem === 'string' ? firstItem : firstItem?.uri;
    if (firstUri) latestItem.current = firstUri;
  }, [source.items]);

  const loadNewPosts = useCallback(() => {
    setShowNew(false);
    source.refetch();
    getTimelineScrollContainer(id)?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, [id, source]);

  const checkForUpdates = useCallback(async () => {
    if (!activeDid || !clients.activeAppViewProxyAgent || !latestItem.current) {
      return;
    }
    if (!isActiveRoute()) return;
    const agent = getReadAgent(clients, feedReadMode(activeDid));
    const res = await agent.getTimeline({ limit: 5 });
    const firstUri = res.data.feed[0]?.post.uri;
    if (!firstUri || firstUri === latestItem.current) return;
    const listPage = getTimelineScrollContainer(id);
    if (snapStates.settings.autoRefresh && (listPage?.scrollTop ?? 0) < 16) {
      latestItem.current = firstUri;
      source.refetch();
      return;
    }
    setShowNew(true);
  }, [
    activeDid,
    clients,
    id,
    isActiveRoute,
    snapStates.settings.autoRefresh,
    source,
  ]);

  usePageVisibility((isVisible) => {
    setVisible(isVisible);
    if (isVisible) void checkForUpdates();
  }, [checkForUpdates]);

  useInterval(
    () => {
      void checkForUpdates();
    },
    visible && !showNew ? 15_000 : null,
    [checkForUpdates],
  );

  return (
    <PostUriFeed
      source={source}
      title={
        title ||
        t({
          id: 'following.title',
          message: 'Following',
        })
      }
      path={path}
      id={id}
      headerStart={headerStart ? undefined : false}
      headerEnd={
        <>
          {showNew ? (
            <button
              type="button"
              className="updates-button shiny-pill"
              onClick={loadNewPosts}
            >
              <Icon icon="arrow-up" /> {t`New posts`}
            </button>
          ) : null}
          {headerEnd}
        </>
      }
      emptyText={t`Nothing to see here.`}
      errorText={t`Unable to load posts.`}
      filterContext="home"
      boostsCarousel={snapStates.settings.boostsCarousel}
    />
  );
}
