import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useEffect, useReducer, useRef } from 'react';

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

function EditHistoryStatus({
  status,
  instance,
  renderStatus,
}: {
  status: AnyStatus;
  instance?: string;
  renderStatus: EditedAtModalProps['renderStatus'];
}) {
  return renderStatus(status, instance);
}

interface EditHistoryState {
  uiState: 'default' | 'loading' | 'error';
  editHistory: AnyStatus[];
}

type EditHistoryAction =
  | { type: 'loading' }
  | { type: 'loaded'; editHistory: AnyStatus[] }
  | { type: 'error' };

function editHistoryReducer(
  state: EditHistoryState,
  action: EditHistoryAction,
): EditHistoryState {
  switch (action.type) {
    case 'loading':
      return { ...state, uiState: 'loading' };
    case 'loaded':
      return { editHistory: action.editHistory, uiState: 'default' };
    case 'error':
      return { ...state, uiState: 'error' };
  }
  return state;
}

export default function EditedAtModal({
  statusID: _statusID,
  instance,
  fetchStatusHistory = () => Promise.resolve([]),
  onClose,
  renderStatus,
}: EditedAtModalProps) {
  const { t } = useLingui();
  const [{ uiState, editHistory }, dispatchEditHistory] = useReducer(
    editHistoryReducer,
    {
      uiState: 'default',
      editHistory: [],
    },
  );

  const fetchStatusHistoryRef = useRef(fetchStatusHistory);
  fetchStatusHistoryRef.current = fetchStatusHistory;

  useEffect(() => {
    dispatchEditHistory({ type: 'loading' });
    void (async () => {
      try {
        const fetchedHistory = await fetchStatusHistoryRef.current();
        dispatchEditHistory({
          type: 'loaded',
          editHistory: fetchedHistory ?? [],
        });
      } catch (e) {
        console.error(e);
        dispatchEditHistory({ type: 'error' });
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
              return (
                <li key={createdAt} className="history-item">
                  <h3>
                    <time>
                      {niceDateTime(createdAt, {
                        formatOpts: {
                          weekday: 'short',
                          second: 'numeric',
                        },
                      })}
                    </time>
                  </h3>
                  <EditHistoryStatus
                    status={status}
                    instance={instance}
                    renderStatus={renderStatus}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
