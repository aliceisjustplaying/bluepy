import './filters.css';

import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { Fragment } from 'preact';
import type { TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import MenuConfirm from '../components/menu-confirm';
import Modal from '../components/modal';
import NavMenu from '../components/nav-menu';
import RelativeTime from '../components/relative-time';
import { api } from '../utils/api';
import i18nDuration from '../utils/i18n-duration';
import { getAPIVersions } from '../utils/store-utils';
import useInterval from '../utils/useInterval';
import useTitle from '../utils/useTitle';

// The filters endpoint isn't surfaced on the loose MastoClient shape.
// Use the real masto v2 resource type via a cast.
type FiltersV2Resource = mastodon.rest.v2.FiltersResource;
type FilterV2 = mastodon.v2.Filter;

// Local working-copy of a keyword inside the editor. Existing keywords have
// `id` (server-assigned string); new keywords have only `_id` (client-local).
interface EditKeyword {
  id?: string;
  _id?: number;
  keyword: string;
  wholeWord: boolean;
}

type UIState = 'default' | 'loading' | 'error';

// Modal state mirrors the JS contract: `false` (closed), `true` (new), or an
// object containing the filter being edited.
type FiltersAddEditModalState = false | true | { filter: FilterV2 };

interface FiltersAddEditCloseResult {
  state: 'success' | 'error';
  filter?: FilterV2;
}

// The close button passes the raw click event through `onClose`; the consumer
// branches on `result?.state`, so a non-result payload is a valid cancel.
type FiltersAddEditCloseArg = FiltersAddEditCloseResult | Event;

const FILTER_CONTEXT = [
  'home',
  'public',
  'notifications',
  'thread',
  'account',
] as const;
type FilterContextName = (typeof FILTER_CONTEXT)[number];
const FILTER_CONTEXT_UNIMPLEMENTED: readonly FilterContextName[] = [
  'thread',
  'account',
];
const FILTER_CONTEXT_LABELS: Record<
  FilterContextName,
  ReturnType<typeof msg>
> = {
  home: msg`Home and lists`,
  notifications: msg`Notifications`,
  public: msg`Public timelines`,
  thread: msg`Conversations`,
  account: msg`Profiles`,
};

const EXPIRY_DURATIONS = [
  0, // forever
  30 * 60, // 30 minutes
  60 * 60, // 1 hour
  6 * 60 * 60, // 6 hours
  12 * 60 * 60, // 12 hours
  60 * 60 * 24, // 24 hours
  60 * 60 * 24 * 7, // 7 days
  60 * 60 * 24 * 30, // 30 days
];

const EXPIRY_DURATIONS_LABELS: Record<
  number,
  ReturnType<typeof msg> | (() => string)
> = {
  0: msg`Never`,
  1800: i18nDuration(30, 'minute'),
  3600: i18nDuration(1, 'hour'),
  21600: i18nDuration(6, 'hour'),
  43200: i18nDuration(12, 'hour'),
  86_400: i18nDuration(24, 'hour'),
  604_800: i18nDuration(7, 'day'),
  2_592_000: i18nDuration(30, 'day'),
};

function Filters() {
  const { t } = useLingui();
  const { masto } = api();
  useTitle(t`Filters`, `/ft`);
  const [uiState, setUIState] = useState<UIState>('default');
  const [showFiltersAddEditModal, setShowFiltersAddEditModal] =
    useState<FiltersAddEditModalState>(false);

  const [reloadCount, setReloadCount] = useState(0);
  const reload = () => {
    setReloadCount((c) => c + 1);
  };
  const [filters, setFilters] = useState<FilterV2[]>([]);
  useEffect(() => {
    setUIState('loading');
    const filtersResource = masto.v2.filters as FiltersV2Resource;
    void (async () => {
      try {
        // The JS treats the awaited value as an array; the typed surface is a
        // Paginator. The runtime returns the array directly here.
        const fetchedFilters =
          (await filtersResource.list()) as unknown as FilterV2[];
        fetchedFilters.sort((a, b) => a.title.localeCompare(b.title));
        fetchedFilters.forEach((filter) => {
          if (filter.keywords?.length) {
            filter.keywords.sort(
              (a, b) =>
                (a.id as unknown as number) - (b.id as unknown as number),
            );
          }
        });
        console.log(fetchedFilters);
        setFilters(fetchedFilters);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, [reloadCount, masto]);

  return (
    <div id="filters-page" class="deck-container" tabIndex={-1}>
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
              <Link to="/" class="button plain">
                <Icon icon="home" size="l" alt={t`Home`} />
              </Link>
            </div>
            <h1>
              <Trans>Filters</Trans>
            </h1>
            <div class="header-side">
              <button
                type="button"
                class="plain"
                onClick={() => {
                  setShowFiltersAddEditModal(true);
                }}
              >
                <Icon icon="plus" size="l" alt={t`New filter`} />
              </button>
            </div>
          </div>
        </header>
        <main>
          {filters.length > 0 ? (
            <>
              <ul class="filters-list">
                {filters.map((filter) => {
                  const { id, title, expiresAt, keywords } = filter;
                  return (
                    <li key={id}>
                      <div>
                        <h2>{title}</h2>
                        {keywords?.length > 0 && (
                          <div>
                            {keywords.map((k) => (
                              <Fragment key={k.id ?? k.keyword}>
                                <span class="tag collapsed insignificant">
                                  {k.wholeWord ? `“${k.keyword}”` : k.keyword}
                                </span>{' '}
                              </Fragment>
                            ))}
                          </div>
                        )}
                        <small class="insignificant">
                          <ExpiryStatus expiresAt={expiresAt} />
                        </small>
                      </div>
                      <button
                        type="button"
                        class="plain"
                        onClick={() => {
                          setShowFiltersAddEditModal({
                            filter,
                          });
                        }}
                      >
                        <Icon icon="pencil" size="l" alt="Edit filter" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {filters.length > 1 && (
                <footer class="ui-state">
                  <small class="insignificant">
                    <Plural
                      value={filters.length}
                      one="# filter"
                      other="# filters"
                    />
                  </small>
                </footer>
              )}
            </>
          ) : uiState === 'loading' ? (
            <p class="ui-state">
              <Loader />
            </p>
          ) : uiState === 'error' ? (
            <p class="ui-state">
              <Trans>Unable to load filters.</Trans>
            </p>
          ) : (
            <p class="ui-state">
              <Trans>No filters yet.</Trans>
            </p>
          )}
        </main>
      </div>
      {!!showFiltersAddEditModal && (
        <Modal
          title={t`Add filter`}
          onClose={() => {
            setShowFiltersAddEditModal(false);
          }}
        >
          <FiltersAddEdit
            filter={
              typeof showFiltersAddEditModal === 'object'
                ? showFiltersAddEditModal.filter
                : undefined
            }
            onClose={(result) => {
              if (result && 'state' in result && result.state === 'success') {
                reload();
              }
              setShowFiltersAddEditModal(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

let _id = 1;
const incID = (): number => _id++;

interface FiltersAddEditProps {
  filter?: FilterV2;
  onClose?: (result: FiltersAddEditCloseArg) => void;
}

function FiltersAddEdit({ filter, onClose }: FiltersAddEditProps) {
  // The macro-typed `useLingui` strips `_`, but the runtime forwards it from
  // I18nContext. We need `_(MessageDescriptor)` for the dynamic `msg`-built
  // label maps below. Bind through `i18n` so the method keeps its receiver.
  const { i18n, t } = useLingui();
  const _: I18n['_'] = i18n._.bind(i18n);
  const { masto } = api();
  const [uiState, setUIState] = useState<UIState>('default');
  const editMode = !!filter;
  const { context, expiresAt, id, keywords, title, filterAction } =
    filter || ({} as Partial<FilterV2>);
  const hasExpiry = !!expiresAt;
  const expiresAtDate = hasExpiry && new Date(expiresAt);
  const [editKeywords, setEditKeywords] = useState<EditKeyword[]>(
    (keywords || []) as unknown as EditKeyword[],
  );
  const keywordsRef = useRef<HTMLDivElement | null>(null);

  // Hacky way of handling removed keywords for both existing and new ones
  const [removedKeywordIDs, setRemovedKeywordIDs] = useState<string[]>([]);
  const [removedKeyword_IDs, setRemovedKeyword_IDs] = useState<number[]>([]);

  const filteredEditKeywords = editKeywords.filter(
    (k) =>
      !(k.id !== undefined && removedKeywordIDs.includes(k.id)) &&
      !(k._id !== undefined && removedKeyword_IDs.includes(k._id)),
  );

  return (
    <div class="sheet" id="filters-add-edit-modal">
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>{editMode ? t`Edit filter` : t`New filter`}</h2>
      </header>
      <main>
        <form
          onSubmit={(e: TargetedEvent<HTMLFormElement>) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const titleValue = formData.get('title');
            const keywordIDs = formData.getAll('keyword_attributes[][id]');
            const keywordKeywords = formData.getAll(
              'keyword_attributes[][keyword]',
            );
            // const keywordWholeWords = formData.getAll(
            //   'keyword_attributes[][whole_word]',
            // );
            // Not using getAll because it skips the empty checkboxes
            const keywordWholeWords = [
              ...(
                keywordsRef.current as HTMLDivElement
              ).querySelectorAll<HTMLInputElement>(
                'input[name="keyword_attributes[][whole_word]"]',
              ),
            ].map((i) => i.checked);
            const keywordsAttributes: Array<{
              id?: string;
              keyword?: FormDataEntryValue;
              wholeWord?: boolean;
              _destroy?: boolean;
            }> = keywordKeywords.map((k, i) => ({
              id: (keywordIDs[i] as string) || undefined,
              keyword: k,
              wholeWord: keywordWholeWords[i],
            }));
            // if (editMode && keywords?.length) {
            //   // Find which one got deleted and add to keywordsAttributes
            //   keywords.forEach((k) => {
            //     if (!keywordsAttributes.find((ka) => ka.id === k.id)) {
            //       keywordsAttributes.push({
            //         ...k,
            //         _destroy: true,
            //       });
            //     }
            //   });
            // }
            if (editMode && removedKeywordIDs?.length) {
              removedKeywordIDs.forEach((removedID) => {
                keywordsAttributes.push({
                  id: removedID,
                  _destroy: true,
                });
              });
            }
            const contextValue = formData.getAll('context');
            let expiresIn: string | number | null | FormDataEntryValue =
              formData.get('expires_in');
            const filterActionValue = formData.get('filter_action');
            console.log({
              title: titleValue,
              keywordIDs,
              keywords: keywordKeywords,
              wholeWords: keywordWholeWords,
              keywordsAttributes,
              context: contextValue,
              expiresIn,
              filterAction: filterActionValue,
            });

            // Required fields
            if (!titleValue || !contextValue?.length) {
              return;
            }

            setUIState('loading');

            void (async () => {
              try {
                let filterResult: FilterV2;
                const filtersResource = masto.v2.filters as FiltersV2Resource;

                if (editMode) {
                  if (expiresIn === '' || expiresIn === null) {
                    // No value
                    // Preserve existing expiry if not specified
                    // Seconds from now to expiresAtDate
                    // Other clients don't do this
                    if (hasExpiry) {
                      expiresIn = Math.floor(
                        ((expiresAtDate as Date).getTime() - Date.now()) / 1000,
                      );
                    } else {
                      expiresIn = null;
                    }
                  } else if (
                    expiresIn === '0' ||
                    (expiresIn as unknown as number) === 0
                  ) {
                    // 0 = Never
                    expiresIn = null;
                  } else {
                    expiresIn = +(expiresIn as string);
                  }
                  filterResult = await filtersResource
                    .$select(id as string)
                    .update({
                      title: titleValue,
                      context: contextValue,
                      expiresIn,
                      keywordsAttributes,
                      filterAction: filterActionValue,
                    } as unknown as mastodon.rest.v2.UpdateFilterParams);
                } else {
                  expiresIn = +(expiresIn as string) || null;
                  filterResult = await filtersResource.create({
                    title: titleValue,
                    context: contextValue,
                    expiresIn,
                    keywordsAttributes,
                    filterAction: filterActionValue,
                  } as unknown as mastodon.rest.v2.CreateFilterParams);
                }
                console.log({ filterResult });
                setUIState('default');
                onClose?.({
                  state: 'success',
                  filter: filterResult,
                });
              } catch (error) {
                console.error(error);
                setUIState('error');
                alert(
                  editMode
                    ? t`Unable to edit filter`
                    : t`Unable to create filter`,
                );
              }
            })();
          }}
        >
          <div class="filter-form-row">
            {/* TODO(oxlint:jsx-a11y/label-has-associated-control): rule does
                not look through <Trans> children for accessible text. */}
            <label>
              <b>
                <Trans>Title</Trans>
              </b>
              <input
                type="text"
                name="title"
                defaultValue={title}
                disabled={uiState === 'loading'}
                dir="auto"
                enterKeyHint="done"
                required
              />
            </label>
          </div>
          <div class="filter-form-keywords" ref={keywordsRef}>
            {filteredEditKeywords.length ? (
              <ul class="filter-keywords">
                {filteredEditKeywords.map((k) => {
                  const { id: keywordId, keyword, wholeWord, _id: localId } = k;
                  return (
                    <li key={`${keywordId}-${localId}`}>
                      <input
                        type="hidden"
                        name="keyword_attributes[][id]"
                        value={keywordId}
                      />
                      <input
                        name="keyword_attributes[][keyword]"
                        type="text"
                        defaultValue={keyword}
                        disabled={uiState === 'loading'}
                        required
                        dir="auto"
                        enterKeyHint="done"
                      />
                      <div class="filter-keyword-actions">
                        <label>
                          <input
                            name="keyword_attributes[][whole_word]"
                            type="checkbox"
                            value={keywordId} // Hacky way to map checkbox boolean to the keyword id
                            defaultChecked={wholeWord}
                            disabled={uiState === 'loading'}
                          />{' '}
                          <Trans>Whole word</Trans>
                        </label>
                        <button
                          type="button"
                          class="light danger small"
                          disabled={uiState === 'loading'}
                          onClick={() => {
                            if (keywordId) {
                              removedKeywordIDs.push(keywordId);
                              setRemovedKeywordIDs([...removedKeywordIDs]);
                            } else if (localId) {
                              removedKeyword_IDs.push(localId);
                              setRemovedKeyword_IDs([...removedKeyword_IDs]);
                            }
                          }}
                        >
                          <Icon icon="x" alt={t`Remove`} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div class="filter-keywords">
                <div class="insignificant">
                  <Trans>No keywords. Add one.</Trans>
                </div>
              </div>
            )}
            <footer class="filter-keywords-footer">
              <button
                type="button"
                class="light"
                onClick={() => {
                  setEditKeywords([
                    ...editKeywords,
                    {
                      _id: incID(),
                      keyword: '',
                      wholeWord: true,
                    },
                  ]);
                  setTimeout(() => {
                    // Focus last input
                    const fields =
                      keywordsRef.current!.querySelectorAll<HTMLInputElement>(
                        'input[type="text"]',
                      );
                    fields[fields.length - 1]?.focus?.();
                  }, 10);
                }}
              >
                <Trans>Add keyword</Trans>
              </button>{' '}
              {filteredEditKeywords?.length > 1 && (
                <small class="insignificant">
                  <Plural
                    value={filteredEditKeywords.length}
                    one="# keyword"
                    other="# keywords"
                  />
                </small>
              )}
            </footer>
          </div>
          <div class="filter-form-cols">
            <div class="filter-form-col">
              <div>
                <b>
                  <Trans>Filter from…</Trans>
                </b>
              </div>
              {FILTER_CONTEXT.map((ctx) => (
                <div key={ctx}>
                  <label
                    class={
                      FILTER_CONTEXT_UNIMPLEMENTED.includes(ctx)
                        ? 'insignificant'
                        : ''
                    }
                  >
                    <input
                      type="checkbox"
                      name="context"
                      value={ctx}
                      defaultChecked={context ? context.includes(ctx) : true}
                      disabled={uiState === 'loading'}
                    />{' '}
                    {_(FILTER_CONTEXT_LABELS[ctx])}
                    {FILTER_CONTEXT_UNIMPLEMENTED.includes(ctx) ? '*' : ''}
                  </label>{' '}
                </div>
              ))}
              <p>
                <small class="insignificant">
                  <Trans>* Not implemented yet</Trans>
                </small>
              </p>
            </div>
            <div class="filter-form-col">
              {editMode && (
                <Trans>
                  Status:{' '}
                  <b>
                    <ExpiryStatus expiresAt={expiresAt} showNeverExpires />
                  </b>
                </Trans>
              )}
              <div>
                <label for="filters-expires_in">
                  {editMode ? t`Change expiry` : t`Expiry`}
                </label>
                <select
                  id="filters-expires_in"
                  name="expires_in"
                  disabled={uiState === 'loading'}
                  defaultValue={editMode ? undefined : 0}
                >
                  {editMode && <option></option>}
                  {EXPIRY_DURATIONS.map((v) => {
                    const label = EXPIRY_DURATIONS_LABELS[v];
                    return (
                      <option key={v} value={v}>
                        {typeof label === 'function' ? label() : _(label)}
                      </option>
                    );
                  })}
                </select>
              </div>
              <p>
                <Trans>Filtered post will be…</Trans>
                <br />
                {(getAPIVersions()?.mastodon as number) >= 5 && (
                  <label class="ib">
                    <input
                      type="radio"
                      name="filter_action"
                      value="blur"
                      defaultChecked={filterAction === 'blur'}
                      disabled={uiState === 'loading'}
                    />{' '}
                    <Trans>obscured (media only)</Trans>
                  </label>
                )}{' '}
                <label class="ib">
                  <input
                    type="radio"
                    name="filter_action"
                    value="warn"
                    defaultChecked={
                      (filterAction !== 'hide' && filterAction !== 'blur') ||
                      !editMode
                    }
                    disabled={uiState === 'loading'}
                  />{' '}
                  <Trans>minimized</Trans>
                </label>{' '}
                <label class="ib">
                  <input
                    type="radio"
                    name="filter_action"
                    value="hide"
                    defaultChecked={filterAction === 'hide'}
                    disabled={uiState === 'loading'}
                  />{' '}
                  <Trans>hidden</Trans>
                </label>
              </p>
            </div>
          </div>
          <footer class="filter-form-footer">
            <span>
              <button type="submit" disabled={uiState === 'loading'}>
                {editMode ? t`Save` : t`Create`}
              </button>{' '}
              <Loader abrupt hidden={uiState !== 'loading'} />
            </span>
            {editMode && (
              <MenuConfirm
                disabled={uiState === 'loading'}
                align="end"
                menuItemClassName="danger"
                confirmLabel={t`Delete this filter?`}
                onClick={() => {
                  setUIState('loading');
                  void (async () => {
                    try {
                      await (masto.v2.filters as FiltersV2Resource)
                        .$select(id as string)
                        .remove();
                      setUIState('default');
                      onClose?.({
                        state: 'success',
                      });
                    } catch (e) {
                      console.error(e);
                      setUIState('error');
                      alert(t`Unable to delete filter.`);
                    }
                  })();
                }}
              >
                <button
                  type="button"
                  class="light danger"
                  onClick={() => {}}
                  disabled={uiState === 'loading'}
                >
                  <Trans>Delete…</Trans>
                </button>
              </MenuConfirm>
            )}
          </footer>
        </form>
      </main>
    </div>
  );
}

interface ExpiryStatusProps {
  expiresAt?: string | null;
  showNeverExpires?: boolean;
}

function ExpiryStatus({ expiresAt, showNeverExpires }: ExpiryStatusProps) {
  const { t } = useLingui();
  const hasExpiry = !!expiresAt;
  const expiresAtDate = hasExpiry && new Date(expiresAt);
  const expired = hasExpiry && Date.parse(expiresAt) <= Date.now();

  // If less than a minute left, re-render interval every second, else every minute
  const [, setTick] = useState(0);
  const rerender = () => {
    setTick((c) => c + 1);
  };
  // JS passed `expired || 30_000` (boolean `true` or 30000ms); preserve.
  useInterval(rerender, (expired || 30_000) as unknown as number);

  return expired ? (
    t`Expired`
  ) : hasExpiry ? (
    <Trans>
      Expiring <RelativeTime datetime={expiresAtDate as Date} />
    </Trans>
  ) : (
    showNeverExpires && t`Never expires`
  );
}

export default Filters;
