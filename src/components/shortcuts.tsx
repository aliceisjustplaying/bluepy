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
import { memo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { LongPressEventType, useLongPress } from 'use-long-press';
import { useSnapshot } from 'valtio';

import {
  SHORTCUTS_META,
  type ShortcutMetaInput,
  type ShortcutMetaValue,
} from '../components/shortcuts-settings';
import { api } from '../utils/api';
import { getLists, splitListsAndFeeds } from '../utils/lists';
import { navigatePath } from '../utils/router';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import states from '../utils/states';

import AsyncText from './AsyncText';
import Avatar from './avatar';
import Icon from './icon';
import Link from './link';
import MenuLink from './menu-link';
import Menu2 from './menu2';
import SubMenu2 from './submenu2';

interface ListLike {
  id: string;
  title: string;
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

type ShortcutPin = ShortcutMetaInput;
type ShortcutMetaResolver<T> = (
  shortcut: ShortcutMetaInput,
  index?: number,
) => T;

function resolveMetaValue<T>(
  value: ShortcutMetaValue<T> | undefined,
  shortcut: ShortcutMetaInput,
  index: number,
): T | undefined {
  if (typeof value === 'function') {
    const resolver = value as ShortcutMetaResolver<T>;
    return resolver(shortcut, index);
  }
  return value;
}

function isMessageDescriptor(value: unknown): value is MessageDescriptor {
  return !!value && typeof value === 'object' && 'id' in value;
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
              <span>{list.title}</span>
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

function stringifyKeyPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return '';
}

function keyFor(
  i: number,
  id: string | undefined,
  title: string | Promise<string> | undefined,
  subtitle: string | Promise<string> | undefined,
  path: string | undefined,
): string {
  return `${i}-${id ?? ''}-${stringifyKeyPart(title)}-${stringifyKeyPart(subtitle)}-${path ?? ''}`;
}

function Shortcuts() {
  const { t } = useLingui();
  const { i18n } = useLinguiCore();
  const { instance } = api();
  const snapStates = useSnapshot(states);
  const { shortcuts, settings } = snapStates;

  const isMultiColumnMode =
    (settings.shortcutsViewMode === 'multi-column' ||
      (!settings.shortcutsViewMode && settings.shortcutsColumnsMode)) &&
    !!shortcuts.length;

  const menuRef = useRef<MenuInstance | null>(null);
  const tabBarRef = useRef<HTMLElement | null>(null);

  const hasLists = useRef(false);
  const formattedShortcuts: FormattedShortcut[] = (shortcuts as ShortcutPin[])
    .map((pin, i): FormattedShortcut | null => {
      const { type, ...data } = pin;
      const meta = type ? SHORTCUTS_META[type] : undefined;
      if (!type || !meta) return null;
      const shortcutData: ShortcutMetaInput = data;
      const pathData: ShortcutMetaInput = {
        ...data,
        instance: data.instance || instance,
      };
      const id = resolveMetaValue(meta.id, shortcutData, i);
      const path = resolveMetaValue(meta.path, pathData, i);
      let title = resolveMetaValue(meta.title, shortcutData, i);
      let subtitle = resolveMetaValue(meta.subtitle, shortcutData, i);
      const icon = resolveMetaValue(meta.icon, shortcutData, i);
      const altIcon = resolveMetaValue(meta.altIcon, shortcutData, i);

      if (isMessageDescriptor(title)) {
        title = i18n._(title);
      }
      if (isMessageDescriptor(subtitle)) {
        subtitle = i18n._(subtitle);
      }

      if (id === 'lists') {
        hasLists.current = true;
      }

      return {
        id,
        path,
        title,
        subtitle,
        icon,
        altIcon,
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

      return () => {
        clearTimeout(timeoutId);
      };
    }
    return undefined;
  }, [snapStates.settings.shortcutsViewMode]);

  useHotkeys(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    (e) => {
      const index = parseInt(e.key, 10) - 1;
      if (index < formattedShortcuts.length) {
        const { path } = formattedShortcuts[index];
        if (path) {
          navigatePath(path);
          menuRef.current?.closeMenu?.();
        }
      }
    },
    {
      enabled: !isMultiColumnMode,
      useKey: true,
      ignoreEventWhen: (e) => {
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
      void getLists().then(setLists);
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

  if (!shortcuts.length || isMultiColumnMode) {
    return null;
  }

  return (
    <div id="shortcuts">
      {snapStates.settings.shortcutsViewMode === 'tab-menu-bar' ? (
        <>
          <nav
            ref={tabBarRef}
            className="tab-bar"
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
                          onContextMenu(e: React.MouseEvent) {
                            e.preventDefault();
                            e.stopPropagation();
                            setListsMenuState('open');
                          },
                          ...bindListsLongPress(),
                        }
                      : id === 'profile'
                        ? {
                            onContextMenu(e: React.MouseEvent) {
                              e.preventDefault();
                              e.stopPropagation();
                              states.showAccounts = true;
                            },
                            ...bindProfileLongPress(),
                          }
                        : {};

                  return (
                    <li key={keyFor(i, id, title, subtitle, path)}>
                      <Link
                        className={subtitle ? 'has-subtitle' : ''}
                        to={path ?? ''}
                        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
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
                              className="shortcut-icon"
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
            anchorRef={listsLinkRef as never}
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
              void getLists().then(setLists);
            }
          }}
          menuButton={
            <button
              type="button"
              id="shortcuts-button"
              className="plain"
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
                } catch {}
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
                  key={keyFor(i, id, title, subtitle, path)}
                  menuClassName="glass-menu lists-picker-menu"
                  overflow="auto"
                  gap={-8}
                  label={
                    <>
                      <Icon icon={icon} size="l" />
                      <span className="menu-grow">
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
                key={keyFor(i, id, title, subtitle, path)}
                className="glass-menu-item"
              >
                <Icon icon={icon} size="l" />{' '}
                <span className="menu-grow">
                  <span>
                    <AsyncText>{title ?? ''}</AsyncText>
                  </span>
                  {subtitle && (
                    <>
                      {' '}
                      <small className="more-insignificant">{subtitle}</small>
                    </>
                  )}
                </span>
                <span className="menu-shortcut hide-until-focus-visible">
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
