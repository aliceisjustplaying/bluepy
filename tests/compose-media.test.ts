import assert from 'node:assert/strict';
import { test } from 'bun:test';

import {
  revokeAttachmentObjectUrl,
  uploadComposeMediaAttachments,
} from '../src/utils/compose-media';

test('uploadComposeMediaAttachments uploads pending media without mutating state objects', async () => {
  const pending = {
    fileData: new Uint8Array([1, 2, 3]).buffer,
    fileName: 'photo.png',
    type: 'image/png',
    id: null,
    description: 'alt',
  };
  const existing = { id: 'already-uploaded', description: 'kept' };
  const attachments = [pending, existing];

  const uploaded = await uploadComposeMediaAttachments(
    attachments,
    async (params) => {
      assert.equal(params.description, 'alt');
      assert.ok(params.file);
      assert.equal(params.file.name, 'photo.png');
      assert.equal(params.file.type, 'image/png');
      return { id: 'new-upload-id' };
    },
  );

  assert.equal(pending.id, null);
  assert.notEqual(uploaded[0], pending);
  assert.deepEqual(
    uploaded.map((attachment) => attachment.id),
    ['new-upload-id', 'already-uploaded'],
  );
});

test('revokeAttachmentObjectUrl only revokes object URLs owned by compose', () => {
  const revoked: string[] = [];
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  try {
    revokeAttachmentObjectUrl({
      url: 'blob:https://bluepy.social/owned',
      ownedObjectUrl: true,
    });
    revokeAttachmentObjectUrl({
      url: 'blob:https://bluepy.social/not-owned',
    });
    revokeAttachmentObjectUrl({
      url: 'https://cdn.example/image.jpg',
      ownedObjectUrl: true,
    });
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }

  assert.deepEqual(revoked, ['blob:https://bluepy.social/owned']);
});
