import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import Menu2 from '../components/menu2';
import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import { navigatePath } from '../utils/router';
import states, { saveStatus } from '../utils/states';
import supports from '../utils/supports';
import { checkTimelineAccess } from '../utils/timeline-access';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

interface PublicTimelineItem {
  id: string;
  account?: { id?: string } | null;
  filtered?: readonly mastodon.v1.FilterResult[] | null;
  [key: string]: unknown;
}

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
}

function toSaveStatus(
  status: PublicTimelineItem | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

interface PublicTimelineListOptions {
  limit: number;
  local?: boolean;
  remote?: boolean;
  since_id?: string;
}

interface PublicTimelinesApi {
  public: {
    list(options: PublicTimelineListOptions): {
      values(): AsyncIterator<PublicTimelineItem[]>;
    };
  };
}

interface FetchItemsResult {
  done?: boolean;
  value: PublicTimelineItem[];
}

type TimelineAccess = string | null;

interface PublicProps {
  local?: boolean;
  columnMode?: boolean;
  instance?: string;
  [key: string]: unknown;
}

function Public({ local, columnMode, ...props }: PublicProps) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const isLocal = !!local;
  const routeParams = useParams() as { instance?: string };
  const params: { instance?: string } = columnMode ? {} : routeParams;
  const { masto, authenticated, instance } = api({
    instance: props?.instance || params.instance,
  });
  const { instance: currentInstance } = api();
  const title = isLocal
    ? t`Local timeline (${instance})`
    : t`Federated timeline (${instance})`;
  useTitle(title, isLocal ? `/:instance?/p/l` : `/:instance?/p`);
  // const navigate = useNavigate();
  const latestItem = useRef<string | undefined>(undefined);

  // Timeline access: public, authenticated, disabled
  const [timelineAccess, setTimelineAccess] = useState<TimelineAccess>(null);
  const isDisabled = timelineAccess === 'disabled';
  const requiresAuth = timelineAccess === 'authenticated';
  const isPrivate = requiresAuth && !authenticated;

  const timelinesApi = getMastoV1Resource<PublicTimelinesApi>(
    masto,
    'timelines',
  );

  const publicIterator = useRef<
    AsyncIterator<PublicTimelineItem[]> | undefined
  >(undefined);
  async function fetchPublic(firstLoad?: boolean): Promise<FetchItemsResult> {
    if (firstLoad || !publicIterator.current) {
      const accessResult = await checkTimelineAccess({
        feed: 'liveFeeds',
        feedType: isLocal ? 'local' : 'remote',
        instance,
      });
      const access: TimelineAccess =
        typeof accessResult === 'string' ? accessResult : null;
      setTimelineAccess(access);
      if (
        access === 'disabled' ||
        (access === 'authenticated' && !authenticated)
      ) {
        return {
          done: true,
          value: [],
        };
      }

      const opts: PublicTimelineListOptions = {
        limit: LIMIT,
        local: isLocal || undefined,
      };
      if (!isLocal && supports('@pixelfed/global-feed')) {
        opts.remote = true;
      }
      publicIterator.current = timelinesApi.public.list(opts).values();
    }
    const results = await publicIterator.current.next();
    let { value } = results as {
      done?: boolean;
      value: PublicTimelineItem[] | undefined;
    };
    if (value?.length) {
      if (firstLoad) {
        latestItem.current = value[0].id;
      }

      // value = filteredItems(value, 'public');
      value.forEach((item) => {
        saveStatus(toSaveStatus(item), instance);
      });
    }
    return {
      ...(results as { done?: boolean }),
      value: value ?? [],
    };
  }

  async function checkForUpdates(): Promise<boolean> {
    if (isDisabled || isPrivate) return false;
    try {
      const results = await timelinesApi.public
        .list({
          limit: 1,
          local: isLocal,
          since_id: latestItem.current,
        })
        .values()
        .next();
      let { value } = results as { value: PublicTimelineItem[] | undefined };
      const valueContainsLatestItem = value?.[0]?.id === latestItem.current; // since_id might not be supported
      if (value?.length && !valueContainsLatestItem) {
        value = filteredItems(value, 'public') as PublicTimelineItem[];
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  return (
    <Timeline
      key={instance + isLocal}
      title={title}
      titleComponent={
        <h1 className="header-double-lines">
          <b>{isLocal ? t`Local timeline` : t`Federated timeline`}</b>
          <div>{instance}</div>
        </h1>
      }
      id="public"
      timelineKey={`public-${instance}-${isLocal ? 'local' : 'federated'}`}
      instance={instance}
      emptyText={
        isDisabled
          ? t`This timeline is disabled on this server.`
          : isPrivate
            ? t`Login required to see posts from this server.`
            : t`No one has posted anything yet.`
      }
      errorText={t`Unable to load posts`}
      fetchItems={fetchPublic}
      checkForUpdates={checkForUpdates}
      useItemID
      headerStart={<></>}
      boostsCarousel={snapStates.settings.boostsCarousel}
      // allowFilters
      filterContext="public"
      headerEnd={
        <Menu2
          portal
          // setDownOverflow
          overflow="auto"
          viewScroll="close"
          position="anchor"
          menuButton={
            <button type="button" className="plain">
              <Icon icon="more" size="l" alt={t`More`} />
            </button>
          }
        >
          <MenuItem
            onClick={() =>
              navigatePath(isLocal ? `/${instance}/p` : `/${instance}/p/l`)
            }
          >
            {isLocal ? (
              <>
                <Icon icon="transfer" />{' '}
                <span>
                  <Trans>Switch to Federated</Trans>
                </span>
              </>
            ) : (
              <>
                <Icon icon="transfer" />{' '}
                <span>
                  <Trans>Switch to Local</Trans>
                </span>
              </>
            )}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            onClick={() => {
              let newInstance = prompt(
                t`Enter a new server e.g. "mastodon.social"`,
              );
              if (!/\./.test(newInstance ?? '')) {
                if (newInstance) alert(t`Invalid server`);
                return;
              }
              if (newInstance) {
                newInstance = newInstance.toLowerCase().trim();
                // navigate(isLocal ? `/${newInstance}/p/l` : `/${newInstance}/p`);
                navigatePath(
                  isLocal ? `/${newInstance}/p/l` : `/${newInstance}/p`,
                );
              }
            }}
          >
            <Icon icon="bus" />{' '}
            <span>
              <Trans>Go to another server…</Trans>
            </span>
          </MenuItem>
          {currentInstance !== instance && (
            <MenuItem
              onClick={() => {
                navigatePath(
                  isLocal ? `/${currentInstance}/p/l` : `/${currentInstance}/p`,
                );
              }}
            >
              <Icon icon="bus" />{' '}
              <small className="menu-double-lines">
                <Trans>
                  Go to my server (<b>{currentInstance}</b>)
                </Trans>
              </small>
            </MenuItem>
          )}
        </Menu2>
      }
    />
  );
}

export default Public;
