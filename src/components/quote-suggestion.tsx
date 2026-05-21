import './quote-suggestion.css';

import { Trans } from '@lingui/react/macro';
import StatusComponent, { type StatusComponentProps } from './status';

interface StatusProps {
  status?: StatusComponentProps['status'];
  instance?: StatusComponentProps['instance'];
  size?: StatusComponentProps['size'];
  readOnly?: StatusComponentProps['readOnly'];
}
function Status(props: StatusProps) {
  return <StatusComponent {...props} />;
}

interface QuoteSuggestionData {
  url?: string;
  status?: StatusComponentProps['status'];
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
    <div className="quote-suggestion">
      <div className="quote-suggestion-header">
        <b>
          <Trans>Turn link into a quote?</Trans>
        </b>
        <div className="quote-suggestion-url">{quoteSuggestion.url}</div>
      </div>
      <div className="quote-status">
        <Status
          status={quoteSuggestion.status}
          instance={quoteSuggestion.instance}
          size="s"
          readOnly
        />
      </div>
      <div className="quote-suggestion-actions">
        <span className="spacer" />
        <button type="button" className="plain" onClick={onCancel}>
          {hasCurrentQuoteStatus ? (
            <Trans>Cancel</Trans>
          ) : (
            <Trans>Keep as link</Trans>
          )}
        </button>
        <button type="button" className="plain6" onClick={onAccept}>
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
