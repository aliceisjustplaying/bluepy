import './feedback-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import * as Sentry from '@sentry/react';
import { useEffect, useRef, useState } from 'react';

import showToast from '../utils/show-toast';
import { getAccount, getCurrentAccountID } from '../utils/store-utils';

import Icon from './icon';

const MAX_MESSAGE_LENGTH = 5000;
const MAX_CONTACT_LENGTH = 200;

type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';

interface FeedbackModalProps {
  defaultMessage?: string;
  onClose: () => void;
}

interface FeedbackPayload {
  message: string;
  contact?: string;
  hp?: string;
  subject: string;
  page: string;
  account?: string;
  pds?: string;
  build: string;
  sentryEventId?: string;
  viewport: string;
  userAgent: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function currentAccountLabel(): string | undefined {
  const account = getCurrentFeedbackAccount();
  if (!account) return undefined;
  const handle =
    optionalString(account.info.acct) ||
    optionalString(account.info.username) ||
    optionalString(account.info.displayName);
  return [handle, account.info.id].filter(Boolean).join(' / ');
}

function getCurrentFeedbackAccount() {
  return getAccount(getCurrentAccountID()) || getAccount();
}

function buildFeedbackPayload(
  message: string,
  contact: string,
  hp: string,
  sentryEventId?: string,
): FeedbackPayload {
  const page = window.location.href;
  const account = currentAccountLabel();
  const build = __COMMIT_HASH__ || 'unknown';
  return {
    message,
    contact: contact || undefined,
    hp,
    subject: 'Feedback from Bluepy',
    page,
    account,
    pds: optionalString(getCurrentFeedbackAccount()?.instanceURL),
    build,
    sentryEventId,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: window.navigator.userAgent,
  };
}

export default function FeedbackModal({
  defaultMessage = '',
  onClose,
}: FeedbackModalProps) {
  const { t } = useLingui();
  const [message, setMessage] = useState(defaultMessage);
  const [contact, setContact] = useState('');
  const [hp, setHp] = useState('');
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      messageRef.current?.focus();
    }, 50);
    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (status === 'submitting') return;

    const trimmedMessage = message.trim();
    const trimmedContact = contact.trim();
    if (!trimmedMessage) {
      setStatus('error');
      setErrorMessage(t`Tell us what happened first.`);
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);

    try {
      const sentryEventId = import.meta.env.VITE_SENTRY_DSN
        ? Sentry.lastEventId() || undefined
        : undefined;
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFeedbackPayload(
            trimmedMessage,
            trimmedContact,
            hp,
            sentryEventId,
          ),
        ),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          text.length > 0 && text.length < 200
            ? text
            : `Request failed (${response.status})`,
        );
      }
      setStatus('success');
      showToast(t`Feedback sent`);
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : t`Feedback could not be sent.`,
      );
    }
  }

  return (
    <div className="feedback-modal-container">
      <div className="top-controls">
        <h1>
          <Trans>Send feedback</Trans>
        </h1>
        <button type="button" className="plain" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} size="l" />
        </button>
      </div>
      <main>
        {status === 'success' ? (
          <div className="feedback-success">
            <Icon icon="check-circle" size="xl" />
            <strong>
              <Trans>Thanks, got it.</Trans>
            </strong>
            <p className="insignificant">
              <Trans>We read every message even when we cannot reply.</Trans>
            </p>
            <button type="button" onClick={onClose}>
              <Trans>Close</Trans>
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="feedback-hp" aria-hidden="true">
              <label htmlFor="feedback-company">
                <Trans>Leave this field blank</Trans>
              </label>
              <input
                id="feedback-company"
                name="company"
                aria-label={t`Leave this field blank`}
                value={hp}
                tabIndex={-1}
                autoComplete="off"
                onChange={(event) => {
                  setHp(event.currentTarget.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="feedback-message">
                <Trans>What happened?</Trans>
              </label>
              <textarea
                id="feedback-message"
                ref={messageRef}
                aria-label={t`What happened?`}
                required
                rows={7}
                value={message}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={t`Bugs, confusing behavior, missing features, or anything else.`}
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="feedback-contact">
                <Trans>Contact, optional</Trans>
              </label>
              <input
                id="feedback-contact"
                aria-label={t`Contact, optional`}
                value={contact}
                maxLength={MAX_CONTACT_LENGTH}
                autoComplete="email"
                placeholder={t`email or Bluesky handle`}
                onChange={(event) => {
                  setContact(event.currentTarget.value);
                }}
              />
            </div>
            {status === 'error' && errorMessage && (
              <p className="feedback-error" role="alert">
                {errorMessage}
              </p>
            )}
            <footer>
              <button type="button" className="plain" onClick={onClose}>
                <Trans>Cancel</Trans>
              </button>
              <button type="submit" disabled={status === 'submitting'}>
                {status === 'submitting' ? (
                  <Trans>Sending...</Trans>
                ) : (
                  <Trans>Send</Trans>
                )}
              </button>
            </footer>
          </form>
        )}
      </main>
    </div>
  );
}
