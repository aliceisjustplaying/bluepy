// @ts-check
import { expect, test } from '@playwright/test';

/**
 * @typedef {import('@atproto/api').AppBskyActorDefs.ProfileViewBasic} AtprotoTestActor
 * @typedef {import('@atproto/api').AppBskyFeedDefs.PostView} AtprotoTestPost
 */

/**
 * @param {string} did
 * @param {string} handle
 * @param {string} displayName
 * @returns {AtprotoTestActor}
 */
function makeAtprotoTestActor(did, handle, displayName) {
  return { did, handle, displayName };
}

/**
 * @param {string} uri
 * @param {AtprotoTestActor} author
 * @param {string} text
 * @param {{ uri: string; cid: string } | null} parent
 * @param {string} createdAt
 * @returns {AtprotoTestPost}
 */
function makeAtprotoTestPost(uri, author, text, parent, createdAt) {
  const cid = THREAD_CIDS[uri];
  return {
    uri,
    cid,
    author,
    record: {
      $type: 'app.bsky.feed.post',
      text,
      createdAt,
      ...(parent
        ? {
            reply: {
              root: { uri: THREAD_ROOT_URI, cid: THREAD_ROOT_CID },
              parent,
            },
          }
        : {}),
    },
    indexedAt: createdAt,
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
    labels: [],
    viewer: {},
  };
}

const THREAD_ROOT_URI =
  'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/threadroot';
const THREAD_ROOT_CID =
  'bafyreifpzxifkolbqfuez5mhvx6axkld7aynq2bjxkqivd375k2iobqfcq';
/** @type {Record<string, string>} */
const THREAD_CIDS = {
  [THREAD_ROOT_URI]: THREAD_ROOT_CID,
  'at://did:plc:p2cp5gopk7mgjegy6wadk3ep/app.bsky.feed.post/directreply':
    'bafyreieuuxftpeth2jakt425iwn7on5or7ydni47uai2k4c4a7jxcrswsi',
  'at://did:plc:vc7f4oafdgxsihk4cry2xpze/app.bsky.feed.post/nestedreply':
    'bafyreic3pxdls7ilzck5xoyhfu66ijkeoqvxbhptksupex2xdjkdb4nia4',
  'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/parentpost':
    'bafyreigobhwuxqo4jevkyjuesxg4jhnsbbrx2lcwz2voe5ur5hapn4zhp4',
  'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/childreply':
    'bafyreid6oyjebcjmlq2h7omcm5mj6zq3yhmvn5nrkpe7gdq5j4i6ygc65m',
};

test('has welcome page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
});

test('login page appview switcher updates data-appview on html element', async ({
  page,
}) => {
  await page.goto('/login');
  // Default should be bluesky
  await expect(page.locator('html')).toHaveAttribute('data-appview', 'bluesky');

  // Switch to Blacksky
  await page
    .getByRole('combobox', { name: /appview/i })
    .selectOption('blacksky');
  await expect(page.locator('html')).toHaveAttribute(
    'data-appview',
    'blacksky',
  );

  // Switch back
  await page
    .getByRole('combobox', { name: /appview/i })
    .selectOption('bluesky');
  await expect(page.locator('html')).toHaveAttribute('data-appview', 'bluesky');
});

test('does not run a Mastodon runtime for legacy instance post routes', async ({
  page,
}) => {
  let mastodonRequested = false;
  await page.route('**/api/v1/statuses/**', async (route) => {
    mastodonRequested = true;
    await route.fulfill({
      json: { id: '123', content: '<p>This is a test post</p>' },
    });
  });

  await page.goto('/test.social/s/123');

  // ATProto-only: there is no Mastodon runtime to fetch a non-Bluesky instance
  // post, so the route degrades to the welcome/login screen and never calls the
  // Mastodon REST API.
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('text=This is a test post')).toHaveCount(0);
  expect(mastodonRequested).toBe(false);
});

test('uses cache-busting reloads when the app script never mounts', async ({
  page,
}) => {
  await page.clock.install();
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.fulfill({
      contentType: 'application/javascript',
      body: '// Simulate Safari restoring the boot document without app mount.',
    });
  });

  await page.goto('/');

  await page.clock.runFor(29_000);
  expect(appScriptRequests).toBe(1);
  await page.clock.runFor(1_000);
  await expect.poll(() => appScriptRequests).toBe(2);
  await page.clock.runFor(30_000);
  await expect.poll(() => appScriptRequests).toBe(3);
  await page.clock.runFor(30_000);
  await expect.poll(() => appScriptRequests).toBe(4);
  await page.clock.runFor(30_000);
  await expect(page.locator('#boot-status')).toContainText(
    'Safari did not run the app script',
  );
  await expect.poll(() => page.evaluate(getBootReloadAttempts)).toBe(3);
  expect(new URL(page.url()).searchParams.has('__bluepy_boot_retry')).toBe(
    true,
  );
  expect(appScriptRequests).toBe(4);
});

test('uses cache-busting reloads when the app script fails to load', async ({
  page,
}) => {
  test.setTimeout(20_000);
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.abort('failed');
  });

  await page.goto('/');

  await expect.poll(() => appScriptRequests, { timeout: 10_000 }).toBe(4);
  await expect.poll(() => page.evaluate(getBootReloadAttempts)).toBe(3);
  expect(new URL(page.url()).searchParams.has('__bluepy_boot_retry')).toBe(
    true,
  );
  await page.waitForTimeout(1000);
  expect(appScriptRequests).toBe(4);
});

test('shows boot failure without recovery on app runtime errors', async ({
  page,
}) => {
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.fulfill({
      contentType: 'application/javascript',
      body: "throw new Error('boot boom');",
    });
  });

  await page.goto('/');

  await expect(page.locator('#boot-status')).toContainText('boot boom');
  await page.waitForTimeout(1000);
  expect(appScriptRequests).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('bluepy:boot-reload-state')),
    )
    .toBeNull();
});

test('clears boot retry state after a successful mount', async ({ page }) => {
  await page.goto('/favicon.ico');
  await page.evaluate(() => {
    sessionStorage.setItem(
      'bluepy:boot-reload-state',
      JSON.stringify({ attempts: 2, lastAt: Date.now() }),
    );
    sessionStorage.setItem('bluepy:boot-reload-attempted', '1');
  });

  await page.goto('/?__bluepy_boot_retry=123');
  await expect(page.locator('#welcome')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        search: location.search,
        state: sessionStorage.getItem('bluepy:boot-reload-state'),
        legacyState: sessionStorage.getItem('bluepy:boot-reload-attempted'),
      })),
    )
    .toEqual({
      search: '',
      state: null,
      legacyState: null,
    });
});

test('does not treat post-mount module failures as boot failures', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  const mountedURL = page.url();

  await page.evaluate(() => {
    const script = document.createElement('script');
    script.type = 'module';
    document.body.append(script);
    script.dispatchEvent(new Event('error'));
  });

  await page.waitForTimeout(1000);
  expect(page.url()).toBe(mountedURL);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('bluepy:boot-reload-state')),
    )
    .toBeNull();
});

test('redirects old hash post URLs to path routes', async ({ page }) => {
  let mastodonRequested = false;
  await page.route('**/api/v1/statuses/**', async (route) => {
    mastodonRequested = true;
    await route.fulfill({
      json: { id: '123', content: '<p>Legacy hash post</p>' },
    });
  });

  await page.goto('/#/test.social/s/123');
  // Hash→path route normalization still applies...
  await expect(page).toHaveURL(/\/test\.social\/s\/123$/);
  // ...but ATProto-only means no Mastodon runtime renders the post; it degrades
  // to the welcome/login screen without a Mastodon REST call.
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('text=Legacy hash post')).toHaveCount(0);
  expect(mastodonRequested).toBe(false);
});

