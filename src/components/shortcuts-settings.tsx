import './shortcuts-settings.css';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';
import type { Dispatch, HTMLAttributes, RefObject, SetStateAction } from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import floatingButtonUrl from '../assets/floating-button.svg';
import multiColumnUrl from '../assets/multi-column.svg';
import tabMenuBarUrl from '../assets/tab-menu-bar.svg';

import { api, getMastoV1Resource } from '../utils/api';
import { getLists, getListTitle, splitListsAndFeeds } from '../utils/lists';
import pmem from '../utils/pmem';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import { getCurrentAccount, getCurrentAccountID } from '../utils/store-utils';

import AsyncText from './AsyncText';
import Icon from './icon';
import MenuConfirm from './menu-confirm';
import Modal from './modal';
import { mediaDevicesSupported } from './qr-code-modal';

// A shortcut record stored in the user's shortcut list. `type` selects which
// timeline; remaining string keys are per-type params (id, instance, query,
// hashtag, local, media, ...). Form submissions only ever produce string
// values (FormData), so non-`type` fields are typed loosely as string.
export interface ShortcutMetaInput {
  type?: string;
  [key: string]: string | undefined;
}

interface ShortcutEntry extends ShortcutMetaInput {
  type: string;
}

// `api().masto` is loosely typed at the hub (open index signature). Shim a
// narrower view for the v1 endpoints touched here.
interface AccountSelectClient {
  fetch(): Promise<{
    username?: string;
    acct?: string;
    displayName?: string;
  }>;
}
interface MastoV1AccountsForShortcuts {
  $select(id: string): AccountSelectClient;
}
type ShortcutMetaResolver<T> = (
  shortcut: ShortcutMetaInput,
  index?: number,
) => T;
type ShortcutMetaStatic =
  | string
  | MessageDescriptor
  | Promise<string>
  | string[]
  | { url?: string; type: string }
  | undefined;

// Lingui macro returns `Omit<I18nContext, "_"> & { t }`. Other tsx call sites
// use `i18n._(msg)` to translate MessageDescriptors; we follow that pattern.
type Translator = (descriptor: MessageDescriptor) => string;

export const SHORTCUTS_LIMIT = 9;

interface TypeParam {
  text: string | MessageDescriptor;
  name: string;
  type?: string;
  placeholder?: string | MessageDescriptor;
  pattern?: string;
  notRequired?: boolean;
}

const TYPES: string[] = [
  'following',
  'mentions',
  'notifications',
  'list',
  'trending',
  'search',
  'hashtag',
  'bookmarks',
  'favourites',
  'profile', // Own profile
  // NOTE: Hide for now
  // 'account-statuses', // Need @acct search first
];
const TYPE_TEXT: Record<string, MessageDescriptor> = {
  following: msg`Home / Following`,
  notifications: msg`Notifications`,
  list: msg`Lists & Feeds`,
  search: msg`Search`,
  'account-statuses': msg`Account`,
  bookmarks: msg`Bookmarks`,
  favourites: msg`Likes`,
  hashtag: msg`Hashtag`,
  trending: msg`Trending`,
  mentions: msg`Mentions`,
  profile: msg`Profile`,
};
const TYPE_PARAMS: Record<string, TypeParam[]> = {
  list: [
    {
      text: msg`List ID`,
      name: 'id',
      notRequired: true,
    },
  ],
  trending: [
    {
      text: msg`PDS`,
      name: 'instance',
      type: 'text',
      placeholder: msg`Optional, e.g. bsky.social`,
      notRequired: true,
    },
  ],
  search: [
    {
      text: msg`Search term`,
      name: 'query',
      type: 'text',
      placeholder: msg`Optional`,
      notRequired: true,
    },
  ],
  'account-statuses': [
    {
      text: '@',
      name: 'id',
      type: 'text',
      placeholder: 'alice.bsky.social',
    },
  ],
  hashtag: [
    {
      text: '#',
      name: 'hashtag',
      type: 'text',
      placeholder: msg`e.g. PixelArt (Max 5, space-separated)`,
      pattern: '[^#]+',
    },
    {
      text: msg`Media only`,
      name: 'media',
      type: 'checkbox',
    },
    {
      text: msg`PDS`,
      name: 'instance',
      type: 'text',
      placeholder: msg`Optional, e.g. bsky.social`,
      notRequired: true,
    },
  ],
};
const fetchAccountTitle = pmem(
  async ({ id }: { id: string }): Promise<string> => {
    const accountsResource = getMastoV1Resource<MastoV1AccountsForShortcuts>(
      api().masto,
      'accounts',
    );
    const account = await accountsResource.$select(id).fetch();
    return account.username || account.acct || account.displayName || '';
  },
);

