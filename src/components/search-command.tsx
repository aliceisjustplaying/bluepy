import './search-command.css';

import type { ComponentType, JSX, Ref } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSnapshot } from 'valtio';

import states from '../utils/states';

import SearchFormUntyped from './search-form';

interface SearchFormHandle {
  setValue?: (value: string) => void;
  focus?: () => void;
  select?: () => void;
  blur?: () => void;
}

interface SearchFormProps {
  hidden?: boolean;
  onSubmit?: (e: JSX.TargetedEvent<HTMLFormElement>) => void;
  ref?: Ref<SearchFormHandle>;
}

const SearchForm =
  SearchFormUntyped as unknown as ComponentType<SearchFormProps>;

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
    <div
      id="search-command-container"
      hidden={hidden}
      onClick={(e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
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
