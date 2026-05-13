import './shortcuts-settings.css';

import { useAutoAnimate } from '@formkit/auto-animate/preact';
import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';
import type { mastodon } from 'masto';
import type { HTMLAttributes } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import floatingButtonUrl from '../assets/floating-button.svg';
import multiColumnUrl from '../assets/multi-column.svg';
import tabMenuBarUrl from '../assets/tab-menu-bar.svg';

import { api } from '../utils/api';
import { fetchFollowedTags } from '../utils/followed-tags';
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
interface ShortcutEntry {
  type: string;
  [key: string]: string | undefined;
}

// `states.shortcuts` is typed as `unknown[]` in the central proxy. Locally we
// narrow it to ShortcutEntry[] at the read boundary.
const statesShortcuts = states as unknown as {
  shortcuts: ShortcutEntry[];
  settings: {
    shortcutsViewMode: string | null;
    shortcutSettingsCloudImportExport: boolean;
    [key: string]: unknown;
  };
  showQrScannerModal: unknown;
  showQrCodeModal: unknown;
  [key: string]: unknown;
};

// `api().masto` is loosely typed at the hub (open index signature). Shim a
// narrower view for the v1 endpoints touched here.
interface AccountSelectClient {
  fetch(): Promise<{
    username?: string;
    acct?: string;
    displayName?: string;
  }>;
  note: {
    create(opts: { comment: string }): Promise<unknown>;
  };
}
interface RelationshipsClient {
  fetch(opts: { id: string[] }): Promise<Array<{ note?: string }>>;
}
interface MastoV1AccountsForShortcuts {
  $select(id: string): AccountSelectClient;
  relationships: RelationshipsClient;
}
interface ShortcutsMastoClient {
  v1: {
    accounts: MastoV1AccountsForShortcuts;
  };
}

function shortcutsMasto(): ShortcutsMastoClient {
  return api().masto as unknown as ShortcutsMastoClient;
}

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
  'public',
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
  public: msg`Public (Local / Federated)`,
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
  public: [
    {
      text: msg`Local only`,
      name: 'local',
      type: 'checkbox',
    },
    {
      text: msg`Server`,
      name: 'instance',
      type: 'text',
      placeholder: msg`Optional, e.g. mastodon.social`,
      notRequired: true,
    },
  ],
  trending: [
    {
      text: msg`Server`,
      name: 'instance',
      type: 'text',
      placeholder: msg`Optional, e.g. mastodon.social`,
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
      placeholder: 'cheeaun@mastodon.social',
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
      text: msg`Server`,
      name: 'instance',
      type: 'text',
      placeholder: msg`Optional, e.g. mastodon.social`,
      notRequired: true,
    },
  ],
};
const fetchAccountTitle = pmem(
  async ({ id }: { id: string }): Promise<string> => {
    const account = await shortcutsMasto().v1.accounts.$select(id).fetch();
    return account.username || account.acct || account.displayName || '';
  },
);

// SHORTCUTS_META describes per-shortcut-type metadata. Some fields are static
// strings/MessageDescriptors and some are functions of the shortcut entry.
// Consumers (this file + shortcuts.tsx) already widen via
// `as unknown as Record<string, ...>`, so loose entry shapes are fine.
type ShortcutMetaValue<T> =
  | T
  | ((shortcut: ShortcutEntry, index?: number) => T);
