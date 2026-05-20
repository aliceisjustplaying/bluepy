import { expect, test } from '@playwright/test';

import {
  getBlueskyVideoFallbackURL,
  isHlsPlaylistURL,
} from '../src/utils/media-url.js';

test.describe('media URL helpers', () => {
  test('detects Bluesky HLS playlists independently of browser playback support', () => {
    expect(
      isHlsPlaylistURL(
        'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/playlist.m3u8',
      ),
    ).toBe(true);
    expect(
      isHlsPlaylistURL(
        'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/720p/video.m3u8?session_id=abc',
      ),
    ).toBe(true);
    expect(
      isHlsPlaylistURL(
        'https://cdn.bsky.app/img/feed_fullsize/plain/did/bafkrei',
      ),
    ).toBe(false);
  });

  test('builds Bluesky video fallbacks for Blacksky stream URLs', () => {
    expect(
      getBlueskyVideoFallbackURL(
        'https://video.blacksky.community/stream/did%3Aplc%3Aalice/video/360p/video.m3u8?session_id=abc',
      ),
    ).toBe(
      'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/360p/video.m3u8?session_id=abc',
    );
    expect(
      getBlueskyVideoFallbackURL(
        'https://video.bsky.app/watch/did%3Aplc%3Aalice/video/playlist.m3u8',
      ),
    ).toBeUndefined();
  });
});