// SHORTCUTS_META describes per-shortcut-type metadata. Some fields are static
// strings/MessageDescriptors and some are functions of the shortcut entry.
export type ShortcutMetaValue<T extends ShortcutMetaStatic> =
  | T
  | ShortcutMetaResolver<T>;
export interface ShortcutMetaEntry {
  id: ShortcutMetaValue<string>;
  title: ShortcutMetaValue<string | MessageDescriptor | Promise<string>>;
  subtitle?: ShortcutMetaValue<string | undefined>;
  path: ShortcutMetaValue<string>;
  icon: ShortcutMetaValue<string>;
  altIcon?: ShortcutMetaValue<{ url?: string; type: string }>;
  excludeViewMode?: ShortcutMetaValue<string[]>;
}

export const SHORTCUTS_META: Partial<Record<string, ShortcutMetaEntry>> = {
  following: {
    id: 'home',
    title: (_shortcut, index) =>
      index === 0
        ? t`Home`
        : t({ id: 'following.title', message: 'Following' }),
    path: '/',
    icon: 'home',
  },
  mentions: {
    id: 'mentions',
    title: msg`Mentions`,
    path: '/mentions',
    icon: 'at',
  },
  notifications: {
    id: 'notifications',
    title: msg`Notifications`,
    path: '/notifications',
    icon: 'notification',
  },
  list: {
    id: ({ id }) => (id ? 'list' : 'lists'),
    title: ({ id }) => (id ? getListTitle(id) : t`Lists & Feeds`),
    path: ({ id }) => (id ? `/l/${id}` : '/l'),
    icon: 'list',
  },
  trending: {
    id: 'trending',
    title: msg`Trending`,
    subtitle: ({ instance }) => instance || api().instance,
    path: ({ instance }) => `/${instance}/trending`,
    icon: 'chart',
  },
  search: {
    id: 'search',
    title: ({ query }) => (query ? `“${query}”` : t`Search`),
    path: ({ query }) =>
      query
        ? `/search?q=${encodeURIComponent(query)}&type=statuses`
        : '/search',
    icon: 'search',
  },
  profile: {
    id: 'profile',
    title: msg`Profile`,
    path: () => `/a/${getCurrentAccountID()}?replies=1`,
    icon: 'user',
    altIcon: () => {
      const account = getCurrentAccount();
      const info = account?.info;
      const avatarStatic =
        info &&
        'avatarStatic' in info &&
        typeof info.avatarStatic === 'string'
          ? info.avatarStatic
          : undefined;
      return {
        // Prefer static URL
        url: avatarStatic || info?.avatar,
        type: 'avatar',
      };
    },
  },
  'account-statuses': {
    id: 'account-statuses',
    title: ({ id }) => (id ? fetchAccountTitle({ id }) : ''),
    path: ({ id }) => `/a/${id}`,
    icon: 'user',
  },
  bookmarks: {
    id: 'bookmarks',
    title: msg`Bookmarks`,
    path: '/b',
    icon: 'bookmark',
  },
  favourites: {
    id: 'favourites',
    title: msg`Likes`,
    path: '/f',
    icon: 'heart',
  },
  hashtag: {
    id: 'hashtag',
    title: ({ hashtag }) => hashtag || '',
    subtitle: ({ instance }) => instance || api().instance,
    path: ({ hashtag, instance, media }) =>
      `${instance ? `/${encodeURIComponent(instance)}` : ''}/t/${encodedHashtagPath(
        hashtag || '',
      )}${media ? '?media=1' : ''}`,
    icon: 'hashtag',
  },
};

function encodedHashtagPath(value: string) {
  return value.split(/\s+/).reduce((path, tag) => {
    if (!tag) return path;
    const encodedTag = encodeURIComponent(tag);
    return path ? `${path}+${encodedTag}` : encodedTag;
  }, '');
}

function resolveShortcutMeta<T extends ShortcutMetaStatic>(
  value: ShortcutMetaValue<T> | undefined,
  shortcut: ShortcutEntry,
  index: number,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  return typeof value === 'function'
    ? value(shortcut, index)
    : value;
}

function isShortcutEntry(value: unknown): value is ShortcutEntry {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

function asShortcutEntries(value: unknown): readonly ShortcutEntry[] {
  return Array.isArray(value) ? value.filter(isShortcutEntry) : [];
}

function unknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value.map((item: unknown) => item) : null;
}

function getStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

interface ShortcutsSettingsProps {
  onClose?: () => void;
}

type ShortcutFormState =
  | false
  | true
  | { shortcut: ShortcutEntry; shortcutIndex: number };
type ShortcutsListParent = ReturnType<
  typeof useAutoAnimate<HTMLOListElement>
