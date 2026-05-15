import './search-command.css';

import type { Ref, TargetedMouseEvent } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSnapshot } from 'valtio';

import states from '../utils/states';

import SearchForm, { type SearchFormHandle } from './search-form';

interface SearchCommandProps {
  onClose?: () => void;
}

interface ShowSearchCommandPayload {
  query?: string;
}

export default memo(function SearchCommand({
  onClose = () => {},
}: SearchCommandProps) {
  const snapStates = useSnapshot(states);
  const [showSearch, setShowSearch] = useState(false);
  const searchFormRef = useRef<SearchFormHandle | null>(null);

  useEffect(() => {
    if (snapStates.showSearchCommand) {
      const { query } =
        (snapStates.showSearchCommand as ShowSearchCommandPayload) || {};
      setShowSearch(true);
      setTimeout(() => {
        if (query) {
          searchFormRef.current?.setValue?.(query);
        }
        searchFormRef.current?.focus?.();
      }, 150);
      states.showSearchCommand = false;
    }
  }, [snapStates.showSearchCommand]);

  useHotkeys(
    ['Slash', '/'],
    () => {
      setShowSearch(true);
      setTimeout(() => {
        searchFormRef.current?.focus?.();
        searchFormRef.current?.select?.();
      }, 0);
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        const isSearchPage = /\/search/.test(location.hash);
        const isYearInPostsPage = /\/yip/.test(location.hash);
        const hasModal = !!document.querySelector('#modal-container > *');
        // Allow '/' even with Shift (e.g. German keyboards)
        if (e.key === '/') return false;
        return (
          isSearchPage ||
          isYearInPostsPage ||
          hasModal ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey
        );
      },
    },
  );

  const closeSearch = () => {
    setShowSearch(false);
    onClose();
  };

  useHotkeys(
    'esc',
    () => {
      searchFormRef.current?.blur?.();
      closeSearch();
    },
    {
      enabled: showSearch,
      enableOnFormTags: true,
      preventDefault: true,
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) =>
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );

  const hidden = !showSearch;

  return (
    // TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
    // backdrop-style overlay; Esc-close is wired via `useHotkeys('esc', ...)`
    // above. Adding keyboard handlers to the backdrop itself would be
    // duplicative no-ops.
    <div
      id="search-command-container"
      hidden={hidden}
      onClick={(e: TargetedMouseEvent<HTMLDivElement>) => {
        console.log(e);
        if (e.target === e.currentTarget) {
          closeSearch();
        }
      }}
    >
      <SearchForm
        ref={searchFormRef as Ref<SearchFormHandle>}
        hidden={hidden}
        onSubmit={() => {
          closeSearch();
        }}
      />
    </div>
  );
});