test('loads native AT URI post URLs', async ({ page }) => {
  const atUri =
    'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/3mlvekixsll23';
  const post = {
    uri: atUri,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    author: {
      did: 'did:plc:by3jhwdqgbtrcc7q4tkkv3cf',
      handle: 'alice.mosphere.at',
      displayName: 'Alice',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'Native AT URI post',
      createdAt: '2024-01-01T12:00:00.000Z',
    },
    indexedAt: '2024-01-01T12:00:00.000Z',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
    labels: [],
    viewer: {},
  };

  await page.route('**/xrpc/app.bsky.feed.getPosts*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { posts: [post] },
    });
  });
  await page.route('**/xrpc/app.bsky.feed.getPostThread*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post,
          replies: [],
        },
      },
    });
  });

  await page.goto(`/${atUri}`);
  await expect(page.locator('text=Native AT URI post')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page).toHaveURL(
    new RegExp(
      `/at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app\\.bsky\\.feed\\.post/3mlvekixsll23$`,
    ),
  );
});

test('canonicalizes Worker-encoded native AT URI post URLs', async ({
  page,
}) => {
  await routeAtprotoRecords(page);

  const workerEncodedPath =
    '/at%3A/did%3Aplc%3Aby3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/post123';
  await page.goto(workerEncodedPath, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(pathRegex(AT_POST_PATH));
  await expect(page.locator('text=AT route post')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
});

test('keeps nested same-author thread replies under their parent', async ({
  page,
}) => {
  const directUri =
    'at://did:plc:p2cp5gopk7mgjegy6wadk3ep/app.bsky.feed.post/directreply';
  const nestedUri =
    'at://did:plc:vc7f4oafdgxsihk4cry2xpze/app.bsky.feed.post/nestedreply';
  const parentUri =
    'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/parentpost';
  const childUri =
    'at://did:plc:by3jhwdqgbtrcc7q4tkkv3cf/app.bsky.feed.post/childreply';
  const alice = makeAtprotoTestActor(
    'did:plc:by3jhwdqgbtrcc7q4tkkv3cf',
    'alice.mosphere.at',
    'Alice',
  );
  const bob = makeAtprotoTestActor(
    'did:plc:p2cp5gopk7mgjegy6wadk3ep',
    'samuel.fm',
    'Samuel',
  );
  const jerry = makeAtprotoTestActor(
    'did:plc:vc7f4oafdgxsihk4cry2xpze',
    'jcsalterego.bsky.social',
    'Jerry',
  );
  const root = makeAtprotoTestPost(
    THREAD_ROOT_URI,
    alice,
    'Thread root post',
    null,
    '2026-05-20T13:00:00.000Z',
  );
  const direct = makeAtprotoTestPost(
    directUri,
    bob,
    'Direct reply',
    { uri: THREAD_ROOT_URI, cid: THREAD_ROOT_CID },
    '2026-05-20T13:01:00.000Z',
  );
  const nested = makeAtprotoTestPost(
    nestedUri,
    jerry,
    'Nested reply',
    { uri: directUri, cid: direct.cid },
    '2026-05-20T13:02:00.000Z',
  );
  const parent = makeAtprotoTestPost(
    parentUri,
    alice,
    'Parent in nested chain',
    { uri: nestedUri, cid: nested.cid },
    '2026-05-20T13:03:00.000Z',
  );
  const child = makeAtprotoTestPost(
    childUri,
    alice,
    'Same author child reply',
    { uri: parentUri, cid: parent.cid },
    '2026-05-20T13:04:00.000Z',
  );

  await page.route('**/xrpc/app.bsky.feed.getPosts*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { posts: [root] },
    });
  });
  await page.route('**/xrpc/app.bsky.feed.getPostThread*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: root,
          replies: [
            {
              $type: 'app.bsky.feed.defs#threadViewPost',
              post: direct,
              replies: [
                {
                  $type: 'app.bsky.feed.defs#threadViewPost',
                  post: nested,
                  replies: [
                    {
                      $type: 'app.bsky.feed.defs#threadViewPost',
                      post: parent,
                      replies: [
                        {
                          $type: 'app.bsky.feed.defs#threadViewPost',
                          post: child,
                          replies: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });

  await page.goto(`/${THREAD_ROOT_URI}`);
  await expect(page.locator('text=Parent in nested chain')).toBeVisible();
  await expect(page.locator('text=Same author child reply')).toBeVisible();

  const childIsNestedUnderParent = await page.evaluate(() => {
    const statuses = Array.from(document.querySelectorAll('.status'));
    const parentStatus = statuses.find((status) =>
      status.textContent?.includes('Parent in nested chain'),
    );
    const childStatus = statuses.find((status) =>
      status.textContent?.includes('Same author child reply'),
    );
    return !!parentStatus?.closest('li')?.contains(childStatus || null);
  });
  const visibleText = await page.locator('body').innerText();
  expect(childIsNestedUnderParent).toBe(true);
  expect(visibleText.indexOf('Parent in nested chain')).toBeLessThan(
    visibleText.indexOf('Same author child reply'),
  );
});

const HLS_AT_URI =
  'at://did:plc:xgvzy7ni6ig6ievcbls5jaxe/app.bsky.feed.post/hlsvideo';
const HLS_VIDEO_PLAYLIST =
  'https://video.bsky.app/watch/did%3Aplc%3Axgvzy7ni6ig6ievcbls5jaxe/bafkreid6nmhqqqmmbsahgfpahxxbatxykbs62palibnw5ujmm3tjtitd6a/playlist.m3u8';
const HLS_VIDEO_THUMBNAIL =
  'https://video.bsky.app/watch/did%3Aplc%3Axgvzy7ni6ig6ievcbls5jaxe/bafkreid6nmhqqqmmbsahgfpahxxbatxykbs62palibnw5ujmm3tjtitd6a/thumbnail.jpg';
const BLACKSKY_HLS_VIDEO_PLAYLIST =
  'https://video.blacksky.community/stream/did%3Aplc%3Axgvzy7ni6ig6ievcbls5jaxe/bafkreid6nmhqqqmmbsahgfpahxxbatxykbs62palibnw5ujmm3tjtitd6a/playlist.m3u8';
const BLACKSKY_HLS_VIDEO_THUMBNAIL =
  'https://video.blacksky.community/stream/did%3Aplc%3Axgvzy7ni6ig6ievcbls5jaxe/bafkreid6nmhqqqmmbsahgfpahxxbatxykbs62palibnw5ujmm3tjtitd6a/thumbnail.jpg';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ playlist?: string; thumbnail?: string }} [options]
 */
async function routeHlsVideoPost(page, options = {}) {
  const { playlist = HLS_VIDEO_PLAYLIST, thumbnail = HLS_VIDEO_THUMBNAIL } =
    options;
  const post = {
    uri: HLS_AT_URI,
    cid: 'bafyreiezmfwjn5hfru62w2ot4hwvfcaeu6qkgimjgg36n4n4tnmzjy7eda',
    author: {
      did: 'did:plc:xgvzy7ni6ig6ievcbls5jaxe',
      handle: 'quillmatiq.com',
      displayName: 'Anuj Ahooja',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'Native AT URI HLS video post',
      createdAt: '2026-05-20T12:48:00.000Z',
    },
    embed: {
      $type: 'app.bsky.embed.video#view',
      cid: 'bafkreid6nmhqqqmmbsahgfpahxxbatxykbs62palibnw5ujmm3tjtitd6a',
      playlist,
      thumbnail,
      alt: 'Bluepy AppView picker demo',
      aspectRatio: { width: 1080, height: 1920 },
    },
    indexedAt: '2026-05-20T12:48:00.000Z',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
    labels: [],
    viewer: {},
  };

  await page.route('**/xrpc/app.bsky.feed.getPosts*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { posts: [post] },
    });
  });
  await page.route('**/xrpc/app.bsky.feed.getPostThread*', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post,
          replies: [],
        },
      },
    });
  });
  await page.route('https://video.bsky.app/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/playlist.m3u8')) {
      await route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n',
      });
      return;
    }
    await route.fulfill({ status: 204 });
  });
}

