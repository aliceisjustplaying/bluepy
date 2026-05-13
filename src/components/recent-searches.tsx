import { useAutoAnimate } from '@formkit/auto-animate/preact';
import { Trans, useLingui } from '@lingui/react/macro';
import type { JSX } from 'preact';
import { useReducer } from 'preact/hooks';

import { api } from '../utils/api';
import {
  addToSearchHistory,
  clearAllSearchHistory,
  getSearchHistory,
  removeFromSearchHistory,
} from '../utils/search-history';
import showToast from '../utils/show-toast';

import Icon from './icon';
import Link from './link';
import { generateSearchItemData } from './search-form';

interface RecentSearchesProps {
  onItemClick?: (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}

export default function RecentSearches({ onItemClick }: RecentSearchesProps) {
  const { t } = useLingui();
  const { instance } = api();
  const [, reload] = useReducer<number, void>((c: number) => c + 1, 0);
  const history = getSearchHistory();

  const handleClearAll = () => {
    clearAllSearchHistory();
    showToast({
      text: t`Cleared recent searches`,
      delay: 1000,
    });
    reload();
  };

  const handleRemoveItem = (query: string, queryType: string | null) => {
    removeFromSearchHistory(query, queryType);
    reload();
  };

  const [listRef] = useAutoAnimate<HTMLUListElement>();

  if (history.length === 0) {
    return null;
  }

  return (
    <div class="recent-searches">
      <div class="recent-searches-header">
        <Icon icon="history" />{' '}
        <span>
          <Trans>Recent searches</Trans>
        </span>
        <span class="spacer" />
        <button
          type="button"
          class="plain4 small"
          onClick={handleClearAll}
          disabled={history.length <= 0}
        >
          <span>
            <Trans>Clear all</Trans>
          </span>
        </button>
      </div>
      <ul class="link-list recent-searches-list" ref={listRef}>
        {history.map((historyItem) => {
          const { label, to, icon } = generateSearchItemData(
            historyItem.query,
            historyItem.queryType,
            instance,
          );

          return (
            <li
              key={`${historyItem.query}-${historyItem.queryType}-${historyItem.timestamp}`}
              class="recent-searches-item"
            >
              <Link
                to={to}
                class="recent-searches-link"
                onClick={(e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
                  addToSearchHistory(historyItem.query, historyItem.queryType);
                  onItemClick?.(e);
                }}
              >
                <Icon icon={icon} class="more-insignificant" />
                <span class="recent-searches-label">{label}</span>
              </Link>
              <button
                type="button"
                class="plain4 small"
                onClick={() =>
                  handleRemoveItem(historyItem.query, historyItem.queryType)
                }
              >
                <Icon icon="trash" alt={t`Clear`} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
