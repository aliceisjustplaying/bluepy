import { execSync } from 'child_process';
import fs from 'fs';
import { resolve } from 'path';

import { lingui } from '@lingui/vite-plugin';
import babel from '@rolldown/plugin-babel';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import Sonda from 'sonda/vite';
import { uid } from 'uid/single';
import { createLogger, defineConfig, loadEnv } from 'vite';
import generateFile from 'vite-plugin-generate-file';
import htmlPlugin from 'vite-plugin-html-config';
import { VitePWA } from 'vite-plugin-pwa';
import removeConsole from 'vite-plugin-remove-console';
import { run } from 'vite-plugin-run';

import { ALL_LOCALES } from './src/locales';

const allowedEnvPrefixes = ['VITE_', 'PHANPY_'];
const { NODE_ENV } = process.env;
const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = loadEnv(
  'production',
  process.cwd(),
  ['SENTRY_'],
);
const { ROLLBAR_ENABLED } = loadEnv('production', process.cwd(), ['ROLLBAR_']);
const {
  PHANPY_WEBSITE: WEBSITE,
  PHANPY_CLIENT_NAME: CLIENT_NAME,
  PHANPY_APP_ERROR_LOGGING: ERROR_LOGGING,
  PHANPY_REFERRER_POLICY: REFERRER_POLICY,
  PHANPY_DISALLOW_ROBOTS: DISALLOW_ROBOTS,
  PHANPY_DEV,
} = loadEnv('production', process.cwd(), allowedEnvPrefixes);
const hasSentrySourcemapUpload =
  !!SENTRY_AUTH_TOKEN && !!SENTRY_ORG && !!SENTRY_PROJECT;
const shouldAnalyzeBundle = process.env.ANALYZE === '1';
const shouldExtractMessages = process.env.LINGUI_EXTRACT === '1';
// Keep legacy Rollbar wiring available, but disabled until explicitly re-enabled.
const shouldInjectRollbar = ROLLBAR_ENABLED === '1' && !!ERROR_LOGGING;
const productionOrigin = (WEBSITE || 'https://bluepy.social').replace(
  /\/$/,
  '',
);
const plausibleDomain = new URL(productionOrigin).hostname;
const { PHANPY_WEBSITE: DEV_WEBSITE } = loadEnv(
  'development',
  process.cwd(),
  allowedEnvPrefixes,
);
const devOrigin = DEV_WEBSITE?.replace(/\/$/, '') || null;
const devHost = devOrigin ? new URL(devOrigin).hostname : null;
const DEV_PORT = Number(process.env.PORT || process.env.VITE_PORT) || undefined;

