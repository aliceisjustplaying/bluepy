const dsn =
  import.meta.env.VITE_ENABLE_SENTRY === '1' ||
  import.meta.env.VITE_ENABLE_SENTRY === 'true'
    ? import.meta.env.VITE_SENTRY_DSN
    : undefined;

export const isSentryEnabled = Boolean(dsn);

const REDACTED = '[redacted]';
const PII_PATTERNS = [
  /at:\/\/[^\s"'<>]+/gi,
  /did:[a-z0-9]+:[a-z0-9._:%-]+/gi,
  /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  /\bbaf[a-z0-9]{20,}\b/gi,
];
const PII_QUERY_PATTERN =
  /([?&](?:access_token|accessToken|refresh_token|refreshToken|code|dpop_jkt)=)[^&#]+/gi;

function redactText(value: string): string {
  const redacted = PII_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
  return redacted.replace(PII_QUERY_PATTERN, `$1${REDACTED}`);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = redactUnknown(entry);
  }
  return redacted;
}

async function initSentry() {
  if (!dsn) return;
  const [Sentry, React, router] = await Promise.all([
    import('@sentry/react'),
    import('react'),
    import('react-router-dom'),
  ]);
  const {
    createRoutesFromChildren,
    matchRoutes,
    useLocation,
    useNavigationType,
  } = router;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: __COMMIT_HASH__ ? `bluepy@${__COMMIT_HASH__}` : undefined,
    sendDefaultPii: false,

    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],

    beforeSend(event) {
      event.user = undefined;
      return redactUnknown(event) as typeof event;
    },

    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    tracePropagationTargets: [/^https:\/\/bluepy\.mosphere\.at\//, /^\//],
  });
}

export async function captureSentryException(
  error: unknown,
  hint?: Record<string, unknown>,
): Promise<void> {
  if (!isSentryEnabled) return;
  const Sentry = await import('@sentry/react');
  Sentry.captureException(error, hint);
}

export async function getLastSentryEventId(): Promise<string | undefined> {
  if (!isSentryEnabled) return undefined;
  const Sentry = await import('@sentry/react');
  return Sentry.lastEventId() || undefined;
}

void initSentry();
