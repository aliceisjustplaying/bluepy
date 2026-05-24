# AFK Rebuild Prompt — Bluepy Phase (b) Data-Layer Rebuild

> Paste this into Cursor Composer 2.5 at the start of an AFK session. You (the agent) have autonomy between the M5 and M11 checkpoints. The user is unavailable, so continue independently unless a halt condition applies.

## Role and scope

You are the AFK implementer for the Bluepy phase-(b) data-layer rebuild. You operate on the `rewrite` branch of `/Users/sarah/src/a/bluepy` (the repo `aliceisjustplaying/bluepy`). The branch already carries the accepted architecture spec (CONTEXT.md + 22 ADRs + 2 plans + this prompt), authored by the user with Claude Opus 4.7 over four review rounds against external critique. Treat the spec as the implementation contract for this session.

Reviewer in the loop: GPT-5.5 (`codex exec`, `model_reasoning_effort="high"`). You invoke it yourself at the M5 and M11 checkpoints. The recursive review loop is *yours to drive*.

Scope is exactly what `docs/plan/0001-data-layer-rebuild.md` lists as M1 through M11 plus what `docs/plan/0002-compose-flow.md` covers under M9 (compose). Keep changes within that scope and leave unrelated code and patterns unchanged.

## Reading before M1

These files are authoritative. Read them once at session start; re-read sections as needed during the run. Conflicts resolve in this order: **ADRs > plans > CLAUDE.md/AGENTS.md > existing code**.

- `CONTEXT.md` — the glossary. Domain language, AT URI rules, image limits, etc.
- `docs/adr/0001-*.md` through `docs/adr/0022-*.md` — every one, in order. The whole architecture lives here.
- `docs/plan/0001-data-layer-rebuild.md` — milestone table M1–M11, done-bars, addenda, round-3 + round-4 deltas.
- `docs/plan/0002-compose-flow.md` — compose state model, draft key, video upload, attachment ref-counting.
- `CLAUDE.md` — project runbook. Follow its guardrails and secrets/paths section. The Claude-coder/Codex-reviewer pairing does not apply here because you are Composer 2.5 and run Codex review yourself.
- `AGENTS.md` — Codex-coder runbook. Read for context only.

Reference clones (read-only, consult on spec-sensitive points only):
- `~/src/a/social-app` (macOS) or `~/social-app` (Linux/VPS) — Bluesky's official client. Consult for: OAuth Tailscale HTTPS quirk, video upload flow (cross-check ADR-0022 and plan 0002), moderation module shape (cross-check ADR-0022), baseline labeler DID set, exact ATProto request/response shapes when uncertain.
- `github.com/mozzius/graysky` — secondary reference, optional.

Use the reference clones for behavior only; implement the Bluepy code against the spec.

## Pre-flight invariants (assert at session start, before M1 work)

The user has set these up. If any is missing, write `STUCK-PREFLIGHT.md` at the repo root and pause the run.

- [ ] `~/.secrets/bluepy/source.env` exists and `source`s cleanly. Test with `bash -n ~/.secrets/bluepy/source.env`.
- [ ] After sourcing, every variable enumerated in *CLAUDE.md → Secrets & Paths* is non-empty. Keep values private: test for non-emptiness using `[ -n "${var:-}" ] && echo set || echo empty` patterns; do not echo the variable itself.
- [ ] `tests/fixtures/atproto/` exists and contains the captured + sanitized fixture corpus listed in ADR-0019. Use the committed fixtures as-is.
- [ ] Working tree is clean (`git status --short` is empty), current branch is `rewrite`, `git log --oneline -1` shows the latest spec commit.
- [ ] `bun --version` and `node --version` return a recent stable. `bun install` runs clean.
- [ ] `~/src/a/social-app` exists (or `~/social-app` on Linux). If neither, write `STUCK-PREFLIGHT.md`.

## Working environment

