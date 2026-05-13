import { useLingui } from '@lingui/react/macro';
import type { FunctionComponent } from 'preact';

import { useEditHistory } from '../utils/edit-history-context';

import IconRaw from './icon';

interface IconProps {
  icon: string;
  size?: string;
  alt?: string;
  title?: string;
  class?: string;
  style?: Record<string, unknown>;
}
// Shim: icon.jsx is still untyped; alt/title are optional in JS runtime.
const Icon = IconRaw as unknown as FunctionComponent<IconProps>;

export default function EditHistoryControls() {
  const { t } = useLingui();
  const {
    prevEditedAt,
    nextEditedAt,
    editedAtIndex,
    editHistoryMode,
    editHistoryRef,
    exitEditHistory,
  } = useEditHistory();
  if (!editHistoryMode) return null;
  return (
    <div class="edit-history-controls">
      <Icon icon="edit" />
      <b class="edit-history-heading">{t`Edit History Snapshots`}</b>
      <span class="spacer" />
      <span class="edit-history-pagination">
        <button
          type="button"
          class="plain4"
          onClick={() => {
            prevEditedAt();
          }}
          disabled={
            !editHistoryMode ||
            editedAtIndex + 1 >= editHistoryRef.current.length
          }
        >
          <Icon icon="chevron-left" alt={t`Previous`} />
        </button>{' '}
        {editHistoryRef.current.length - editedAtIndex} /{' '}
        {editHistoryRef.current.length}{' '}
        <button
          type="button"
          class="plain4"
          onClick={() => {
            nextEditedAt();
          }}
          disabled={!editHistoryMode || editedAtIndex <= 0}
        >
          <Icon icon="chevron-right" alt={t`Next`} />
        </button>
      </span>
      <button
        type="button"
        class="plain3"
        onClick={() => {
          exitEditHistory();
        }}
      >
        <Icon icon="exit" alt={t`Exit`} />
      </button>
    </div>
  );
}
