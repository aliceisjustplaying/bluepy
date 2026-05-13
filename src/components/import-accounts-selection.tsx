import './import-accounts-selection.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { ComponentType } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import states from '../utils/states';
import {
  getAccounts,
  saveAccounts,
  type StoredAccount,
} from '../utils/store-utils';

import Avatar from './avatar';
import Icon from './icon';
import Loader from './loader';
import NameTextUntyped from './name-text';

interface NameTextProps {
  account?: unknown;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (event: Event) => void;
  [key: string]: unknown;
}
const NameText = NameTextUntyped as unknown as ComponentType<NameTextProps>;

type ImportStatus = 'duplicate' | 'new';

type ImportableAccount = StoredAccount & { importStatus: ImportStatus };

interface ImportAccountsSelectionProps {
  accounts: StoredAccount[];
  onClose: () => void;
}

function ImportAccountsSelection({
  accounts: importedAccounts,
  onClose,
}: ImportAccountsSelectionProps) {
  const { t } = useLingui();
  const existingAccounts = getAccounts();

  const { accountsToImport } = useMemo<{
    accountsToImport: ImportableAccount[];
  }>(() => {
    if (!importedAccounts) return { accountsToImport: [] };

    const statusOrder: Record<ImportStatus, number> = {
      duplicate: 0,
      new: 1,
    };
    const mapped: ImportableAccount[] = importedAccounts.map((account) => {
      const existing = existingAccounts.find(
        (a) =>
          a.info.id === account.info.id &&
          a.instanceURL === account.instanceURL,
      );
      const status: ImportStatus = existing ? 'duplicate' : 'new';
      return {
        ...account,
        importStatus: status,
      };
    });
    const sorted = mapped.toSorted((a, b) => {
      return statusOrder[a.importStatus] - statusOrder[b.importStatus];
    });

    return { accountsToImport: sorted };
  }, [importedAccounts, existingAccounts]);

  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, boolean>
  >(() => {
    const initialSelection: Record<string, boolean> = {};
    accountsToImport.forEach((a) => {
      if (a.importStatus === 'duplicate') {
        initialSelection[a.info.id + a.instanceURL] = false;
      } else {
        initialSelection[a.info.id + a.instanceURL] = true;
      }
    });
    return initialSelection;
  });

  const [uiState, setUIState] = useState<string>('default');

  const handleImportSelection = () => {
    setUIState('importing');
    const newAccounts: StoredAccount[] = [
      ...existingAccounts,
      ...importedAccounts.filter(
        (account) => selectedAccounts[account.info.id + account.instanceURL],
      ),
    ];
    saveAccounts(newAccounts);
    onClose();
    states.showImportExportAccounts = false;
    states.showAccounts = true;
  };

  const selectedCount = Object.values(selectedAccounts).filter(Boolean).length;

  return (
    <div id="import-accounts-selection-container" class="sheet">
      {!!onClose && (
        <button
          type="button"
          class="sheet-close"
          onClick={onClose}
          disabled={uiState === 'importing'}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <b>
          <Trans>Select accounts to import</Trans>
        </b>
      </header>
      <main>
        <div class="import-selection">
          {accountsToImport.filter((a) => a.importStatus !== 'duplicate')
            .length > 3 && (
            <div class="accounts-list-header">
              <label class="account-item" aria-label={t`Select all`}>
                <input
                  type="checkbox"
                  checked={
                    accountsToImport.filter(
                      (a) => a.importStatus !== 'duplicate',
                    ).length > 0 &&
                    accountsToImport
                      .filter((a) => a.importStatus !== 'duplicate')
                      .every((a) => selectedAccounts[a.info.id + a.instanceURL])
                  }
                  onChange={(e) => {
                    const newSelection = { ...selectedAccounts };
                    const shouldSelect = (e.target as HTMLInputElement).checked;
                    accountsToImport.forEach((a) => {
                      if (a.importStatus !== 'duplicate') {
                        newSelection[a.info.id + a.instanceURL] = shouldSelect;
                      }
                    });
                    setSelectedAccounts(newSelection);
                  }}
                  disabled={uiState === 'importing'}
                />
                <span class="account-info">
                  <Trans>Select all</Trans>
                </span>
              </label>
            </div>
          )}
          <ul class="accounts-list">
            {accountsToImport.map((account) => {
              const key = account.info.id + account.instanceURL;
              const isSelected = selectedAccounts[key];
              const { importStatus: status } = account;
              return (
                <li key={key}>
                  <label class="account-item">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        setSelectedAccounts({
                          ...selectedAccounts,
                          [key]: (e.target as HTMLInputElement).checked,
                        });
                      }}
                      disabled={
                        uiState === 'importing' || status === 'duplicate'
                      }
                    />
                    <Avatar
                      url={account.info.avatarStatic as string | undefined}
                      size="xl"
                    />
                    <div class="account-info">
                      <NameText
                        account={{
                          ...account.info,
                          acct: /@/.test(account.info.acct as string)
                            ? (account.info.acct as string)
                            : `${account.info.acct as string}@${account.instanceURL}`,
                        }}
                        showAcct
                      />
                    </div>
                    <div class="account-meta">
                      {status === 'duplicate' && (
                        <span class="tag collapsed">
                          <Trans>Existing</Trans>
                        </span>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <footer>
            <button
              type="button"
              class="light"
              onClick={onClose}
              disabled={uiState === 'importing'}
            >
              <Trans>Cancel</Trans>
            </button>
            <Loader hidden={uiState !== 'importing'} />
            <button
              type="button"
              disabled={selectedCount === 0 || uiState === 'importing'}
              onClick={handleImportSelection}
            >
              <Plural
                value={selectedCount}
                one="Import # account"
                other="Import # accounts"
              />
            </button>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default ImportAccountsSelection;