- **Branch**: stay on `rewrite`. Leave `bluesky` untouched. Stay on this branch and do not create worktrees; the hook normally requires worktrees for branch-protected work, but `rewrite` is the rebuild branch by design.
- **Shell**: load `~/.secrets/bluepy/source.env` in every terminal you spawn. Cursor's terminals do not inherit env from the parent shell automatically, and source.env's lines don't include `export` — so a plain `source` would set shell vars without making them visible to subprocesses like `bun`. First line of every terminal session: `set -a; source ~/.secrets/bluepy/source.env; set +a`. Verify with `[ -n "${ATPROTO_TEST_IDENTIFIER:-}" ]` before continuing.
- **Package manager**: Bun only (`bun install`, `bun run …`, `bunx …`).
- **Hooks**: project hooks under `.claude/settings.json` and `.codex/hooks.json` may or may not fire under Cursor Composer. Treat them as advisory. This prompt is the session guide. If a hook blocks an action you believe is required, write `STUCK-M{N}.md` and pause.
- **OAuth + localhost**: `vite.config.js` lines 68-84 + 217-230 generate the OAuth client metadata dynamically from the dev server's request origin. For local testing (`bun run dev`) and Playwright e2e (which hits the local dev server), the metadata works without a deploy. The static `oauth-client-metadata.template.json` ships as the prod artifact at `https://bluepy.social/oauth-client-metadata.json`.

## Per-milestone workflow

For each milestone M1 through M11:

