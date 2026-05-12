# Bluepy Agent Runbook

> CLAUDE.md and AGENTS.md must stay byte-identical. After editing either, copy it over the other and commit them together.

## Deployment Source Of Truth

Production deploys from `fork/bluesky`, not feature branches. Use `/tmp/bluepy-bluesky-deploy` or another clean worktree for deploy-target work. Do not assume Cloudflare Pages; this project deploys on Cloudflare Workers with static assets.

## Before Committing

Always run `git status -sb` and `git diff --name-status` before staging. Never commit generated images unless explicitly requested in the current turn. Keep generated locale catalogs in separate commits.

## Lint Rules

Do not turn off lint rules without explicit permission in the current turn. If a rule blocks useful work, report the rule name, the concrete violation, and the smallest compliant change or ask for permission to change the rule.

## Package Manager

Use Bun for installs and scripts: `bun install`, `bun run ...`, and `bunx ...`. Runtime remains browser/Cloudflare Workers, not Bun.

## Long-Running Work

Make small commits by concern. Push deploy-relevant commits to `fork/bluesky`. Report any remaining dirty files explicitly.

## TypeScript Migration: Roles

- **Coder**: Claude Opus (the active session, or worker subagents in parallel-worktree mode). Owns file conversions, type annotations, fixes, verification, and commits.
- **Reviewer**: Codex (via the Codex Claude Code plugin companion). Owns review verdicts only. Codex output is read-only signal; Codex does not edit files in this workflow.

Coder writes, Codex reviews, Coder fixes. Loop until Codex reports no actionable findings, then commit.

## TypeScript Migration OODA Loop

Work in reviewable batches. Prefer 3-8 tiny independent leaf files, one leaf utility cluster, one boundary module, or one cohesive import chain per batch. Aim for under 300 changed lines; split at 500. Prefer extensionless import-safe `.js -> .ts` and `.jsx -> .tsx` conversions first, because they avoid import churn.

For each batch:

1. Orient: inspect callers, runtime behavior, existing tests, and current JS assumptions. Keep a candidate queue by inspecting a set of small JS/JSX leaves once, then convert the next safe batch from that queue without rediscovering from scratch. Identify the smallest type boundary or independent leaf batch that removes casts from already-converted code.
2. Decide: state the batch target and success checks. Do not disable rules to make progress.
3. Act: convert the files to TypeScript and keep behavior stable. Use `git mv` so renames are tracked. No drive-bys in the same commit — import-path tweaks, formatting, version bumps, and renames belong in their own. No pure helpers extracted solely to test trivial assertions; if it's one expression, inline it. Shimming an untyped peer with `as unknown as X` is acceptable debt — the next batch that converts the peer removes the shim.
4. Verify: `bun run typecheck` (gates), `bun run build` only when the batch may affect bundling, routing, imports, generated assets, or runtime packaging (gates when run), `bun run test` for modules with Playwright coverage (gates), and targeted `bunx oxlint <changed files>` for review delta (informational — project baseline is ~32 000 errors). Then exercise the batch in the browser only when it affects user-visible app flows: source `~/.secrets/phanpy-atproto-test.env` (`ATPROTO_TEST_IDENTIFIER`, `ATPROTO_TEST_PASSWORD`), run `bun run dev`, and walk the affected flows. For pure leaf utilities, use direct module probes or targeted runtime checks when useful; otherwise types, targeted lint, and review are sufficient.
5. Review: stage the batch (`git add -A`), then run Codex review against the working-tree diff. See "Codex Review CLI" below. Ask Codex for bugs, behavioral regressions, unsafe type claims, missing tests, over-decomposition, and rule bypasses.
6. Fix: address actionable Codex findings with code changes, not lint disables. If a lint rule appears wrong for the project, follow the rule-change protocol below.
7. Re-review: after addressing any actionable Codex finding, rerun the relevant verification and re-run Codex review. Repeat until Codex reports no actionable findings. Commit only after that final clean review. Skip re-review only when the first review contains no actionable findings or only explicitly non-actionable residual risks. Hard cap: 5 review rounds per batch — escalate if still not clean by then.
8. Commit & push: run `git status -sb` and `git diff --name-status`, then commit the batch with a narrow message only when the batch is green and Codex reports no actionable findings. Do not batch unrelated catalog, image, domain, or package-manager changes. In single-worker mode, push to `fork/typescript` immediately after committing. In parallel-worktree mode (see below), workers commit on their branch and do **not** push; the coordinator merges and pushes.
9. Loop: pick the next batch by removing the largest remaining JS boundary around already-typed code.