test('loads Bluesky HLS video embeds with hls.js on native AT URI post URLs', async ({
  page,
}) => {
  await routeHlsVideoPost(page);
  let hlsModuleRequested = false;
  page.on('request', (request) => {
    const url = request.url();
    if (/hls(?:__js|-).*\.js/.test(url)) hlsModuleRequested = true;
  });
  await page.addInitScript(() => {
    const nativeVideo = document.createElement('video');
    const nativeCanPlayType = nativeVideo.canPlayType.bind(nativeVideo);
    HTMLMediaElement.prototype.canPlayType = function (type) {
      if (/mpegurl/i.test(type)) return '';
      return nativeCanPlayType(type);
    };
  });

  await page.goto(`/${HLS_AT_URI}?media=1`);
  await expect(page.locator('video[controls]').first()).toBeVisible();
  await expect.poll(() => hlsModuleRequested).toBe(true);
});

test('loads Bluesky HLS video embeds with native HLS when supported', async ({
  page,
}) => {
  await routeHlsVideoPost(page);
  let hlsModuleRequested = false;
  page.on('request', (request) => {
    const url = request.url();
    if (/hls(?:__js|-).*\.js/.test(url)) hlsModuleRequested = true;
  });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return /mpegurl/i.test(type) ? 'probably' : '';
    };
  });

  await page.goto(`/${HLS_AT_URI}?media=1`);
  const video = page.locator('video[controls]').first();
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty('src', HLS_VIDEO_PLAYLIST);
  expect(hlsModuleRequested).toBe(false);
});

test('falls back from failing Blacksky HLS URLs to Bluesky video service URLs', async ({
  page,
}) => {
  await routeHlsVideoPost(page, {
    playlist: BLACKSKY_HLS_VIDEO_PLAYLIST,
    thumbnail: BLACKSKY_HLS_VIDEO_THUMBNAIL,
  });
  let blackskyHlsRequested = false;
  let blackskyVariantRequested = false;
  let blueskyHlsRequested = false;
  let hlsModuleRequested = false;
  page.on('request', (request) => {
    const url = request.url();
    if (/hls(?:__js|-).*\.js/.test(url)) hlsModuleRequested = true;
    if (url === HLS_VIDEO_PLAYLIST) blueskyHlsRequested = true;
  });
  await page.route('https://video.blacksky.community/**', async (route) => {
    const url = route.request().url();
    const { pathname } = new URL(url);
    if (pathname.endsWith('/playlist.m3u8')) {
      blackskyHlsRequested = true;
      await route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-STREAM-INF:PROGRAM-ID=0,BANDWIDTH=655600,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=360x640',
          '360p/video.m3u8?session_id=broken',
          '',
        ].join('\n'),
      });
      return;
    }
    if (pathname.endsWith('/360p/video.m3u8')) {
      blackskyVariantRequested = true;
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.addInitScript(() => {
    const nativeVideo = document.createElement('video');
    const nativeCanPlayType = nativeVideo.canPlayType.bind(nativeVideo);
    HTMLMediaElement.prototype.canPlayType = function (type) {
      if (/mpegurl/i.test(type)) return '';
      return nativeCanPlayType(type);
    };
  });

  await page.goto(`/${HLS_AT_URI}?media=1`);
  const video = page.locator('video[controls]').first();
  await expect(video).toBeVisible();
  await expect.poll(() => hlsModuleRequested).toBe(true);
  await expect.poll(() => blackskyHlsRequested).toBe(true);
  await expect.poll(() => blackskyVariantRequested).toBe(true);
  await expect.poll(() => blueskyHlsRequested).toBe(true);
});

const AT_REPO = 'did:plc:by3jhwdqgbtrcc7q4tkkv3cf';
const AT_PROFILE_URI = `at://${AT_REPO}/app.bsky.actor.profile/self`;
const AT_PROFILE_PATH = `/${AT_PROFILE_URI}`;
const AT_LIST_URI = `at://${AT_REPO}/app.bsky.graph.list/abc123`;
const AT_LIST_PATH = `/${AT_LIST_URI}`;
const AT_FEED_URI = `at://${AT_REPO}/app.bsky.feed.generator/whats-hot`;
const AT_FEED_PATH = `/${AT_FEED_URI}`;
const SCROLL_AT_FEED_URI = `at://${AT_REPO}/app.bsky.feed.generator/scroll-feed`;
const SCROLL_AT_FEED_PATH = `/${SCROLL_AT_FEED_URI}`;
const SCROLL_LOCAL_FEED_PATH = `/l/${encodeURIComponent(SCROLL_AT_FEED_URI)}`;
const AT_POST_URI = `at://${AT_REPO}/app.bsky.feed.post/post123`;
const AT_POST_PATH = `/${AT_POST_URI}`;
const AT_PROFILE_AVATAR =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const AT_PROFILE_BANNER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/**
 * @param {string} path
 */
function pathRegex(path) {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * @param {import('@playwright/test').Page} page
 */
function collectNoRouteWarnings(page) {
  /** @type {string[]} */
  const warnings = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('No routes matched location')) warnings.push(text);
  });
  return warnings;
}

/**
 * @returns {number | null}
 */
function getBootReloadAttempts() {
  /** @type {unknown} */
  const parsed = JSON.parse(
    sessionStorage.getItem('bluepy:boot-reload-state') || '{}',
  );
  if (!parsed || typeof parsed !== 'object' || !('attempts' in parsed)) {
    return null;
  }
  const { attempts } = parsed;
  return typeof attempts === 'number' ? attempts : null;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ accessToken?: string; homeTimeline?: { type: string; id: string } }} [options]
 */
async function seedAtprotoLogin(page, options = {}) {
  await page.addInitScript(
    ({ accessToken, avatar, homeTimeline, repo }) => {
      localStorage.setItem(
        'accounts',
        JSON.stringify([
          {
            accessToken,
            atproto: true,
            info: {
              id: repo,
              username: 'alice.test',
              acct: 'alice.test',
              displayName: 'Alice Profile',
              avatar,
              avatarStatic: avatar,
            },
            instanceURL: 'bsky.social',
          },
        ]),
      );
      localStorage.setItem(
        'instances',
        JSON.stringify({
          'bsky.social': {
            title: 'Bluesky',
          },
        }),
      );
      sessionStorage.setItem('currentAccount', repo);
      if (homeTimeline) {
        localStorage.setItem(
          'homeTimeline',
          JSON.stringify({
            [`${repo}@bsky.social`]: homeTimeline,
          }),
        );
      }
    },
    {
      accessToken: options.accessToken ?? 'test-token',
      avatar: AT_PROFILE_AVATAR,
      homeTimeline: options.homeTimeline,
      repo: AT_REPO,
    },
  );
}

/**
 * @param {string} [uri]
 * @param {string} [text]
 * @returns {AtprotoTestPost}
 */
function makeAtprotoPost(uri = AT_POST_URI, text = 'AT route post') {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    author: {
      $type: 'app.bsky.actor.defs#profileViewBasic',
      did: AT_REPO,
      handle: 'alice.test',
      displayName: 'Alice Profile',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: '2024-01-01T12:00:00.000Z',
    },
    indexedAt: '2024-01-01T12:00:00.000Z',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
    labels: [],
    viewer: {},
  };
}

/**
 * @typedef {{ uri: string, cid: string, author: AtprotoTestPost['author'] }} AtprotoReplyRef
 * @typedef {{
 *   $type: string,
 *   post: AtprotoTestPost,
 *   parent?: AtprotoThreadNode,
 *   replies: AtprotoThreadNode[],
 * }} AtprotoThreadNode
 */

/**
 * @param {AtprotoTestPost} post
 * @returns {AtprotoReplyRef}
 */
