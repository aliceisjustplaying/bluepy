// @ts-check
import { expect, test } from '@playwright/test';

/**
 * @typedef {{ did: string; handle: string; displayName: string }} AtprotoTestActor
 * @typedef {{
 *   uri: string;
 *   cid: string;
 *   author: AtprotoTestActor;
 *   record: {
 *     $type: 'app.bsky.feed.post';
 *     text: string;
 *     createdAt: string;
 *     reply?: {
 *       root: { uri: string; cid: string };
 *       parent: { uri: string; cid: string };
 *     };
 *   };
 *   indexedAt: string;
 *   replyCount: number;
 *   repostCount: number;
 *   likeCount: number;
 *   quoteCount: number;
 *   labels: unknown[];
 *   viewer: Record<string, unknown>;
 * }} AtprotoTestPost
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

test('status carousel controls stay above the native link overlay', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    // Synthetic fixture for the shared app.css stacking rule used by carousel cards.
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <div class="status-carousel-link" style="position:relative;width:160px;height:80px">
        <a class="status-link-native" href="/s/native-link"></a>
        <button id="carousel-child-button" type="button">Child control</button>
      </div>
      <output id="carousel-child-result">idle</output>
    `;
    document.body.append(fixture);
    document
      .querySelector('#carousel-child-button')
      ?.addEventListener('click', () => {
        const result = document.querySelector('#carousel-child-result');
        if (result) result.textContent = 'clicked';
      });
  });

  await page.locator('#carousel-child-button').click();
  await expect(page.locator('#carousel-child-result')).toHaveText('clicked');
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

test('loads post page and works', async ({ page }) => {
  await page.route('**/api/v1/statuses/123', async (route) => {
    await route.fulfill({
      json: {
        id: '123',
        created_at: '2024-01-01T12:00:00.000Z',
        account: {
          id: '1',
          username: 'testuser',
          display_name: 'Test User',
          acct: 'testuser@test.social',
        },
        content: '<p>This is a test post</p>',
      },
    });
  });

  await page.route('**/api/v1/statuses/123/context', async (route) => {
    await route.fulfill({
      json: {
        ancestors: [],
        descendants: [],
      },
    });
  });

  await page.goto('/test.social/s/123');
  await expect(page.locator('text=This is a test post')).toBeVisible();
});

test('uses cache-busting reloads when the app script never mounts', async ({
  page,
}) => {
  test.setTimeout(45_000);
  let appScriptRequests = 0;
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    appScriptRequests++;
    await route.fulfill({
      contentType: 'application/javascript',
      body: '// Simulate Safari restoring the boot document without app mount.',
    });
  });

  await page.goto('/');

  await expect.poll(() => appScriptRequests, { timeout: 25_000 }).toBe(4);
  await expect(page.locator('#boot-status')).toContainText(
    'Safari did not run the app script',
    { timeout: 7_000 },
  );
  await expect.poll(() => page.evaluate(getBootReloadAttempts)).toBe(3);
  expect(new URL(page.url()).searchParams.has('__bluepy_boot_retry')).toBe(
    true,
  );
  await page.waitForTimeout(6000);
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
  await page.waitForTimeout(6000);
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
  await page.route('**/api/v1/statuses/123', async (route) => {
    await route.fulfill({
      json: {
        id: '123',
        created_at: '2024-01-01T12:00:00.000Z',
        account: {
          id: '1',
          username: 'testuser',
          display_name: 'Test User',
          acct: 'testuser@test.social',
        },
        content: '<p>Legacy hash post</p>',
      },
    });
  });

  await page.route('**/api/v1/statuses/123/context', async (route) => {
    await route.fulfill({ json: { ancestors: [], descendants: [] } });
  });

  await page.goto('/#/test.social/s/123');
  await expect(page).toHaveURL(/\/test\.social\/s\/123$/);
  await expect(page.locator('text=Legacy hash post')).toBeVisible();
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
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   blackskyOmitBanner?: boolean;
 *   blackskyOmitPresentation?: boolean;
 *   blueskyOmitPresentation?: boolean;
 *   fallbackFails?: boolean;
 *   onBlueskyProfile?: () => void;
 * }} [options]
 */
async function routeAtprotoRecords(page, options = {}) {
  const {
    blackskyOmitBanner = false,
    blackskyOmitPresentation = false,
    blueskyOmitPresentation = false,
    fallbackFails = false,
    onBlueskyProfile,
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
  const posts = [post, listPost, feedPost];
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
        if (!isBlacksky) onBlueskyProfile?.();
        if (!isBlacksky && fallbackFails) {
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
          json: omitPresentation
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
        await route.fulfill({ headers, json: { posts: [] } });
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
  await expect(page.locator('text=AT route post')).toBeVisible();
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

test('keeps titles working on legacy account routes', async ({ page }) => {
  const account = {
    id: '12345',
    username: 'legacyuser',
    acct: 'legacyuser@mastodon.social',
    display_name: 'Legacy Account',
    avatar: '',
    avatar_static: '',
    header: '',
    header_static: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    emojis: [],
  };
  await page.route('**/api/v1/accounts/12345', async (route) => {
    await route.fulfill({ json: account });
  });
  await page.route('**/api/v1/accounts/12345/statuses*', async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/mastodon.social/a/12345', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(pathRegex('/mastodon.social/a/12345'));
  await expect(page).toHaveTitle(/Legacy Account/);
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
  await expect(page.locator('text=AT list timeline post')).toBeVisible();

  await page.goto(AT_FEED_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('text=AT feed timeline post')).toBeVisible();
  await expect(page).toHaveTitle(/AT Feed/);
  await page.reload();
  await expect(page).toHaveURL(pathRegex(AT_FEED_PATH));
  await expect(page.getByRole('heading', { name: 'AT Feed' })).toBeVisible();
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