>[0];

interface ShortcutsListProps {
  currentViewMode: unknown;
  shortcuts: readonly ShortcutEntry[];
  shortcutsListParent: ShortcutsListParent;
  setShowForm: Dispatch<SetStateAction<ShortcutFormState>>;
}

interface ShortcutsActionsProps {
  shortcutsCount: number;
  setShowForm: Dispatch<SetStateAction<ShortcutFormState>>;
  setShowImportExport: Dispatch<SetStateAction<boolean>>;
}

function ShortcutsViewMode() {
  const snapStates = useSnapshot(states);

  return (
    <div className="shortcuts-view-mode">
      {[
        {
          value: 'float-button',
          label: t`Floating button`,
          imgURL: floatingButtonUrl,
        },
        {
          value: 'tab-menu-bar',
          label: t`Tab/Menu bar`,
          imgURL: tabMenuBarUrl,
        },
        {
          value: 'multi-column',
          label: t`Multi-column`,
          imgURL: multiColumnUrl,
        },
      ].map(({ value, label, imgURL }) => {
        const checked =
          snapStates.settings.shortcutsViewMode === value ||
          (value === 'float-button' && !snapStates.settings.shortcutsViewMode);
        return (
          <label key={value} className={checked ? 'checked' : ''}>
            <input
              type="radio"
              name="shortcuts-view-mode"
              value={value}
              checked={checked}
              onChange={(e) => {
                states.settings.shortcutsViewMode = e.currentTarget.value;
              }}
            />{' '}
            <img src={imgURL} alt="" width="80" height="58" />{' '}
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

function ShortcutsList({
  currentViewMode,
  shortcuts,
  shortcutsListParent,
  setShowForm,
}: ShortcutsListProps) {
  const { i18n } = useLingui();
  const _: Translator = (descriptor) => i18n._(descriptor);

  if (shortcuts.length === 0) {
    return (
      <div className="ui-state insignificant">
        <p>{t`No shortcuts yet. Tap on the Add shortcut button.`}</p>
        <p>
          <Trans>
            Not sure what to add?
            <br />
            Try adding{' '}
            <button
              type="button"
              className="plain"
              onClick={() => {
                states.shortcuts = [
                  {
                    type: 'following',
                  },
                  {
                    type: 'notifications',
                  },
                ];
              }}
            >
              Home / Following and Notifications
            </button>{' '}
            first.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <>
      <ol className="shortcuts-list" ref={shortcutsListParent}>
        {shortcuts.map((shortcut, i) => {
          if (!shortcut) return null;
          // const key = i + Object.values(shortcut);
          const key = Object.values(shortcut).join('-');
          const { type } = shortcut;
          if (!SHORTCUTS_META[type]) return null;
          const meta = SHORTCUTS_META[type];
          const icon = resolveShortcutMeta(meta.icon, shortcut, i, '');
          const titleValue = resolveShortcutMeta(meta.title, shortcut, i, '');
          const title =
            typeof titleValue === 'string' || titleValue instanceof Promise
              ? titleValue
              : _(titleValue);
          const subtitle = resolveShortcutMeta(
            meta.subtitle,
            shortcut,
            i,
            undefined,
          );
          const excludeViewMode = resolveShortcutMeta(
            meta.excludeViewMode,
            shortcut,
            i,
            undefined,
          );
          const excludedViewMode =
            typeof currentViewMode === 'string' &&
            excludeViewMode?.includes(currentViewMode);
          return (
            <li key={key}>
              <Icon icon={icon} />
              <span className="shortcut-text">
                <AsyncText value={title} />
                {!!subtitle && (
                  <>
                    {' '}
                    <small className="ib insignificant">{subtitle}</small>
                  </>
                )}
                {excludedViewMode && (
                  <span className="tag">
                    <Trans>Not available in current view mode</Trans>
                  </span>
                )}
              </span>
              <span className="shortcut-actions">
                <button
                  type="button"
                  className="plain small"
                  disabled={i === 0}
                  onClick={() => {
                    const shortcutsArr = Array.from(states.shortcuts);
                    if (i > 0) {
                      const temp = states.shortcuts[i - 1];
                      shortcutsArr[i - 1] = shortcut;
                      shortcutsArr[i] = temp;
                      states.shortcuts = shortcutsArr;
                    }
                  }}
                >
                  <Icon icon="arrow-up" alt={t`Move up`} />
                </button>
                <button
                  type="button"
                  className="plain small"
                  disabled={i === shortcuts.length - 1}
                  onClick={() => {
                    const shortcutsArr = Array.from(states.shortcuts);
                    if (i < states.shortcuts.length - 1) {
                      const temp = states.shortcuts[i + 1];
                      shortcutsArr[i + 1] = shortcut;
                      shortcutsArr[i] = temp;
                      states.shortcuts = shortcutsArr;
                    }
                  }}
                >
                  <Icon icon="arrow-down" alt={t`Move down`} />
                </button>
                <button
                  type="button"
                  className="plain small"
                  onClick={() => {
                    setShowForm({
                      shortcut,
                      shortcutIndex: i,
                    });
                  }}
                >
                  <Icon icon="pencil" alt={t`Edit`} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {shortcuts.length === 1 && currentViewMode !== 'float-button' && (
        <div className="ui-state insignificant">
          <Icon icon="info" />{' '}
          <small>
            <Trans>Add more than one shortcut/column to make this work.</Trans>
          </small>
        </div>
      )}
    </>
  );
}

function ShortcutsActions({
  shortcutsCount,
  setShowForm,
  setShowImportExport,
}: ShortcutsActionsProps) {
  return (
    <>
      <p className="insignificant">
        {shortcutsCount >= SHORTCUTS_LIMIT &&
          t`Max ${SHORTCUTS_LIMIT} shortcuts`}
      </p>
      <p
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          className="light"
          onClick={() => {
            setShowImportExport(true);
          }}
        >
          <Trans>Import/export</Trans>
        </button>
        <button
          type="button"
          disabled={shortcutsCount >= SHORTCUTS_LIMIT}
          onClick={() => {
            setShowForm(true);
          }}
        >
          <Icon icon="plus" /> <span>{t`Add shortcut…`}</span>
        </button>
      </p>
    </>
  );
}

function ShortcutsSettings({ onClose }: ShortcutsSettingsProps) {
  const snapStates = useSnapshot(states);
  const shortcuts = asShortcutEntries(snapStates.shortcuts);
  const [showForm, setShowForm] = useState<ShortcutFormState>(false);
  const [showImportExport, setShowImportExport] = useState(false);

  const [shortcutsListParent] = useAutoAnimate<HTMLOListElement>();

  return (
    <div id="shortcuts-settings-container" className="sheet" tabIndex={-1}>
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Icon icon="shortcut" /> <Trans>Shortcuts</Trans>{' '}
          <sup
            style={{
              fontSize: 12,
              opacity: 0.5,
              textTransform: 'uppercase',
            }}
          >
            <Trans>beta</Trans>
          </sup>
        </h2>
      </header>
      <main>
        <p>
          <Trans>Specify a list of shortcuts that'll appear&nbsp;as:</Trans>
        </p>
        <ShortcutsViewMode />
        <ShortcutsList
          currentViewMode={snapStates.settings.shortcutsViewMode}
          shortcuts={shortcuts}
          shortcutsListParent={shortcutsListParent}
          setShowForm={setShowForm}
        />
        <ShortcutsActions
          shortcutsCount={shortcuts.length}
          setShowForm={setShowForm}
          setShowImportExport={setShowImportExport}
        />
      </main>
      {showForm && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowForm(false);
            }
          }}
        >
          <ShortcutForm
            shortcut={
              typeof showForm === 'object' ? showForm.shortcut : undefined
            }
            shortcutIndex={
              typeof showForm === 'object' ? showForm.shortcutIndex : undefined
            }
            onSubmit={({ result, mode }) => {
              console.log('onSubmit', result);
              if (mode === 'edit') {
                if (typeof showForm === 'object') {
                  states.shortcuts[showForm.shortcutIndex] = result;
                }
              } else {
                states.shortcuts.push(result);
              }
            }}
            onClose={() => {
              setShowForm(false);
            }}
          />
        </Modal>
      )}
      {showImportExport && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowImportExport(false);
            }
          }}
        >
          <ImportExport
            shortcuts={shortcuts}
            onClose={() => {
              setShowImportExport(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

const FORM_NOTES: Record<string, MessageDescriptor> = {
  list: msg`Specific list is optional.`,
  hashtag: msg`Multiple hashtags are supported. Space-separated.`,
};

interface ShortcutFormSubmission {
  result: ShortcutEntry;
  mode: 'edit' | 'add';
}

interface ShortcutFormProps {
  onSubmit: (submission: ShortcutFormSubmission) => void;
  disabled?: boolean;
  shortcut?: ShortcutEntry;
  shortcutIndex?: number;
  onClose?: () => void;
}

type ListLike = Awaited<ReturnType<typeof getLists>>[number];
interface ShortcutFormListState {
  lists: ListLike[];
  uiState: string;
}

type ShortcutFormListAction =
  | { type: 'loading' }
  | { type: 'success'; lists: ListLike[] }
  | { type: 'error' };

function shortcutFormListReducer(
  state: ShortcutFormListState,
  action: ShortcutFormListAction,
): ShortcutFormListState {
  switch (action.type) {
    case 'loading':
      return { ...state, uiState: 'loading' };
    case 'success':
      return { lists: action.lists, uiState: 'default' };
    case 'error':
      return { ...state, uiState: 'error' };
  }
  return state;
}

function ShortcutForm({
  onSubmit,
  disabled,
  shortcut,
  shortcutIndex,
  onClose,
}: ShortcutFormProps) {
  const { i18n } = useLingui();
  const _: Translator = (descriptor) => i18n._(descriptor);
  console.log('shortcut', shortcut);
  const editMode = !!shortcut;
  const [currentType, setCurrentType] = useState<string | null>(
    shortcut?.type || null,
  );

  const [{ lists, uiState }, dispatchListState] = useReducer(
    shortcutFormListReducer,
    { lists: [], uiState: 'default' },
  );
  const { lists: userLists, feeds } = splitListsAndFeeds(lists);
  useEffect(() => {
    void (async () => {
      if (currentType !== 'list') return;
      try {
        dispatchListState({ type: 'loading' });
        const fetchedLists = await getLists();
        dispatchListState({ type: 'success', lists: fetchedLists });
      } catch (e) {
        console.error(e);
        dispatchListState({ type: 'error' });
      }
    })();
  }, [currentType]);

  const formRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    if (
      editMode &&
      currentType &&
      (TYPE_PARAMS as Record<string, TypeParam[] | undefined>)[currentType]
    ) {
      // Populate form
      const form = formRef.current;
      if (!form) return;
      TYPE_PARAMS[currentType]?.forEach(({ name, type }) => {
        const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (input && shortcut && shortcut[name]) {
          if (type === 'checkbox') {
            input.checked = shortcut[name] === 'on';
          } else {
            input.value = shortcut[name];
          }
        }
      });
    }
  }, [editMode, currentType, shortcut]);

  return (
    <div id="shortcut-settings-form" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>{editMode ? t`Edit shortcut` : t`Add shortcut`}</h2>
      </header>
      <main tabIndex={-1}>
        <form
          ref={formRef}
          onSubmit={(e) => {
            // Construct a nice object from form
            e.preventDefault();
            const formEl = e.currentTarget;
            const data = new FormData(formEl);
            const result: Record<string, string> = {};
            data.forEach((value, key) => {
              if (typeof value !== 'string') return;
              result[key] = value.trim();
              if (key === 'instance') {
                // Remove protocol and trailing slash
                result[key] = result[key]
                  .replace(/^https?:\/\//, '')
                  .replace(/\/+$/, '');
                // Remove @acct@ or acct@ from instance URL
                result[key] = result[key].replace(/^@?[^@]+@/, '');
              }
            });
            console.log('result', result);
            if (!result.type) return;
            onSubmit({
              result: { ...result, type: result.type },
              mode: editMode ? 'edit' : 'add',
            });
            // Reset
            formEl.reset();
            setCurrentType(null);
            onClose?.();
          }}
        >
          <p>
            <label>
              <span>
                <Trans>Timeline</Trans>
              </span>
              <select
                required
                disabled={disabled}
                onChange={(e) => {
                  setCurrentType((e.target as HTMLSelectElement).value);
                }}
                defaultValue={editMode && shortcut ? shortcut.type : undefined}
                name="type"
                dir="auto"
              >
                <option></option>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {_(TYPE_TEXT[type])}
                  </option>
                ))}
              </select>
            </label>
          </p>
          {currentType
            ? TYPE_PARAMS[currentType]?.map?.(
                ({ text, name, type, placeholder, pattern, notRequired }) => {
                  if (currentType === 'list') {
                    return (
                      <p key={name}>
                        <label>
                          <span>
                            <Trans>List</Trans>
                          </span>
                          <select
                            name="id"
                            required={!notRequired}
                            disabled={disabled || uiState === 'loading'}
                            defaultValue={
                              editMode && shortcut ? shortcut.id : undefined
                            }
                            dir="auto"
                          >
                            <option value=""></option>
                            {userLists.length > 0 && (
                              <optgroup label={t`Lists`}>
                                {userLists.map((list) => (
                                  <option key={list.id} value={list.id}>
                                    {list.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {feeds.length > 0 && (
                              <optgroup label={t`Feeds`}>
                                {feeds.map((feed) => (
                                  <option key={feed.id} value={feed.id}>
                                    {feed.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                      </p>
                    );
                  }

                  return (
                    <p key={name}>
                      <label>
                        <span>{typeof text === 'string' ? text : _(text)}</span>{' '}
                        {(() => {
                          // `switch` is a non-standard HTML attribute used by
                          // some toggle-style styling; not in Preact's
                          // InputHTMLAttributes. Assemble props loosely then
                          // cast at the JSX boundary to keep the JS shape.
                          const inputProps = {
                            type,
                            switch: type === 'checkbox' || undefined,
                            name,
                            placeholder:
                              placeholder === undefined
                                ? undefined
                                : typeof placeholder === 'string'
                                  ? placeholder
                                  : _(placeholder),
                            required: type === 'text' && !notRequired,
                            disabled,
                            // Original JS passed `null` here. Preact treats
                            // null/undefined the same for HTML attributes.
                            list: null,
                            autocorrect: 'off',
                            autocapitalize: 'off',
                            spellCheck: false,
                            pattern,
                            dir: 'auto',
                          } as HTMLAttributes<HTMLInputElement>;
                          return <input {...inputProps} />;
                        })()}
                      </label>
                    </p>
                  );
                },
              )
            : null}
          {currentType &&
            !!(FORM_NOTES as Record<string, MessageDescriptor | undefined>)[
              currentType
            ] && (
              <p className="form-note insignificant">
                <Icon icon="info" />
                {_(FORM_NOTES[currentType])}
              </p>
            )}
          <footer>
            <button
              type="submit"
              className="block"
              disabled={disabled || uiState === 'loading'}
            >
              {editMode ? t`Save` : t`Add`}
            </button>
            {editMode && (
              <button
                type="button"
                className="light danger"
                onClick={() => {
                  if (shortcutIndex !== undefined) {
                    states.shortcuts.splice(shortcutIndex, 1);
                  }
                  onClose?.();
                }}
              >
                <Trans>Remove</Trans>
              </button>
            )}
          </footer>
        </form>
      </main>
    </div>
  );
}

interface ImportExportProps {
  shortcuts: readonly ShortcutEntry[];
  onClose?: () => void;
}

interface ImportShortcutsSectionProps {
  hasCurrentSettings: boolean;
  importShortcutStr: string;
  importUIState: string;
  onClose?: () => void;
  parsedImportShortcutStr: unknown[] | null;
  setImportShortcutStr: Dispatch<SetStateAction<string>>;
  shortcuts: readonly ShortcutEntry[];
  shortcutsImportFieldRef: RefObject<HTMLInputElement | null>;
}

interface ExportShortcutsSectionProps {
  shortcuts: readonly ShortcutEntry[];
  shortcutsStr: string;
}

function shortcutExistsInList(
  shortcut: Record<string, string>,
  shortcuts: readonly ShortcutEntry[],
) {
  return shortcuts.some((s) =>
    Object.keys(s).every((key) => {
      if (!(key in shortcut)) return true;
      const val = shortcut[key];
      if (val === '' || val === null || val === undefined) return true;
      return s[key] === val;
    }),
  );
}

function ImportShortcutsSection({
  hasCurrentSettings,
  importShortcutStr,
  importUIState,
  onClose,
  parsedImportShortcutStr,
  setImportShortcutStr,
  shortcuts,
  shortcutsImportFieldRef,
}: ImportShortcutsSectionProps) {
  const { i18n } = useLingui();
  const _: Translator = (descriptor) => i18n._(descriptor);

  return (
    <section>
      <h3>
        <Icon icon="arrow-down-circle" size="l" className="insignificant" />{' '}
        <span>
          <Trans>Import</Trans>
        </span>
      </h3>
      <p className="field-button">
        <input
          ref={shortcutsImportFieldRef}
          type="text"
          name="import"
          placeholder={t`Paste shortcuts here`}
          className="block"
          onInput={(e) => {
            setImportShortcutStr(e.currentTarget.value);
          }}
          dir="auto"
        />
        {mediaDevicesSupported && (
          <button
            type="button"
            className="plain2 small"
            onClick={() => {
              states.showQrScannerModal = {
                onClose: ({ text }: { text?: string } = {}) => {
                  if (text) {
                    setImportShortcutStr(text);
                    const field = shortcutsImportFieldRef.current;
                    if (field) {
                      field.value = text;
                      field.dispatchEvent(new Event('input'));
                    }
                  }
                },
              };
            }}
          >
            <Icon icon="scan" alt={t`Scan QR code`} />
          </button>
        )}
      </p>
      {!!parsedImportShortcutStr && Array.isArray(parsedImportShortcutStr) && (
        <>
          <p>
            <b>{parsedImportShortcutStr.length}</b> shortcut
            {parsedImportShortcutStr.length > 1 ? 's' : ''}{' '}
            <small className="insignificant">
              ({importShortcutStr.length} characters)
            </small>
          </p>
          <ol className="import-settings-list">
            {parsedImportShortcutStr.map((rawShortcut) => {
              // The JS original accesses fields directly without validating
              // each entry. We treat each parsed element as a loose
              // string-record to preserve that.
              const shortcut = getStringRecord(rawShortcut);
              const shortcutKey = JSON.stringify(shortcut);
              return (
                <li key={shortcutKey}>
                  <span
                    style={{
                      opacity: shortcutExistsInList(shortcut, shortcuts) ? 1 : 0,
                    }}
                  >
                    *
                  </span>
                  <span>
                    {_(TYPE_TEXT[shortcut.type])}
                    {shortcut.type === 'list' && !!shortcut.id && ' ⚠️'}{' '}
                    {TYPE_PARAMS[shortcut.type]?.map?.(({ text, name, type }) =>
                      shortcut[name] ? (
                        <>
                          <span className="tag collapsed insignificant">
                            {typeof text === 'string' ? text : _(text)}:{' '}
                            {type === 'checkbox'
                              ? shortcut[name] === 'on'
                                ? '✅'
                                : '❌'
                              : shortcut[name]}
                          </span>{' '}
                        </>
                      ) : null,
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <p>
            <small>
              <Trans>* Exists in current shortcuts</Trans>
            </small>
            <br />
            <small>
              ⚠️{' '}
              <Trans>List may not work if it's from a different account.</Trans>
            </small>
          </p>
        </>
      )}
      {importUIState === 'error' && (
        <p className="error">
          <small>
            ⚠️ <Trans>Invalid settings format</Trans>
          </small>
        </p>
      )}
      <p>
        {hasCurrentSettings && (
          <>
            <MenuConfirm
              confirmLabel={t`Append to current shortcuts?`}
              menuFooter={
                <div className="footer">
                  <Trans>
                    Only shortcuts that don’t exist in current shortcuts will be
                    appended.
                  </Trans>
                </div>
              }
              onClick={() => {
                // Append non-unique shortcuts only.
                const parsed = parsedImportShortcutStr ?? [];
                const currentShortcuts = asShortcutEntries(states.shortcuts);
                const nonUniqueShortcuts = parsed.filter((rawShortcut) => {
                  const shortcut = getStringRecord(rawShortcut);
                  return !currentShortcuts.some((s) =>
                    // Compare all properties
                    Object.keys(s).every((key) => s[key] === shortcut[key]),
                  );
                });
                if (!nonUniqueShortcuts.length) {
                  showToast(t`No new shortcuts to import`);
                  return;
                }
                let newShortcuts: unknown[] = [
                  ...states.shortcuts,
                  ...nonUniqueShortcuts,
                ];
                const exceededLimit = newShortcuts.length > SHORTCUTS_LIMIT;
                if (exceededLimit) {
                  // If exceeded, trim it
                  newShortcuts = newShortcuts.slice(0, SHORTCUTS_LIMIT);
                }
                states.shortcuts = [...asShortcutEntries(newShortcuts)];
                showToast(
                  exceededLimit
                    ? t`Shortcuts imported. Exceeded max ${SHORTCUTS_LIMIT}, so the rest are not imported.`
                    : t`Shortcuts imported`,
                );
                onClose?.();
              }}
            >
              <button
                type="button"
                className="plain2"
                disabled={!parsedImportShortcutStr}
              >
                <Trans>Import & append…</Trans>
              </button>
            </MenuConfirm>{' '}
          </>
        )}
        <MenuConfirm
          confirmLabel={
            hasCurrentSettings ? t`Override current shortcuts?` : t`Import shortcuts?`
          }
          menuItemClassName={hasCurrentSettings ? 'danger' : undefined}
          onClick={() => {
            states.shortcuts = [...asShortcutEntries(parsedImportShortcutStr)];
            showToast(t`Shortcuts imported`);
            onClose?.();
          }}
        >
          <button
            type="button"
            className="plain2"
            disabled={!parsedImportShortcutStr}
          >
            {hasCurrentSettings ? t`or override…` : t`Import…`}
          </button>
        </MenuConfirm>
      </p>
    </section>
  );
}

function ExportShortcutsSection({
  shortcuts,
  shortcutsStr,
}: ExportShortcutsSectionProps) {
  return (
    <section>
      <h3>
        <Icon icon="arrow-up-circle" size="l" className="insignificant" />{' '}
        <span>
          <Trans>Export</Trans>
        </span>
      </h3>
      <p className="field-button">
        <input
          style={{ width: '100%' }}
          type="text"
          value={shortcutsStr}
          readOnly
          onClick={(e) => {
            const target = e.currentTarget;
            if (!target.value) return;
            target.select();
            // Copy url to clipboard
            void (async () => {
              try {
                await navigator.clipboard.writeText(target.value);
                showToast(t`Shortcuts copied`);
              } catch (err) {
                console.error(err);
                showToast(t`Unable to copy shortcuts`);
              }
            })();
          }}
          dir="auto"
        />
        <button
          type="button"
          className="plain2 small"
          disabled={!shortcutsStr}
          onClick={() => {
            states.showQrCodeModal = {
              text: shortcutsStr,
            };
          }}
        >
          <Icon icon="qrcode" alt={t`QR code`} />
        </button>
      </p>
      <p>
        <button
          type="button"
          className="plain2"
          disabled={!shortcutsStr}
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(shortcutsStr);
                showToast(t`Shortcut settings copied`);
              } catch (err) {
                console.error(err);
                showToast(t`Unable to copy shortcut settings`);
              }
            })();
          }}
        >
          <Icon icon="clipboard" />{' '}
          <span>
            <Trans>Copy</Trans>
          </span>
        </button>{' '}
        {navigator?.share &&
          navigator?.canShare?.({
            text: shortcutsStr,
          }) && (
            <button
              type="button"
              className="plain2"
              disabled={!shortcutsStr}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.share({
                      text: shortcutsStr,
                    });
                  } catch (err) {
                    console.error(err);
                    alert(t`Sharing doesn't seem to work.`);
                  }
                })();
              }}
            >
              <Icon icon="share" />{' '}
              <span>
                <Trans>Share</Trans>
              </span>
            </button>
          )}{' '}
        {shortcutsStr.length > 0 && (
          <small className="insignificant ib">
            <Plural
              value={shortcutsStr.length}
              one="# character"
              other="# characters"
            />
          </small>
        )}
      </p>
      {!!shortcutsStr && (
        <details>
          <summary className="insignificant">
            <small>
              <Trans>Raw Shortcuts JSON</Trans>
            </small>
          </summary>
          <textarea style={{ width: '100%' }} rows={10} readOnly>
            {JSON.stringify(shortcuts.filter(Boolean), null, 2)}
          </textarea>
        </details>
      )}
    </section>
  );
}

function ImportExport({ shortcuts, onClose }: ImportExportProps) {
  const shortcutsStr = useMemo(() => {
    if (!shortcuts) return '';
    if (!shortcuts.filter(Boolean).length) return '';
    return compressToEncodedURIComponent(
      JSON.stringify(shortcuts.filter(Boolean)),
    );
  }, [shortcuts]);
  const [importShortcutStr, setImportShortcutStr] = useState('');
  const [importUIState, setImportUIState] = useState('default');
  // Parsed import payload — the original JS only checks `Array.isArray`, so
  // individual entries can be anything. Keep the element type `unknown` and
  // narrow per-element at the use sites.
  const parsedImportShortcutStr = useMemo<unknown[] | null>(() => {
    if (!importShortcutStr) {
      setImportUIState('default');
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(
        decompressFromEncodedURIComponent(importShortcutStr),
      );
      // Very basic validation, I know
      const parsedList = unknownArray(parsed);
      if (!parsedList) throw new Error('Not an array');
      setImportUIState('default');
      console.log('⚡ Parsed imported shortcuts', parsedList);
      return parsedList;
    } catch {
      // Fallback to JSON string parsing
      // There's a chance that someone might want to import a JSON string instead of the compressed version
      try {
        const parsed: unknown = JSON.parse(importShortcutStr);
        const parsedList = unknownArray(parsed);
        if (!parsedList) {
          throw new Error('Not an array');
        }
        setImportUIState('default');
        return parsedList;
      } catch {
        setImportUIState('error');
        return null;
      }
    }
  }, [importShortcutStr]);
  const hasCurrentSettings = states.shortcuts.length > 0;

  const shortcutsImportFieldRef = useRef<HTMLInputElement | null>(null);

  return (
    <div id="import-export-container" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>
            Import/Export <small className="ib insignificant">Shortcuts</small>
          </Trans>
        </h2>
      </header>
      <main tabIndex={-1}>
        <ImportShortcutsSection
          hasCurrentSettings={hasCurrentSettings}
          importShortcutStr={importShortcutStr}
          importUIState={importUIState}
          onClose={onClose}
          parsedImportShortcutStr={parsedImportShortcutStr}
          setImportShortcutStr={setImportShortcutStr}
          shortcuts={shortcuts}
          shortcutsImportFieldRef={shortcutsImportFieldRef}
        />
        <ExportShortcutsSection shortcuts={shortcuts} shortcutsStr={shortcutsStr} />
      </main>
    </div>
  );
}

export default ShortcutsSettings;