function atprotoReplyRef(post) {
  return {
    uri: post.uri,
    cid: post.cid,
    author: post.author,
  };
}

/**
 * @param {AtprotoTestPost} post
 * @param {{
 *   parent?: AtprotoThreadNode,
 *   replies?: AtprotoThreadNode[],
 * }} [options]
 * @returns {AtprotoThreadNode}
 */
function makeAtprotoThreadNode(post, options = {}) {
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post,
    ...(options.parent ? { parent: options.parent } : {}),
    replies: options.replies || [],
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   onThreadRequest?: (uri: string) => Promise<void> | void,
 * }} [options]
 */
async function routeAtprotoThreadNavigation(page, options = {}) {
  const root = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-root`,
    'Thread root post',
  );
  const middle = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-middle`,
    'Thread middle post',
  );
  const child = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-child`,
    'Thread child post',
  );
  const grandchild = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-grandchild`,
    'Thread grandchild post',
  );
  const otherReply = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-other-reply`,
    'Thread other reply post',
  );
  const directOtherReply = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/thread-direct-other-reply`,
    'Thread direct other reply post',
  );
  otherReply.author = {
    $type: 'app.bsky.actor.defs#profileViewBasic',
    did: 'did:plc:otherreplyauthor',
    handle: 'other.test',
    displayName: 'Other Reply',
  };
  directOtherReply.author = otherReply.author;
  middle.record.reply = {
    root: atprotoReplyRef(root),
    parent: atprotoReplyRef(root),
  };
  child.record.reply = {
    root: atprotoReplyRef(root),
    parent: atprotoReplyRef(middle),
  };
  grandchild.record.reply = {
    root: atprotoReplyRef(root),
    parent: atprotoReplyRef(child),
  };
  otherReply.record.reply = {
    root: atprotoReplyRef(root),
    parent: atprotoReplyRef(child),
  };
  directOtherReply.record.reply = {
    root: atprotoReplyRef(root),
    parent: atprotoReplyRef(middle),
  };
  root.replyCount = 1;
  middle.replyCount = 2;
  child.replyCount = 2;
  const posts = [root, middle, child, grandchild, otherReply, directOtherReply];
  const profile = {
    $type: 'app.bsky.actor.defs#profileView',
    did: AT_REPO,
    handle: 'alice.test',
    displayName: 'Alice Profile',
    description: '',
    followersCount: 1,
    followsCount: 2,
    postsCount: 3,
    labels: [],
    viewer: {},
  };
  const feed = {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: AT_FEED_URI,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    did: AT_REPO,
    displayName: 'AT Feed',
    description: '',
    creator: profile,
    indexedAt: '2024-01-01T12:00:00.000Z',
    likeCount: 0,
    viewer: {},
  };
  const rootNode = () =>
    makeAtprotoThreadNode(root, {
      replies: [
        makeAtprotoThreadNode(middle, {
          replies: [
            makeAtprotoThreadNode(child, {
              replies: [
                makeAtprotoThreadNode(grandchild),
                makeAtprotoThreadNode(otherReply),
              ],
            }),
            makeAtprotoThreadNode(directOtherReply),
          ],
        }),
      ],
    });
  const middleNode = () =>
    makeAtprotoThreadNode(middle, {
      parent: makeAtprotoThreadNode(root),
      replies: [
        makeAtprotoThreadNode(child, {
          replies: [
            makeAtprotoThreadNode(grandchild),
            makeAtprotoThreadNode(otherReply),
          ],
        }),
        makeAtprotoThreadNode(directOtherReply),
      ],
    });
  const childNode = () =>
    makeAtprotoThreadNode(child, {
      parent: makeAtprotoThreadNode(middle, {
        parent: makeAtprotoThreadNode(root),
      }),
      replies: [
        makeAtprotoThreadNode(grandchild),
        makeAtprotoThreadNode(otherReply),
      ],
    });
  const grandchildNode = () =>
    makeAtprotoThreadNode(grandchild, {
      parent: makeAtprotoThreadNode(child, {
        parent: makeAtprotoThreadNode(middle, {
          parent: makeAtprotoThreadNode(root),
        }),
      }),
    });
  const otherReplyNode = () =>
    makeAtprotoThreadNode(otherReply, {
      parent: makeAtprotoThreadNode(child, {
        parent: makeAtprotoThreadNode(middle, {
          parent: makeAtprotoThreadNode(root),
        }),
      }),
    });
  const directOtherReplyNode = () =>
    makeAtprotoThreadNode(directOtherReply, {
      parent: makeAtprotoThreadNode(middle, {
        parent: makeAtprotoThreadNode(root),
      }),
    });
  const threadByURI = new Map([
    [root.uri, rootNode],
    [middle.uri, middleNode],
    [child.uri, childNode],
    [grandchild.uri, grandchildNode],
    [otherReply.uri, otherReplyNode],
    [directOtherReply.uri, directOtherReplyNode],
  ]);
  const headers = { 'access-control-allow-origin': '*' };

  await page.route('**/xrpc/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/xrpc/', '');
    if (endpoint === 'app.bsky.feed.getFeedGenerator') {
      expect(url.searchParams.get('feed')).toBe(AT_FEED_URI);
      await route.fulfill({ headers, json: { view: feed, isOnline: true } });
      return;
    }
    if (endpoint === 'app.bsky.feed.getFeed') {
      expect(url.searchParams.get('feed')).toBe(AT_FEED_URI);
      await route.fulfill({ headers, json: { feed: [{ post: middle }] } });
      return;
    }
    if (endpoint === 'app.bsky.feed.getPosts') {
      const uris = url.searchParams.getAll('uris');
      const selectedPosts = uris.length
        ? posts.filter(({ uri }) => uris.includes(uri))
        : posts;
      await route.fulfill({ headers, json: { posts: selectedPosts } });
      return;
    }
    if (endpoint === 'app.bsky.feed.getPostThread') {
      const uri = url.searchParams.get('uri') || '';
      const thread = threadByURI.get(uri)?.();
      if (!thread) {
        throw new Error(`Unexpected thread URI in test fixture: ${uri}`);
      }
      await options.onThreadRequest?.(uri);
      await route.fulfill({ headers, json: { thread } });
      return;
    }
    if (endpoint === 'app.bsky.actor.getProfile') {
      await route.fulfill({ headers, json: profile });
      return;
    }
    if (endpoint === 'app.bsky.actor.getPreferences') {
      await route.fulfill({ headers, json: { preferences: [] } });
      return;
    }
    if (endpoint === 'app.bsky.actor.putPreferences') {
      await route.fulfill({ headers, json: {} });
      return;
    }
    if (endpoint === 'app.bsky.labeler.getServices') {
      await route.fulfill({ headers, json: { views: [] } });
      return;
    }
    throw new Error(`Unexpected XRPC endpoint in test fixture: ${endpoint}`);
  });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function routeAtprotoScrollableFeed(page) {
  const posts = Array.from({ length: 60 }, (_unused, index) =>
    makeAtprotoPost(
      `at://${AT_REPO}/app.bsky.feed.post/scroll-${String(index).padStart(2, '0')}`,
      `AT feed position post ${index}\n${Array.from(
        { length: 12 },
        (_line, lineIndex) => `feed position filler ${index}-${lineIndex}`,
      ).join('\n')}`,
    ),
  );
  posts[59].embed = {
    $type: 'app.bsky.embed.images#view',
    images: [
      {
        thumb: AT_PROFILE_AVATAR,
        fullsize: AT_PROFILE_AVATAR,
        alt: 'AT feed position image',
        aspectRatio: { width: 1, height: 1 },
      },
    ],
  };
  const profile = {
    $type: 'app.bsky.actor.defs#profileView',
    did: AT_REPO,
    handle: 'alice.test',
    displayName: 'Alice Profile',
    description: '',
    followersCount: 1,
    followsCount: 2,
    postsCount: posts.length,
    labels: [],
    viewer: {},
  };
  const feed = {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: SCROLL_AT_FEED_URI,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    did: AT_REPO,
    displayName: 'AT Feed',
    description: '',
    creator: profile,
    indexedAt: '2024-01-01T12:00:00.000Z',
    likeCount: 0,
    viewer: {},
  };
  const headers = { 'access-control-allow-origin': '*' };

  await page.route('**/xrpc/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/xrpc/', '');
    if (endpoint === 'app.bsky.feed.getFeedGenerator') {
      expect(url.searchParams.get('feed')).toBe(SCROLL_AT_FEED_URI);
      await route.fulfill({
        headers,
        json: { view: feed, isOnline: true, isValid: true },
      });
      return;
    }
    if (endpoint === 'app.bsky.feed.getFeed') {
      expect(url.searchParams.get('feed')).toBe(SCROLL_AT_FEED_URI);
      await route.fulfill({
        headers,
        json: { feed: posts.map((post) => ({ post })) },
      });
      return;
    }
    if (endpoint === 'app.bsky.feed.getPosts') {
      const uris = url.searchParams.getAll('uris');
      await route.fulfill({
        headers,
        json: {
          posts: uris.length
            ? posts.filter(({ uri }) => uris.includes(uri))
            : posts,
        },
      });
      return;
    }
    if (endpoint === 'app.bsky.feed.getPostThread') {
      const uri = url.searchParams.get('uri') || '';
      const post = posts.find((item) => item.uri === uri);
      if (!post) {
        throw new Error(`Unexpected thread URI in test fixture: ${uri}`);
      }
      await route.fulfill({
        headers,
        json: {
          thread: {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post,
            replies: [],
          },
        },
      });
      return;
    }
    if (endpoint === 'app.bsky.actor.getProfile') {
      await route.fulfill({ headers, json: profile });
      return;
    }
    if (endpoint === 'app.bsky.actor.getPreferences') {
      await route.fulfill({ headers, json: { preferences: [] } });
      return;
    }
    if (endpoint === 'app.bsky.actor.putPreferences') {
      await route.fulfill({ headers, json: {} });
      return;
    }
    if (endpoint === 'app.bsky.labeler.getServices') {
      await route.fulfill({ headers, json: { views: [] } });
      return;
    }
    if (endpoint === 'app.bsky.feed.getTimeline') {
      await route.fulfill({
        headers,
        json: { feed: posts.map((post) => ({ post })) },
      });
      return;
    }
    throw new Error(`Unexpected XRPC endpoint in test fixture: ${endpoint}`);
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   blackskyOmitBanner?: boolean;
 *   blackskyOmitPresentation?: boolean;
 *   blueskyOmitPresentation?: boolean;
 *   fallbackFails?: boolean;
 *   labelerViews?: unknown[];
 *   onBlueskyProfile?: () => void;
 *   profileFailures?: string[];
 *   preferences?: unknown[];
 *   profilesByDid?: Record<string, AtprotoTestActor>;
 *   searchActorsByQuery?: Record<string, AtprotoTestActor[]>;
 *   searchActorTypeaheadByQuery?: Record<string, AtprotoTestActor[]>;
 *   searchPostsByQuery?: Record<string, AtprotoTestPost[]>;
 * }} [options]
 */
