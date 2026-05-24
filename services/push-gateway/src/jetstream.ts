import { setTimeout as sleep } from 'node:timers/promises';
import { JetstreamSubscription } from '@atcute/jetstream';
import { createDeliveryAttemptsForEvent } from './delivery.js';
import type { Db } from './db.js';
import { extractCandidates, type JetstreamPostEvent } from './candidates.js';
import {
  activeRecipientDids,
  advanceJetstreamCursor,
  getJetstreamCursor,
  hasActiveRecipients,
  upsertNotificationEvent,
} from './repository.js';
import { getOrFetchProfilePreview } from './profiles.js';

export const JETSTREAM_CURSOR_ID = 'app.bsky.feed.post';
export const REPLAY_WINDOW_US = 60_000_000;

export interface ProcessJetstreamResult {
  seen: number;
  candidates: number;
  events: number;
  attempts: number;
  dropped: number;
  cursorAdvanced: boolean;
}

export function resumeCursorUs(db: Db): number {
  const cursor = getJetstreamCursor(db, JETSTREAM_CURSOR_ID);
  if (!cursor) return Math.max(0, Date.now() * 1000 - REPLAY_WINDOW_US);
  return Math.max(0, cursor - REPLAY_WINDOW_US);
}

export function processJetstreamEvent(db: Db, event: JetstreamPostEvent): ProcessJetstreamResult {
  const candidates = extractCandidates(event);
  const activeRecipients = activeRecipientDids(db);
  let attempts = 0;
  let events = 0;
  let dropped = 0;

  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      if (!activeRecipients.has(candidate.recipientDid)) {
        dropped += 1;
        continue;
      }
      const notificationEvent = upsertNotificationEvent(db, candidate);
      events += 1;
      attempts += createDeliveryAttemptsForEvent(db, notificationEvent.id, candidate.recipientDid);
    }
    if (typeof event.time_us === 'number') {
      advanceJetstreamCursor(db, JETSTREAM_CURSOR_ID, event.time_us);
    }
  });
  tx();

  return {
    seen: 1,
    candidates: candidates.length,
    events,
    attempts,
    dropped,
    cursorAdvanced: typeof event.time_us === 'number',
  };
}

export async function processJetstreamEventWithProfileCache(
  db: Db,
  event: JetstreamPostEvent,
  appViewUrl?: string,
): Promise<ProcessJetstreamResult> {
  const candidates = extractCandidates(event);
  const activeRecipients = activeRecipientDids(db);
  const deliverableCandidates = candidates.filter((candidate) => activeRecipients.has(candidate.recipientDid));
  if (!deliverableCandidates.length) {
    if (typeof event.time_us === 'number') {
      advanceJetstreamCursor(db, JETSTREAM_CURSOR_ID, event.time_us);
    }
    return {
      seen: 1,
      candidates: candidates.length,
      events: 0,
      attempts: 0,
      dropped: candidates.length,
      cursorAdvanced: typeof event.time_us === 'number',
    };
  }
  const profile = await getOrFetchProfilePreview(db, event.did, appViewUrl);
  if (!profile) return processJetstreamEvent(db, event);
  let attempts = 0;
  let events = 0;
  const tx = db.transaction(() => {
    for (const candidate of deliverableCandidates) {
      const notificationEvent = upsertNotificationEvent(db, {
        ...candidate,
        actorHandle: profile.handle,
        actorDisplayName: profile.displayName,
      });
      events += 1;
      attempts += createDeliveryAttemptsForEvent(db, notificationEvent.id, candidate.recipientDid);
    }
    if (typeof event.time_us === 'number') {
      advanceJetstreamCursor(db, JETSTREAM_CURSOR_ID, event.time_us);
    }
  });
  tx();
  return {
    seen: 1,
    candidates: candidates.length,
    events,
    attempts,
    dropped: candidates.length - deliverableCandidates.length,
    cursorAdvanced: typeof event.time_us === 'number',
  };
}

export async function consumeJetstream(
  db: Db,
  options: {
    url: string;
    signal: AbortSignal;
    onResult?: (result: ProcessJetstreamResult) => void;
    onError?: (error: unknown) => void;
  },
): Promise<void> {
  while (!options.signal.aborted) {
    if (!hasActiveRecipients(db)) {
      await waitForAbort(options.signal, 5_000);
      continue;
    }
    const subscription = new JetstreamSubscription({
      url: options.url,
      cursor: resumeCursorUs(db),
      wantedCollections: ['app.bsky.feed.post'],
      // Jetstream can emit non-commit events that are irrelevant to V1 delivery.
      // Record shape validation happens in extractCandidates before persistence.
      validateEvents: false,
      onError: options.onError,
    });
    const iterator = subscription[Symbol.asyncIterator]();
    let removeAbortListener: (() => void) | undefined;
    const abortPromise = new Promise<IteratorResult<unknown>>((resolve) => {
      const onAbort = () => {
        subscription.updateOptions({ url: options.url, wantedCollections: [] });
        resolve({ done: true, value: undefined });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => {
        options.signal.removeEventListener('abort', onAbort);
      };
    });
    try {
      while (!options.signal.aborted && hasActiveRecipients(db)) {
        try {
          const next = await Promise.race([iterator.next(), abortPromise]);
          if (next.done) break;
          const result = await processJetstreamEventWithProfileCache(db, next.value as JetstreamPostEvent);
          options.onResult?.(result);
        } catch (error) {
          if (options.signal.aborted) break;
          options.onError?.(error);
        }
      }
    } finally {
      removeAbortListener?.();
      await iterator.return?.();
    }
  }
}

async function waitForAbort(signal: AbortSignal, ms: number): Promise<void> {
  try {
    await sleep(ms, undefined, { signal });
  } catch {
    // Abort is the shutdown path.
  }
}
