# Bluepy Agent Runbook (Claude)

> AGENTS.md mirrors this file. Only difference: reviewer identity + review CLI. This file is for Claude coders; Codex reviews Claude-authored work. AGENTS.md is for Codex coders; Claude reviews Codex-authored work. Commit both files together. Product/UX conventions, footer credits, palette, and domain language live in `docs/CONTEXT.md`.

## The Path — follow top to bottom, every task

→ **Worktree** off `bluesky`. Never work on `bluesky` directly.
  `git worktree add -b fix/<name> /tmp/bluepy-<name> bluesky` — also `feat/<name>`, `chore/<name>`, `agent/issue-<number>`.
→ **Secrets:** `source ~/.secrets/bluepy/source.env`.
→ **Build:** Bun only (`bun install`, `bun run …`, `bunx …`). Reuse `@atproto/*` types before defining new ones. "Type X" means convert X to TS, not patch JSDoc into `.js`. Runtime is browser / Cloudflare Workers.
→ **Verify** (apply the gates that match your change):
  - i18n — after changing user-facing strings, `<Trans>`, `t` macro calls, or Lingui message IDs, run `bun run messages:extract` before typecheck/build. Do not rely on `bun run build` to extract catalogs.
  - typecheck — always: `bun run typecheck`
  - test — when touching a module with Playwright coverage: `bun run test`
  - build — when changing bundling, routing, imports, assets, or packaging: `bun run build`
  - lint — every change, regardless of scope: `bunx oxlint <changed files>`. If you changed a file, lint it before staging.
  - behavioral change (timeline, post, compose, notifications, auth, routing)? Write and run an e2e test, then walk the affected flow logged in (`bun run dev`, expose via HTTPS). Logged-out routes are not correctness evidence. Pure refactors / typecheck-only / copy tweaks: existing suite passing is enough, no new e2e.
→ **Stage:** `git status -sb` and `git diff --name-status`. Report any dirty files.
→ **Review loop** (cross-model, read-only): Codex reviews → you fix actionable findings in code → re-run relevant verification → re-review until Codex reports "no actionable findings". Hard cap 5 rounds. See *Review CLI* below.
→ **Ship:** only after review rounds are clean and e2e is written/run — push your branch and open a draft PR against `bluesky`. Automation takes over: preview deploy → agent-pr loop → `human-review` label.

## Ask first — everything else is yours

The Path above is yours to run autonomously. These few actions are the exceptions — check in before proceeding:

- To update pushed work, add a follow-up commit and `git push`.
- Add new commits to update published work. Merging and amending published commits need an explicit ask.
- Keep PRs in draft until asked to mark ready.
- Only modify files that are part of your task. `git restore`, `git checkout --`, `git clean -f` on other files need an explicit ask.
- If a lint rule blocks useful work, report the rule name, diagnostic, and smallest compliant change; for a real change write `docs/rule-change-proposals/YYYY-MM-DD-name.md` and get reviewer approval first.
- Only run `bun run messages:extract` when source strings changed. Preserve `<Trans>` tags and report any generated locale catalog diff before staging it.
- Keep generated images out of code commits.
- Send your work to Codex for review. Claude does not review Claude-authored work.

## Correctness Traps

- Verify external review findings against current code before editing. CodeRabbit and GitHub summaries can be stale; compare the latest PR head SHA and review timestamp before declaring a PR clean.
- Keep fixes minimal for review comments and merge conflicts. Resolve toward current `bluesky` behavior; put broader cleanup in a follow-up PR.
- Treat post/profile/media/poll/spoiler/emoji fields as untrusted HTML input. Escape interpolated values before sanitizing and add XSS regression vectors when touching HTML preview/sanitizer code.
- Do not guess ATProto behavior. Trace through `src/utils/atproto-adapter.ts` and the social-app reference clone (see Secrets & Paths for the host-conditional path); logged-out public reads use AppView, PDS-facing writes/uploads need PDS audience/auth.
- For compose changes, verify the final `com.atproto.repo.createRecord` payload directly. UI text, facets, embed state, and reply refs are separate concerns.
- Overlay links, icon buttons, comboboxes, and visually labeled inputs need keyboard reachability and accessible names. A browser snapshot with unnamed controls is not clean.
- Behavioral changes to timeline, post, compose, notification, auth, routing, or settings need a focused regression test plus the relevant logged-in browser check.

## Hooks

Project hooks live in `.claude/settings.json`, `.codex/hooks.json`, and `scripts/hooks/`. They block main-branch edits, destructive git commands, non-draft PR creation, production deploys, verification bypasses, runbook drift, and secret disclosure; they warn on locale churn, missing i18n extraction, behavioral changes without tests, sanitizer changes without XSS tests, and compose changes without payload assertions. Stop hooks run typecheck plus changed-file lint/format by default; set `BLUEPY_HOOK_CHECK_SCOPE=full` when the full-tree baseline is green, and `BLUEPY_HOOK_STRICT_CHECKS=1` to make those checks blocking.

## Review CLI — Codex reviews Claude's work

Robust by construction: do not inline the diff. The reviewer runs git itself, so there is nothing to quote or truncate. Build the prompt with a quoted heredoc (`<<'PROMPT'`) so the shell never expands `$`, backticks, or quotes.