async function routeAtprotoRecords(page, options = {}) {
  const {
    blackskyOmitBanner = false,
    blackskyOmitPresentation = false,
    blueskyOmitPresentation = false,
    fallbackFails = false,
    labelerViews = [],
    onBlueskyProfile,
    profileFailures = [],
    preferences = [],
    profilesByDid = {},
    searchActorsByQuery = {},
    searchActorTypeaheadByQuery = {},
    searchPostsByQuery = {},
  } = options;
  const post = makeAtprotoPost();
  const listPost = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/listpost`,
    'AT list timeline post',
  );
  const feedPost = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/feedpost`,
    'AT feed timeline post',
  );
  const searchPosts = Object.values(searchPostsByQuery).flat();
  const posts = [post, listPost, feedPost, ...searchPosts];
  const profile = {
    $type: 'app.bsky.actor.defs#profileView',
    did: AT_REPO,
    handle: 'alice.test',
    displayName: 'Alice Profile',
    description: 'Profile loaded through an AT URI',
    avatar: AT_PROFILE_AVATAR,
    banner: AT_PROFILE_BANNER,
    followersCount: 1,
    followsCount: 2,
    postsCount: 3,
    labels: [],
    viewer: {},
  };
  const list = {
    $type: 'app.bsky.graph.defs#listView',
    uri: AT_LIST_URI,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    creator: profile,
    name: 'AT List',
    description: '',
    purpose: 'app.bsky.graph.defs#curatelist',
    indexedAt: '2024-01-01T12:00:00.000Z',
    listItemCount: 1,
    viewer: {},
  };
  const feed = {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: AT_FEED_URI,
    cid: 'bafyreihltdmuzgj3iaoj5woin7jn3yfhftewnsijzf4b5gqsuxorrhw4qi',
    did: AT_REPO,
    displayName: 'AT Feed',
    description: '',
    creator: profile,
    indexedAt: '2024-01-01T12:00:00.000Z',
    likeCount: 0,
    viewer: {},
  };
  const headers = { 'access-control-allow-origin': '*' };

  await page.route(
    '**/xrpc/**',
    async (/** @type {import('@playwright/test').Route} */ route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace('/xrpc/', '');
      if (endpoint === 'app.bsky.actor.getProfile') {
        const isBlacksky = url.hostname === 'api.blacksky.community';
        const actor = url.searchParams.get('actor') || '';
        if (!isBlacksky) onBlueskyProfile?.();
        if (
          !isBlacksky &&
          (fallbackFails || profileFailures.includes(actor))
        ) {
          await route.fulfill({
            headers,
            status: 500,
            json: { error: 'FallbackUnavailable' },
          });
          return;
        }
        const omitPresentation = isBlacksky
          ? blackskyOmitPresentation
          : blueskyOmitPresentation;
        await route.fulfill({
          headers,
          json: profilesByDid[actor]
            ? profilesByDid[actor]
            : omitPresentation
            ? {
                ...profile,
                displayName: undefined,
                description: undefined,
                avatar: undefined,
                banner: undefined,
              }
            : {
                ...profile,
                banner:
                  isBlacksky && blackskyOmitBanner ? undefined : profile.banner,
              },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getAuthorFeed') {
        await route.fulfill({
          headers,
          json: { feed: [{ post }] },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getPosts') {
        const uris = url.searchParams.getAll('uris');
        const selectedPosts = uris.length
          ? posts.filter(({ uri }) => uris.includes(uri))
          : posts;
        await route.fulfill({
          headers,
          json: { posts: selectedPosts },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getPostThread') {
        const requestedPost =
          posts.find(({ uri }) => uri === url.searchParams.get('uri')) || post;
        await route.fulfill({
          headers,
          json: {
            thread: {
              $type: 'app.bsky.feed.defs#threadViewPost',
              post: requestedPost,
              replies: [],
            },
          },
        });
        return;
      }
      if (endpoint === 'app.bsky.graph.getList') {
        expect(url.searchParams.get('list')).toBe(AT_LIST_URI);
        await route.fulfill({
          headers,
          json: {
            list,
            items: [
              {
                $type: 'app.bsky.graph.defs#listItemView',
                uri: `at://${AT_REPO}/app.bsky.graph.listitem/item1`,
                subject: profile,
              },
            ],
          },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getListFeed') {
        expect(url.searchParams.get('list')).toBe(AT_LIST_URI);
        await route.fulfill({
          headers,
          json: { feed: [{ post: listPost }] },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getFeedGenerator') {
        expect(url.searchParams.get('feed')).toBe(AT_FEED_URI);
        await route.fulfill({
          headers,
          json: { view: feed, isOnline: true, isValid: true },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.getFeed') {
        expect(url.searchParams.get('feed')).toBe(AT_FEED_URI);
        await route.fulfill({
          headers,
          json: { feed: [{ post: feedPost }] },
        });
        return;
      }
      if (endpoint === 'app.bsky.feed.searchPosts') {
        const query = url.searchParams.get('q') || '';
        await route.fulfill({
          headers,
          json: { posts: searchPostsByQuery[query] || [] },
        });
        return;
      }
      if (endpoint === 'app.bsky.actor.searchActors') {
        const query = url.searchParams.get('q') || '';
        await route.fulfill({
          headers,
          json: { actors: searchActorsByQuery[query] || [] },
        });
        return;
      }
      if (endpoint === 'app.bsky.actor.searchActorsTypeahead') {
        const query = url.searchParams.get('q') || '';
        await route.fulfill({
          headers,
          json: { actors: searchActorTypeaheadByQuery[query] || [] },
        });
        return;
      }
      if (endpoint === 'app.bsky.actor.getPreferences') {
        await route.fulfill({ headers, json: { preferences } });
        return;
      }
      if (endpoint === 'app.bsky.actor.putPreferences') {
        await route.fulfill({ headers, json: {} });
        return;
      }
      if (endpoint === 'app.bsky.labeler.getServices') {
        await route.fulfill({ headers, json: { views: labelerViews } });
        return;
      }
      await route.fulfill({ headers, json: {} });
    },
  );
}

test('canonicalizes legacy AT record routes on direct load', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await routeAtprotoRecords(page);

  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  await page.goto(`/bsky.social/s/${encodeURIComponent(AT_POST_URI)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_POST_PATH));
  await expect(page.locator('text=AT route post')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(pathRegex('/search'));

  await page.goto(`/bsky.social/s/${encodeURIComponent(AT_POST_URI)}#reply`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(`${AT_POST_PATH}#reply`));

  await page.goto(`/bsky.social/s/${encodeURIComponent(AT_POST_URI)}?q=1`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(`${AT_POST_PATH}?q=1`));

  await page.goto(`/bsky.social/a/${AT_REPO}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_PROFILE_PATH));
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();

  await page.goto(`/a/${AT_REPO}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(pathRegex(AT_PROFILE_PATH));
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();

  await page.goto(`/l/${encodeURIComponent(AT_LIST_URI)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_LIST_PATH));
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();

  await page.goto(`/bsky.social/l/${encodeURIComponent(AT_LIST_URI)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_LIST_PATH));
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();

  await page.goto(`/bsky.social/l/${encodeURIComponent(AT_LIST_URI)}?q=1`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(`${AT_LIST_PATH}?q=1`));

  await page.goto(`/l/${encodeURIComponent(AT_FEED_URI)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_FEED_PATH));
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
});

test('canonicalizes Worker-decoded legacy AT record routes', async ({ page }) => {
  await routeAtprotoRecords(page);

  await page.goto(`/bsky.social/s/at%3A/${AT_REPO}/app.bsky.feed.post/post123`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_POST_PATH));
  await expect(page.locator('text=AT route post')).toBeVisible();

  await page.goto(`/l/at%3A/${AT_REPO}/app.bsky.graph.list/abc123`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex(AT_LIST_PATH));
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();
});

test('loads and reloads canonical AT profile URLs', async ({ page }) => {
  const noRouteWarnings = collectNoRouteWarnings(page);
  await routeAtprotoRecords(page);

  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();

  await page.goto(AT_PROFILE_PATH);
  await expect(page).toHaveURL(pathRegex(AT_PROFILE_PATH));
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page).toHaveTitle(/Alice Profile/);

  await page.reload();
  await expect(page).toHaveURL(pathRegex(AT_PROFILE_PATH));
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Alice Profile/);
  expect(noRouteWarnings).toEqual([]);
});

test('returns to a logged-out AT profile after opening one of its posts', async ({
  page,
}) => {
  await routeAtprotoRecords(page);

  await page.goto(AT_PROFILE_PATH);
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();

  await page.locator(`.status-link-native[href="${AT_POST_PATH}"]`).click();
  await expect(page).toHaveURL(pathRegex(AT_POST_PATH));
  await expect(
    page.locator('.status-deck article', { hasText: 'AT route post' }),
  ).toBeVisible();
  await expect(page.locator('.deck-close')).toHaveAttribute(
    'href',
    AT_PROFILE_PATH,
  );

  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(AT_PROFILE_PATH));
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
});

test('backfills canonical AT profile media when Blacksky omits it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings-appview', 'blacksky');
  });
  await routeAtprotoRecords(page, { blackskyOmitPresentation: true });

  await page.goto(AT_PROFILE_PATH);

  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(
    page.locator('.account-container .avatar img').first(),
  ).toHaveAttribute('src', AT_PROFILE_AVATAR);
  await expect(
    page.locator('.account-container .header-banner'),
  ).toHaveAttribute('src', AT_PROFILE_BANNER);
});

test('keeps missing profile media local on the Bluesky AppView', async ({
  page,
}) => {
  let blueskyProfileRequests = 0;
  await routeAtprotoRecords(page, {
    blueskyOmitPresentation: true,
    onBlueskyProfile: () => {
      blueskyProfileRequests += 1;
    },
  });

  await page.goto(AT_PROFILE_PATH);

  await expect(
    page.getByRole('heading', { name: /alice\.test/ }),
  ).toBeVisible();
  expect(blueskyProfileRequests).toBe(1);
});

test('keeps Blacksky profile data when the media fallback fails', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings-appview', 'blacksky');
  });
  let blueskyProfileRequests = 0;
  await routeAtprotoRecords(page, {
    blackskyOmitPresentation: true,
    fallbackFails: true,
    onBlueskyProfile: () => {
      blueskyProfileRequests += 1;
    },
  });

  await page.goto(AT_PROFILE_PATH);

  await expect(
    page.getByRole('heading', { name: /alice\.test/ }),
  ).toBeVisible();
  expect(blueskyProfileRequests).toBe(1);
});

test('does not fetch Bluesky media for Blacksky profiles that only lack a banner', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings-appview', 'blacksky');
  });
  let blueskyProfileRequests = 0;
  await routeAtprotoRecords(page, {
    blackskyOmitBanner: true,
    onBlueskyProfile: () => {
      blueskyProfileRequests += 1;
    },
  });

  await page.goto(AT_PROFILE_PATH);

  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(
    page.locator('.account-container .avatar img').first(),
  ).toHaveAttribute('src', AT_PROFILE_AVATAR);
  expect(blueskyProfileRequests).toBe(0);
});

test('degrades legacy Mastodon account routes to welcome (ATProto-only)', async ({
  page,
}) => {
  let mastodonRequested = false;
  await page.route('**/api/v1/accounts/**', async (route) => {
    mastodonRequested = true;
    await route.fulfill({ json: {} });
  });

  await page.goto('/mastodon.social/a/12345', {
    waitUntil: 'domcontentloaded',
  });
  // The route is preserved, but with no Mastodon runtime it degrades to the
  // welcome/login screen instead of fetching the legacy account.
  await expect(page).toHaveURL(pathRegex('/mastodon.social/a/12345'));
  await expect(page.locator('#welcome')).toBeVisible();
  expect(mastodonRequested).toBe(false);
});

test('loads and reloads canonical AT list and feed URLs', async ({ page }) => {
  await routeAtprotoRecords(page);

  await page.goto(AT_LIST_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('text=AT list timeline post')).toBeVisible();
  await expect(page).toHaveTitle(/AT List/);
  await page.reload();
  await expect(page).toHaveURL(pathRegex(AT_LIST_PATH));
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();
  await expect(page.locator('.status-link-native').first()).toHaveAttribute(
    'href',
    new RegExp(`/at://${AT_REPO}/app\\.bsky\\.feed\\.post/listpost$`),
  );
  await page.locator('.status-link-native').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/listpost`),
  );
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();
  await expect(page.getByText('AT list timeline post').first()).toBeVisible();
  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(AT_LIST_PATH));
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();

  await page.goto(AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('text=AT feed timeline post')).toBeVisible();
  await expect(page).toHaveTitle(/AT Feed/);
  await page.reload();
  await expect(page).toHaveURL(pathRegex(AT_FEED_PATH));
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
});

test('keeps logged-in native AT list and profile routes off the home deck', async ({
  page,
}) => {
  await seedAtprotoLogin(page);
  await routeAtprotoRecords(page);

  await page.goto(AT_LIST_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT List' })).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);

  await page.goto(AT_PROFILE_PATH, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: /Alice Profile/ }),
  ).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#account-statuses-page')).toHaveCount(1);
});

test('keeps AT thread links navigable from a feed-backed post detail', async ({
  page,
}) => {
  await routeAtprotoThreadNavigation(page);

  await page.goto(AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Thread middle post')).toBeVisible();
  await page
    .locator(`.status-link-native[href$="/app.bsky.feed.post/thread-middle"]`)
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-middle`),
  );

  await page
    .locator(
      `.status-link[data-href$="/app.bsky.feed.post/thread-direct-other-reply"]`,
    )
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-direct-other-reply`),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-middle`),
  );

  await page
    .locator(`.status-link[data-href$="/app.bsky.feed.post/thread-other-reply"]`)
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-other-reply`),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-middle`),
  );

  await page
    .locator(`.status-link[data-href$="/app.bsky.feed.post/thread-child"]`)
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-child`),
  );

  await page
    .locator(`.status-link[data-href$="/app.bsky.feed.post/thread-grandchild"]`)
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-grandchild`),
  );
  await expect(page.getByText('Thread middle post').first()).toBeVisible();
  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(AT_FEED_PATH));
});

test('renders a feed-backed post detail before the full thread returns', async ({
  page,
}) => {
  /** @type {((uri: string) => void) | undefined} */
  let resolveThreadStarted;
  /** @type {(() => void) | undefined} */
  let releaseThread;
  /** @type {Promise<string>} */
  const threadStarted = new Promise((resolve) => {
    resolveThreadStarted = resolve;
  });
  const threadRelease = new Promise((resolve) => {
    releaseThread = () => {
      resolve(undefined);
    };
  });

  await routeAtprotoThreadNavigation(page, {
    onThreadRequest: async (uri) => {
      resolveThreadStarted?.(uri);
      await threadRelease;
    },
  });

  await page.goto(AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Thread middle post')).toBeVisible();
  await page
    .locator(`.status-link-native[href$="/app.bsky.feed.post/thread-middle"]`)
    .first()
    .click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/thread-middle`),
  );
  await expect(threadStarted).resolves.toBe(
    `at://${AT_REPO}/app.bsky.feed.post/thread-middle`,
  );
  await expect(
    page.locator('.status-deck li.hero').getByText('Thread middle post'),
  ).toBeVisible();
  releaseThread?.();
  await expect(
    page.locator('.status-link[data-href$="/app.bsky.feed.post/thread-child"]'),
  ).toBeVisible();
});

test('keeps mobile search controls at the bottom and resets post results scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAtprotoLogin(page);
  const alphaFirst = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/search-alpha-1`,
    'Alpha first search result',
  );
  const alphaSecond = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/search-alpha-2`,
    'Alpha second search result',
  );
  const betaFirst = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/search-beta-1`,
    'Beta first search result',
  );
  const betaSecond = makeAtprotoPost(
    `at://${AT_REPO}/app.bsky.feed.post/search-beta-2`,
    'Beta second search result',
  );
  await routeAtprotoRecords(page, {
    searchPostsByQuery: {
      alpha: [alphaFirst, alphaSecond],
      beta: [betaFirst, betaSecond],
    },
  });

  await page.goto('/search?q=alpha&type=statuses', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByText('Alpha first search result')).toBeVisible();
  await expect(page.locator('#compose-button')).toBeHidden();

  const controlsGeometry = await page.evaluate(() => {
    const input = document.querySelector('#search-page input[type="search"]');
    const filter = document.querySelector('.search-filter-bar');
    const inputBox = input?.getBoundingClientRect();
    const filterBox = filter?.getBoundingClientRect();
    const filterStyle = filter ? getComputedStyle(filter) : undefined;
    return {
      filterBottom: filterBox?.bottom ?? 0,
      inputTop: inputBox?.top ?? 0,
      viewportHeight: window.innerHeight,
      filterPosition: filterStyle?.position,
      filterBackground: filterStyle?.backgroundColor,
      filterRadius: filterStyle?.borderRadius,
    };
  });
  expect(controlsGeometry.filterPosition).toBe('fixed');
  expect(controlsGeometry.filterBackground).not.toBe('rgb(220, 226, 234)');
  expect(Number.parseFloat(controlsGeometry.filterRadius || '0')).toBeGreaterThan(
    20,
  );
  await expect
    .poll(() =>
      page
        .locator('.search-filter-bar a')
        .evaluateAll((links) =>
          links.map((link) => link.textContent?.trim() || ''),
        ),
    )
    .toEqual(['All', 'Accounts', 'Hashtags', 'Posts']);
  expect(controlsGeometry.filterBottom).toBeLessThanOrEqual(
    controlsGeometry.inputTop,
  );
  expect(controlsGeometry.filterBottom).toBeGreaterThan(
    controlsGeometry.viewportHeight - 180,
  );
  await expect
    .poll(() =>
      page
        .locator('#search-posts-page > .timeline-deck > header')
        .evaluate((element) => getComputedStyle(element).position),
    )
    .not.toBe('fixed');

  await page.locator('#search-posts-page').evaluate((element) => {
    element.scrollTop = 160;
  });
  const scrolledControlsGeometry = await page.evaluate(() => {
    const input = document.querySelector('#search-page input[type="search"]');
    const filter = document.querySelector('.search-filter-bar');
    const inputBox = input?.getBoundingClientRect();
    const filterBox = filter?.getBoundingClientRect();
    return {
      filterBottom: filterBox?.bottom ?? 0,
      inputTop: inputBox?.top ?? 0,
    };
  });
  expect(scrolledControlsGeometry).toEqual({
    filterBottom: controlsGeometry.filterBottom,
    inputTop: controlsGeometry.inputTop,
  });
  await page.locator('#search-page').evaluate((element) => {
    element.scrollTop = 160;
  });
  const outerScrolledControlsGeometry = await page.evaluate(() => {
    const input = document.querySelector('#search-page input[type="search"]');
    const filter = document.querySelector('.search-filter-bar');
    const inputBox = input?.getBoundingClientRect();
    const filterBox = filter?.getBoundingClientRect();
    return {
      filterBottom: filterBox?.bottom ?? 0,
      inputTop: inputBox?.top ?? 0,
    };
  });
  expect(outerScrolledControlsGeometry).toEqual({
    filterBottom: controlsGeometry.filterBottom,
    inputTop: controlsGeometry.inputTop,
  });

  await page.locator('#search-posts-page').evaluate((element) => {
    element.scrollTop = 320;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.locator('#search-page input[type="search"]').fill('beta');
  await page.locator('#search-page header form').evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });

  await expect(page).toHaveURL(/\/search\?q=beta&type=statuses/);
  await expect(page.getByText('Beta first search result')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('#search-posts-page')
        .evaluate((element) => element.scrollTop),
    )
    .toBeLessThan(8);
});

