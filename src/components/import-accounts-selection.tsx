import './import-accounts-selection.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';

import { sorted } from '../utils/sorted';
import states from '../utils/states';
import {
  getAccounts,
  saveAccounts,
  type StoredAccount,
} from '../utils/store-utils';

import Avatar from './avatar';
import Icon from './icon';
import Loader from './loader';
import NameText, { type NameTextProps } from './name-text';

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
    const sortedAccounts = sorted(mapped, (a, b) => {
      return statusOrder[a.importStatus] - statusOrder[b.importStatus];
    });

    return { accountsToImport: sortedAccounts };
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
    <div id="import-accounts-selection-container" className="sheet">
      {!!onClose && (
        <button
          type="button"
          className="sheet-close"
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
        <div className="import-selection">
          {accountsToImport.filter((a) => a.importStatus !== 'duplicate')
            .length > 3 && (
            <div className="accounts-list-header">
              <label className="account-item" aria-label={t`Select all`}>
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
                <span className="account-info">
                  <Trans>Select all</Trans>
                </span>
              </label>
            </div>
          )}
          <ul className="accounts-list">
            {accountsToImport.map((account) => {
              const key = account.info.id + account.instanceURL;
              const isSelected = selectedAccounts[key];
              const { importStatus: status } = account;
              return (
                <li key={key}>
                  <label className="account-item">
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
                    <div className="account-info">
                      <NameText
                        account={
                          {
                            ...account.info,
                            acct: /@/.test(account.info.acct as string)
                              ? (account.info.acct as string)
                              : `${account.info.acct as string}@${account.instanceURL}`,
                          } as NameTextProps['account']
                        }
                        showAcct
                      />
                    </div>
                    <div className="account-meta">
                      {status === 'duplicate' && (
                        <span className="tag collapsed">
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
              className="light"
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
