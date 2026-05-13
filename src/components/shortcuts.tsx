import './shortcuts.css';

import type { MessageDescriptor } from '@lingui/core';
import { useLingui as useLinguiCore } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ControlledMenu,
  type MenuInstance,
  type MenuState,
  MenuDivider,
  MenuHeader,
} from '@szhsin/react-menu';
import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate } from 'react-router-dom';
import { LongPressEventType, useLongPress } from 'use-long-press';
import { useSnapshot } from 'valtio';

import { SHORTCUTS_META } from '../components/shortcuts-settings';
import { api } from '../utils/api';
import { getLists, splitListsAndFeeds } from '../utils/lists';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import states from '../utils/states';

import AsyncText from './AsyncText';
import Avatar from './avatar';
import Icon from './icon';
import Link from './link';
import ListExclusiveBadge from './list-exclusive-badge';
import MenuLink from './menu-link';
import Menu2 from './menu2';
import SubMenu2 from './submenu2';

interface ListLike {
  id: string;
  title: string;
  exclusive?: boolean;
  [key: string]: unknown;
}

interface AltIconValue {
  url?: string;
  type?: string;
}

interface FormattedShortcut {
  id?: string;
  path?: string;
  title?: string | Promise<string>;
  subtitle?: string | Promise<string>;
  icon?: string;
  altIcon?: AltIconValue;
}

interface ShortcutPin {
  type?: string;
  instance?: string;
  [key: string]: unknown;
}

function ListsMenuContent({ lists }: { lists: ListLike[] }) {
  const { lists: userLists, feeds } = splitListsAndFeeds(lists);
  return (
    <>
      <MenuLink to="/l">
        <span>
          <Trans>Lists & Feeds</Trans>
        </span>
      </MenuLink>
      <MenuDivider />
      {userLists.length > 0 && (
        <>
          <MenuHeader className="plain">
            <Trans>Lists</Trans>
          </MenuHeader>
          {userLists.map((list) => (
            <MenuLink key={list.id} to={`/l/${list.id}`}>
              <span>
                {list.title}
                {list.exclusive && (
                  <>
                    {' '}
                    <ListExclusiveBadge />
                  </>
                )}
              </span>
            </MenuLink>
          ))}
        </>
      )}
      {feeds.length > 0 && (
        <>
          <MenuHeader className="plain">
            <Trans>Feeds</Trans>
          </MenuHeader>
          {feeds.map((feed) => (
            <MenuLink key={feed.id} to={`/l/${feed.id}`}>
              <Icon icon="sparkles" /> <span>{feed.title}</span>
            </MenuLink>
          ))}
        </>
      )}
    </>
  );
}