test('keeps the leading account search match visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAtprotoLogin(page, {
    accessToken: JSON.stringify({
      type: 'atproto',
      service: 'https://bsky.social',
      session: {
        refreshJwt: 'test-refresh',
        accessJwt: 'test-access',
        handle: 'alice.test',
        did: AT_REPO,
        active: true,
      },
    }),
  });
  const warningLabelerDid = 'did:plc:dm6tjhimvcxsgh2yxbppbqkx';
  const exactActor = {
    ...makeAtprotoTestActor(
      'did:plc:samuelexact',
      'samuel.fm',
      'Samuel',
    ),
    labels: [
      {
        src: warningLabelerDid,
        uri: 'did:plc:samuelexact',
        val: 'folklore',
        cts: '2024-11-08T20:16:43.383Z',
      },
    ],
  };
  const fallbackActor = makeAtprotoTestActor(
    'did:plc:samuelfallback',
    'samueloakford.bsky.social',
    'Samuel Oakford',
  );
  await routeAtprotoRecords(page, {
    labelerViews: [
      {
        $type: 'app.bsky.labeler.defs#labelerViewDetailed',
        uri: `at://${warningLabelerDid}/app.bsky.labeler.service/self`,
        cid: 'bafyreididididididididididididididididididididididididid',
        creator: {
          did: warningLabelerDid,
          handle: 'labels.example.com',
          displayName: 'Example Labeler',
          labels: [],
          viewer: {},
        },
        policies: {
          labelValues: ['folklore'],
          labelValueDefinitions: [
            {
              identifier: 'folklore',
              severity: 'alert',
              blurs: 'none',
              defaultSetting: 'warn',
              locales: [
                {
                  lang: 'en',
                  name: 'Folklore',
                  description: 'Folklore label used by the regression fixture.',
                },
              ],
            },
          ],
        },
        indexedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    preferences: [
      {
        $type: 'app.bsky.actor.defs#labelersPref',
        labelers: [{ did: warningLabelerDid }],
      },
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'folklore',
        labelerDid: warningLabelerDid,
        visibility: 'warn',
      },
    ],
    searchActorsByQuery: {
      samuel: [exactActor, fallbackActor],
    },
    searchActorTypeaheadByQuery: {
      samuel: [exactActor],
    },
  });

  await page.goto('/search?q=samuel&type=accounts', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('@samuel.fm')).toBeVisible();
  await expect(page.getByText('@samueloakford.bsky.social')).toBeVisible();
  const firstAccount = page.locator('.accounts-list .account-block').first();
  await expect(firstAccount).toContainText('Samuel');
  await expect(firstAccount).toContainText('@samuel.fm');
  await page.waitForTimeout(1000);
  await expect(firstAccount).toContainText('@samuel.fm');
  await expect
    .poll(() =>
      page
        .locator('.search-filter-bar a')
        .evaluateAll((links) =>
          links.map((link) => link.textContent?.trim() || ''),
        ),
    )
    .toEqual(['All', 'Accounts', 'Hashtags', 'Posts']);
});

