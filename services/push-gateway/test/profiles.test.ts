import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, openDb } from '../src/db.js';
import { getCachedProfile, storeProfile } from '../src/profiles.js';
import { processJetstreamEventWithProfileCache } from '../src/jetstream.js';
import { registerSubscription, upsertSettings } from '../src/repository.js';

void test('profile cache enriches notification events best-effort', async () => {
  const db = openDb(':memory:');
  migrate(db);
  storeProfile(db, {
    did: 'did:plc:author',
    handle: 'author.test',
    displayName: 'Author',
  });
  upsertSettings(db, 'did:plc:recipient', { enabled: true });
  registerSubscription(
    db,
    'secret',
    'did:plc:recipient',
    { endpoint: 'https://push.example/sub', keys: { p256dh: 'p', auth: 'a' } },
    'k1',
  );
  await processJetstreamEventWithProfileCache(db, {
    kind: 'commit',
    did: 'did:plc:author',
    time_us: 1,
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
      cid: 'cid1',
      record: {
        text: 'hello',
        facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:recipient' }] }],
      },
    },
  });
  const event = db
    .prepare('SELECT actor_handle, actor_display_name FROM notification_events')
    .get() as { actor_handle: string; actor_display_name: string };
  assert.deepEqual(event, {
    actor_handle: 'author.test',
    actor_display_name: 'Author',
  });
  assert.equal(getCachedProfile(db, 'did:plc:author')?.handle, 'author.test');
});