interface ShortcutMetaEntry {
  id: ShortcutMetaValue<string>;
  title: ShortcutMetaValue<string | MessageDescriptor | Promise<string>>;
  subtitle?: ShortcutMetaValue<string | undefined>;
  path: ShortcutMetaValue<string>;
  icon: ShortcutMetaValue<string>;
  altIcon?: () => { url?: string; type: string };
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
  public: {
    id: 'public',
    title: ({ local }) => (local ? t`Local` : t`Federated`),
    subtitle: ({ instance }) => instance || api().instance,
    path: ({ local, instance }) => `/${instance}/p${local ? '/l' : ''}`,
    icon: ({ local }) => (local ? 'building' : 'earth'),
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
      const info = account?.info as
        | { avatarStatic?: string; avatar?: string }
        | undefined;
      return {
        // Prefer static URL
        url: info?.avatarStatic || info?.avatar,
        type: 'avatar',
      };
    },
  },
  'account-statuses': {
    id: 'account-statuses',
    title: fetchAccountTitle as unknown as ShortcutMetaValue<
      string | Promise<string>
    >,
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
    title: ({ hashtag }) => hashtag as string,
    subtitle: ({ instance }) => instance || api().instance,
    path: ({ hashtag, instance, media }) =>
      `${instance ? `/${instance}` : ''}/t/${(hashtag as string)
        .split(/\s+/)
        .join('+')}${media ? '?media=1' : ''}`,
    icon: 'hashtag',
  },
};

interface ShortcutsSettingsProps {
  onClose?: () => void;
}

type ShortcutFormState =
  | false
  | true
  | { shortcut: ShortcutEntry; shortcutIndex: number };