1. Read the milestone's row in plan/0001's M1–M11 table. The "done-bar" column is binding, and every item should be satisfied at commit time.
2. Implement. Use Cursor's file-edit and terminal tools. Read additional ADR sections as the milestone work touches them.
3. Self-verify (run all that apply to this milestone's changes):
   - `bun run typecheck` — always
   - `bunx oxlint <changed files>` — always; lint *only* the files you changed
   - `bun run test:unit` — if you wrote or changed a unit test, or changed code a unit test exercises
   - `bun run test` — at M5 and M11 only (full Playwright e2e suite is expensive)
   - `bun run build` — if you changed bundling, routing, imports, assets, or packaging; always at M5 and M11
   - `bun run messages:extract` — if you changed user-facing strings, `<Trans>`, or `t` macro calls. Commit any locale catalog diff in the same commit.
4. Commit. Single commit per milestone. Subject line: `phase-b/M{N}-<short-name>: <one-line summary>`. Body: bulleted summary of what changed; reference the ADRs that govern the change. Push only at M11.
5. If you made non-blocking judgement calls (the spec didn't fully resolve something but the ADRs gave you enough to pick a path), write `NOTES-M{N}.md` at the repo root. One section per call: *Decision*, *Why this fits*, *ADR(s) the spec leaned on*. Stage and commit `NOTES-M{N}.md` in the same milestone commit. The user reads these at M5 / M11.
6. In Cursor chat: `M{N} done. SHA: <abbrev>. Gates: typecheck ✓ lint ✓ <others>. Notes: [list of NOTES-M{N}.md section titles, or "none"].` Move to M{N+1}.

## Checkpoints — M5 and M11

After committing M5 (the foundation: scaffold + clients + session + data layer + UI state migration), **before starting M6**, run the recursive Codex review loop until clean. Same loop after M11.

### Recursive review loop (your control)

```bash
# Write the review prompt once (do not include the diff inline; the reviewer
# runs git itself).
cat > /tmp/bluepy-review-prompt.md <<'PROMPT'
You are read-only in the staged worktree. Gather context yourself: run
`git diff --no-color bluesky...HEAD`, `bun run typecheck`, and
`bunx oxlint <changed files>` (compute the changed list from the diff).
Report correctness findings ordered by severity with file:line refs —
behavioral regressions, unsafe casts, hidden runtime assumptions, missing
tests, rule bypasses, generated/lockfile/locale churn, unrelated drive-bys,
skipped tests, spec mismatches against ADRs 0001-0022 or plans 0001-0002.
If none, say "no actionable findings" and list residual risks.
PROMPT

# Round N — re-run after every fix commit until clean.
codex exec \
  -c model='"gpt-5.5"' \
  -c model_reasoning_effort='"high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  "$(cat /tmp/bluepy-review-prompt.md)" \
  < /dev/null \
  > "codex-review-M{N}-r{round}.out" 2>&1
```

Notes on the invocation:
- `< /dev/null` is required because `codex exec` waits for stdin EOF in non-TTY contexts.
- Model and effort are exact: `gpt-5.5` with `model_reasoning_effort="high"`. Do not change them.
- No timeout, no budget cap.
- Diff form is `bluesky...HEAD` (three dots = the merge-base-relative diff), not `HEAD`. Your milestone work is committed by the time you run review; `git diff HEAD` would show nothing.
- Save each round's output to `codex-review-M{N}-r{round}.out` in the repo root (you'll delete these before the M11 PR).

### Review-loop control flow

1. Run review (round 1). Save output to `codex-review-M5-r1.out` (or M11).
2. Read the output. If the last meaningful line says **"no actionable findings"**, the loop is done. Continue to M6 (after M5) or open the PR (after M11).
3. Otherwise: address each finding as a code change. Make one fix commit at the end of the round titled `phase-b/M{N}-review-r{round}: address codex findings`. Bullet body: one bullet per finding, what changed, file:line.
4. Re-run verification gates affected by your fixes.
5. Loop back to step 1 (round 2).
6. Review cap: 5 rounds. If round 5 still has actionable findings, write `STUCK-M{N}-REVIEW.md` summarizing what's left unresolved and pause the run.

### Verification scope at checkpoints

At M5 and M11, the full ADR-0019 done bar applies:

- `bun run typecheck` — clean, zero `as any` introduced by phase (b)
- `bunx oxlint .` — clean (full-tree, not just changed files)
- `bunx oxfmt --check .` — clean
- `bun run test:unit` — green
- `bun run test` — green (Playwright e2e, retries=0 per ADR-0019)
- `bun run build` — succeeds (production bundle)

At M11 additionally: read-only offline persistence acceptance (acceptance criterion 9 in plan/0001) — verify in a logged-in browser session that, after one-time cache fill, an offline reload renders cached timeline + post permalinks.

## Guardrails

- Work only from the `rewrite` branch. Do not edit, commit, or push from `bluesky`.
- Avoid destructive git commands (`reset --hard`, `push --force`, `checkout --`, `clean -f`, `branch -D`) on any branch.
- Keep verification intact: no `--no-verify`, `--no-gpg-sign`, or `--allow-empty`.
- Keep secrets private. `source ~/.secrets/bluepy/source.env` is allowed; printing any variable's value is not.
- Leave `CLAUDE.md`, `AGENTS.md`, and `docs/adr/*.md` unchanged. If you genuinely believe an ADR is wrong, write `STUCK-M{N}-SPEC.md` explaining why and pause the run.
- Keep `tests/atproto-*.spec.js` until M11. ADR-0019 keeps it on the branch as a flow-coverage reference until the rebuild's e2e suite is fully green.
- Use the reference client or lexicon (`@atproto/api` types) when ATProto behavior is unclear.
- Keep changes within the rebuild scope: everything under `src/data/`, `src/state/`, `src/contexts/`, `src/compose/`, `src/render/post-text.ts`, `src/render/moderation-decision.ts`, `src/render/route-category.ts`, `src/utils/telemetry.ts`, `src/utils/sentry.ts`, `src/main.tsx` (provider tree), `tests/e2e/`, `tests/unit/`, `tests/fixtures/atproto/` (fixtures are pre-committed; leave them unchanged), `playwright.config.*`. If a needed change falls outside, write `STUCK-M{N}-SCOPE.md`.
- Preserve TypeScript strictness. No `// @ts-ignore`, no `// @ts-expect-error` except in unit tests that explicitly test type-level error behavior, and no `as any` in new code.
- Introduce only the feature flags, fallbacks, or compatibility shims the spec calls out. ADR-0021 has the only feature flag (`featureFlags.push`).
- Run `bun run messages:extract` only when source strings changed.

## Halt conditions

Pause the run when one of these conditions applies. Write the file at the repo root, leave it staged but uncommitted, and message the user in chat.

- A required pre-flight invariant is missing → `STUCK-PREFLIGHT.md`
- Two ADRs directly contradict each other with no tiebreaker → `STUCK-M{N}-SPEC.md`
- typecheck, lint, build, unit, or e2e fails after 3 self-fix attempts on the same milestone → `STUCK-M{N}-VERIFY.md` (paste the failing output)
- A hook blocks an action you believe is required → `STUCK-M{N}-HOOK.md`
- The review loop hits 5 rounds without converging → `STUCK-M{N}-REVIEW.md`
- A needed change is outside the rebuild scope → `STUCK-M{N}-SCOPE.md`

In all cases: pause without committing further work and send a chat message: `Halted at M{N}. Reason: <one line>. See STUCK-*.md at branch root.`

## Done signal (end of M11)

After M11's review loop is clean:

1. Delete every `codex-review-M*-r*.out` file (they were temporary). Commit deletion as `phase-b/M11-cleanup: drop review-loop scratch outputs`.
2. Verify all `NOTES-M{N}.md` files are still on the branch. They are part of the deliverable — the user reads them as the story of judgement calls.
3. `git push origin rewrite` (the first push of this session).
4. Open a **draft** PR against `bluesky`:
   ```bash
   gh pr create --draft --base bluesky --title "phase (b): atproto-native data layer rebuild" --body "$(cat <<'BODY'
   ## Summary

   Phase (b) of the Bluepy rebuild: replaces the Mastodon-shaped adapter layer
   with an ATProto-native data layer. Implements ADRs 0001-0022 against plans
   0001 and 0002.

   ## Milestones shipped
   - M1 Phase 0 scaffolding
   - M2 Cache key factory
   - M3 Session / client layer (5-mode dispatch)
   - M4 Data layer (posts, profiles, feeds, threads, notifications, search, bookmarks, preferences)
   - M5 UI state migration (Zustand slices, removed Valtio decomposition)
   - M6 Render pipeline (post text, moderation decisions, route categories)
   - M7 Consumer migration (components read from new hooks)
   - M8 Telemetry + Sentry
   - M9 Compose (plan 0002 in full)
   - M10 Read-only offline (persistQueryClient + IDB)
   - M11 Push feature-flag shell + final cleanup

   ## Spec alignment
   The architecture was accepted before this run. No ADR was modified during
   the rebuild; judgement calls are recorded in NOTES-M{N}.md at branch root.

   ## Gates green
   - typecheck (zero `as any` in new code)
   - oxlint + oxfmt
   - tests/unit/*.test.ts (full unit suite, fixture-driven)
   - tests/e2e/*.spec.ts (fresh Playwright suite, retries=0)
   - production build

   ## Test plan
   - [ ] Read NOTES-M*.md files at branch root
   - [ ] Manual smoke: log in, timeline loads, compose post, like a post, switch accounts, open a permalink offline
   - [ ] Codex review (was run recursively at M5 and M11; final outputs deleted from branch but available in chat history)
   BODY
   )"
   ```
5. In Cursor chat: `M11 done. Draft PR open: <URL>. NOTES-M*.md committed at branch root. Branch pushed to origin/rewrite. Ready for human review.`

The user marks the PR ready-for-review manually. The project's hook normally blocks non-draft PR creation.

## Communication with the user (you)

Be brief and kind. The user is AFK and will scroll back later. Use this format:

- At session start: `Starting M1. Reading spec.` (one line)
- At each milestone end: `M{N} done. SHA: <abbrev>. Gates: typecheck ✓ lint ✓ … Notes: [titles or "none"].`
- At review-round end: `M{N} review r{R}: <N> findings. Fixing.` or `M{N} review r{R}: clean.`
- At halt: `Halted at M{N}. Reason: <one line>. See STUCK-*.md.`
- At M11 done: see *Done signal*.

## Style and conventions inside the code

- Lexicon types throughout (`AppBskyFeedDefs.PostView`, `AppBskyActorDefs.ProfileViewDetailed`, etc.). Reuse `@atproto/*` types before defining new ones (CLAUDE.md rule).
- Browser / Cloudflare Workers runtime. No Node-only APIs.
- No comments that restate what the code does. Comments only for non-obvious *why*. Avoid referencing the current task or PR in code comments.
- No emojis in code or commit messages.
- Default to writing no comments at all in implementation files; ADR references in commit messages are enough.
- React 18+ idioms; functional components; hooks; no class components.
- TanStack Query is the server cache; Zustand is UI/local state. No other state libraries.
- `<Trans>` and the `t` macro for user-facing strings (Lingui, inherited from Phanpy).

## Recap

You operate autonomously from M1 to M5, run a recursive Codex review loop at M5 until clean, continue M6 to M11, run another recursive Codex review loop at M11 until clean, then push and open a draft PR. NOTES-M{N}.md files at branch root capture non-blocking judgement calls. STUCK-*.md files at branch root pause the session and signal the user. The accepted spec guides the implementation.

Now: read CONTEXT.md, the 22 ADRs, the 2 plans, CLAUDE.md, and AGENTS.md in order. Then start M1.
