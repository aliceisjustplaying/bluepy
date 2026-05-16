import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { SyntheticEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useDebouncedCallback } from 'use-debounce';

import { api, getMastoV1Resource } from '../utils/api';
import { fetchRelationships } from '../utils/relationships';

import AccountBlock from './account-block';
import Icon from './icon';
import Loader from './loader';

interface AccountSearchResource {
  readonly search: {
    list(params: {
      q: string;
      limit: number;
      resolve: boolean;
    }): Promise<mastodon.v1.Account[]>;
  };
}

export interface MentionModalProps {
  onClose?: () => void;
  onSelect?: (socialAddress: string) => void;
  defaultSearchTerm?: string | null;
}

function MentionModal({
  onClose = () => {},
  onSelect = () => {},
  defaultSearchTerm,
}: MentionModalProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState('default');
  const [accounts, setAccounts] = useState<mastodon.v1.Account[]>([]);
  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, mastodon.v1.Relationship>
  >({});

  const [selectedIndex, setSelectedIndex] = useState(0);

  const relationshipsMapRef = useRef(relationshipsMap);
  relationshipsMapRef.current = relationshipsMap;

  const loadRelationships = useCallback(
    async (fetchedAccounts: mastodon.v1.Account[]) => {
      if (!fetchedAccounts?.length) return;
      const relationships = await fetchRelationships(
        fetchedAccounts,
        relationshipsMapRef.current,
      );
      if (relationships) {
        setRelationshipsMap((prev) => ({
          ...prev,
          ...relationships,
        }));
      }
    },
    [],
  );

  const loadAccounts = useCallback(
    (term?: string) => {
      if (!term) return;
      setUIState('loading');
      void (async () => {
        try {
          const fetchedAccounts =
            await getMastoV1Resource<AccountSearchResource>(
              masto,
              'accounts',
            ).search.list({
            q: term,
            limit: 40,
            resolve: false,
          });
          setAccounts(fetchedAccounts);
          void loadRelationships(fetchedAccounts);
          setUIState('default');
        } catch (e) {
          setUIState('error');
          console.error(e);
        }
      })();
    },
    [masto, loadRelationships],
  );

  const debouncedLoadAccounts = useDebouncedCallback(loadAccounts, 1000);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Put cursor at the end
      if (inputRef.current.value) {
        inputRef.current.selectionStart = inputRef.current.value.length;
        inputRef.current.selectionEnd = inputRef.current.value.length;
      }
    }
  }, []);

  useEffect(() => {
    if (defaultSearchTerm) {
      loadAccounts(defaultSearchTerm);
    }
  }, [defaultSearchTerm, loadAccounts]);

  const selectAccount = (account: mastodon.v1.Account) => {
    const socialAddress = account.acct;
    onSelect(socialAddress);
    onClose();
  };

  useHotkeys(
    'enter',
    () => {
      const selectedAccount = accounts[selectedIndex];
      if (selectedAccount) {
        selectAccount(selectedAccount);
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: ['input'],
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );

  const listRef = useRef<HTMLUListElement | null>(null);
  useHotkeys(
    'down',
    () => {
      if (selectedIndex < accounts.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else {
        setSelectedIndex(0);
      }
      setTimeout(() => {
        const selectedItem = listRef.current?.querySelector('.selected');
        if (selectedItem) {
          selectedItem.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }, 1);
    },
    {
      preventDefault: true,
      enableOnFormTags: ['input'],
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );

  useHotkeys(
    'up',
    () => {
      if (selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else {
        setSelectedIndex(accounts.length - 1);
      }
      setTimeout(() => {
        const selectedItem = listRef.current?.querySelector('.selected');
        if (selectedItem) {
          selectedItem.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }, 1);
    },
    {
      preventDefault: true,
      enableOnFormTags: ['input'],
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );

  return (
    <div id="mention-sheet" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            debouncedLoadAccounts.flush?.();
            // const searchTerm = inputRef.current.value;
            // debouncedLoadAccounts(searchTerm);
          }}
        >
          <input
            ref={inputRef}
            required
            type="search"
            className="block"
            placeholder={t`Search accounts`}
            onInput={(e: SyntheticEvent<HTMLInputElement>) => {
              const { value } = e.currentTarget;
              debouncedLoadAccounts(value);
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="auto"
            enterKeyHint="search"
            defaultValue={defaultSearchTerm || ''}
          />
        </form>
      </header>
      <main>
        {accounts?.length > 0 ? (
          <ul
            ref={listRef}
            className={`accounts-list ${uiState === 'loading' ? 'loading' : ''}`}
          >
            {accounts.map((account, i) => {
              const relationship = relationshipsMap[account.id];
              return (
                <li
                  key={account.id}
                  className={i === selectedIndex ? 'selected' : ''}
                >
                  <AccountBlock
                    avatarSize="xxl"
                    account={account}
                    relationship={relationship}
                    showStats
                    showActivity
                  />
                  <button
                    type="button"
                    className="plain2"
                    onClick={() => {
                      selectAccount(account);
                    }}
                  >
                    <Icon icon="plus" size="xl" alt={t`Add`} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : uiState === 'loading' ? (
          <div className="ui-state">
            <Loader abrupt />
          </div>
        ) : uiState === 'error' ? (
          <div className="ui-state">
            <p>
              <Trans>Error loading accounts</Trans>
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default MentionModal;
