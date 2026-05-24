import { describe, expect, test } from 'bun:test';

import {
  findViewerRecordUriForSubject,
  postDeleteRecordArgs,
} from '../../src/data/posts';

describe('post mutation record URI resolution', () => {
  test('paginates viewer like records until the matching subject is found', async () => {
    const calls: (string | undefined)[] = [];
    const agent = {
      com: {
        atproto: {
          repo: {
            listRecords: async ({ cursor }: { cursor?: string }) => {
              calls.push(cursor);
              if (!cursor) {
                return {
                  data: {
                    cursor: 'page-2',
                    records: [
                      {
                        uri: 'at://did:plc:viewer/app.bsky.feed.like/other',
                        value: {
                          subject: {
                            uri: 'at://did:plc:other/app.bsky.feed.post/1',
                          },
                        },
                      },
                    ],
                  },
                };
              }
              return {
                data: {
                  records: [
                    {
                      uri: 'at://did:plc:viewer/app.bsky.feed.like/match',
                      value: {
                        subject: {
                          uri: 'at://did:plc:author/app.bsky.feed.post/target',
                        },
                      },
                    },
                  ],
                },
              };
            },
          },
        },
      },
    };

    const uri = await findViewerRecordUriForSubject(
      agent,
      'did:plc:viewer',
      'app.bsky.feed.like',
      'at://did:plc:author/app.bsky.feed.post/target',
    );
    expect(uri).toBe('at://did:plc:viewer/app.bsky.feed.like/match');
    expect(calls).toEqual([undefined, 'page-2']);
  });

  test('stops record URI lookup when a cursor repeats', async () => {
    const agent = {
      com: {
        atproto: {
          repo: {
            listRecords: async () => ({
              data: {
                cursor: 'same-page',
                records: [],
              },
            }),
          },
        },
      },
    };

    const uri = await findViewerRecordUriForSubject(
      agent,
      'did:plc:viewer',
      'app.bsky.feed.repost',
      'at://did:plc:author/app.bsky.feed.post/target',
    );
    expect(uri).toBeUndefined();
  });

  test('post delete args reject posts outside the active account repo', () => {
    expect(
      postDeleteRecordArgs(
        'at://did:plc:viewer/app.bsky.feed.post/abc',
        'did:plc:viewer',
      ),
    ).toEqual({ repo: 'did:plc:viewer', rkey: 'abc' });
    expect(() =>
      postDeleteRecordArgs(
        'at://did:plc:other/app.bsky.feed.post/abc',
        'did:plc:viewer',
      ),
    ).toThrow('active account');
  });

  test('post delete args reject URIs that merely contain the post collection segment', () => {
    expect(() =>
      postDeleteRecordArgs(
        'https://example.test/app.bsky.feed.post/abc',
        'did:plc:viewer',
      ),
    ).toThrow('Record URI required');
  });
});
