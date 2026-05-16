import './quote-settings-sheet.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';

import { api } from '../utils/api';
import showToast from '../utils/show-toast';
import { saveStatus } from '../utils/states';

import Icon from './icon';
import type { AnyStatus, RenderStatus } from './status-types';

const QUOTE_POLICIES = ['public', 'followers', 'nobody'] as const;
type QuotePolicy = (typeof QUOTE_POLICIES)[number];

function isQuotePolicy(value: unknown): value is QuotePolicy {
  return (
    typeof value === 'string' &&
    (QUOTE_POLICIES as readonly string[]).includes(value)
  );
}

interface QuoteSettingsSheetProps {
  onClose: (arg?: unknown) => void;
  post: mastodon.v1.Status & { instance?: string };
  currentPolicy?: string | null;
  renderStatus: RenderStatus;
}

interface InteractionPolicyClient {
  update(params: {
    quote_approval_policy: string;
  }): Promise<mastodon.v1.Status>;
}

interface StatusesSelector {
  $select(id: string): { interactionPolicy: InteractionPolicyClient };
}

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
}

function toSaveStatus(
  status: mastodon.v1.Status | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

function QuoteSettingsSheet({
  onClose,
  post,
  currentPolicy,
  renderStatus,
}: QuoteSettingsSheetProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );

  const [selectedPolicy, setSelectedPolicy] = useState<string>(
    currentPolicy || 'public',
  );

  const handleFormSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const raw = formData.get('quoteApprovalPolicy');
    if (!isQuotePolicy(raw)) return;
    const quoteApprovalPolicy: QuotePolicy = raw;

    setSelectedPolicy(quoteApprovalPolicy);
    setUIState('loading');

    try {
      const statuses = masto.v1.statuses as StatusesSelector;
      const newStatus = await statuses
        .$select(post.id)
        .interactionPolicy.update({
          quote_approval_policy: quoteApprovalPolicy,
        });
      onClose(true);
      showToast(t`Quote settings updated`);
      setUIState('default');

      // Update the status with new quote policy
      saveStatus(
        toSaveStatus(newStatus),
        post.instance,
        {
          skipThreading: true,
          skipUnfurling: true,
        },
      );
    } catch (err) {
      console.error(err);
      showToast(t`Failed to update quote settings`);
      setUIState('error');
    }
  };

  return (
    <div className="sheet" id="quote-settings-container">
      {!!onClose && (
        <button
          type="button"
          className="sheet-close"
          onClick={onClose}
          disabled={uiState === 'loading'}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Quote settings for this post</Trans>
        </h2>
      </header>
      <main>
        {!!post && (
          <div className="post-preview">
            {renderStatus({
              status: post as AnyStatus,
              size: 's',
              readOnly: true,
            })}
          </div>
        )}
        <form
          onSubmit={(e) => {
            void handleFormSubmit(e);
          }}
        >
          <select
            value={selectedPolicy}
            name="quoteApprovalPolicy"
            disabled={uiState === 'loading'}
          >
            <option value="public">
              <Trans>Anyone can quote</Trans>
            </option>
            <option value="followers">
              <Trans>Your followers can quote</Trans>
            </option>
            <option value="nobody">
              <Trans>Only you can quote</Trans>
            </option>
          </select>{' '}
          <button disabled={uiState === 'loading'}>
            <Trans>Save</Trans>
          </button>
        </form>
      </main>
    </div>
  );
}

export default QuoteSettingsSheet;
