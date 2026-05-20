import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';

import FeedbackModal from './feedback-modal';
import Icon from './icon';
import Modal from './modal';

export default function ErrorFallback() {
  const { t } = useLingui();
  const [showFeedback, setShowFeedback] = useState(false);

  return (
    <>
      <main className="deck-container">
        <section className="empty">
          <Icon icon="alert" size="xl" />
          <p>
            <Trans>Something went wrong.</Trans>
          </p>
          <button
            type="button"
            onClick={() => {
              setShowFeedback(true);
            }}
          >
            <Icon icon="comment" size="l" /> <Trans>Report a bug</Trans>
          </button>
        </section>
      </main>
      {showFeedback && (
        <Modal
          onClose={() => {
            setShowFeedback(false);
          }}
        >
          <FeedbackModal
            defaultMessage={t`Something went wrong while using Bluepy.\n\n`}
            onClose={() => {
              setShowFeedback(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}