test('restores AT feed position after opening a feed post in the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await routeAtprotoScrollableFeed(page);

  await page.goto(SCROLL_AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  const feedDeck = page.locator('#list-page');
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const savedScrollTop = await feedDeck.evaluate((element) => element.scrollTop);

  await page.getByText('AT feed position post 59').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/scroll-59`),
  );
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(SCROLL_AT_FEED_PATH));
  await expect(page.locator('#list-page')).toHaveCount(1);
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#list-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThanOrEqual(savedScrollTop - 24);
});

test('restores AT feed position after opening an image from the feed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await routeAtprotoScrollableFeed(page);

  await page.goto(SCROLL_AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  const feedDeck = page.locator('#list-page');
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const savedScrollTop = await feedDeck.evaluate((element) => element.scrollTop);

  await page
    .locator(`a.media[href*="/app.bsky.feed.post/scroll-59"]`)
    .first()
    .click();
  await expect(page).toHaveURL(/media-only=1/);
  await page.locator('.carousel-top-controls button').first().click();
  await expect(page).toHaveURL(pathRegex(SCROLL_AT_FEED_PATH));
  await expect(page.locator('#list-page')).toHaveCount(1);
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#list-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThanOrEqual(savedScrollTop - 24);
});

test('keeps a logged-in AT feed as the post sidebar background', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedAtprotoLogin(page);
  await routeAtprotoScrollableFeed(page);

  await page.goto(SCROLL_AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  const feedDeck = page.locator('#list-page');
  await expect(feedDeck).toHaveCount(1);
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const scrollBefore = await feedDeck.evaluate((element) => element.scrollTop);

  await page.getByText('AT feed position post 59').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/scroll-59`),
  );
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);
  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(SCROLL_AT_FEED_PATH));
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#list-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(scrollBefore - 4);
});

