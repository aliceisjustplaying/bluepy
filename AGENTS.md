# Bluepy Agent Runbook (Codex)

> CLAUDE.md mirrors this file. Only difference: reviewer identity. This file (AGENTS.md) is for Codex coders; Claude reviews. CLAUDE.md is for Claude coders; Codex reviews. Commit both together. Product/UX conventions, footer credits, palette, etc. live in `docs/CONTEXT.md`.

## Always

- Work in a **worktree** off `bluesky`, on a **branch**: `fix/<name>` | `feat/<name>` | `chore/<name>`.
  - `git worktree add -b fix/<name> /tmp/bluepy-<name> bluesky`
- Push to **both** remotes: `fork` (github.com/aliceisjustplaying/bluepy) and `tangled`.
- **Open a draft PR** against `bluesky` when the work is ready for review.

## Don't

- **Merge PRs** — the user merges on GitHub. Force-push, amend published commits — same.
- **Delete or restore files you don't own** — no `git restore` / `git checkout --` / `git clean -f` outside your own staged work. Investigate unfamiliar files before removing.
- **Bypass checks** — no `--no-verify`, no `--no-gpg-sign`, no `.skip`/`xfail`/`eslint-disable`, no `@ts-ignore`/`@ts-expect-error`/`any`. No turning off lint rules.
- **Commit generated images** unless asked. **Run `lingui extract`** unless source strings actually changed. **Strip `<Trans>` tags**.
- **Preserve known bugs** to "keep parity" — fix or file follow-up.
- **Touch the prod Worker** (`bluepy`) — only deploy to it when explicitly asked.
- **Self-review** — Codex never reviews Codex-authored code. Claude reviews Codex; Codex reviews Claude.

## Secrets & Paths

All secrets live in `~/.secrets/bluepy/` (700, files 600). Never log/print/commit.

- **One-liner to load everything**: `source ~/.secrets/bluepy/source.env` → sets `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `ATPROTO_TEST_IDENTIFIER`, `ATPROTO_TEST_PASSWORD`.
- Individual files (rarely needed directly): `cloudflare-email`, `cloudflare-key`, `test-credentials`.

Reference clients (read-only): `~/social-app` (primary), optionally clone `github.com/mozzius/graysky`.

## Branches, Remotes & Deploy

- `bluesky` is main. Old `typescript` branch is dead — do not branch off it.
- Remotes: `fork` (`github.com/aliceisjustplaying/bluepy`, deploy source) and `tangled`. Push to both, always.
- **Cloudflare account**: `aliceisjustplaying@gmail.com`, account ID `b752c979e541327de3e87e52f0906aa1`. Zone `bluepy.social` id `c3e3ebea11871d784375b74624d3b6cd`.
- **Workers** (single wrangler.jsonc, two effective names via `env`):
  - `bluepy` → `bluepy.social` (prod). Don't touch unless asked.
  - `bluepy-dev` → `dev.bluepy.social` (deployed with `--env dev`).
- **Deploy is manual via wrangler** — no Workers Builds, no GH Actions deploy.
  - Dev (any feature branch): `bunx wrangler deploy --env dev`
  - Prod (only after user merges to `bluesky`): `bunx wrangler deploy`
  - Auth: `source ~/.secrets/bluepy/source.env` once, then `bunx wrangler deploy …`. Global key — no scoped token.

## Environment Quirks

- **Tailscale-only previews.** No `localhost`. Use the funnel for HTTPS (`p.tailec2dc.ts.net`); the bare IP `100.74.251.100:5173` only works for non-OAuth flows. OAuth needs HTTPS (`SubtleCrypto` requires it).
- **Mobile Safari content blockers** kill `src/utils/push-notifications.js` → blank page / "Bluepy is still loading…". When debugging mobile-Safari, add visible on-screen debug — no DevTools on her phone.
- Host is Hermes (Hetzner arm64, 4cpu/8gb). If CPU is hot at session start, `pgrep -a hermes|codex|claude|camoufox|agent-browser` and kill orphans carefully — don't blow away sibling agents.

## Commands

- Package manager: **Bun only** (`bun install`, `bun run …`, `bunx …`). Runtime is browser / CF Workers.
- Verify: `bun run typecheck` (gates), `bun run test` (gates for files with Playwright coverage), `bun run build` only when bundling/routing/imports/assets affected (gates if run), `bunx oxlint <changed files>` (gates on changed-file delta; project baseline is being burned down).
- Browser: `source ~/.secrets/bluepy/source.env`, `bun run dev`, expose via funnel, walk the flow **logged in**. Logged-out is not correctness evidence.
- **Ad-hoc visual / exploratory checks** → `agent-browser` (start with `agent-browser skills get core --full`). **Smoke / regression tests** → `bun run test` (Playwright). Don't write a one-off Playwright test for a single manual check; don't take screenshots by hand when `agent-browser` will do.
- **Playwright browsers ARE installed — via Nix, not via `npx playwright install`.** If `bun run test` says browsers are missing, the bundled Chromium is failing to load shared libs on NixOS. Don't reinstall; point Playwright at the Nix-provided bundle per `/workspace/notes/reference/nixos-gotchas.md`.
- Smoke tests: if flaky, fix; do not skip.

## Commits

- One concern per commit. Don't mix code, locales, images, configs, deps.
- Run `git status -sb` and `git diff --name-status` before staging. Report dirty files.
- Lingui `.po` files commit alongside but separate from source-string changes.

## Models

- **All Claude invocations: `claude-opus-4-7` `--effort xhigh`.** Never Sonnet/Haiku/defaults.
- **All Codex invocations: `gpt-5.5` `model_reasoning_effort='"high"'`.** Never defaults.
- External reviewer-of-record (manual): GPT-5.5 Pro via `scripts/dump-source-for-review.sh`.

## Lint

Rules only go **stricter, never looser**. Demotions are not wins. `no-unsafe-type-assertion` warnings are real type debt — fix, don't silence. Active sweep: burn down oxlint errors and warnings; pick mechanically-fixable warnings first.

If a rule blocks useful work, follow the Rule-Change Protocol: smallest compliant code change first; if that's worse, write `docs/rule-change-proposals/YYYY-MM-DD-name.md` (rule, diagnostic, why compliant is worse, narrower scope, blast radius, rollback, Claude review). Apply only after Claude approves, in its own commit prefixed `Adjust lint rule:`. Never loosen — only scope, narrow, or tighten.

## Code Discipline

- No `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `--no-verify`. `as unknown as X` shims are temporary debt; remove when adjacent code changes.
- Reuse `@atproto/*` types before defining new ones.
- "Type X" means convert X to TS, not patch JSDoc into `.js`. Never invent types that codify known-broken behavior.
- AT-URIs are native: serialize as `at://...` (two slashes — single-slash `at:/` has bitten multiple times).
- Bluesky image limits (client enforces): 2 MB, ~4000 px long edge.
- Atomic refactors over symptom-fixes ("now 1 line" while the substance moved to a sibling is not a refactor).

