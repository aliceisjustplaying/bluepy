import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentChildren, RefObject } from 'preact';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useContext } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import states, { statusKey } from '../utils/states';
import { getCurrentAccID } from '../utils/store-utils';
import useTruncated from '../utils/useTruncated';

import Icon from './icon';
import LazyShazam from './lazy-shazam';
import Link from './link';
import NameText from './name-text';
import { readMoreText } from './status-helpers';
import type { AnyAccount, AnyStatus } from './status-types';

const handledUnfulfilledStates = [
  'deleted',
  'unauthorized',
  'pending',
  'rejected',
  'revoked',
  'blocked_account',
  'blocked_domain',
  'muted_account',
];
const revealableUnfulfilledStates = new Set([
  'blocked_account',
  'blocked_domain',
  'muted_account',
]);
const unfulfilledText = {
  filterHidden: msg`Post hidden by your filters`,
  pending: msg`Post pending`,
  deleted: msg`Post unavailable`,
  unauthorized: msg`Post unavailable`,
  rejected: msg`Post unavailable`,
  revoked: msg`Post removed by author`,
  blocked_account: (name: string) =>
    msg`Post hidden because you've blocked @${name}.`,
  blocked_domain: (domain: string) =>
    msg`Post hidden because you've blocked ${domain}.`,
  muted_account: (name: string) =>
    msg`Post hidden because you've muted @${name}.`,
};

interface QuoteRef {
  id?: string | null;
  instance?: string;
  state?: string;
  native?: boolean;
  url?: string;
  quoteStatus?: AnyStatus | null;
  originalDomain?: string;
  account?: AnyAccount | null;
}

export interface FallbackQuote {
  quotedStatus?: AnyStatus | null;
  id?: string | null;
  state?: string;
}

interface RenderStatusArgs {
  statusID?: string | null;
  status?: AnyStatus | null;
  instance?: string;
  level: number;
  quoteDomain?: string;
}

type RenderStatus = (args: RenderStatusArgs) => ComponentChildren;

interface QuoteStatusProps {
  quote: QuoteRef;
  level?: number;
  renderStatus: RenderStatus;
}

const QuoteStatus = memo(
  ({ quote, level = 0, renderStatus }: QuoteStatusProps) => {
    const { i18n } = useLingui();
    const _ = i18n._.bind(i18n);
    const snapStates = useSnapshot(states);
    const filterContext = useContext(FilterContext);
    const currentAccount = getCurrentAccID();

    const q = quote;
    let unfulfilledState;

    const isStaticQuote = !!q.quoteStatus;
    const quoteStatusKey = statusKey(q.id, q.instance);
    const quoteStatus = ((quoteStatusKey
      ? snapStates.statuses[quoteStatusKey]
      : undefined) || q.quoteStatus) as unknown as
      | AnyStatus
      | null
      | undefined;
    if (quoteStatus) {
      const isSelf =
        currentAccount && currentAccount === quoteStatus.account?.id;
      const filterInfo = (!isSelf &&
        isFiltered(
          quoteStatus.filtered as
            | readonly mastodon.v1.FilterResult[]
            | undefined,
          filterContext as string,
        )) as { action?: string } | false;

      if (filterInfo && filterInfo.action === 'hide') {
        unfulfilledState = 'filterHidden';
      }
    }

    if (!unfulfilledState) {
      unfulfilledState = handledUnfulfilledStates.find(
        (state) => q.state === state,
      );
    }

    const isRevealable = revealableUnfulfilledStates.has(
      unfulfilledState as string,
    );
    const quoteKey = q.id ? statusKey(q.id, q.instance) : null;
    const isRevealed = quoteKey && snapStates.revealedQuotes[quoteKey];

    if (unfulfilledState && (!isRevealable || !isRevealed)) {
      const quotedAccount = quoteStatus?.account as
        | { acct?: string }
        | null
        | undefined;
      const quotedAccountAcct = quotedAccount?.acct;
      const domain = quotedAccountAcct?.split('@')[1];

      let message: string | undefined;
      if (isRevealable) {
        if (unfulfilledState === 'blocked_account') {
          message = _(
            unfulfilledText.blocked_account(quotedAccountAcct as string),
          );
        } else if (unfulfilledState === 'blocked_domain') {
          message = _(unfulfilledText.blocked_domain(domain as string));
        } else if (unfulfilledState === 'muted_account') {
          message = _(
            unfulfilledText.muted_account(quotedAccountAcct as string),
          );
        }
      } else {
        message = _(
          unfulfilledText[
            unfulfilledState as keyof typeof unfulfilledText
          ] as unknown as Parameters<typeof _>[0],
        );
      }

      return (
        <div
          key={quoteKey}
          class={`status-card-unfulfilled ${
            unfulfilledState === 'filterHidden' || isRevealable
              ? 'status-card-ghost'
              : ''
          } ${q.native ? 'quote-post-native' : ''}`}
        >
          <Icon icon="quote" />
          <i>{message}</i>
          {isRevealable && quoteKey && (
            <button
              type="button"
              class="textual"
              onClick={() => {
                states.revealedQuotes[quoteKey] = true;
              }}
            >
              <Trans>Show anyway</Trans>
            </button>
          )}
        </div>
      );
    }

    const Parent = q.native ? Fragment : LazyShazam;
    const qKey = `${q.instance ?? ''}${q.id ?? ''}`;
    return (
      <Parent id={qKey} key={qKey}>
        <Link
          key={qKey}
          to={`${q.instance ? `/${q.instance}` : ''}/s/${q.id}`}
          class={`status-card-link ${q.native ? 'quote-post-native' : ''}`}
          data-read-more={_(readMoreText)}
        >
          {renderStatus({
            statusID: q.id,
            status: isStaticQuote ? quoteStatus : undefined,
            instance: q.instance,
            level: level + 1,
            quoteDomain: q.originalDomain,
          })}
        </Link>
      </Parent>
    );
  },
);