function ShortcutsSettings({ onClose }: ShortcutsSettingsProps) {
  const { i18n } = useLingui();
  const _: Translator = (descriptor) => i18n._(descriptor);
  const snapStates = useSnapshot(states) as unknown as {
    shortcuts: ShortcutEntry[];
    settings: { shortcutsViewMode: string | null };
  };
  const { shortcuts } = snapStates;
  const [showForm, setShowForm] = useState<ShortcutFormState>(false);
  const [showImportExport, setShowImportExport] = useState(false);

  const [shortcutsListParent] = useAutoAnimate<HTMLOListElement>();

  return (
    <div id="shortcuts-settings-container" class="sheet" tabIndex={-1}>
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
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
        <div class="shortcuts-view-mode">
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
              (value === 'float-button' &&
                !snapStates.settings.shortcutsViewMode);
            return (
              <label key={value} class={checked ? 'checked' : ''}>
                <input
                  type="radio"
                  name="shortcuts-view-mode"
                  value={value}
                  checked={checked}
                  onChange={(e) => {
                    states.settings.shortcutsViewMode = (
                      e.target as HTMLInputElement
                    ).value;
                  }}
                />{' '}
                <img src={imgURL} alt="" width="80" height="58" />{' '}
                <span>{label}</span>
              </label>
            );
          })}
        </div>
        {shortcuts.length > 0 ? (
          <>
            <ol class="shortcuts-list" ref={shortcutsListParent}>
              {shortcuts.filter(Boolean).map((shortcut, i) => {
                // const key = i + Object.values(shortcut);
                const key = Object.values(shortcut).join('-');
                const { type } = shortcut;
                if (!SHORTCUTS_META[type]) return null;
                const meta = SHORTCUTS_META[type];
                let icon: unknown = meta.icon;
                let title: unknown = meta.title;
                let subtitle: unknown = meta.subtitle;
                let excludeViewMode: unknown = meta.excludeViewMode;
                if (typeof title === 'function') {
                  title = (title as (s: ShortcutEntry, i: number) => unknown)(
                    shortcut,
                    i,
                  );
                } else {
                  title = _(title as MessageDescriptor);
                }
                if (typeof subtitle === 'function') {
                  subtitle = (
                    subtitle as (s: ShortcutEntry, i: number) => unknown
                  )(shortcut, i);
                } else {
                  subtitle = _(subtitle as MessageDescriptor);
                }
                if (typeof icon === 'function') {
                  icon = (icon as (s: ShortcutEntry, i: number) => unknown)(
                    shortcut,
                    i,
                  );
                }
                if (typeof excludeViewMode === 'function') {
                  excludeViewMode = (
                    excludeViewMode as (s: ShortcutEntry, i: number) => unknown
                  )(shortcut, i);
                }
                const excludedViewMode = (
                  excludeViewMode as string[] | undefined
                )?.includes(snapStates.settings.shortcutsViewMode as string);
                return (
                  <li key={key}>
                    <Icon icon={icon as string | undefined} />
                    <span class="shortcut-text">
                      <AsyncText>{title as string | Promise<string>}</AsyncText>
                      {!!subtitle && (
                        <>
                          {' '}
                          <small class="ib insignificant">
                            {subtitle as string}
                          </small>
                        </>
                      )}
                      {excludedViewMode && (
                        <span class="tag">
                          <Trans>Not available in current view mode</Trans>
                        </span>
                      )}
                    </span>
                    <span class="shortcut-actions">
                      <button
                        type="button"
                        class="plain small"
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
                        class="plain small"
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
                        class="plain small"
                        onClick={() => {
                          setShowForm({
                            shortcut,
                            shortcutIndex: i,
                          });
                        }}
                      >
                        <Icon icon="pencil" alt={t`Edit`} />
                      </button>
                      {/* <button
                      type="button"
                      class="plain small"
                      onClick={() => {
                        states.shortcuts.splice(i, 1);
                      }}
                    >
                      <Icon icon="x" alt="Remove" />
                    </button> */}
                    </span>
                  </li>
                );
              })}
            </ol>
            {shortcuts.length === 1 &&
              snapStates.settings.shortcutsViewMode !== 'float-button' && (
                <div class="ui-state insignificant">
                  <Icon icon="info" />{' '}
                  <small>
                    <Trans>
                      Add more than one shortcut/column to make this work.
                    </Trans>
                  </small>
                </div>
              )}
          </>
        ) : (
          <div class="ui-state insignificant">
            <p>{t`No shortcuts yet. Tap on the Add shortcut button.`}</p>
            <p>
              <Trans>
                Not sure what to add?
                <br />
                Try adding{' '}
                <button
                  type="button"
                  class="plain"
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
        )}
        <p class="insignificant">
          {shortcuts.length >= SHORTCUTS_LIMIT &&
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
            class="light"
            onClick={() => setShowImportExport(true)}
          >
            <Trans>Import/export</Trans>
          </button>
          <button
            type="button"
            disabled={shortcuts.length >= SHORTCUTS_LIMIT}
            onClick={() => setShowForm(true)}
          >
            <Icon icon="plus" /> <span>{t`Add shortcut…`}</span>
          </button>
        </p>
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
                // `showForm` is set to `{ shortcut, shortcutIndex }` in edit
                // mode (see Edit button onClick). In add mode `showForm` is
                // `true`; the form never emits `mode === 'edit'` then. Cast
                // to keep original write-through-`undefined-index` behavior
                // if that ever changes.
                const sf = showForm as { shortcutIndex: number };
                states.shortcuts[sf.shortcutIndex] = result;
              } else {
                states.shortcuts.push(result);
              }
            }}
            onClose={() => setShowForm(false)}
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
            onClose={() => setShowImportExport(false)}
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

  const [uiState, setUIState] = useState('default');
  const [lists, setLists] = useState<ListLike[]>([]);
  const { lists: userLists, feeds } = splitListsAndFeeds(lists);
  const [followedHashtags, setFollowedHashtags] = useState<mastodon.v1.Tag[]>(
    [],
  );
  useEffect(() => {
    void (async () => {
      if (currentType !== 'list') return;
      try {
        setUIState('loading');
        const fetchedLists = await getLists();
        setLists(fetchedLists);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();

    void (async () => {
      if (currentType !== 'hashtag') return;
      try {
        const tags = await fetchFollowedTags();
        setFollowedHashtags(tags);
      } catch (e) {
        console.error(e);
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
    <div id="shortcut-settings-form" class="sheet">
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
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
            const formEl = e.target as HTMLFormElement;
            const data = new FormData(formEl);
            const result: Record<string, string> = {};
            data.forEach((value, key) => {
              // Original JS: `value?.trim()`. FormData entries are
              // `string | File`; this form only collects text/checkbox
              // values (strings), so cast to preserve runtime behavior.
              result[key] = (value as string)?.trim();
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
              result: result as ShortcutEntry,
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
                            list:
                              currentType === 'hashtag'
                                ? 'followed-hashtags-datalist'
                                : null,
                            autocorrect: 'off',
                            autocapitalize: 'off',
                            spellCheck: false,
                            pattern,
                            dir: 'auto',
                          } as unknown as HTMLAttributes<HTMLInputElement>;
                          return <input {...inputProps} />;
                        })()}
                        {currentType === 'hashtag' &&
                          followedHashtags.length > 0 && (
                            <datalist id="followed-hashtags-datalist">
                              {followedHashtags.map((tag) => (
                                <option key={tag.name} value={tag.name} />
                              ))}
                            </datalist>
                          )}
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
              <p class="form-note insignificant">
                <Icon icon="info" />
                {_(FORM_NOTES[currentType])}
              </p>
            )}
          <footer>
            <button
              type="submit"
              class="block"
              disabled={disabled || uiState === 'loading'}
            >
              {editMode ? t`Save` : t`Add`}
            </button>
            {editMode && (
              <button
                type="button"
                class="light danger"
                onClick={() => {
                  // shortcutIndex is required in edit mode; cast retains the
                  // original splice-with-undefined runtime behavior if it
                  // were ever absent.
                  states.shortcuts.splice(shortcutIndex as number, 1);
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

function ImportExport({ shortcuts, onClose }: ImportExportProps) {
  const { i18n } = useLingui();
  const _: Translator = (descriptor) => i18n._(descriptor);
  const { masto } = api();
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
      if (!Array.isArray(parsed)) throw new Error('Not an array');
      setImportUIState('default');
      console.log('⚡ Parsed imported shortcuts', parsed);
      return parsed;
    } catch {
      // Fallback to JSON string parsing
      // There's a chance that someone might want to import a JSON string instead of the compressed version
      try {
        const parsed: unknown = JSON.parse(importShortcutStr);
        if (!Array.isArray(parsed)) {
          throw new Error('Not an array');
        }
        setImportUIState('default');
        return parsed;
      } catch {
        setImportUIState('error');
        return null;
      }
    }
  }, [importShortcutStr]);
  const hasCurrentSettings = states.shortcuts.length > 0;

  const shortcutsImportFieldRef = useRef<HTMLInputElement | null>(null);

  return (
    <div id="import-export-container" class="sheet">
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>
            Import/Export <small class="ib insignificant">Shortcuts</small>
          </Trans>
        </h2>
      </header>
      <main tabIndex={-1}>
        <section>
          <h3>
            <Icon icon="arrow-down-circle" size="l" class="insignificant" />{' '}
            <span>
              <Trans>Import</Trans>
            </span>
          </h3>
          <p class="field-button">
            <input
              ref={shortcutsImportFieldRef}
              type="text"
              name="import"
              placeholder={t`Paste shortcuts here`}
              class="block"
              onInput={(e) => {
                setImportShortcutStr((e.target as HTMLInputElement).value);
              }}
              dir="auto"
            />
            {mediaDevicesSupported && (
              <button
                type="button"
                class="plain2 small"
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
            {statesShortcuts.settings.shortcutSettingsCloudImportExport && (
              <button
                type="button"
                class="plain2 small"
                disabled={importUIState === 'cloud-downloading'}
                onClick={() => {
                  void (async () => {
                    setImportUIState('cloud-downloading');
                    const currentAccount = getCurrentAccountID();
                    showToast(t`Downloading saved shortcuts from server…`);
                    try {
                      const relationships = await (
                        masto as unknown as ShortcutsMastoClient
                      ).v1.accounts.relationships.fetch({
                        id: [currentAccount as string],
                      });
                      const relationship = relationships[0];
                      if (relationship) {
                        const { note = '' } = relationship;
                        if (
                          /<phanpy-shortcuts-settings>(.*)<\/phanpy-shortcuts-settings>/.test(
                            note,
                          )
                        ) {
                          const settings = (
                            note.match(
                              /<phanpy-shortcuts-settings>(.*)<\/phanpy-shortcuts-settings>/,
                            ) as RegExpMatchArray
                          )[1];
                          const { data } = JSON.parse(settings) as {
                            v: string;
                            dt: number;
                            data: string;
                          };
                          const field = shortcutsImportFieldRef.current;
                          if (field) {
                            field.value = data;
                            field.dispatchEvent(new Event('input'));
                          }
                        }
                      }
                      setImportUIState('default');
                    } catch (e) {
                      console.error(e);
                      setImportUIState('error');
                      showToast(t`Unable to download shortcuts`);
                    }
                  })();
                }}
                title={t`Download shortcuts from server`}
              >
                <Icon icon="cloud" />
                <Icon icon="arrow-down" size="s" />
              </button>
            )}
          </p>
          {!!parsedImportShortcutStr &&
            Array.isArray(parsedImportShortcutStr) && (
              <>
                <p>
                  <b>{parsedImportShortcutStr.length}</b> shortcut
                  {parsedImportShortcutStr.length > 1 ? 's' : ''}{' '}
                  <small class="insignificant">
                    ({importShortcutStr.length} characters)
                  </small>
                </p>
                <ol class="import-settings-list">
                  {parsedImportShortcutStr.map((rawShortcut, idx) => {
                    // The JS original accesses fields directly without
                    // validating each entry. We treat each parsed element as
                    // a loose string-record to preserve that.
                    const shortcut = rawShortcut as Record<string, string>;
                    return (
                      <li key={idx}>
                        <span
                          style={{
                            opacity: shortcuts.some((s: ShortcutEntry) =>
                              // Compare all properties
                              Object.keys(s).every((key) => {
                                if (!(key in shortcut)) return true;
                                const val = shortcut[key];
                                if (
                                  val === '' ||
                                  val === null ||
                                  val === undefined
                                ) {
                                  return true;
                                }
                                return s[key] === val;
                              }),
                            )
                              ? 1
                              : 0,
                          }}
                        >
                          *
                        </span>
                        <span>
                          {_(TYPE_TEXT[shortcut.type])}
                          {shortcut.type === 'list' &&
                            !!shortcut.id &&
                            ' ⚠️'}{' '}
                          {TYPE_PARAMS[shortcut.type]?.map?.(
                            ({ text, name, type }) =>
                              shortcut[name] ? (
                                <>
                                  <span class="tag collapsed insignificant">
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
                    <Trans>
                      List may not work if it's from a different account.
                    </Trans>
                  </small>
                </p>
              </>
            )}
          {importUIState === 'error' && (
            <p class="error">
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
                    <div class="footer">
                      <Trans>
                        Only shortcuts that don’t exist in current shortcuts
                        will be appended.
                      </Trans>
                    </div>
                  }
                  onClick={() => {
                    // states.shortcuts = [
                    //   ...states.shortcuts,
                    //   ...parsedImportShortcutStr,
                    // ];
                    // Append non-unique shortcuts only.
                    // The trigger button is disabled when parsedImportShortcutStr
                    // is null, so the assertion below matches the JS original
                    // — which would throw on `.filter` if null reached here.
                    const parsed = parsedImportShortcutStr as unknown[];
                    const nonUniqueShortcuts = parsed.filter((rawShortcut) => {
                      const shortcut = rawShortcut as Record<string, unknown>;
                      return !statesShortcuts.shortcuts.some((s) =>
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
                    states.shortcuts = newShortcuts;
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
                    class="plain2"
                    disabled={!parsedImportShortcutStr}
                  >
                    <Trans>Import & append…</Trans>
                  </button>
                </MenuConfirm>{' '}
              </>
            )}
            <MenuConfirm
              confirmLabel={
                hasCurrentSettings
                  ? t`Override current shortcuts?`
                  : t`Import shortcuts?`
              }
              menuItemClassName={hasCurrentSettings ? 'danger' : undefined}
              onClick={() => {
                // Trigger button is disabled when parsed is null; the
                // assertion below mirrors the original JS assignment which
                // wrote `null` through to `states.shortcuts` if it ever
                // reached this point.
                states.shortcuts = parsedImportShortcutStr as unknown[];
                showToast(t`Shortcuts imported`);
                onClose?.();
              }}
            >
              <button
                type="button"
                class="plain2"
                disabled={!parsedImportShortcutStr}
              >
                {hasCurrentSettings ? t`or override…` : t`Import…`}
              </button>
            </MenuConfirm>
          </p>
        </section>
        <section>
          <h3>
            <Icon icon="arrow-up-circle" size="l" class="insignificant" />{' '}
            <span>
              <Trans>Export</Trans>
            </span>
          </h3>
          <p class="field-button">
            <input
              style={{ width: '100%' }}
              type="text"
              value={shortcutsStr}
              readOnly
              onClick={(e) => {
                const target = e.target as HTMLInputElement;
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
              class="plain2 small"
              disabled={!shortcutsStr}
              onClick={() => {
                states.showQrCodeModal = {
                  text: shortcutsStr,
                };
              }}
            >
              <Icon icon="qrcode" alt={t`QR code`} />
            </button>
            {statesShortcuts.settings.shortcutSettingsCloudImportExport && (
              <button
                type="button"
                class="plain2 small"
                disabled={importUIState === 'cloud-uploading'}
                onClick={() => {
                  void (async () => {
                    setImportUIState('cloud-uploading');
                    const currentAccount = getCurrentAccountID();
                    try {
                      const mastoShim =
                        masto as unknown as ShortcutsMastoClient;
                      const relationships =
                        await mastoShim.v1.accounts.relationships.fetch({
                          id: [currentAccount as string],
                        });
                      const relationship = relationships[0];
                      if (relationship) {
                        const { note = '' } = relationship;
                        // const newNote = `${note}\n\n\n$<phanpy-shortcuts-settings>{shortcutsStr}</phanpy-shortcuts-settings>`;
                        let newNote = '';
                        const settingsJSON = JSON.stringify({
                          v: '1', // version
                          dt: Date.now(), // datetime stamp
                          data: shortcutsStr, // shortcuts settings string
                        });
                        if (
                          /<phanpy-shortcuts-settings>(.*)<\/phanpy-shortcuts-settings>/.test(
                            note,
                          )
                        ) {
                          newNote = note.replace(
                            /<phanpy-shortcuts-settings>(.*)<\/phanpy-shortcuts-settings>/,
                            `<phanpy-shortcuts-settings>${settingsJSON}</phanpy-shortcuts-settings>`,
                          );
                        } else {
                          newNote = `${note}\n\n\n<phanpy-shortcuts-settings>${settingsJSON}</phanpy-shortcuts-settings>`;
                        }
                        showToast(t`Saving shortcuts to server…`);
                        await mastoShim.v1.accounts
                          .$select(currentAccount as string)
                          .note.create({
                            comment: newNote,
                          });
                        setImportUIState('default');
                        showToast(t`Shortcuts saved`);
                      }
                    } catch (e) {
                      console.error(e);
                      setImportUIState('error');
                      showToast(t`Unable to save shortcuts`);
                    }
                  })();
                }}
                title={t`Sync to server`}
              >
                <Icon icon="cloud" />
                <Icon icon="arrow-up" size="s" />
              </button>
            )}
          </p>
          <p>
            <button
              type="button"
              class="plain2"
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
                  class="plain2"
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
              <small class="insignificant ib">
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
              <summary class="insignificant">
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
        {statesShortcuts.settings.shortcutSettingsCloudImportExport && (
          <footer>
            <p>
              <Icon icon="cloud" />{' '}
              <Trans>
                Import/export settings from/to server (Very experimental)
              </Trans>
            </p>
          </footer>
        )}
      </main>
    </div>
  );
}

export default ShortcutsSettings;