## Review Loop

Roles: Coder writes (Codex or worker subagents). Reviewer is **Claude Opus 4.7 xhigh**, read-only, no edits. Coder writes → verify (typecheck, test, targeted oxlint, authenticated browser walk if user-visible) → stage → Claude reviews diff → fix actionable findings in code (not via lint disables) → re-verify → re-review until Claude says "no actionable findings". Hard cap 5 rounds; escalate. Commit narrow; push to both `fork` and `tangled`; then `bunx wrangler deploy --env dev` to ship the preview on `dev.bluepy.social`. Prod deploy (`bunx wrangler deploy`) waits until the user merges into `bluesky` on GitHub.

Prefer batches under 300 changed lines; split at 500. No drive-bys (formatting, version bumps, package.json, tsconfig, lint config, lockfiles, locale catalogs, `.claude/`) in the same commit. `git mv` for renames.

### Claude Review CLI

Run from inside the staged worktree. **Always Opus 4.7 xhigh.** `< /dev/null` is mandatory in non-TTY contexts (background, subagents, scripts) or Claude hangs.

```bash
DIFF="$(git diff --no-color HEAD)"; TYPECHECK="$(bun run typecheck 2>&1)"
LINT="$(bunx oxlint <changed> 2>&1)"
claude -p --model claude-opus-4-7 --effort xhigh --no-session-persistence \
  "$PROMPT" < /dev/null > claude-review.out 2>&1
```

`$PROMPT` asks Claude to find, ordered by severity with `file:line`: behavioral regressions (unless an intentional bug-fix, noted), unsafe casts / `as unknown as X` shims hiding bugs, `any`/`@ts-ignore`/`eslint-disable`, missing tests around changed behavior, over-decomposition, drive-bys (formatting, version bumps, package.json, tsconfig, lint config, lockfiles, generated images, locale catalogs, `.claude/`), renames without `git mv`, new skipped/xfailed tests. Include `${TYPECHECK}`, `${LINT}`, `${DIFF}`. If none, "no actionable findings" + residual risks. Smoke: `claude -p --model claude-opus-4-7 --effort xhigh --no-session-persistence "Reply with EXACTLY CLAUDE_OK and nothing else."`.

Claude is read-only — does not edit files during review.
