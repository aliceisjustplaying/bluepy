import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWebPushFailure, deterministicTopic } from '../src/delivery.js';
import { buildPayload, payloadBytes } from '../src/payload.js';

void test('payload construction keeps URLs as Bluepy at-uri targets', () => {
  const payload = buildPayload(
    {
      notificationId: '1',
      recipientDid: 'did:plc:me',
      type: 'mention',
      targetAtUri: 'at://did:plc:actor/app.bsky.feed.post/abc',
      actorDid: 'did:plc:actor',
      actorHandle: 'actor.test',
      textExcerpt: 'hello',
    },
    true,
  );
  assert.equal(payload.body, 'hello');
  assert.equal(payloadBytes(payload) > 0, true);
  assert.throws(() => buildPayload({ ...payload, targetAtUri: 'https://evil.test' }, true), /invalid_target_at_uri/);
});

void test('payload construction strips actor identity when rich previews are disabled', () => {
  const payload = buildPayload(
    {
      notificationId: '1',
      recipientDid: 'did:plc:me',
      type: 'reply',
      targetAtUri: 'at://did:plc:actor/app.bsky.feed.post/abc',
      actorDid: 'did:plc:actor',
      actorHandle: 'actor.test',
      actorDisplayName: 'Actor',
      textExcerpt: 'private text',
    },
    false,
  );
  assert.equal(payload.title, 'New reply');
  assert.equal(payload.body, 'Open Bluepy to view it.');
  assert.equal(payload.actorDid, undefined);
  assert.equal(payload.actorHandle, undefined);
  assert.equal(payload.actorDisplayName, undefined);
  assert.equal(payload.textExcerpt, undefined);
});

void test('failure classification and topic are deterministic', () => {
  assert.equal(classifyWebPushFailure(410), 'gone');
  assert.equal(classifyWebPushFailure(413), 'payload_too_large');
  assert.equal(classifyWebPushFailure(503), 'transient');
  assert.equal(deterministicTopic(42), 'bluepy-42');
});
