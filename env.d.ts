/// <reference types="vite/client" />

// Module-mode (via the empty named export type below) so `declare global` is
// valid here. Vite-defined compile-time constants are listed as oxlint globals
// in `.oxlintrc.json`, so we wrap them in `declare global` to provide TS types
// without triggering `eslint/no-redeclare`.
//
// Ambient `declare module '...'` augmentations for untyped peer packages
// (e.g. `punycode/` and `*.po`) live in `src/utils/untyped-shims.d.ts`, which
// is still in script mode; placing them here would require module-augmentation
// semantics which fail when the original module has no types.
export type _EnvModuleMarker = never;

declare global {
  var __BUILD_TIME__: string;
  var __COMMIT_HASH__: string | undefined;
  var __COMMIT_TIME__: string | undefined;
  var __FAKE_COMMIT_HASH__: boolean;
  var __BENCHMARK: BluepyBenchmark;

  interface ImportMetaEnv {
    readonly PHANPY_APP_ERROR_LOGGING?: string;
    readonly PHANPY_CLIENT_NAME?: string;
    readonly PHANPY_DEV?: string;
    readonly PHANPY_DISALLOW_ROBOTS?: string;
    readonly PHANPY_LINGVA_INSTANCES?: string;
    readonly PHANPY_PRIVACY_POLICY_URL?: string;
    readonly PHANPY_REFERRER_POLICY?: string;
    readonly PHANPY_TRANSLANG_INSTANCES?: string;
    readonly PHANPY_WEBSITE?: string;
    readonly VITE_APP_ENV?: string;
    readonly VITE_PORT?: string;
    readonly VITE_SENTRY_DSN?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface BluepyBenchmark {
    start(name: string): void;
    end(name: string): void;
  }

  interface Window {
    __ACCOUNT_APIS__?: Record<string, Record<string, unknown> | undefined>;
    __API__?: {
      apis?: Record<string, unknown>;
      accountApis?: Record<string, Record<string, unknown> | undefined>;
    };
    __BENCH_RESULTS?: Map<string, unknown>;
    __BENCHMARK?: BluepyBenchmark;
    __BLUEPY_OAUTH_ARGS__?: unknown;
    __CLOAK__?: () => void;
    __COMPOSE__?: unknown;
    __generateCodeChallenge?: unknown;
    __IDLE__?: boolean;
    __IGNORE_GET_ACCOUNT_ERROR__?: boolean;
    _memoize?: unknown;
    __nativeAlert?: typeof window.alert;
    __SHARED_DATA__?: unknown;
    __STATES__?: Record<string, unknown>;
    __STATES_STATS__?: () => void;
  }
}