const ShallowQuote = ({ quote }: { quote?: QuoteRef } = {}) => {
  const { account, native, instance } = quote || ({} as QuoteRef);
  if (!account) return null;
  return (
    <div class="status-card-container">
      <div class={native ? 'quote-post-native' : ''}>
        <div class="status-card status-shallow-card">
          <NameText account={account} instance={instance} showAvatar />{' '}
          <span class="insignificant">…</span>
        </div>
      </div>
    </div>
  );
};

interface QuoteStatusesProps {
  id?: string | null;
  instance?: string;
  level?: number;
  collapsed?: boolean;
  fallbackQuote?: FallbackQuote | null;
  renderStatus: RenderStatus;
}

const QuoteStatuses = memo(
  ({
    id,
    instance,
    level = 0,
    collapsed = false,
    fallbackQuote,
    renderStatus,
  }: QuoteStatusesProps) => {
    const { i18n } = useLingui();
    const _ = i18n._.bind(i18n);
    const snapStates = useSnapshot(states);
    const containerRef = useTruncated() as RefObject<HTMLDivElement>;
    if (!id || !instance) return null;
    const sKey = statusKey(id, instance);
    const quotes = (sKey ? snapStates.statusQuotes[sKey] : undefined) as
      | readonly QuoteRef[]
      | undefined;
    let uniqueQuotes = quotes?.filter(
      (q: QuoteRef, i: number, arr: readonly QuoteRef[]) =>
        q.native || arr.findIndex((q2) => q2.url === q.url) === i,
    );

    if (!uniqueQuotes?.length && fallbackQuote?.quotedStatus) {
      return (
        <div
          class="status-card-container"
          ref={containerRef}
          data-read-more={_(readMoreText)}
          data-quote-container-static={true}
        >
          <QuoteStatus
            quote={{
              id: fallbackQuote.quotedStatus.id || fallbackQuote.id || id,
              instance,
              state: fallbackQuote.state,
              native: true,
              quoteStatus: fallbackQuote.quotedStatus,
            }}
            renderStatus={renderStatus}
          />
        </div>
      );
    }

    if (!uniqueQuotes?.length) return null;
    if (level > 2) {
      return <ShallowQuote quote={uniqueQuotes[0]} />;
    }

    if (collapsed) {
      uniqueQuotes = [uniqueQuotes[0]];
    }

    return (
      <div
        class="status-card-container"
        ref={containerRef}
        data-read-more={_(readMoreText)}
      >
        {uniqueQuotes.map((q) => {
          const quoteKey = q.id
            ? statusKey(q.id, q.instance)
            : `${q.instance || ''}-${q.state}`;
          return (
            <QuoteStatus
              key={quoteKey}
              quote={q}
              level={level}
              renderStatus={renderStatus}
            />
          );
        })}
      </div>
    );
  },
);

export default QuoteStatuses;
