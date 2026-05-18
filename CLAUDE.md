# Bluepy Agent Runbook (Claude)

> AGENTS.md mirrors this file. Only difference: reviewer identity. This file is for Claude coders; Codex reviews Claude-authored work. AGENTS.md is for Codex coders; Claude reviews Codex-authored work. Commit both files together. Product/UX conventions, footer credits, palette, and domain language live in `docs/CONTEXT.md`.

## Always

- Work in a **worktree** off `bluesky`, on a branch: `fix/<name>`, `feat/<name>`, `chore/<name>`, or `agent/issue-<number>`.
  - `git worktree add -b fix/<name> /tmp/bluepy-<name> bluesky`
- Use Bun only: `bun install`, `bun run ...`, `bunx ...`. Runtime is browser / Cloudflare Workers.
- Run `git status -sb` and `git diff --name-status` before staging. Report dirty files.
- Open a draft PR against `bluesky` when work is ready for automated preview/review.

## Don't

- Merge PRs, force-push, or amend published commits unless the user explicitly asks.
- Delete or restore files you don't own. No `git restore`, `git checkout --`, or `git clean -f` outside your own staged work.
- Bypass checks: no `--no-verify`, `.skip`, `xfail`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `any`.
- Commit generated images unless asked. Keep generated locale catalogs in separate commits.
- Run `lingui extract` unless source strings changed. Never strip `<Trans>` tags.
- Touch the prod Worker (`bluepy`) unless explicitly asked.
- Self-review. Claude never reviews Claude-authored work.

## Secrets & Paths

All secrets live in `~/.secrets/bluepy/` with private permissions. Never log, print, or commit them.

- Load secrets with `source ~/.secrets/bluepy/source.env`.
- This sets `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `ATPROTO_TEST_IDENTIFIER`, and `ATPROTO_TEST_PASSWORD`.
- Reference clients are read-only: `~/social-app` first, optionally `github.com/mozzius/graysky`.

## Branches, Remotes & Deploy

- `bluesky` is main. Old TypeScript migration branches are not the default base for new work.
- `fork` (`github.com/aliceisjustplaying/bluepy`) is the GitHub deploy source. `tangled` is a mirror.
- Production deploys from `fork/bluesky`, not feature branches. Use `/tmp/bluepy-bluesky-deploy` or another clean worktree for deploy-target work.
- Cloudflare account: `aliceisjustplaying@gmail.com`, account ID `b752c979e541327de3e87e52f0906aa1`, zone `bluepy.social` id `c3e3ebea11871d784375b74624d3b6cd`.
- Workers:
  - `bluepy` -> `bluepy.social` (prod). Do not touch unless asked.
  - `bluepy-dev` -> `dev.bluepy.social` (`bunx wrangler deploy --env dev`).
  - PR previews -> `https://pr-<number>.bluepy.social` via `.github/workflows/bluepy-preview.yml`.

## PR Automation

- Issue label `agent:codex` runs `.github/workflows/bluepy-agent.yml`, which calls `scripts/agent-loop.sh issue <number>`.
- PRs with `agent:preview` get a preview deploy on open, sync, reopen, ready-for-review, or label events.
- After a successful `Bluepy Preview` run, `.github/workflows/bluepy-agent-pr.yml` calls `scripts/agent-loop.sh pr <number>` unless the PR already has `human-review`.
- The PR loop runs deterministic verification, asks Claude for structured JSON review, lets Codex fix actionable findings, repeats, waits for a passing preview, then labels `human-review`.
- `/bluepy-agent` comments from owners, members, or collaborators run `scripts/agent-loop.sh comment <number>`.
- Self-hosted preview jobs require runners tagged `bluepy-deploy`; agent jobs require `bluepy-agent`.
- Agent workflow logs live under `/workspace/agent-worktrees/bluepy/logs` and are uploaded as GitHub artifacts. Claude raw and normalized review JSON are preserved there.

## Environment Quirks

- Use authenticated views when checking visual or behavioral regressions. Logged-out routes are not correctness evidence for timeline, post, compose, notification, or account flows.
- Agent-runner browser checks inherit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `AGENT_BROWSER_EXECUTABLE_PATH` from `scripts/agent-loop.sh`; both point at `scripts/chromium-for-agents`.
- Use `agent-browser` for ad-hoc visual checks (`agent-browser skills get core --full`). Use `bun run test` for Playwright smoke/regression tests.
- Playwright browsers are installed via Nix, not `npx playwright install`. If browser launch fails on NixOS, point Playwright at the Nix-provided Chromium wrapper.
- Tailscale previews need HTTPS for OAuth/SubtleCrypto. Use `p.tailec2dc.ts.net`; the bare IP only works for non-OAuth flows.
- Mobile Safari content blockers can kill `src/utils/push-notifications.js` and leave "Bluepy is still loading...".
- Host is Hermes (Hetzner arm64, 4cpu/8gb). If CPU is hot, inspect `hermes`, `codex`, `claude`, `camoufox`, and `agent-browser` processes before killing anything.

## Verification

- `bun run typecheck` gates normal code changes.
- `bun run test` gates modules with Playwright coverage.
- `bun run build` gates bundling, routing, import, asset, and runtime packaging changes.
- `bunx oxlint <changed files>` gates changed-file delta; the project baseline still has unrelated noise.
- Browser verification must be logged in for authenticated flows: `source ~/.secrets/bluepy/source.env`, `bun run dev`, expose via HTTPS, then walk the affected flow.

## Models

- Claude: `claude-opus-4-7` with `--effort xhigh`. Never Sonnet, Haiku, or defaults.
- Codex: `gpt-5.5` with `model_reasoning_effort="high"`. Never defaults.
- External manual reviewer of record: GPT-5.5 Pro via `scripts/dump-source-for-review.sh`.

## Lint & Code Discipline

- Do not turn off lint rules without explicit permission in the current turn.
- If a rule blocks useful work, report the rule name, diagnostic, and smallest compliant change. For a real rule change, write `docs/rule-change-proposals/YYYY-MM-DD-name.md` and get reviewer approval first.
- Reuse `@atproto/*` types before defining new ones.
- "Type X" means convert X to TS, not patch JSDoc into `.js`.
- Do not invent types that codify known-broken behavior.
- AT URIs are native: serialize as `at://...`, never `at:/...`.
- Bluesky image limits: 2 MB and about 4000 px long edge.

## Review Loop

Claude writes, verifies, stages, and fixes. Codex reviews read-only through structured output. Fix actionable findings in code, re-run relevant verification, and re-review until Codex reports no actionable findings. Hard cap is 5 review rounds.

### Codex Review CLI

Run from the staged worktree. `< /dev/null` is mandatory in non-TTY contexts.

```bash
DIFF="$(git diff --no-color HEAD)"
TYPECHECK="$(bun run typecheck 2>&1)"
LINT="$(bunx oxlint <changed> 2>&1)"
codex exec \
  -c model='"gpt-5.5"' \
  -c model_reasoning_effort='"high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  "$PROMPT" < /dev/null > codex-review.out 2>&1
```

The prompt should ask for correctness findings ordered by severity with `file:line` refs: behavioral regressions, unsafe casts, hidden runtime assumptions, missing tests, rule bypasses, generated/lockfile/locale churn, unrelated drive-bys, and skipped tests. If none, Codex should say "no actionable findings" and list residual risks.
