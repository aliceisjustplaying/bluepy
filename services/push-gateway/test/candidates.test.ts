import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCandidates, parseDidFromAtUri, validateTargetAtUri } from '../src/candidates.js';

void test('extracts mention and reply candidates with mention precedence', () => {
  const candidates = extractCandidates({
    kind: 'commit',
    did: 'did:plc:author',
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
      cid: 'cid1',
      record: {
        text: 'hello @you',
        facets: [
          {
            features: [
              { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:root' },
              { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:mentioned' },
              { $type: 'app.bsky.richtext.facet#link', did: 'did:plc:not-mentioned' },
            ],
          },
        ],
        reply: {
          root: { uri: 'at://did:plc:root/app.bsky.feed.post/root' },
          parent: { uri: 'at://did:plc:parent/app.bsky.feed.post/parent' },
        },
      },
    },
  });
  assert.deepEqual(candidates.map((candidate) => [candidate.recipientDid, candidate.type]), [
    ['did:plc:root', 'mention'],
    ['did:plc:mentioned', 'mention'],
    ['did:plc:parent', 'reply'],
  ]);
});

void test('ignores non-mention facet features with did fields', () => {
  const candidates = extractCandidates({
    kind: 'commit',
    did: 'did:plc:author',
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
      cid: 'cid1',
      record: {
        text: 'hello',
        facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', did: 'did:plc:not-mentioned' }] }],
      },
    },
  });
  assert.deepEqual(candidates, []);
});

void test('at-uri parser rejects handle authorities and arbitrary urls', () => {
  assert.equal(parseDidFromAtUri('at://alice.test/app.bsky.feed.post/1'), null);
  assert.equal(validateTargetAtUri('https://bluepy.social/notifications'), false);
  assert.equal(validateTargetAtUri('at://did:plc:abc/app.bsky.feed.post/1'), true);
});
