/**
 * @typedef {{
 *   ASSETS: { fetch(request: Request): Promise<Response> };
 *   RESEND_API_KEY?: string;
 *   BLUEPY_FEEDBACK_TO?: string;
 *   BLUEPY_FEEDBACK_FROM?: string;
 *   BLUEPY_BUILD_TIME?: string;
 *   BLUEPY_COMMIT_HASH?: string;
 *   FEEDBACK_RATE_LIMITER?: DurableObjectNamespace;
 * }} Env
 */

const FEEDBACK_MAX_BODY_BYTES = 16_000;
const FEEDBACK_MAX_MESSAGE = 5000;
const FEEDBACK_MAX_CONTACT = 200;
const FEEDBACK_MAX_FIELD = 500;
const FEEDBACK_RATE_LIMIT = 2;
const FEEDBACK_RATE_LIMIT_PERIOD_MS = 60_000;
const FEEDBACK_TOO_MANY_REQUESTS =
  'Too many requests. Please wait a minute and try again.';
const FEEDBACK_FROM = '"Bluepy" <noreply@bluepy.social>';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

function oauthMetadata(origin) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Bluepy',
    client_uri: `${origin}/`,
    logo_uri: `${origin}/logo-512.png`,
    policy_uri:
      'https://github.com/aliceisjustplaying/bluepy/blob/bluesky/PRIVACY.MD',
    redirect_uris: [`${origin}/`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

function asTrimmedString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function asOptionalString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function hashLimitKey(value) {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function getClientAddress(request) {
  const directIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('True-Client-IP');
  if (directIp) return directIp;

  const forwardedFor = request.headers.get('X-Forwarded-For');
  return forwardedFor?.split(',')[0]?.trim() || 'unknown';
}

function feedbackRateLimitRequest(request, message, contact, action) {
  const clientAddress = getClientAddress(request);
  const keys = ['feedback:ip', `feedback:message:${hashLimitKey(message)}`];
  if (contact) keys.push(`feedback:contact:${hashLimitKey(contact)}`);

  return {
    action,
    clientAddress,
    keys,
    limit: FEEDBACK_RATE_LIMIT,
    periodMs: FEEDBACK_RATE_LIMIT_PERIOD_MS,
  };
}

async function callFeedbackRateLimiter(request, env, message, contact, action) {
  if (!env.FEEDBACK_RATE_LIMITER) {
    console.error('FEEDBACK_RATE_LIMITER is not configured');
    return { success: false, reason: 'unavailable' };
  }

  const body = feedbackRateLimitRequest(request, message, contact, action);

  try {
    const id = env.FEEDBACK_RATE_LIMITER.idFromName(
      hashLimitKey(body.clientAddress),
    );
    const limiter = env.FEEDBACK_RATE_LIMITER.get(id);
    const response = await limiter.fetch(
      new Request('https://feedback-rate-limiter/check', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      return { success: false, reason: 'unavailable' };
    }

    const outcome = await response.json();
    return outcome.success === true
      ? { success: true }
      : { success: false, reason: 'limited' };
  } catch (err) {
    console.error('Feedback rate limit check failed', err);
    return { success: false, reason: 'unavailable' };
  }
}

async function checkFeedbackRateLimit(request, env, message, contact) {
  return callFeedbackRateLimiter(request, env, message, contact, 'check');
}

async function refundFeedbackRateLimit(request, env, message, contact) {
  await callFeedbackRateLimiter(request, env, message, contact, 'refund');
}

function formatOptionalLine(label, value, lines) {
  if (value) lines.push(`${label}: ${value}`);
}

function buildFeedbackEmailText(body, request, message, contact) {
  const diagnostics = body && typeof body === 'object' ? body : {};
  const lines = [];
  formatOptionalLine('Contact', contact, lines);
  formatOptionalLine(
    'Page',
    asOptionalString(diagnostics.page, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'Account',
    asOptionalString(diagnostics.account, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'PDS',
    asOptionalString(diagnostics.pds, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'Build',
    asOptionalString(diagnostics.build, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'Sentry event',
    asOptionalString(diagnostics.sentryEventId, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'Viewport',
    asOptionalString(diagnostics.viewport, FEEDBACK_MAX_FIELD),
    lines,
  );
  formatOptionalLine(
    'User agent',
    asOptionalString(diagnostics.userAgent, 1000) ||
      request.headers.get('user-agent'),
    lines,
  );
  if (lines.length > 0) lines.push('');
  lines.push(message);
  return lines.join('\n');
}

async function handleFeedback(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!env.RESEND_API_KEY || !env.BLUEPY_FEEDBACK_TO) {
    console.error('Feedback email is not configured');
    return new Response('Feedback is temporarily unavailable.', {
      status: 503,
    });
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsed) && parsed > FEEDBACK_MAX_BODY_BYTES) {
      return new Response('Request body too large.', { status: 413 });
    }
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return new Response('Expected JSON body.', { status: 415 });
  }

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return new Response('Invalid request body.', { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).length > FEEDBACK_MAX_BODY_BYTES) {
    return new Response('Request body too large.', { status: 413 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }

  if (typeof body?.hp === 'string' && body.hp.trim().length > 0) {
    return new Response(null, { status: 204 });
  }

  const message = asTrimmedString(body?.message, FEEDBACK_MAX_MESSAGE);
  if (!message) {
    return new Response('Message is required.', { status: 400 });
  }

  const contact = asOptionalString(body?.contact, FEEDBACK_MAX_CONTACT);
  const rateLimit = await checkFeedbackRateLimit(
    request,
    env,
    message,
    contact,
  );
  if (!rateLimit.success) {
    const rateLimited = rateLimit.reason === 'limited';
    return new Response(
      rateLimited
        ? FEEDBACK_TOO_MANY_REQUESTS
        : 'Feedback is temporarily unavailable.',
      { status: rateLimited ? 429 : 503 },
    );
  }

  const replyTo =
    contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : undefined;
  const subjectPrefix =
    asOptionalString(body?.subject, 120) || 'Feedback from Bluepy';
  const resendBody = {
    from: env.BLUEPY_FEEDBACK_FROM || FEEDBACK_FROM,
    to: [env.BLUEPY_FEEDBACK_TO],
    subject: subjectPrefix,
    text: buildFeedbackEmailText(body, request, message, contact),
  };
  if (replyTo) resendBody.reply_to = replyTo;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendBody),
  });

  if (!resendResponse.ok) {
    await refundFeedbackRateLimit(request, env, message, contact);
    const errText = await resendResponse.text().catch(() => '');
    console.error('Resend send failed', resendResponse.status, errText);
    return new Response('Could not send feedback.', { status: 502 });
  }

  return new Response(null, { status: 204 });
}

export class FeedbackRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false }, { status: 400 });
    }

    if (
      !Array.isArray(body.keys) ||
      body.keys.some((key) => typeof key !== 'string' || key.length === 0) ||
      typeof body.limit !== 'number' ||
      typeof body.periodMs !== 'number' ||
      (body.action !== 'check' && body.action !== 'refund')
    ) {
      return Response.json({ success: false }, { status: 400 });
    }

    const now = Date.now();
    await this.state.storage.setAlarm(now + body.periodMs);
    const success = await this.state.storage.transaction(async (txn) => {
      const existing = await txn.get(body.keys);

      if (body.action === 'refund') {
        const updates = {};
        for (const key of body.keys) {
          const current = existing.get(key);
          if (!current || current.resetAt <= now) continue;
          updates[key] = {
            count: Math.max(0, current.count - 1),
            resetAt: current.resetAt,
          };
        }
        await txn.put(updates);
        return true;
      }

      const entries = new Map();

      for (const key of body.keys) {
        const current = existing.get(key);
        const entry =
          current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + body.periodMs };
        entries.set(key, entry);
        if (entry.count >= body.limit) return false;
      }

      const updates = {};
      for (const [key, entry] of entries) {
        updates[key] = { count: entry.count + 1, resetAt: entry.resetAt };
      }
      await txn.put(updates);
      return true;
    });

    return Response.json({ success });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback') {
      return handleFeedback(request, env);
    }
    if (url.pathname === '/oauth-client-metadata.json') {
      return json(oauthMetadata(url.origin));
    }
    if (url.pathname === '/version.json') {
      return json({
        buildTime: env.BLUEPY_BUILD_TIME || null,
        commitHash: env.BLUEPY_COMMIT_HASH || 'unknown',
      });
    }
    return env.ASSETS.fetch(request);
  },
};