function Shortcuts() {
  const { t } = useLingui();
  const { i18n } = useLinguiCore();
  const { instance } = api();
  const snapStates = useSnapshot(states);
  const { shortcuts, settings } = snapStates;

  if (!shortcuts.length) {
    return null;
  }
  const isMultiColumnMode =
    (settings.shortcutsViewMode === 'multi-column' ||
      (!settings.shortcutsViewMode && settings.shortcutsColumnsMode)) &&
    !!shortcuts.length;

  const menuRef = useRef<MenuInstance | null>(null);
  const tabBarRef = useRef<HTMLElement | null>(null);

  const hasLists = useRef(false);
  const shortcutsMeta = SHORTCUTS_META as unknown as Record<
    string,
    {
      id?: unknown;
      path?: unknown;
      title?: unknown;
      subtitle?: unknown;
      icon?: unknown;
      altIcon?: unknown;
    }
  >;
  const formattedShortcuts: FormattedShortcut[] = (shortcuts as ShortcutPin[])
    .map((pin, i): FormattedShortcut | null => {
      const { type, ...data } = pin;
      if (!type || !shortcutsMeta[type]) return null;
      let { id, path, title, subtitle, icon, altIcon } = shortcutsMeta[type];

      if (typeof id === 'function') {
        id = (id as (d: unknown, i: number) => unknown)(data, i);
      }
      if (typeof path === 'function') {
        path = (path as (d: unknown, i: number) => unknown)(
          {
            ...data,
            instance: data.instance || instance,
          },
          i,
        );
      }
      if (typeof title === 'function') {
        title = (title as (d: unknown, i: number) => unknown)(data, i);
      } else if (
        title &&
        typeof title === 'object' &&
        'id' in (title as Record<string, unknown>)
      ) {
        // Check if it's MessageDescriptor
        title = i18n._(title as MessageDescriptor);
      }
      if (typeof subtitle === 'function') {
        subtitle = (subtitle as (d: unknown, i: number) => unknown)(data, i);
      } else if (
        subtitle &&
        typeof subtitle === 'object' &&
        'id' in (subtitle as Record<string, unknown>)
      ) {
        // Check if it's MessageDescriptor
        subtitle = i18n._(subtitle as MessageDescriptor);
      }
      if (typeof icon === 'function') {
        icon = (icon as (d: unknown, i: number) => unknown)(data, i);
      }
      if (typeof altIcon === 'function') {
        altIcon = (altIcon as (d: unknown, i: number) => unknown)(data, i);
      }

      if (id === 'lists') {
        hasLists.current = true;
      }

      return {
        id: id as string | undefined,
        path: path as string | undefined,
        title: title as string | Promise<string> | undefined,
        subtitle: subtitle as string | Promise<string> | undefined,
        icon: icon as string | undefined,
        altIcon: altIcon as AltIconValue | undefined,
      };
    })
    .filter((item): item is FormattedShortcut => item !== null);

  // Auto-scroll to active tab on first render
  useEffect(() => {
    if (
      snapStates.settings.shortcutsViewMode === 'tab-menu-bar' &&
      tabBarRef.current
    ) {
      const timeoutId = setTimeout(() => {
        const activeTab = tabBarRef.current?.querySelector('.is-active');
        if (activeTab instanceof HTMLElement) {
          activeTab.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
          });
        }
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, []);

  const navigate = useNavigate();
  useHotkeys(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    (e) => {
      const index = parseInt(e.key, 10) - 1;
      if (index < formattedShortcuts.length) {
        const { path } = formattedShortcuts[index];
        if (path) {
          navigate(path);
          menuRef.current?.closeMenu?.();
        }
      }
    },
    {
      enabled: !isMultiColumnMode,
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        // Allow number even with Shift (e.g. French AZERTY requires Shift for numbers)
        if (/^[1-9]$/.test(e.key)) return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  const [lists, setLists] = useState<ListLike[]>([]);

  const listsMenuRef = useRef<MenuInstance | null>(null);
  const listsLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [listsMenuState, setListsMenuState] = useState<MenuState | undefined>(
    undefined,
  );

  useEffect(() => {
    if (listsMenuState === 'open') {
      getLists().then(setLists);
    }
  }, [listsMenuState]);

  const bindListsLongPress = useLongPress(
    () => {
      setListsMenuState('open');
    },
    {
      threshold: 600,
      detect: LongPressEventType.Touch,
      cancelOnMovement: true,
    },
  );

  const bindProfileLongPress = useLongPress(
    () => {
      states.showAccounts = true;
    },
    {
      threshold: 600,
      detect: LongPressEventType.Touch,
      cancelOnMovement: true,
    },
  );

  if (isMultiColumnMode) {
    return null;
  }

  return (
    <div id="shortcuts">
      {snapStates.settings.shortcutsViewMode === 'tab-menu-bar' ? (
        <>
          <nav
            ref={tabBarRef}
            class="tab-bar"
            onContextMenu={(e) => {
              e.preventDefault();
              states.showShortcutsSettings = true;
            }}
          >
            <ul>
              {formattedShortcuts.map(
                ({ id, path, title, subtitle, icon, altIcon }, i) => {
                  const extraProps: Record<string, unknown> =
                    id === 'lists'
                      ? {
                          ref: listsLinkRef,
                          onContextMenu(e: MouseEvent) {
                            e.preventDefault();
                            e.stopPropagation();
                            setListsMenuState('open');
                          },
                          ...bindListsLongPress(),
                        }
                      : id === 'profile'
                        ? {
                            onContextMenu(e: MouseEvent) {
                              e.preventDefault();
                              e.stopPropagation();
                              states.showAccounts = true;
                            },
                            ...bindProfileLongPress(),
                          }
                        : {};

                  return (
                    <li key={`${i}-${id}-${title}-${subtitle}-${path}`}>
                      <Link
                        class={subtitle ? 'has-subtitle' : ''}
                        to={path ?? ''}
                        onClick={(
                          e: JSX.TargetedMouseEvent<HTMLAnchorElement>,
                        ) => {
                          const target = e.target as HTMLElement;
                          if (target.classList.contains('is-active')) {
                            e.preventDefault();
                            const page = document.getElementById(`${id}-page`);
                            if (page) {
                              page.scrollTop = 0;
                              const updatesButton =
                                page.querySelector('.updates-button');
                              if (updatesButton instanceof HTMLElement) {
                                updatesButton.click();
                              }
                            }
                          }
                        }}
                        {...extraProps}
                      >
                        {altIcon?.url ? (
                          altIcon?.type === 'avatar' ? (
                            <Avatar staticUrl={altIcon.url} size="l" />
                          ) : (
                            <img
                              src={altIcon.url}
                              alt=""
                              class="shortcut-icon"
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                            />
                          )
                        ) : (
                          <Icon icon={icon} size="xl" />
                        )}
                        <span>
                          <AsyncText>{title ?? ''}</AsyncText>
                          {subtitle && (
                            <>
                              <br />
                              <small>{subtitle}</small>
                            </>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                },
              )}
            </ul>
          </nav>
          <ControlledMenu
            ref={listsMenuRef}
            state={listsMenuState}
            anchorRef={listsLinkRef}
            menuClassName="lists-picker-menu"
            onClose={() => {
              setListsMenuState(undefined);
            }}
            overflow="auto"
            viewScroll="close"
            gap={4}
            boundingBoxPadding={safeBoundingBoxPadding()}
            portal={{
              target: document.body,
            }}
          >
            <ListsMenuContent lists={lists} />
          </ControlledMenu>
        </>
      ) : (
        <Menu2
          instanceRef={menuRef}
          overflow="auto"
          viewScroll="close"
          menuClassName="glass-menu shortcuts-menu"
          gap={8}
          position="anchor"
          onMenuChange={(e) => {
            if (e.open && hasLists.current) {
              getLists().then(setLists);
            }
          }}
          menuButton={
            <button
              type="button"
              id="shortcuts-button"
              class="plain"
              onContextMenu={(e) => {
                e.preventDefault();
                states.showShortcutsSettings = true;
              }}
              onTransitionStart={(e) => {
                // Close menu if the button disappears
                try {
                  const target = e.target as Element | null;
                  if (
                    target &&
                    getComputedStyle(target).pointerEvents === 'none'
                  ) {
                    menuRef.current?.closeMenu?.();
                  }
                } catch (e) {}
              }}
            >
              <Icon icon="shortcut" size="xl" alt={t`Shortcuts`} />
            </button>
          }
        >
          {formattedShortcuts.map(({ id, path, title, subtitle, icon }, i) => {
            if (id === 'lists') {
              return (
                <SubMenu2
                  menuClassName="glass-menu lists-picker-menu"
                  overflow="auto"
                  gap={-8}
                  label={
                    <>
                      <Icon icon={icon} size="l" />
                      <span class="menu-grow">
                        <AsyncText>{title ?? ''}</AsyncText>
                      </span>
                      <Icon icon="chevron-right" />
                    </>
                  }
                >
                  <ListsMenuContent lists={lists} />
                </SubMenu2>
              );
            }

            return (
              <MenuLink
                to={path}
                key={`${i}-${id}-${title}-${subtitle}-${path}`}
                class="glass-menu-item"
              >
                <Icon icon={icon} size="l" />{' '}
                <span class="menu-grow">
                  <span>
                    <AsyncText>{title ?? ''}</AsyncText>
                  </span>
                  {subtitle && (
                    <>
                      {' '}
                      <small class="more-insignificant">{subtitle}</small>
                    </>
                  )}
                </span>
                <span class="menu-shortcut hide-until-focus-visible">
                  {i + 1}
                </span>
              </MenuLink>
            );
          })}
        </Menu2>
      )}
    </div>
  );
}

export default memo(Shortcuts);
