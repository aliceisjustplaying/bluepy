import './quote-chain-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';
import { getStatus } from '../utils/states';
import useTruncated from '../utils/useTruncated';

import type { Ref } from 'preact';

import IconUntyped from './icon';
import Link, { type LinkProps } from './link';
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

type QuotedStatus = mastodon.v1.Status & {
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
}

export default function QuoteChainModal({
  statusId,
  instance,
  onClose = () => {},
}: QuoteChainModalProps) {
  const { t } = useLingui();
  const { masto } = api();

  const [posts, setPosts] = useState<QuotedStatus[]>([]);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [nextPostID, setNextPostID] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchQuoteChain = async (postID: string) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setUIState('loading');
    let fetchCount = 0;
    let currentPostID: string | undefined | null = postID;

    while (currentPostID && !signal.aborted && fetchCount < BATCH_LIMIT) {
      console.log('🔗 WHILE', { currentPostID, fetchCount });
      // Break circular reference if it somehow happens
      // Note that origin post could be edited to add a quote that might reference to any post in the chain ♻️
      if (posts.some((p) => p.id === currentPostID)) {
        break;
      }

      let fullStatus = getStatus(currentPostID, instance) as
        | QuotedStatus
        | undefined;
      const cached = !!fullStatus;

      if (!cached) {
        try {
          const statusesSelect = (
            masto.v1 as unknown as {
              statuses: { $select: StatusesSelectFn };
            }
          ).statuses.$select;
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
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY));
      }
    }

    if (!signal.aborted) {
      setNextPostID(currentPostID || null);
      setUIState('default');
    }
  };

  useEffect(() => {
    void fetchQuoteChain(statusId);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [statusId]);

  return (
    <div id="quote-chain-modal" class="sheet" tabindex={-1}>
      {onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <b>
          <Trans>Quote chain</Trans>
        </b>{' '}
        {posts.length > 0 && (
          <small class="tag insignificant collapsed">
            {posts.length}
            {(!!nextPostID || uiState === 'loading') && '+'}
          </small>
        )}
      </header>
      <main>
        <ul class="quoted-posts-list">
          {posts.map((post) => (
            <li key={post.id} class="quoted-post-item">
              <TruncatedLink
                to={instance ? `/${instance}/s/${post.id}` : `/s/${post.id}`}
                class="status-link"
                onContextMenu={(e: MouseEvent) => {
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
                <Status
                  status={post}
                  instance={instance}
                  size="s"
                  readOnly
                  showCommentCount
                  showQuoteCount={(c: number) => c > 1}
                />
              </TruncatedLink>
            </li>
          ))}
        </ul>
        {uiState === 'error' ? (
          <p class="ui-state">
            <Trans>Failed to unwrap quote chain</Trans>
          </p>
        ) : uiState === 'loading' ? (
          <p class="ui-state">
            <Loader abrupt />
          </p>
        ) : nextPostID ? (
          <button
            type="button"
            class="light block"
            onClick={() => {
              void fetchQuoteChain(nextPostID);
            }}
          >
            <Icon icon="arrow-down" /> <Trans>Continue unwrapping…</Trans>
          </button>
        ) : (
          <p class="ui-state insignificant">
            <Trans>The end.</Trans>
          </p>
        )}
      </main>
    </div>
  );
}
