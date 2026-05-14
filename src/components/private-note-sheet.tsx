import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';

import { api, getMastoV1Resource } from '../utils/api';

import Icon from './icon';
import Loader from './loader';

interface PrivateNoteSheetProps {
  account?: { id?: string } | null;
  note?: string;
  onRelationshipChange?: (relationship: unknown) => void;
  onClose?: () => void;
}

interface AccountsResource {
  $select(id: string | undefined): {
    note: {
      create(params: { comment: string | null }): Promise<unknown>;
    };
  };
}

function PrivateNoteSheet({
  account,
  note: initialNote,
  onRelationshipChange = () => {},
  onClose = () => {},
}: PrivateNoteSheetProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (textareaRef.current && !initialNote) {
      timer = setTimeout(() => {
        textareaRef.current?.focus?.();
      }, 100);
    }
    return () => {
      clearTimeout(timer);
    };
  }, [initialNote]);

  return (
    <div class="sheet" id="private-note-container">
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <b>
          <Trans>Notes</Trans>
        </b>{' '}
        <small class="insignificant">
          <Trans>Only visible to you</Trans>
        </small>
      </header>
      <main>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.target as HTMLFormElement);
            const note = formData.get('note') as string | null;
            if (note?.trim() !== initialNote?.trim()) {
              setUIState('loading');
              void (async () => {
                try {
                  const accounts = getMastoV1Resource<AccountsResource>(
                    masto,
                    'accounts',
                  );
                  const newRelationship = await accounts
                    .$select(account?.id)
                    .note.create({
                      comment: note,
                    });
                  console.log('updated relationship', newRelationship);
                  setUIState('default');
                  onRelationshipChange(newRelationship);
                  onClose();
                } catch (err) {
                  console.error(err);
                  setUIState('error');
                  alert(
                    (err as { message?: string })?.message ||
                      t`Unable to update private note.`,
                  );
                }
              })();
            }
          }}
        >
          <textarea
            ref={textareaRef}
            name="note"
            disabled={uiState === 'loading'}
            dir="auto"
          >
            {initialNote}
          </textarea>
          <footer>
            <button
              type="button"
              class="light"
              disabled={uiState === 'loading'}
              onClick={() => {
                onClose?.();
              }}
            >
              <Trans>Cancel</Trans>
            </button>
            <span>
              <Loader abrupt hidden={uiState !== 'loading'} />
              <button disabled={uiState === 'loading'} type="submit">
                <Trans>Save &amp; close</Trans>
              </button>
            </span>
          </footer>
        </form>
      </main>
    </div>
  );
}

export default PrivateNoteSheet;