```bash
cat > /tmp/bluepy-review-prompt.md <<'PROMPT'
You are read-only in the staged worktree. Gather context yourself: run
`git diff --no-color HEAD`, `bun run typecheck`, and `bunx oxlint <changed files>`.
Report correctness findings ordered by severity with file:line refs — behavioral
regressions, unsafe casts, hidden runtime assumptions, missing tests, rule bypasses,
generated/lockfile/locale churn, unrelated drive-bys, skipped tests. If none, say
"no actionable findings" and list residual risks.
PROMPT

codex exec \
  -c model='"gpt-5.5"' \
  -c model_reasoning_effort='"high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  "$(cat /tmp/bluepy-review-prompt.md)" < /dev/null > codex-review.out 2>&1
```

- `< /dev/null` is required — `codex exec` hangs waiting for stdin EOF in non-TTY contexts without it.
- Use the exact model and effort shown: `gpt-5.5` with `model_reasoning_effort="high"`.
- Do not add a timeout or a budget cap. Neither is needed.

## Secrets & Paths

All secrets live in `~/.secrets/bluepy/` with private permissions. Never log, print, or commit them.

- `source ~/.secrets/bluepy/source.env` sets `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `ATPROTO_TEST_IDENTIFIER`, `ATPROTO_TEST_PASSWORD`.
- Reference clients are read-only: `~/social-app` (Linux/VPS) / `~/src/a/social-app` (macOS dev). The runbook writes `~/social-app`; if the path doesn't exist on the host, try `~/src/a/social-app` before failing — both are the same `bluesky-social/social-app` clone. Optionally `github.com/mozzius/graysky`.

## Branches, Remotes & Deploy

- `bluesky` is main. Old TypeScript migration branches are not the default base for new work.
- `fork` (`github.com/aliceisjustplaying/bluepy`) is the GitHub deploy source; `tangled` is a mirror.
- Production deploys from `fork/bluesky`, not feature branches. Use `/tmp/bluepy-bluesky-deploy` or another clean worktree for deploy-target work.
- Cloudflare account: `aliceisjustplaying@gmail.com`, account ID `b752c979e541327de3e87e52f0906aa1`, zone `bluepy.social` id `c3e3ebea11871d784375b74624d3b6cd`.
- Workers: `bluepy` → `bluepy.social` (prod, do not touch unless asked) · `bluepy-dev` → `dev.bluepy.social` (`bunx wrangler deploy --env dev`) · PR previews → `https://pr-<number>.bluepy.social` via `.github/workflows/bluepy-preview.yml`.

## PR Automation

- Issue label `agent:codex` runs `.github/workflows/bluepy-agent.yml` → `scripts/agent-loop.sh issue <number>`.
- PRs with `agent:preview` get a preview deploy on open, sync, reopen, ready-for-review, or label events.
- After a successful `Bluepy Preview` run, `.github/workflows/bluepy-agent-pr.yml` → `scripts/agent-loop.sh pr <number>` unless the PR already has `human-review`.
- The PR loop runs deterministic verification, asks Claude for structured JSON review, lets Codex fix actionable findings, repeats, waits for a passing preview, then labels `human-review`.
- `/bluepy-agent` comments from owners, members, or collaborators run `scripts/agent-loop.sh comment <number>`.
- Self-hosted preview jobs require runners tagged `bluepy-deploy`; agent jobs require `bluepy-agent`.
- Agent workflow logs live under `/workspace/agent-worktrees/bluepy/logs` and are uploaded as GitHub artifacts (raw + normalized review JSON preserved).

## Environment Quirks

- Agent-runner browser checks inherit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `AGENT_BROWSER_EXECUTABLE_PATH` from `scripts/agent-loop.sh`; both point at `scripts/chromium-for-agents`.
- Use `agent-browser` for ad-hoc visual checks (`agent-browser skills get core --full`); `bun run test` for Playwright smoke/regression tests.
- Playwright browsers are installed via Nix, not `npx playwright install`. If launch fails on NixOS, point Playwright at the Nix-provided Chromium wrapper.
- Tailscale previews need HTTPS for OAuth/SubtleCrypto. Use `p.tailec2dc.ts.net`; the bare IP only works for non-OAuth flows.
- Mobile Safari content blockers can kill `src/utils/push-notifications.js` and leave "Bluepy is still loading...".
- Host is Hermes (Hetzner arm64, 4cpu/8gb). If CPU is hot, inspect `hermes`, `codex`, `claude`, `camoufox`, and `agent-browser` processes before killing anything.

## Models

- Claude: `claude-opus-4-7` with `--effort xhigh`. Never Sonnet, Haiku, or defaults.
- Codex: `gpt-5.5` with `model_reasoning_effort="high"`. Never defaults.
- External manual reviewer of record: GPT-5.5 Pro via `scripts/dump-source-for-review.sh`.

## Domain Rules

- AT URIs are native: serialize as `at://…`, never `at:/…`.
- Do not invent types that codify known-broken behavior.
- Bluesky image limits: 2 MB and about 4000 px long edge.

## Agent skills

### Issue tracker

Linear (team `Aliceisjustplaying`, project `Bluepy`) via the official Linear MCP server. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to Linear workflow states. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
