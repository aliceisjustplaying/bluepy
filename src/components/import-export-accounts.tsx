import './import-export-accounts.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useRef, useState } from 'react';

import showToast from '../utils/show-toast';
import { getAccounts, type StoredAccount } from '../utils/store-utils';

import Icon from './icon';
import ImportAccountsSelection from './import-accounts-selection';
import Modal from './modal';

interface ImportExportAccountsProps {
  onClose: () => void;
  // exportDisabled is passed by modals.jsx but currently unused by this
  // component; declared here so callers (still in JS) keep typechecking.
  exportDisabled?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isImportAccount(value: unknown): value is StoredAccount {
  return (
    isRecord(value) &&
    isRecord(value.info) &&
    typeof value.info.id === 'string' &&
    typeof value.instanceURL === 'string'
  );
}

function importAccountList(value: unknown): StoredAccount[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isImportAccount) ? value : null;
}

export default function ImportExportAccounts({
  onClose,
}: ImportExportAccountsProps) {
  const { t } = useLingui();
  const accounts = getAccounts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiState, setUIState] = useState<string>('default');
  const [importedAccounts, setImportedAccounts] = useState<
    StoredAccount[] | null
  >(null);
  const [dragOver, setDragOver] = useState<boolean>(false);

  const handleExport = async () => {
    setUIState('exporting');
    try {
      const exportAccounts = getAccounts();
      const accountsToExport = exportAccounts.map((account) => {
        const { accessToken: _accessToken, ...rest } = account;
        return rest;
      });

      const exportData = {
        accounts: accountsToExport,
        createdAt: Date.now(),
      };
      const json = JSON.stringify(exportData);

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(now.getDate()).padStart(2, '0')}_${String(
        now.getHours(),
      ).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      a.download = `accounts-${date}.phanpy.json`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      console.error(e);
      showToast(t`Export failed`);
      setUIState('error');
    }
  };

  const processFile = async (file: File | undefined) => {
    if (!file) return;

    setUIState('importing');
    try {
      const text = await file.text();
      const json: unknown = JSON.parse(text);

      const importAccounts = isRecord(json)
        ? importAccountList(json.accounts)
        : null;
      if (!importAccounts) {
        throw new Error('Invalid backup file');
      }

      setImportedAccounts(importAccounts);
      setUIState('default');
    } catch (e) {
      console.error(e);
      showToast(t`Import failed`);
      setUIState('error');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    void processFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => {
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    void processFile(file);
  };

  return (
    <div
      id="import-export-accounts-container"
      className="sheet"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>
            Import/Export <small className="ib insignificant">Accounts</small>
          </Trans>
        </h2>
      </header>
      <main>
        <section>
          <button
            type="button"
            className={`section-button button-import button plain4 ${
              dragOver ? 'drag-over' : ''
            }`}
            onClick={() => fileInputRef.current?.click()}
            disabled={uiState === 'importing'}
          >
            <Icon icon="arrow-down-circle" size="xxl" />
            <b>
              <Trans>Import</Trans>
            </b>
            <div>
              <small className="insignificant">
                <Trans>Select file…</Trans>
              </small>
            </div>
          </button>{' '}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={uiState === 'importing'}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="section-button button-export plain4"
            onClick={() => {
              void handleExport();
            }}
            disabled={uiState === 'exporting' || accounts.length === 0}
          >
            <Icon icon="arrow-up-circle" size="xxl" />
            <b>
              <Trans>Export</Trans>
            </b>
            <div>
              <small className="insignificant">
                <Plural
                  value={accounts.length}
                  one="# account"
                  other="# accounts"
                />
              </small>
            </div>
          </button>
        </section>

        <p className="insignificant">
          <small>
            <Trans>
              No login information or account access details are stored in the
              exported files. You will need to log in again for each account
              after importing.
            </Trans>
          </small>
        </p>
      </main>
      {importedAccounts && (
        <Modal
          onClose={() => {
            setImportedAccounts(null);
          }}
        >
          <ImportAccountsSelection
            accounts={importedAccounts}
            onClose={() => {
              setImportedAccounts(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