function devRequestOrigin(req) {
  const host = req.headers.host || '';
  if (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    return null;
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(
    ',',
  )[0];
  const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

function oauthMetadata(origin) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Bluepy',
    client_uri: `${origin}/`,
    logo_uri: `${origin}/logo-512.png`,
    policy_uri:
      'https://github.com/aliceisjustplaying/bluepy/blob/bluesky/PRIVACY.MD',
    redirect_uris: [`${origin}/`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

const now = new Date();
let commitHash;
let commitTime;
let fakeCommitHash = false;
try {
  const gitResult = execSync('git log -1 --format="%h %cI"').toString().trim();
  const [hash, time] = gitResult.split(' ');
  commitHash = hash;
  commitTime = new Date(time);
} catch {
  // If error, means git is not installed or not a git repo (could be downloaded instead of git cloned)
  // Fallback to random hash which should be different on every build run 🤞
  commitHash = uid();
  commitTime = now;
  fakeCommitHash = true;
}

let rollbarCode = '';
if (shouldInjectRollbar) {
  rollbarCode = fs.readFileSync(resolve(__dirname, './rollbar.js'), 'utf-8');
  rollbarCode = rollbarCode.replace(
    '__PHANPY_COMMIT_HASH__',
    `'${commitHash}'`,
  );
}

// https://github.com/vitejs/vite/issues/9597#issuecomment-1209305107
const excludedPostCSSWarnings = [
  ':is()', // This IS fine
  'display: box;', // Browsers are kinda late for the ellipsis support
];
const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (
    msg.includes('vite:css') &&
    excludedPostCSSWarnings.some((str) => msg.includes(str))
  ) {
    return;
  }
  originalWarn(msg, options);
};

/** @param {string} filePath */
function stripSourceMappingURL(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const next = source.replace(/\n?\/\/# sourceMappingURL=.+\.map\s*$/u, '');
  if (next !== source) {
    fs.writeFileSync(filePath, next);
  }
}

function removeUploadedSourcemaps() {
  return {
    name: 'remove-uploaded-sourcemaps',
    closeBundle() {
      const outputDir = resolve(__dirname, 'dist');
      /** @param {string} dir */
      const visit = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const filePath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            visit(filePath);
          } else if (entry.name.endsWith('.map')) {
            fs.unlinkSync(filePath);
          } else if (/\.(?:js|mjs)$/u.test(entry.name)) {
            stripSourceMappingURL(filePath);
          }
        }
      };

      if (hasSentrySourcemapUpload && fs.existsSync(outputDir)) {
        visit(outputDir);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  customLogger: logger,
  base: '/',
  envPrefix: allowedEnvPrefixes,
  appType: 'mpa',
  mode: NODE_ENV,
  define: {
    __BUILD_TIME__: JSON.stringify(now),
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __COMMIT_TIME__: JSON.stringify(commitTime),
    __FAKE_COMMIT_HASH__: fakeCommitHash,
  },
  server: {
    host: true,
    port: DEV_PORT,
    allowedHosts: devHost ? [devHost] : true,
    watch: {
      awaitWriteFinish: {
        pollInterval: 1000,
      },
      // Ignore specific folders to prevent auto-refresh
      ignored: [
        '**/src/iconify-icons/**',
        // Add folder paths here (glob patterns)
        // Example: '**/node_modules/**',
        // Example: '**/dist/**',
        // Example: '**/scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      // Bluepy only needs the core HLS playback path; the light build omits
      // optional subtitle/EME/alternate-audio controllers.
      'hls.js': 'hls.js/light',
    },
  },
  css: {
    preprocessorMaxWorkers: 1,
  },
  plugins: [
    {
      name: 'plausible-domain',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `    <script defer data-domain="${plausibleDomain}" src="https://p.mosphere.at/js/script.js"></script>\n  </head>`,
        );
      },
    },
    {
      name: 'dynamic-oauth-metadata',
      configureServer(server) {
        server.middlewares.use(
          '/oauth-client-metadata.json',
          (req, res, next) => {
            const origin = devOrigin || devRequestOrigin(req);
            if (!origin) {
              next();
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(oauthMetadata(origin)));
          },
        );
      },
    },
    {
      name: 'browser-router-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const method = req.method || 'GET';
          const url = req.url || '/';
          if (method !== 'GET' && method !== 'HEAD') {
            next();
            return;
          }
          if (!(req.headers.accept || '').includes('text/html')) {
            next();
            return;
          }
          let pathname = url;
          try {
            pathname = new URL(url, 'http://localhost').pathname;
          } catch {}
          const assetExtensionRE =
            /\.(?:avif|css|gif|html|ico|jpe?g|js|json|map|mjs|mp4|png|svg|txt|wasm|webmanifest|webp|woff2?)$/i;
          const isComposePath =
            pathname === '/compose' || pathname.startsWith('/compose/');
          if (
            url.startsWith('/@') ||
            url.startsWith('/__') ||
            url.startsWith('/assets/') ||
            isComposePath ||
            url.startsWith('/oauth-client-metadata.json') ||
            assetExtensionRE.test(pathname)
          ) {
            next();
            return;
          }
          void (async () => {
            try {
              const html = fs.readFileSync(
                resolve(__dirname, 'index.html'),
                'utf-8',
              );
              const transformed = await server.transformIndexHtml(url, html);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/html');
              res.end(transformed);
            } catch (error) {
              next(error);
            }
          })();
        });
      },
    },
    babel({
      plugins: ['@lingui/babel-plugin-lingui-macro'],
      include: /\.[jt]sx?$/,
    }),
    react(),
    lingui(),
    shouldExtractMessages &&
      run({
        silent: false,
        input: [
          {
            name: 'messages:extract:clean',
            run: ['bun', 'run', 'messages:extract:clean'],
            pattern: 'src/**/*.{js,jsx,ts,tsx}',
          },
          // {
          //   name: 'update-catalogs',
          //   run: ['node', 'scripts/catalogs.js'],
          //   pattern: 'src/locales/*.po',
          // },
        ],
      }),
    removeConsole({
      includes: ['log', 'debug', 'info', 'warn', 'error'],
    }),
    htmlPlugin({
      metas: [
        // Learn more: https://web.dev/articles/referrer-best-practices
        {
          name: 'referrer',
          content: REFERRER_POLICY || 'origin',
        },
        // Metacrap https://broken-links.com/2015/12/01/little-less-metacrap/
        ...(WEBSITE
          ? [
              {
                property: 'twitter:card',
                content: 'summary_large_image',
              },
              {
                property: 'og:url',
                content: WEBSITE,
              },
              {
                property: 'og:title',
                content: CLIENT_NAME,
              },
              {
                property: 'og:description',
                content: 'Minimalistic opinionated Bluesky web client',
              },
              {
                property: 'og:image',
                content: `${WEBSITE}/og-image-2.jpg`,
              },
            ]
          : []),
      ],
      headScripts: shouldInjectRollbar ? [rollbarCode] : [],
      links: WEBSITE
        ? [
            {
              rel: 'canonical',
              href: WEBSITE,
            },
            ...ALL_LOCALES.map((lang) => ({
              rel: 'alternate',
              hreflang: lang,
              // *Fully-qualified* URLs
              href: `${WEBSITE}/?lang=${lang}`,
            })),
            // https://developers.google.com/search/docs/specialty/international/localized-versions#xdefault
            {
              rel: 'alternate',
              hreflang: 'x-default',
              href: WEBSITE,
            },
          ]
        : [],
    }),
    generateFile([
      {
        type: 'json',
        output: './version.json',
        data: {
          buildTime: now,
          commitHash,
        },
      },
      {
        type: 'json',
        output: './oauth-client-metadata.json',
        data: oauthMetadata(productionOrigin),
      },
      ...(DISALLOW_ROBOTS
        ? [
            {
              type: 'raw',
              output: './robots.txt',
              data: 'User-agent: *\nDisallow: /',
            },
          ]
        : []),
    ]),
    {
      // https://developers.cloudflare.com/pages/configuration/early-hints/
      name: 'generate-headers',
      writeBundle(_, bundle) {
        const cssFiles = Object.keys(bundle).filter((file) =>
          file.endsWith('.css'),
        );
        const lines = ['/*', '  Cache-Control: no-store'];
        if (cssFiles.length > 0) {
          lines.push(
            '/',
            ...cssFiles.map(
              (file) => `  Link: <${file}>; rel=preload; as=style`,
            ),
          );
        }
        [
          '/apple-touch-icon.png',
          '/favicon.ico',
          '/logo-192.png',
          '/logo-512.png',
          '/logo-badge-72.png',
          '/logo-maskable-512.png',
          '/logo-monochrome-512.png',
          '/logo-monochrome-maskable-512.png',
          '/manifest.webmanifest',
          '/oauth-client-metadata.json',
          '/og-image.png',
          '/og-image-2.jpg',
          '/robots.txt',
          '/version.json',
        ].forEach((path) => {
          lines.push(
            path,
            '  ! Cache-Control',
            '  Cache-Control: public, max-age=0, must-revalidate',
          );
        });
        lines.push(
          '/assets/*',
          '  ! Cache-Control',
          '  Cache-Control: public, max-age=31536000, immutable',
        );
        fs.writeFileSync(
          resolve(__dirname, 'dist/_headers'),
          `${lines.join('\n')}\n`,
        );
      },
    },
    hasSentrySourcemapUpload &&
      sentryVitePlugin({
        authToken: SENTRY_AUTH_TOKEN,
        org: SENTRY_ORG,
        project: SENTRY_PROJECT,
        release: {
          name: commitHash ? `bluepy@${commitHash}` : undefined,
        },
        ...(shouldAnalyzeBundle
          ? {}
          : {
              sourcemaps: {
                filesToDeleteAfterUpload: 'dist/**/*.map',
              },
            }),
      }),
    VitePWA({
      manifest: {
        id: './', // Cannot be empty string for Web Install API to work
        start_url: './',
        scope: './',
        name: CLIENT_NAME,
        short_name: CLIENT_NAME,
        description: 'Minimalistic opinionated Bluesky web client',
        // Match the splash background and satisfy installable PWA checks.
        theme_color: '#b7cdf9',
        background_color: '#b7cdf9', // background for splash
        icons: [
          {
            src: 'logo-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'logo-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'logo-monochrome-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
          {
            src: 'logo-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['social', 'news'],
        share_target: {
          action: './share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: ['image/*', 'video/*', 'audio/*'],
              },
            ],
          },
        },
      },
      strategies: 'injectManifest',
      injectRegister: 'inline',
      injectManifest: {
        // Prevent "Unable to find a place to inject the manifest" error
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
    shouldAnalyzeBundle &&
      Sonda({
        deep: true,
        brotli: true,
        open: false,
      }),
    // Runs after Sentry and the PWA child build so uploaded maps are not deployed.
    hasSentrySourcemapUpload &&
      !shouldAnalyzeBundle &&
      removeUploadedSourcemaps(),
    {
      name: 'css-ordering-plugin',
      transformIndexHtml(html) {
        const stylesheets = [];
        html = html.replace(
          /<link[^>]*rel=["']stylesheet["'][^>]*>/g,
          (match) => {
            stylesheets.push(match);
            return '';
          },
        );

        // Try to place before first <link> tag, fallback to after last <meta> tag
        const linkRegex = /<link[^>]*>/;
        if (linkRegex.test(html)) {
          return html.replace(linkRegex, (match) => {
            return stylesheets.join('') + match;
          });
        } else {
          return html.replace(/(<meta[^>]*>)(?![\s\S]*<meta)/, (match) => {
            return match + stylesheets.join('');
          });
        }
      },
    },
  ],
  build: {
    sourcemap: hasSentrySourcemapUpload || shouldAnalyzeBundle,
    cssCodeSplit: false,
    rolldownOptions: {
      // Rolldown's code-splitting groups rely on tree-shaking to avoid
      // broken CommonJS helper cycles in the production browser build.
      treeshake: true,
      external: ['@xmldom/xmldom'], // exifreader's optional dependency, not needed
      input: {
        main: resolve(__dirname, 'index.html'),
        compose: resolve(__dirname, 'compose/index.html'),
      },
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](?:react|scheduler)[\\/]/,
              priority: 50,
            },
            {
              name: 'atproto-lexicons',
              test: /node_modules[\\/]@atproto[\\/]api[\\/]dist[\\/]client[\\/]lexicons/,
              priority: 40,
            },
            {
              name: 'atproto-client',
              test: /node_modules[\\/]@atproto[\\/]api[\\/]dist[\\/]client[\\/]index/,
              priority: 35,
            },
            {
              name: 'zod',
              test: /node_modules[\\/]zod[\\/]/,
              priority: 30,
            },
            {
              name: 'react-dom',
              test: /node_modules[\\/]react-dom[\\/]/,
              priority: 25,
            },
            {
              name: 'atproto',
              test: /node_modules[\\/](?:@atproto|multiformats)[\\/]/,
              priority: 20,
            },
            {
              name: 'router',
              test: /node_modules[\\/]react-router[\\/]/,
              priority: 10,
            },
            {
              name: 'sentry',
              test: /node_modules[\\/]@sentry[\\/]/,
              priority: 10,
            },
          ],
        },
        chunkFileNames: (chunkInfo) => {
          const { facadeModuleId } = chunkInfo;
          if (facadeModuleId && facadeModuleId.includes('icon')) {
            return 'assets/icons/[name]-[hash].js';
          }
          if (facadeModuleId && facadeModuleId.includes('locales')) {
            return 'assets/locales/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          const { originalFileNames } = assetInfo;
          if (originalFileNames?.[0]?.includes('assets/sandbox')) {
            return 'assets/sandbox/[name]-[hash].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        },
      },
      plugins: [
        {
          name: 'exclude-sandbox',
          generateBundle(_, bundle) {
            if (!PHANPY_DEV) {
              Object.keys(bundle).forEach((name) => {
                if (name.includes('sandbox')) {
                  delete bundle[name];
                }
              });
            }
          },
        },
        {
          name: 'remove-chunk-sourcemaps',
          generateBundle(_, bundle) {
            // Remove .js.map files and sourcemap references for specific chunks
            Object.keys(bundle).forEach((fileName) => {
              const shouldRemoveSourcemap =
                fileName.includes('locales/') || fileName.includes('icons/');

              if (fileName.endsWith('.js.map') && shouldRemoveSourcemap) {
                delete bundle[fileName];
              } else if (fileName.endsWith('.js') && shouldRemoveSourcemap) {
                const chunk = bundle[fileName];
                if (chunk.type === 'chunk' && chunk.code) {
                  // Remove sourceMappingURL comment
                  chunk.code = chunk.code.replace(
                    /\/\/# sourceMappingURL=.+\.js\.map\n?$/,
                    '',
                  );
                }
              }
            });
          },
        },
      ],
    },
  },
});
