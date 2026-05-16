import './embed-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { CSSProperties } from 'react';

import Icon from './icon';

interface EmbedModalProps {
  html?: string;
  url?: string;
  iframeUrl?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  onClose?: () => void;
}

function EmbedModal({
  html,
  url,
  iframeUrl,
  title,
  width,
  height,
  onClose = () => {},
}: EmbedModalProps) {
  // Preserve original semantics: falsy title (null, '', undefined) all
  // fall back to 'Embedded content'.
  const iframeTitle = title || 'Embedded content';
  const { t } = useLingui();
  return (
    <div className="embed-modal-container">
      <div className="top-controls">
        <button
          type="button"
          className="light"
          onClick={() => {
            onClose();
          }}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="button plain"
          >
            <span>
              <Trans>Open in new window</Trans>
            </span>{' '}
            <Icon icon="external" />
          </a>
        )}
      </div>
      {iframeUrl ? (
        <div className="embed-content iframe-content">
          {/* TODO(oxlint:react/iframe-missing-sandbox): allow-scripts +
              allow-same-origin together weaken the sandbox, but many oEmbed
              providers (YouTube, Spotify, Bluesky) require it. Behavioural
              regression to remove either; needs per-provider audit. */}
          <iframe
            src={iframeUrl}
            title={iframeTitle}
            sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            allow="clipboard-write; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div
          className="embed-content"
          dangerouslySetInnerHTML={{ __html: html as string }}
          style={
            {
              '--width': width + 'px',
              '--height': height + 'px',
              '--aspect-ratio': `${width}/${height}`,
            } as CSSProperties
          }
        />
      )}
    </div>
  );
}

export default EmbedModal;
