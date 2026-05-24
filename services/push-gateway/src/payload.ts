import { validateTargetAtUri } from './candidates.js';

export interface PushPayload {
  version: 1;
  notificationId: string;
  recipientDid: string;
  type: 'reply' | 'mention';
  targetAtUri: string;
  actorDid?: string;
  actorHandle?: string;
  actorDisplayName?: string;
  textExcerpt?: string;
  title: string;
  body: string;
}

export function payloadBytes(payload: PushPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

export function buildPayload(input: Omit<PushPayload, 'version' | 'title' | 'body'>, rich: boolean): PushPayload {
  if (!validateTargetAtUri(input.targetAtUri)) throw new Error('invalid_target_at_uri');
  const name = input.actorDisplayName || input.actorHandle || input.actorDid || 'Someone';
  const title = rich
    ? input.type === 'mention'
      ? `${name} mentioned you`
      : `${name} replied to you`
    : input.type === 'mention'
      ? 'New mention'
      : 'New reply';
  const body = rich && input.textExcerpt ? input.textExcerpt : 'Open Bluepy to view it.';
  const payload: PushPayload = { version: 1, ...input, title, body };
  if (!rich) {
    delete payload.actorDid;
    delete payload.actorHandle;
    delete payload.actorDisplayName;
    delete payload.textExcerpt;
  }
  return payload;
}
