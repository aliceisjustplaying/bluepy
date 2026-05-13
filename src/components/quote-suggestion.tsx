import './quote-suggestion.css';

import { Trans } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';

import StatusUntyped from './status';

interface StatusProps {
  status?: mastodon.v1.Status;
  instance?: string;
  size?: 's' | 'm' | 'l';
  readOnly?: boolean;
}
function Status(props: StatusProps) {
  const Inner = StatusUntyped as unknown as ComponentType<StatusProps>;
  return <Inner {...props} />;
}

interface QuoteSuggestionData {
  url?: string;
  status?: mastodon.v1.Status;
  instance?: string;
}

interface QuoteSuggestionProps {
  quoteSuggestion?: QuoteSuggestionData | null;
  hasCurrentQuoteStatus?: boolean;
  onAccept?: () => void;
  onCancel?: () => void;
}

export default function QuoteSuggestion({
  quoteSuggestion,
  hasCurrentQuoteStatus,
  onAccept,
  onCancel,
}: QuoteSuggestionProps) {
  if (!quoteSuggestion) return null;

  return (
    <div class="quote-suggestion">
      <div class="quote-suggestion-header">
        <b>
          <Trans>Turn link into a quote?</Trans>
        </b>
        <div class="quote-suggestion-url">{quoteSuggestion.url}</div>
      </div>
      <div class="quote-status">
        <Status
          status={quoteSuggestion.status}
          instance={quoteSuggestion.instance}
          size="s"
          readOnly
        />
      </div>
      <div class="quote-suggestion-actions">
        <span class="spacer" />
        <button type="button" class="plain" onClick={onCancel}>
          {hasCurrentQuoteStatus ? (
            <Trans>Cancel</Trans>
          ) : (
            <Trans>Keep as link</Trans>
          )}
        </button>
        <button type="button" class="plain6" onClick={onAccept}>
          {hasCurrentQuoteStatus ? (
            <Trans>Replace current quote</Trans>
          ) : (
            <Trans>Turn into quote</Trans>
          )}
        </button>
      </div>
    </div>
  );
}
