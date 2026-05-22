import assert from 'node:assert/strict';
import { test } from 'bun:test';

import { compareCreatedAt } from '../src/utils/catchup-sort';
import { sorted } from '../src/utils/sorted';

test('compareCreatedAt orders timezone-offset timestamps by instant', () => {
  const posts = [
    {
      id: 'timezone-offset-newer-post',
      createdAt: '2026-05-18T20:46:14-04:00',
    },
    {
      id: 'utc-older-post',
      createdAt: '2026-05-18T21:30:00.000Z',
    },
    {
      id: 'utc-newest-post',
      createdAt: '2026-05-19T01:00:00.000Z',
    },
  ];

  assert.deepEqual(
    sorted(posts, compareCreatedAt).map((post) => post.id),
    ['utc-older-post', 'timezone-offset-newer-post', 'utc-newest-post'],
  );
});
