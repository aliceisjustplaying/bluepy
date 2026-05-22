import './quote-chain-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { Ref } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AtprotoCompat } from '../types/atproto-compat';
import { api, getCompatV1Resource } from '../utils/api';
import { getStatus } from '../utils/states';
import useTruncated from '../utils/useTruncated';

import Icon from './icon';
import Link, { type LinkProps } from './link';
import Loader from './loader';
import type { AnyStatus, RenderStatus } from './status-types';

type QuotedStatus = AtprotoCompat.v1.Status & {
  quote?: {
    quotedStatusId?: string;
    quotedStatus?: { id?: string };
  };
};

type StatusesSelectFn = (id: string) => {
  fetch(): Promise<QuotedStatus>;
};

function TruncatedLink(props: LinkProps) {
  const { t } = useLingui();
  const ref = useTruncated() as Ref<HTMLAnchorElement>;
  return <Link {...props} data-read-more={t`Read more →`} ref={ref} />;
}

const FETCH_DELAY = 500; // Delay between fetches to avoid rate limiting
const BATCH_LIMIT = 30; // The chain might get very long, so fetch in batches

interface QuoteChainModalProps {
  statusId: string;
  instance?: string;
  onClose?: () => void;
  renderStatus: RenderStatus;
}

export default function QuoteChainModal({
  statusId,
  instance,
  onClose = () => {},
  renderStatus,
}: QuoteChainModalProps) {
  const { t } = useLingui();
  const { compat } = api();

  const [posts, setPosts] = useState<QuotedStatus[]>([]);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [nextPostID, setNextPostID] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Memoize the statuses.$select endpoint so the loader callback's identity
  // is tied to the stable `compat` client, not to per-render proxy access.
  const statusesSelect = useMemo(
    () =>
      getCompatV1Resource<{ $select: StatusesSelectFn }>(compat, 'statuses')
        .$select,
    [compat],
  );

  // Track the live `posts` array via a ref so the cycle-detection check
  // inside the async loop reads the latest value without subscribing to it
  // (subscribing would recreate the callback after every setPosts, breaking
  // the long-running while loop).
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const fetchQuoteChain = useCallback(
    async (postID: string) => {
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setUIState('loading');
      let fetchCount = 0;
      let currentPostID: string | undefined | null = postID;

      while (currentPostID && !signal.aborted && fetchCount < BATCH_LIMIT) {
        console.log('🔗 WHILE', { currentPostID, fetchCount });
        // Break circular reference if it somehow happens
        // Note that origin post could be edited to add a quote that might
        // reference any post in the chain ♻️
        if (postsRef.current.some((p) => p.id === currentPostID)) {
          break;
        }

        let fullStatus = getStatus(currentPostID, instance) as
          | QuotedStatus
          | undefined;
        const cached = !!fullStatus;

        if (!cached) {
          try {
            fullStatus = await statusesSelect(currentPostID).fetch();
            fetchCount++;
          } catch (e) {
            console.error('Error fetching quote:', e);
            setUIState('error');
            break;
          }
        }

        console.log('🔗 PUSH', fullStatus);
        if (fullStatus) {
          const pushed = fullStatus;
          setPosts((prev) => [...prev, pushed]);
        }

        currentPostID =
          fullStatus?.quote?.quotedStatusId ||
          fullStatus?.quote?.quotedStatus?.id;

        // Add delay before next fetch to avoid rate limiting
        if (
          !cached &&
          currentPostID &&
          !signal.aborted &&
          fetchCount < BATCH_LIMIT
        ) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, FETCH_DELAY);
          });
        }
      }

      if (!signal.aborted) {
        setNextPostID(currentPostID || null);
        setUIState('default');
      }
    },
    [instance, statusesSelect],
  );

  useEffect(() => {
    void fetchQuoteChain(statusId);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [statusId, fetchQuoteChain]);

  return (
    <div id="quote-chain-modal" className="sheet" tabIndex={-1}>
      {onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <b>
          <Trans>Quote chain</Trans>
        </b>{' '}
        {posts.length > 0 && (
          <small className="tag insignificant collapsed">
            {posts.length}
            {(!!nextPostID || uiState === 'loading') && '+'}
          </small>
        )}
      </header>
      <main>
        <ul className="quoted-posts-list">
          {posts.map((post) => (
            <li key={post.id} className="quoted-post-item">
              <TruncatedLink
                to={instance ? `/${instance}/s/${post.id}` : `/s/${post.id}`}
                className="status-link"
                onContextMenu={(e: React.MouseEvent) => {
                  const target = e.target as Element | null;
                  const postEl = target?.querySelector('.status');
                  if (postEl) {
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
                {renderStatus({
                  status: post as AnyStatus,
                  instance,
                  size: 's',
                  readOnly: true,
                  showCommentCount: true,
                  showQuoteCount: (c?: number) => (c ?? 0) > 1,
                })}
              </TruncatedLink>
            </li>
          ))}
        </ul>
        {uiState === 'error' ? (
          <p className="ui-state">
            <Trans>Failed to unwrap quote chain</Trans>
          </p>
        ) : uiState === 'loading' ? (
          <p className="ui-state">
            <Loader abrupt />
          </p>
        ) : nextPostID ? (
          <button
            type="button"
            className="light block"
            onClick={() => {
              void fetchQuoteChain(nextPostID);
            }}
          >
            <Icon icon="arrow-down" /> <Trans>Continue unwrapping…</Trans>
          </button>
        ) : (
          <p className="ui-state insignificant">
            <Trans>The end.</Trans>
          </p>
        )}
      </main>
    </div>
  );
}
