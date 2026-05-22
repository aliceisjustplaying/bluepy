import { expect, test } from '@playwright/test';

import {
  getVideoUploadServiceAuthAud,
  getVideoJobStatus,
  postToStatus,
} from '../src/utils/atproto-adapter.js';

/** @param {Record<string, unknown>} embed */
function postWithEmbed(embed) {
  return {
    uri: 'at://did:plc:alice/app.bsky.feed.post/video',
    cid: 'post-cid',
    author: {
      did: 'did:plc:alice',
      handle: 'alice.test',
      displayName: 'Alice',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'video post',
      createdAt: '2026-05-08T00:00:00.000Z',
    },
    embed,
    indexedAt: '2026-05-08T00:00:00.000Z',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
  };
}

test.describe('ATProto video mapping', () => {
  test('maps Bluesky video view embeds to video media attachments', () => {
    const status = postToStatus(
      postWithEmbed({
        $type: 'app.bsky.embed.video#view',
        cid: 'video-cid',
        playlist:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/playlist.m3u8',
        thumbnail:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/thumbnail.jpg',
        alt: 'Video alt text',
        aspectRatio: { width: 1920, height: 1080 },
      }),
    );

    expect(status.mediaAttachments).toEqual([
      {
        id: 'video-cid',
        type: 'video',
        url: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/playlist.m3u8',
        previewUrl:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/thumbnail.jpg',
        remoteUrl:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/playlist.m3u8',
        description: 'Video alt text',
        meta: { original: { width: 1920, height: 1080 } },
      },
    ]);
  });

  test('maps record-with-media video embeds to video media attachments', () => {
    const status = postToStatus(
      postWithEmbed({
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: {
          $type: 'app.bsky.embed.video#view',
          cid: 'nested-video-cid',
          playlist:
            'https://video.bsky.app/watch/did%3Aplc%3Aalice/nested/playlist.m3u8',
          thumbnail:
            'https://video.bsky.app/watch/did%3Aplc%3Aalice/nested/thumbnail.jpg',
          alt: 'Nested video alt text',
          aspectRatio: { width: 1080, height: 1920 },
        },
      }),
    );

    expect(status.mediaAttachments).toMatchObject([
      {
        id: 'nested-video-cid',
        type: 'video',
        url: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/nested/playlist.m3u8',
        previewUrl:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/nested/thumbnail.jpg',
        remoteUrl:
          'https://video.bsky.app/watch/did%3Aplc%3Aalice/nested/playlist.m3u8',
        description: 'Nested video alt text',
        meta: { original: { width: 1080, height: 1920 } },
      },
    ]);
  });

  test('keeps media on quoted Bluesky record embeds', () => {
    const status = postToStatus(
      postWithEmbed({
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: 'at://did:plc:bob/app.bsky.feed.post/quoted',
          cid: 'quoted-cid',
          author: {
            did: 'did:plc:bob',
            handle: 'bob.test',
            displayName: 'Bob',
          },
          value: {
            $type: 'app.bsky.feed.post',
            text: 'quoted video post',
            createdAt: '2026-05-08T00:00:00.000Z',
          },
          embeds: [
            {
              $type: 'app.bsky.embed.video#view',
              cid: 'quoted-video-cid',
              playlist:
                'https://video.bsky.app/watch/did%3Aplc%3Abob/quoted/playlist.m3u8',
              thumbnail:
                'https://video.bsky.app/watch/did%3Aplc%3Abob/quoted/thumbnail.jpg',
              alt: 'Quoted video alt text',
              aspectRatio: { width: 1280, height: 720 },
            },
          ],
          replyCount: 4,
          repostCount: 3,
          likeCount: 2,
          quoteCount: 1,
          indexedAt: '2026-05-08T00:01:00.000Z',
        },
      }),
    );

    expect(status.quote.quotedStatus.mediaAttachments).toMatchObject([
      {
        id: 'quoted-video-cid',
        type: 'video',
        url: 'https://video.bsky.app/watch/did%3Aplc%3Abob/quoted/playlist.m3u8',
        previewUrl:
          'https://video.bsky.app/watch/did%3Aplc%3Abob/quoted/thumbnail.jpg',
        description: 'Quoted video alt text',
      },
    ]);
    expect(status.quote.quotedStatus.repliesCount).toBe(4);
    expect(status.quote.quotedStatus.reblogsCount).toBe(3);
    expect(status.quote.quotedStatus.favouritesCount).toBe(2);
    expect(status.quote.quotedStatus.quotesCount).toBe(1);
  });

  test('keeps link cards on quoted Bluesky record embeds', () => {
    const status = postToStatus(
      postWithEmbed({
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: 'at://did:plc:bob/app.bsky.feed.post/quoted-link',
          cid: 'quoted-link-cid',
          author: {
            did: 'did:plc:bob',
            handle: 'bob.test',
            displayName: 'Bob',
          },
          value: {
            $type: 'app.bsky.feed.post',
            text: 'quoted link post',
            createdAt: '2026-05-08T00:00:00.000Z',
            embed: {
              $type: 'app.bsky.embed.external',
              external: {
                uri: 'https://example.com/story',
                title: 'Example Story',
                description: 'A linked story',
              },
            },
          },
          embeds: [],
          indexedAt: '2026-05-08T00:01:00.000Z',
        },
      }),
    );

    expect(status.quote.quotedStatus.card).toMatchObject({
      url: 'https://example.com/story',
      title: 'Example Story',
      description: 'A linked story',
      type: 'link',
    });
  });

  test('accepts bare video job status responses while polling', () => {
    expect(
      getVideoJobStatus({
        jobId: 'video-job',
        state: 'JOB_STATE_PROCESSING',
      }),
    ).toMatchObject({
      jobId: 'video-job',
      state: 'JOB_STATE_PROCESSING',
    });
  });

  test('keeps plain JSON blobs from bare video job status responses', () => {
    const status = getVideoJobStatus({
      jobId: 'video-job',
      state: 'JOB_STATE_COMPLETED',
      blob: {
        cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        mimeType: 'video/mp4',
      },
    });

    expect(status.blob?.toJSON()).toEqual({
      cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      mimeType: 'video/mp4',
    });
  });

  test('surfaces video job status error payload messages', () => {
    expect(() =>
      getVideoJobStatus({
        error: 'UploadFailed',
        message: 'transcode failed',
      }),
    ).toThrow('transcode failed');
  });

  test('uses the agent PDS dispatch URL for video upload service auth', async () => {
    const aud = await getVideoUploadServiceAuthAud({
      dispatchUrl: 'https://pds.example.com',
      sessionManager: {},
      com: {
        atproto: {
          server: {
            getSession: async () => {
              throw new Error('unexpected session lookup');
            },
          },
        },
      },
    });

    expect(aud).toBe('did:web:pds.example.com');
  });

  test('encodes custom PDS ports for video upload service auth', async () => {
    const aud = await getVideoUploadServiceAuthAud({
      dispatchUrl: 'https://pds.example.com:2583',
      sessionManager: {},
      com: {
        atproto: {
          server: {
            getSession: async () => {
              throw new Error('unexpected session lookup');
            },
          },
        },
      },
    });

    expect(aud).toBe('did:web:pds.example.com%3A2583');
  });

  test('accepts a DID audience from the session token for video upload auth', async () => {
    const aud = await getVideoUploadServiceAuthAud({
      dispatchUrl: 'https://public.api.bsky.app',
      sessionManager: {
        getTokenInfo: async () => ({ aud: 'did:web:pds.example.com' }),
      },
      com: {
        atproto: {
          server: {
            getSession: async () => {
              throw new Error('unexpected session lookup');
            },
          },
        },
      },
    });

    expect(aud).toBe('did:web:pds.example.com');
  });

  test('falls back to the PDS DID document when dispatch goes through appview', async () => {
    const clearedProxies = [];
    /** @type {{ pdsUrl?: URL }} */
    const sessionManager = {};
    const aud = await getVideoUploadServiceAuthAud({
      dispatchUrl: 'https://public.api.bsky.app',
      sessionManager,
      clone: () => ({
        configureProxy: (proxy) => {
          clearedProxies.push(proxy);
        },
        com: {
          atproto: {
            server: {
              getSession: async () => ({
                data: {
                  didDoc: {
                    '@context': ['https://www.w3.org/ns/did/v1'],
                    id: 'did:plc:alice',
                    service: [
                      {
                        id: '#atproto_pds',
                        type: 'AtprotoPersonalDataServer',
                        serviceEndpoint: 'https://pds.example.com',
                      },
                    ],
                  },
                },
              }),
            },
          },
        },
      }),
      configureProxy: () => {},
      com: {
        atproto: {
          server: {
            getSession: async () => {
              throw new Error('expected cloned PDS-facing agent');
            },
          },
        },
      },
    });

    expect(aud).toBe('did:web:pds.example.com');
    expect(sessionManager.pdsUrl.href).toBe('https://pds.example.com/');
    expect(clearedProxies).toEqual([null]);
  });

  test('falls back to the PDS DID document when token audience is an appview proxy', async () => {
    const clearedProxies = [];
    /** @type {{ pdsUrl?: URL, getTokenInfo: () => Promise<{ aud: string }> }} */
    const sessionManager = {
      getTokenInfo: async () => ({
        aud: 'did:web:api.bsky.app#bsky_appview',
      }),
    };
    const aud = await getVideoUploadServiceAuthAud({
      dispatchUrl: 'did:web:api.bsky.app#bsky_appview',
      sessionManager,
      clone: () => ({
        configureProxy: (proxy) => {
          clearedProxies.push(proxy);
        },
        com: {
          atproto: {
            server: {
              getSession: async () => ({
                data: {
                  didDoc: {
                    '@context': ['https://www.w3.org/ns/did/v1'],
                    id: 'did:plc:alice',
                    service: [
                      {
                        id: '#atproto_pds',
                        type: 'AtprotoPersonalDataServer',
                        serviceEndpoint: 'https://pds.example.com',
                      },
                    ],
                  },
                },
              }),
            },
          },
        },
      }),
      configureProxy: () => {},
      com: {
        atproto: {
          server: {
            getSession: async () => {
              throw new Error('expected cloned PDS-facing agent');
            },
          },
        },
      },
    });

    expect(aud).toBe('did:web:pds.example.com');
    expect(sessionManager.pdsUrl.href).toBe('https://pds.example.com/');
    expect(clearedProxies).toEqual([null]);
  });
});
