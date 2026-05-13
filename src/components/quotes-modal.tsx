import './quotes-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';

import IconUntyped from './icon';
import Link from './link';
import LoaderUntyped from './loader';
import StatusUntyped from './status';

type IconProps = {
  icon: string;
  alt?: string;
  [key: string]: unknown;
};

type LoaderProps = {
  abrupt?: boolean;
  [key: string]: unknown;
};

type StatusProps = {
  status: mastodon.v1.Status;
  instance?: string;
  size?: string;
  readOnly?: boolean;
  showCommentCount?: boolean;
  showQuoteCount?: boolean | ((c: number) => boolean);
  [key: string]: unknown;
};

const Icon = IconUntyped as unknown as ComponentType<IconProps>;
const Loader = LoaderUntyped as unknown as ComponentType<LoaderProps>;
const Status = StatusUntyped as unknown as ComponentType<StatusProps>;

const LIMIT = 20;

type StatusesQuotesResource = {
  list(opts: { limit: number }): {
    values(): AsyncIterator<mastodon.v1.Status[]>;
  };
};

type StatusesSelectFn = (id: string) => {
  quotes: StatusesQuotesResource;
};

interface QuotesModalProps {
  statusId: string;
  instance?: string;
  onClose?: () => void;
}

export default function QuotesModal({
  statusId,
  instance,
  onClose = () => {},
}: QuotesModalProps) {
  const { t } = useLingui();
  const { masto } = api();

  const [posts, setPosts] = useState<mastodon.v1.Status[]>([]);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [showMore, setShowMore] = useState(false);

  const quotesIterator = useRef<
    AsyncIterator<mastodon.v1.Status[]> | undefined
  >(undefined);
  const firstLoad = useRef(true);

  const loadQuotes = (isFirstLoad = false) => {
    if (isFirstLoad || !quotesIterator.current) {
      const statusesSelect = (
        masto.v1 as unknown as { statuses: { $select: StatusesSelectFn } }
      ).statuses.$select;
      quotesIterator.current = statusesSelect(statusId)
        .quotes.list({
          limit: LIMIT,
        })
        .values();
    }

    setUIState('loading');

    void (async () => {
      try {
        const iterator = quotesIterator.current;
        if (!iterator) return;
        const result = await iterator.next();
        let { done } = result;
        const { value } = result;

        if (Array.isArray(value)) {
          if (isFirstLoad) {
            setPosts(value);
          } else {
            setPosts((prev) => [...prev, ...value]);
          }
          if (value.length < LIMIT) {
            done = true;
          }
          setShowMore(!done);
        } else {
          setShowMore(false);
        }
        setUIState('default');
      } catch (e) {
        console.error('Error loading quotes:', e);
        setUIState('error');
      }
    })();
  };

  useEffect(() => {
    loadQuotes(true);
    firstLoad.current = false;
  }, [statusId]);

  return (
    <div id="quotes-modal" class="sheet" tabindex={-1}>
      {onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Quotes</Trans>
        </h2>
      </header>
      <main>
        {posts.length > 0 ? (
          <>
            <ul class="quoted-posts-list">
              {posts.map((post) => (
                <li key={post.id} class="quoted-post-item">
                  <Link
                    to={
                      instance ? `/${instance}/s/${post.id}` : `/s/${post.id}`
                    }
                    class="status-link"
                    onContextMenu={(e: MouseEvent) => {
                      const target = e.target as Element | null;
                      const postEl = target?.querySelector('.status');
                      if (postEl) {
                        // Fire a custom event to open the context menu
                        if (e.metaKey) return;
                        e.preventDefault();
                        postEl.dispatchEvent(
                          new MouseEvent('contextmenu', {
                            clientX: e.clientX,
                            clientY: e.clientY,
                          }),
                        );
                      }
                    }}
                  >
                    <Status
                      status={post}
                      instance={instance}
                      size="s"
                      readOnly
                      showCommentCount
                      showQuoteCount
                    />
                  </Link>
                </li>
              ))}
            </ul>
            {uiState === 'default' ? (
              showMore ? (
                <button
                  type="button"
                  class="plain block"
                  onClick={() => loadQuotes()}
                >
                  <Trans>Show more…</Trans>
                </button>
              ) : (
                <p class="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              )
            ) : (
              uiState === 'loading' && (
                <p class="ui-state">
                  <Loader abrupt />
                </p>
              )
            )}
          </>
        ) : uiState === 'loading' ? (
          <p class="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p class="ui-state">
            <Trans>Error loading quotes</Trans>
          </p>
        ) : (
          <p class="ui-state insignificant">
            <Trans>No quotes yet</Trans>
          </p>
        )}
      </main>
    </div>
  );
}
