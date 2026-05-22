import './drafts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { api } from '../utils/api';
import db from '../utils/db';
import niceDateTime from '../utils/nice-date-time';
import states from '../utils/states';
import { getCurrentAccountNS } from '../utils/store-utils';

import Icon from './icon';
import Loader from './loader';
import MenuConfirm from './menu-confirm';

interface MediaAttachment {
  type: string;
  fileData?: BufferSource;
  file?: Blob;
  url?: string | null;
}

interface DraftStatus {
  status?: string;
  mediaAttachments?: MediaAttachment[];
}

interface DraftReplyTo {
  id?: string;
  account?: { acct?: string };
}

interface DraftQuote {
  id?: string;
}

interface Draft {
  key: string;
  updatedAt: string;
  draftStatus: DraftStatus;
  replyTo?: DraftReplyTo;
  quote?: DraftQuote;
}

interface DraftsProps {
  onClose?: () => void;
}

function Drafts({ onClose }: DraftsProps) {
  const { t } = useLingui();
  const { compat } = api();
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [reloadCount, reload] = useReducer(
    (c: number, _action?: undefined) => c + 1,
    0,
  );

  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const keys = (await db.drafts.keys()) as string[];
        if (keys.length) {
          const ns = getCurrentAccountNS();
          const ownKeys = keys.filter((key) => key.startsWith(ns));
          if (ownKeys.length) {
            const ownDrafts = (await db.drafts.getMany(ownKeys)) as Draft[];
            ownDrafts.sort(
              (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
            );
            setDrafts(ownDrafts);
          } else {
            setDrafts([]);
          }
        } else {
          setDrafts([]);
        }
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, [reloadCount]);

  const hasDrafts = drafts?.length > 0;

  return (
    <div className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Unsent drafts</Trans>{' '}
          <Loader abrupt hidden={uiState !== 'loading'} />
        </h2>
        {hasDrafts && (
          <div className="insignificant">
            <Trans>
              Looks like you have unsent drafts. Let's continue where you left
              off.
            </Trans>
          </div>
        )}
      </header>
      <main>
        {hasDrafts ? (
          <>
            <ul className="drafts-list">
              {drafts.map((draft) => {
                const { updatedAt, key, draftStatus, replyTo, quote } = draft;
                const updatedAtDate = new Date(updatedAt);
                return (
                  <li key={updatedAt}>
                    <div className="mini-draft-meta">
                      <b>
                        <Icon icon={replyTo ? 'reply' : 'quill'} size="s" />{' '}
                        <time>
                          {!!replyTo && (
                            <>
                              <span className="bidi-isolate">
                                @{replyTo.account?.acct}
                              </span>
                              <br />
                            </>
                          )}
                          {niceDateTime(updatedAtDate)}
                        </time>
                      </b>
                      <MenuConfirm
                        confirmLabel={
                          <span>
                            <Trans>Delete this draft?</Trans>
                          </span>
                        }
                        menuItemClassName="danger"
                        align="end"
                        disabled={uiState === 'loading'}
                        onClick={() => {
                          void (async () => {
                            try {
                              // const yes = confirm('Delete this draft?');
                              // if (yes) {
                              await db.drafts.del(key);
                              reload(undefined);
                              // }
                            } catch (e) {
                              console.error(e);
                              alert(t`Error deleting draft! Please try again.`);
                            }
                          })();
                        }}
                      >
                        <button
                          type="button"
                          className="small light"
                          disabled={uiState === 'loading'}
                        >
                          <Trans>Delete…</Trans>
                        </button>
                      </MenuConfirm>
                    </div>
                    <button
                      type="button"
                      disabled={uiState === 'loading'}
                      className="draft-item"
                      onClick={() => {
                        void (async () => {
                          // console.log({ draftStatus });
                          let replyToStatus: unknown;
                          let quoteStatus: unknown;
                          if (replyTo?.id || quote?.id) {
                            setUIState('loading');
                            if (replyTo) {
                              try {
                                replyToStatus = await (
                                  compat.v1.statuses as {
                                    $select(id: string | undefined): {
                                      fetch(): Promise<unknown>;
                                    };
                                  }
                                )
                                  .$select(replyTo.id)
                                  .fetch();
                              } catch (e) {
                                console.error(e);
                                alert(t`Error fetching reply-to status!`);
                                setUIState('default');
                                return;
                              }
                            }
                            if (quote) {
                              try {
                                quoteStatus = await (
                                  compat.v1.statuses as {
                                    $select(id: string | undefined): {
                                      fetch(): Promise<unknown>;
                                    };
                                  }
                                )
                                  .$select(quote.id)
                                  .fetch();
                              } catch (e) {
                                console.error(e);
                                alert(t`Error fetching quoted status!`);
                                setUIState('default');
                                // Don't return. Fail and still allow draft without quote
                                // return;
                              }
                            }
                            setUIState('default');
                          }
                          // TODO(oxlint:no-underscore-dangle) `__COMPOSE__` is
                          // an intentional cross-window global used by compose
                          // flow; renaming is out of scope.
                          window.__COMPOSE__ = {
                            draftStatus,
                            replyToStatus,
                            quoteStatus,
                          };
                          states.showCompose = true;
                          states.showDrafts = false;
                        })();
                      }}
                    >
                      <MiniDraft draft={draft} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {drafts.length > 1 && (
              <p>
                <MenuConfirm
                  confirmLabel={
                    <span>
                      <Trans>Delete all drafts?</Trans>
                    </span>
                  }
                  menuItemClassName="danger"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    void (async () => {
                      // const yes = confirm('Delete all drafts?');
                      // if (yes) {
                      setUIState('loading');
                      try {
                        await db.drafts.delMany(
                          drafts.map((draft) => draft.key),
                        );
                        setUIState('default');
                        reload(undefined);
                      } catch (e) {
                        console.error(e);
                        alert(t`Error deleting drafts! Please try again.`);
                        setUIState('error');
                      }
                      // }
                    })();
                  }}
                >
                  <button
                    type="button"
                    className="light danger"
                    disabled={uiState === 'loading'}
                  >
                    <Trans>Delete all…</Trans>
                  </button>
                </MenuConfirm>
              </p>
            )}
          </>
        ) : (
          <p>
            <Trans>No drafts found.</Trans>
          </p>
        )}
      </main>
    </div>
  );
}

interface MiniDraftProps {
  draft: Draft;
}

function MiniDraft({ draft }: MiniDraftProps) {
  const { t } = useLingui();
  const { draftStatus, quote } = draft;
  const { status, mediaAttachments } = draftStatus;
  const hasMedia = (mediaAttachments?.length ?? 0) > 0;
  const hasQuote = !!quote?.id;
  const hasMediaOrQuote = hasMedia || hasQuote;
  const firstImageMedia = useMemo<string | null | undefined>(() => {
    if (!hasMedia || !mediaAttachments) return undefined;
    const image = mediaAttachments.find((media) => /image/.test(media.type));
    if (!image) return undefined;
    const { fileData, type, file, url } = image;
    if (fileData) {
      const blob = new Blob([fileData], { type });
      return URL.createObjectURL(blob);
    }
    if (file) return URL.createObjectURL(file);
    return url || null;
  }, [hasMedia, mediaAttachments]);

  useEffect(() => {
    return () => {
      if (firstImageMedia?.startsWith('blob:')) {
        URL.revokeObjectURL(firstImageMedia);
      }
    };
  }, [firstImageMedia]);

  return (
    <>
      <div className="mini-draft">
        {hasMediaOrQuote && (
          <div
            className={`mini-draft-aside ${firstImageMedia ? 'has-image' : ''}`}
            style={
              firstImageMedia
                ? ({
                    '--bg-image': `url(${firstImageMedia})`,
                  } as CSSProperties)
                : {}
            }
          >
            {hasMedia && (
              <span>
                <Icon icon="attachment" alt={t`Media`} />{' '}
                <small>{mediaAttachments?.length}</small>
              </span>
            )}
            {hasQuote && <Icon icon="quote" alt={t`Quote`} />}
          </div>
        )}
        <div className="mini-draft-main">
          {!!status && <div className="mini-draft-status">{status}</div>}
        </div>
      </div>
    </>
  );
}

export default Drafts;
