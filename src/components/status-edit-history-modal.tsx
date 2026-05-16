import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import niceDateTime from '../utils/nice-date-time';

import Icon from './icon';
import Loader from './loader';
import type { AnyStatus } from './status-types';

interface EditedAtModalProps {
  statusID?: string | null;
  instance?: string;
  fetchStatusHistory?: () => Promise<AnyStatus[] | undefined>;
  onClose?: () => void;
  renderStatus: (status: AnyStatus, instance?: string) => ReactNode;
}

export default function EditedAtModal({
  statusID: _statusID,
  instance,
  fetchStatusHistory = () => Promise.resolve([]),
  onClose,
  renderStatus,
}: EditedAtModalProps) {
  const { t } = useLingui();
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [editHistory, setEditHistory] = useState<AnyStatus[]>([]);

  const fetchStatusHistoryRef = useRef(fetchStatusHistory);
  fetchStatusHistoryRef.current = fetchStatusHistory;

  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const fetchedHistory = await fetchStatusHistoryRef.current();
        setEditHistory(fetchedHistory ?? []);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, []);

  return (
    <div id="edit-history" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Edit History</Trans>
        </h2>
        {uiState === 'error' && (
          <p>
            <Trans>Failed to load history</Trans>
          </p>
        )}
        {uiState === 'loading' && (
          <p>
            <Loader abrupt /> <Trans>Loading…</Trans>
          </p>
        )}
      </header>
      <main tabIndex={-1}>
        {editHistory.length > 0 && (
          <ol>
            {editHistory.map((status: AnyStatus) => {
              const { createdAt } = status;
              const createdAtDate = new Date(createdAt);
              return (
                <li key={createdAt} className="history-item">
                  <h3>
                    <time>
                      {niceDateTime(createdAtDate, {
                        formatOpts: {
                          weekday: 'short',
                          second: 'numeric',
                        },
                      })}
                    </time>
                  </h3>
                  {renderStatus(status, instance)}
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