test('keeps a logged-in legacy custom feed route off the home deck', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedAtprotoLogin(page);
  await routeAtprotoScrollableFeed(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((path) => {
    history.pushState(history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, SCROLL_LOCAL_FEED_PATH);

  await expect(page).toHaveURL(pathRegex(SCROLL_LOCAL_FEED_PATH));
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  const feedDeck = page.locator('#list-page');
  await expect(feedDeck).toHaveCount(1);
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const scrollBefore = await feedDeck.evaluate((element) => element.scrollTop);

  await page.getByText('AT feed position post 59').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/scroll-59`),
  );
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);

  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(SCROLL_AT_FEED_PATH));
  await expect(page.locator('.status-deck')).toHaveCount(0);
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#list-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(scrollBefore - 4);
});

test('restores logged-in custom feed position on narrow post navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await seedAtprotoLogin(page);
  await routeAtprotoScrollableFeed(page);

  await page.goto(SCROLL_AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  const feedDeck = page.locator('#list-page');
  await expect(feedDeck).toHaveCount(1);
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const scrollBefore = await feedDeck.evaluate((element) => element.scrollTop);

  await page.getByText('AT feed position post 59').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/scroll-59`),
  );
  await expect(page.locator('#list-page')).toHaveCount(1);

  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex(SCROLL_AT_FEED_PATH));
  await expect(page.locator('.status-deck')).toHaveCount(0);
  await expect(page.locator('#list-page')).toHaveCount(1);
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#list-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(scrollBefore - 4);
});

test('restores logged-in selected home feed position after opening a feed post', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedAtprotoLogin(page, {
    homeTimeline: {
      type: 'feed',
      id: encodeURIComponent(SCROLL_AT_FEED_URI),
    },
  });
  await routeAtprotoScrollableFeed(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  const feedDeck = page.locator('#home-page');
  await expect(feedDeck).toHaveCount(1);
  await feedDeck.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByText('AT feed position post 59')).toBeVisible();
  const scrollBefore = await feedDeck.evaluate((element) => element.scrollTop);

  await page.getByText('AT feed position post 59').first().click();
  await expect(page).toHaveURL(
    pathRegex(`/at://${AT_REPO}/app.bsky.feed.post/scroll-59`),
  );
  await expect(page.locator('#home-page')).toHaveCount(1);

  await page.locator('.deck-close').click();
  await expect(page).toHaveURL(pathRegex('/'));
  await expect(page.locator('.status-deck')).toHaveCount(0);
  await expect(page.locator('#home-page')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  await expect(
    page.getByText('AT feed position post 59').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator('#home-page').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(scrollBefore - 4);
});

test('keeps app-local routes outside the AT URI schema', async ({ page }) => {
  test.setTimeout(75_000);
  await page.route('**/xrpc/**', async (route) => {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {},
    });
  });
  const appLocalPaths = [
    '/',
    '/search',
    '/bsky.social/search',
    '/bsky.social/trending',
    '/bsky.social/a/12345',
    '/t/bluepy',
    '/notifications',
    '/mentions',
    '/following',
    '/b',
    '/f',
    '/catchup',
    '/yip',
  ];

  /**
   * @param {string[]} paths
   */
  async function assertAppLocalPaths(paths) {
    const [path, ...rest] = paths;
    if (!path) return;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/at:\/\//);
    await assertAppLocalPaths(rest);
  }

  await assertAppLocalPaths(appLocalPaths);
});
