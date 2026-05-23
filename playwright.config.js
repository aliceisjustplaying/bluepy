// @ts-check
/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

// Silence console output except errors
console.log = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

const DEV_PORT = Number(process.env.PORT || process.env.VITE_PORT) || 5173;
const BASE_URL = `http://localhost:${DEV_PORT}`;
const HAS_ATPROTO_TEST_CREDS = Boolean(
  process.env.ATPROTO_TEST_IDENTIFIER && process.env.ATPROTO_TEST_PASSWORD,
);
const AGENT_CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--single-process',
];
const CHROMIUM_ARGS =
  process.env.BLUEPY_CHROMIUM_ARGS?.split(/\s+/).filter(Boolean) ??
  (process.env.BLUEPY_AGENT_BROWSER || process.env.CI
    ? AGENT_CHROMIUM_ARGS
    : []);

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  retries: 0,
  /* Opt out of parallel tests on CI and when running live ATProto smoke tests. */
  workers: process.env.CI || HAS_ATPROTO_TEST_CREDS ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? 'github' : 'list',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: BASE_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'e2e',
      testMatch: '**/e2e/**/*.spec.ts',
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
            '/run/current-system/sw/bin/chromium',
          args: CHROMIUM_ARGS,
        },
      },
    },
    {
      name: 'legacy-atproto',
      testMatch: '**/atproto-*.spec.js',
      retries: process.env.CI ? 2 : 0,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
            '/run/current-system/sw/bin/chromium',
          args: CHROMIUM_ARGS,
        },
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `bun run dev -- --port ${DEV_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
