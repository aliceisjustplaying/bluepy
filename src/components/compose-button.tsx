import { Trans, useLingui } from '@lingui/react/macro';
import { ControlledMenu, MenuItem } from '@szhsin/react-menu';
import type { MenuInstance } from '@szhsin/react-menu';
import type { MouseEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useLongPress } from 'use-long-press';
import { useSnapshot } from 'valtio';

import type { AtprotoCompat } from '../types/atproto-compat';
import { api, getCompatV1Resource } from '../utils/api';
import haptics from '../utils/haptics';
import niceDateTime from '../utils/nice-date-time';
import openCompose from '../utils/open-compose';
import openOSK from '../utils/open-osk';
import pmem from '../utils/pmem';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import showCompose from '../utils/show-compose';
import states from '../utils/states';
import statusPeek from '../utils/status-peek';
import { getCurrentAccountID } from '../utils/store-utils';

import Icon from './icon';
import RelativeTime from './relative-time';
import SubMenu2 from './submenu2';

// Minimal shape of the compat client surface used here. The shared
// CompatClient interface in utils/api intentionally keeps v1 endpoints loose
// (`[key: string]: unknown`), so we narrow locally for type-safe calls.
interface AccountStatusesEndpoint {
  $select(id: string): {
    readonly statuses: {
      list(params: {
        limit: number;
        exclude_replies: boolean;
        exclude_reblogs: boolean;
      }): {
        values(): AsyncIterator<AtprotoCompat.v1.Status[]>;
      };
    };
  };
}

interface StatusPeekPayload {
  spoilerText?: string;
  content?: string;
  poll?: {
    options?: { title: string }[];
    multiple?: boolean;
  } | null;
  mediaAttachments?: { type: string }[] | null;
  quote?: {
    quotedStatus?: StatusPeekPayload & { id?: string };
  } | null;
}

// Function to fetch the latest posts from the current user
// Use pmem to memoize fetch results for 1 minute
const fetchLatestPostsMemoized = pmem(
  async (
    accountsEndpoint: AccountStatusesEndpoint,
    currentAccountID: string,
  ): Promise<AtprotoCompat.v1.Status[]> => {
    const statusesIterator = accountsEndpoint
      .$select(currentAccountID)
      .statuses.list({
        limit: 3,
        exclude_replies: true,
        exclude_reblogs: true,
      })
      .values();
    const { value } = await statusesIterator.next();
    return value || [];
  },
  { expires: 60000 },
); // 1 minute cache

export default function ComposeButton() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const { compat } = api();

  // Context menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [latestPosts, setLatestPosts] = useState<AtprotoCompat.v1.Status[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<MenuInstance | null>(null);

  const columnMode = false;

  function handleButton(
    e:
      | MouseEvent<HTMLButtonElement>
      | KeyboardEvent
      | { key?: string; shiftKey?: boolean },
  ) {
    // useKey will even listen to Shift
    // e.g. press Shift (without c) will trigger this 😱
    const ev = e as { key?: string; shiftKey?: boolean };
    if (ev.key && ev.key.toLowerCase() !== 'c') return;

    if (snapStates.composerState.minimized) {
      states.composerState.minimized = false;
      openOSK();
      return;
    }

    const composeDataElements =
      document.querySelectorAll<HTMLDataElement>('data.compose-data');
    // If there's a lot of them, ignore
    const opts =
      !columnMode && composeDataElements.length === 1
        ? JSON.parse(composeDataElements[0].value)
        : undefined;

    if (ev.shiftKey) {
      const newWin = openCompose(opts);

      if (!newWin) {
        states.showCompose = opts || true;
      }
    } else {
      openOSK();
      states.showCompose = opts || true;
    }
  }

  useHotkeys('c, shift+c', handleButton, {
    useKey: true,
    ignoreEventWhen: (e) => {
      const hasModal = !!document.querySelector('#modal-container > *');
      return hasModal || e.metaKey || e.ctrlKey || e.altKey;
    },
  });

  const fetchLatestPosts = useCallback(async () => {
    try {
      setLoadingPosts(true);
      const currentAccountID = getCurrentAccountID();
      if (!currentAccountID) {
        return;
      }
      const posts = await fetchLatestPostsMemoized(
        getCompatV1Resource<AccountStatusesEndpoint>(compat, 'accounts'),
        currentAccountID,
      );
      setLatestPosts(posts);
    } catch (error) {
      console.error('Failed to fetch latest posts', error);
    } finally {
      setLoadingPosts(false);
    }
  }, [compat]);

  const openLatestPostsMenu = useCallback(() => {
    setMenuOpen(true);
    void fetchLatestPosts();
  }, [fetchLatestPosts]);

  // Setup longpress handler to open context menu
  const bindLongPress = useLongPress(openLatestPostsMenu, {
    threshold: 600,
  });

  // Function to handle opening the compose window to reply to a post
  const handleReplyToPost = useCallback((post: AtprotoCompat.v1.Status) => {
    showCompose({
      replyToStatus: post,
    });
    setMenuOpen(false);
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id="compose-button"
        onClick={(e) => {
          void haptics.trigger('light');
          handleButton(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openLatestPostsMenu();
        }}
        {...bindLongPress()}
        className={`${snapStates.composerState.minimized ? 'min' : ''} ${
          snapStates.composerState.publishing ? 'loading' : ''
        } ${snapStates.composerState.publishingError ? 'error' : ''}`}
      >
        <Icon icon="quill" size="xl" alt={t`Compose`} />
      </button>
      <ControlledMenu
        ref={menuRef}
        state={menuOpen ? 'open' : undefined}
        anchorRef={buttonRef as never}
        onClose={() => {
          setMenuOpen(false);
        }}
        direction="top"
        gap={8} // Add gap between menu and button
        unmountOnClose
        portal={{
          target: document.body,
        }}
        boundingBoxPadding={safeBoundingBoxPadding()}
        containerProps={{
          style: {
            zIndex: 19,
          },
          onClick: () => {
            menuRef.current?.closeMenu?.();
          },
        }}
        submenuOpenDelay={600}
      >
        <SubMenu2
          align="end"
          direction="top"
          shift={-8}
          disabled={loadingPosts || latestPosts.length === 0}
          label={
            <>
              <Icon icon="comment" />{' '}
              <span className="menu-grow">
                <Trans>Add to thread</Trans>
              </span>
              {loadingPosts ? '…' : <Icon icon="chevron-right" />}
            </>
          }
        >
          {latestPosts.length > 0 &&
            latestPosts.map((post) => {
              const createdDate = new Date(post.createdAt);
              const isWithinDay = Date.now() - createdDate.getTime() < 86400000;

              return (
                <MenuItem
                  key={post.id}
                  onClick={() => {
                    handleReplyToPost(post);
                  }}
                >
                  <small>
                    <div className="menu-post-text">
                      {statusPeek(post as StatusPeekPayload)}
                    </div>
                    <span className="more-insignificant">
                      {/* Show relative time if within a day */}
                      {isWithinDay && (
                        <>
                          <RelativeTime datetime={createdDate} format="micro" />{' '}
                          ‒{' '}
                        </>
                      )}
                      <time
                        className="created"
                        dateTime={createdDate.toISOString()}
                        title={createdDate.toLocaleString()}
                      >
                        {niceDateTime(post.createdAt)}
                      </time>
                    </span>
                  </small>
                </MenuItem>
              );
            })}
        </SubMenu2>
      </ControlledMenu>
    </>
  );
}