Pick batches leaves-first by import graph — modules whose dependencies are already typed. Out-of-order is fine; it just leaves `as unknown as X` shims that the next batch removes. Avoid creating types for known-broken behavior; mark those as follow-up bugs or fix behavior first.

### Parallel-Worktree Wave Mode

For high-throughput migration runs, run multiple workers in parallel rather than serially. The coordinator (Claude Opus, main session) drives waves of up to 5 worker subagents.

Per wave:

1. Coordinator surveys remaining JS/JSX leaves and picks N independent batches. **No shared files between batches in the same wave** — workers must be able to merge cleanly.
2. For each batch, coordinator creates a fresh worktree branched from `typescript`:
   ```bash
   git worktree add -b ts/<wave>-<batch-name> /tmp/bluepy-<wave>/<batch-name> typescript
   ```
3. Coordinator spawns one Claude Opus worker subagent per worktree. Each worker is given: worktree path, file list, and the OODA loop above (steps 2–7). Workers commit on their branch but do **not** push.
4. As each worker returns SUCCESS, coordinator runs `git merge --no-ff ts/<wave>-<batch-name>` from the `typescript` branch in the main checkout. Trivial conflicts (unrelated import paths) — coordinator resolves. Real conflicts — coordinator halts and surfaces them.
5. After all wave branches merged, coordinator pushes once: `git push fork typescript`.
6. Coordinator removes wave worktrees (`git worktree remove --force <path>`) and deletes their branches.
7. Pick next 5 batches; loop until no JS/JSX remains under `src/`.

Worker constraints (enforce in every worker prompt):

- Stay inside the assigned worktree. Never edit files outside the batch list.
- No `bun install`, no `package.json` edits, no `tsconfig*` edits, no lint/eslint/oxlint/vite config edits, no CI edits.
- No `--no-verify`, no `eslint-disable`, no `@ts-ignore` / `@ts-expect-error`, no `any`. Use explicit types or `as unknown as X` shims only.
- No push. Commit on the assigned branch only.
- Use `bun` / `bunx` exclusively.
- Use `git mv` for renames so git tracks them as renames, not delete+add.

### Codex Review CLI

Codex review runs through the Codex Claude Code plugin's companion script. From within the worktree where the batch is staged:

```bash
node /home/agent/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs review --wait --scope working-tree
```

- `--wait` runs the review in the foreground and returns Codex's verdict to stdout.
- `--scope working-tree` reviews staged + unstaged changes vs HEAD (use this when the batch is staged but not committed).
- For branch-scoped reviews after commit: `--scope branch --base typescript`.
- Higher reasoning effort: use `task --effort high "<review prompt>"` instead of `review` when explicit effort control is required. The plain `review` command uses Codex defaults.
- Read Codex's output: actionable findings (bugs, unsafe casts, regressions, missing tests for changed behavior, over-decomposition, rule bypasses) → fix in code. Explicitly non-actionable residual risks → acceptable; commit anyway.

Do not let Codex edit files during review. Treat Codex output as review input; the Coder (Claude Opus) owns code changes, verification, and commits.

For smoke testing Codex availability:

```bash
node /home/agent/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs task "Smoke test: reply with exactly CODEX_OK if you can read this."
```

### Rule-Change Protocol

Default behavior is to obey every configured rule. A migration batch must not silently relax lint, typecheck, formatter, test, build, or runtime checks.

If a rule blocks useful work, first try the smallest compliant code change. If that makes the code materially worse, create a separate rule-change proposal artifact instead of editing config inline.

Use `docs/rule-change-proposals/YYYY-MM-DD-brief-name.md` with:

- rule/check name
- exact command and diagnostic
- changed files blocked by the rule
- why compliant code is worse for this codebase
- proposed config change or scoped exception
- blast radius
- rollback plan
- Codex review result on the proposal

Automation may commit a rule-change proposal document without human approval. Automation may apply the rule change only when all of these are true:

1. The proposal is in its own commit.
2. Codex's review explicitly approves the rule change.
3. The change is narrower than disabling the whole rule globally.
4. The commit message starts with `Adjust lint rule:`.
5. The next migration batch confirms the adjusted rule no longer hides unrelated findings.

If those conditions are not met, leave the proposal committed and continue with a different migration batch.
