# Oxlint category normalization

## Rule / check name

`.oxlintrc.json` `categories` block — currently sets every oxlint category to `error`:

```jsonc
"categories": {
  "correctness": "error",
  "suspicious": "error",
  "pedantic":    "error",
  "perf":        "error",
  "style":       "error",
  "restriction": "error",
  "nursery":     "error"
}
```

This proposal does not target any single rule. It re-tiers the `categories` block so the error count tracks real defects, then re-enables individual rules from the demoted tiers when we want them back.

## Exact command and diagnostic

```bash
bunx oxlint
# Found 150 warnings and 23 755 errors.
# Finished in 10.3s on 257 files with 579 rules using 4 threads.
```

Top 10 rules by current error count (full table in `/tmp/error-counts.txt`, 272 distinct rules firing):

| Rule | Count | Native category |
|---|---|---|
| `typescript/strict-boolean-expressions` | 2 352 | pedantic |
| `typescript/no-unsafe-type-assertion` | 1 394 | suspicious |
| `eslint/no-ternary` | 1 256 | style |
| `eslint/capitalized-comments` | 1 076 | style |
| `eslint/sort-keys` | 859 | style |
| `import/no-relative-parent-imports` | 813 | restriction |
| `typescript/explicit-function-return-type` | 803 | restriction |
| `react-perf/jsx-no-new-function-as-prop` | 721 | perf |
| `eslint/curly` | 700 | style |
| `typescript/no-unnecessary-condition` | 670 | nursery |

Categories verified against `bunx oxlint --rules` taxonomy (oxlint 1.63.0).
`correctness` and `suspicious` rules other than `no-unsafe-type-assertion` sit far down the list. The next entries — `typescript/no-unsafe-assignment` (231), `typescript/no-floating-promises` (207), `react/exhaustive-deps` (161), `react/rules-of-hooks` (146), `typescript/no-deprecated` (129) — straddle `pedantic` and `correctness` (`no-floating-promises` and `exhaustive-deps` are correctness; `rules-of-hooks` and `no-deprecated` are pedantic; the `no-unsafe-*` family is pedantic). The proposal keeps correctness rules at error via the category default and *individually* re-enables the pedantic ones rather than relying on the category default.

## Files blocked

The configuration does not block builds — `bun run build` and `bun run typecheck` pass. It blocks human review delta: when a migration batch lands, the per-file oxlint output is unreadable because it surfaces hundreds of pre-existing rule violations alongside the actual delta. The migration runbook already names this: oxlint output is `informational — project baseline is ~32 000 errors`. With 23 755 errors after the TypeScript conversion, oxlint is still functionally muted.

Effects observed during the migration:

- Codex review prompts had to include the disclaimer `Oxlint output (informational, project baseline ~32 510 errors)` to stop the reviewer from flagging unrelated style violations as findings.
- Per-file oxlint runs against migrated leaves produce 50-300 lines of output where the *new* violation count for the converted file is usually 0-3 lines.
- Several real lint signals (e.g. `react/exhaustive-deps` at 161 hits, `typescript/no-floating-promises` at 207) are buried under thousands of `capitalized-comments`, `sort-keys`, and `no-ternary` hits.

## Why compliant code is worse for this codebase

The codebase was authored upstream (`cheeaun/phanpy`) without these category bans active. Mechanical compliance would mean:

- **`no-ternary` (1 256) + `no-nested-ternary` (126) + `no-implicit-coercion` (402)** — rewrites idiomatic JSX render code into verbose `if/else` branches. The single-expression style is intentional in this codebase.
- **`capitalized-comments` (1 076) + `no-inline-comments` (222)** — purely cosmetic; touches over a thousand lines.
- **`sort-keys` (859) + `sort-imports` (531) + `group-exports` (162) + `exports-last` (105) + `no-named-export` (196)** — opinionated module-layout rules that contradict the existing pattern of mixed named + default exports.
- **`explicit-function-return-type` (803) + `explicit-module-boundary-types` (315) + `prefer-readonly-parameter-types` (459)** — would require annotating every callback in JSX (`onClick`, `onChange`, …) with a return type and `readonly` on every props object. TypeScript inference already covers these. Several modern style guides (Effective TypeScript, Anthony Fu's, the AT Protocol SDK itself) explicitly disable these for non-public APIs.
- **`strict-boolean-expressions` (2 352)** — bans `if (foo)` when `foo: string | undefined`; forces `if (foo != null && foo !== '')`. The current code path is correct and idiomatic; the rule does not catch a real class of bugs in this codebase.
- **`no-unsafe-type-assertion` (1 394)** — the migration deliberately introduced `as unknown as X` shims as documented bridging debt. The rule is in the `suspicious` tier, which this proposal keeps at `error` for genuine bug-catching value. To resolve the contradiction with the migration runbook, the proposed `rules` block explicitly demotes *this one rule* to `warn` so the shims remain visible (chip-away target) without blocking. The remaining `suspicious` rules — `no-shadow`, `no-underscore-dangle`, `no-unused-vars`, `consistent-return`, `no-unnecessary-type-conversion`, `always-return`, `no-array-sort`, `consistent-function-scoping` — stay at `error`.
- **`react-perf/jsx-no-new-function-as-prop` (721) + `jsx-no-new-object-as-prop` (153) + `jsx-no-jsx-as-prop` (117)** — would force `useCallback` / `useMemo` around almost every inline handler. The runtime cost of inline closures in Preact is negligible at this app's scale; the readability cost of memoising every handler is large.
- **`unicorn/no-null` (442)** — bans `null` in favour of `undefined`. Browser APIs and ATProto payload adapters both return `null`; matching them is correct.
- **`oxc/no-async-await` (425)** — bans `async`/`await`. The codebase is built on async/await throughout.

The cumulative cost of mechanical fixes is on the order of tens of thousands of touched lines for zero behavioural improvement, and the rules that *would* catch real bugs (`react/exhaustive-deps + react/rules-of-hooks`, `typescript/no-floating-promises`, `typescript/no-deprecated`) are drowned out today.

## Proposed config change

Three-tier model. Concretely:

```jsonc
"categories": {
  "correctness": "error",
  "suspicious":  "error",
  "perf":        "warn",
  "pedantic":    "off",
  "style":       "off",
  "restriction": "off",
  "nursery":     "off"
}
```

Then, in the `rules` block, re-enable the individually-valuable rules from the demoted tiers at the level we actually want — and explicitly demote the one `suspicious` rule that contradicts the migration runbook:

```jsonc
"rules": {
  // Bug-catching rules from pedantic that we re-enable at error
  // (correctness/suspicious rules don't need entries here — they
  //  are already at error via the category default):
  "typescript/no-deprecated":                     "error",
  "typescript/no-misused-promises":               "error",
  "typescript/switch-exhaustiveness-check":       "error",
  "typescript/restrict-plus-operands":            "error",
  "typescript/only-throw-error":                  "error",
  "typescript/prefer-promise-reject-errors":      "error",
  "react/rules-of-hooks":                         "error",
  "eslint/no-promise-executor-return":            "error",
  "eslint/array-callback-return":                 "error",
  "eslint/no-prototype-builtins":                 "error",
  "eslint/no-redeclare":                          "error",
  "typescript/ban-ts-comment":                    "error",   // runbook bans @ts-ignore / @ts-expect-error
  "react/jsx-no-target-blank":                    "error",   // tabnabbing prevention (security)

  // Bug-catching rules from restriction we re-enable at error:
  "typescript/no-explicit-any":                   "error",
  "typescript/no-invalid-void-type":              "error",
  "typescript/no-non-null-asserted-nullish-coalescing": "error",
  "import/no-cycle":                              "error",
  "promise/catch-or-return":                      "error",

  // Migration-debt rules — kept visible but non-blocking until the
  // `as unknown as X` shims and the `unknown`-typed valtio state
  // surface area introduced during the JS→TS conversion are chipped
  // away. `no-unsafe-type-assertion` fires on every shim (~1 400 sites);
  // the `no-unsafe-*` family fires on every read/call/return through
  // those shims (~740 sites). Same migration-debt pattern, same
  // remediation timeline; promoting to error after the shim count
  // drops below ~50 is a follow-up rule-change proposal.
  "typescript/no-unsafe-type-assertion":          "warn",
  "typescript/no-unsafe-assignment":              "warn",
  "typescript/no-unsafe-member-access":           "warn",
  "typescript/no-unsafe-call":                    "warn",
  "typescript/no-unsafe-return":                  "warn",
  "typescript/no-unsafe-argument":                "warn",

  // Readability-debt rules from pedantic — visible chip-away, not blocking:
  "typescript/strict-void-return":                "warn",
  "typescript/no-confusing-void-expression":      "warn",

  // Unsafe-nullability signal from restriction — kept visible at warn
  // (~154 sites today, mostly `foo!` after defensive checks).
  "typescript/no-non-null-assertion":             "warn",

  // Style rules worth keeping as warn (visible in lint output, not gating):
  "eslint/no-console":                    "warn",   // already pre-existing warn intent
  "eslint/no-alert":                      "warn",   // already in current overrides
  "promise/prefer-await-to-then":         "warn",   // already in current overrides

  // Existing overrides retained as-is.
}
```

Measured effect on this branch with oxlint 1.63.0 after applying the proposed config:

- **2 350 errors / 4 271 warnings** (down from 23 755 errors / 150 warnings today).
- Top remaining **errors** (all `correctness`/`suspicious` or individually re-enabled `pedantic` bug-catchers):
  - `eslint/no-shadow` 307 (suspicious)
  - `eslint/no-underscore-dangle` 280 (suspicious)
  - `eslint/no-unused-vars` 232 (correctness)
  - `typescript/no-floating-promises` 207 (correctness)
  - `typescript/no-unnecessary-type-assertion` 191 (suspicious)
  - `react/exhaustive-deps` 161 (correctness)
  - `react/rules-of-hooks` 146 (pedantic, re-enabled)
  - `typescript/no-deprecated` 129 (pedantic, re-enabled)
- Top remaining **warnings** (migration debt + perf cost-of-readability + style noise):
  - `typescript/no-unsafe-type-assertion` 1 394 (migration-debt cluster)
  - `react-perf/jsx-no-new-function-as-prop` 721 (perf category at warn)
  - `eslint/no-console` 544
  - `typescript/no-unsafe-member-access` 335 (migration-debt cluster)
  - `typescript/no-unsafe-assignment` 231 (migration-debt cluster)
  - `react-perf/jsx-no-new-object-as-prop` 153
  - `typescript/no-confusing-void-expression` 150
- Cosmetic noise (`capitalized-comments`, `sort-keys`, `sort-imports`, `no-ternary`, `curly`, `no-inline-comments`, `prefer-nullish-coalescing`, `strict-boolean-expressions`, `prefer-readonly-parameter-types`, `explicit-function-return-type`, `unicorn/no-null`, `oxc/no-async-await`, `import/no-relative-parent-imports`, `import/no-named-export`, `eslint/max-statements`, `eslint/max-lines-per-function`, …) drops out entirely.

The target is not "near zero" — it is "the error count tracks real defects". 2 350 errors made almost entirely of `no-shadow`, `no-unused-vars`, `no-floating-promises`, `react/exhaustive-deps`, `react/rules-of-hooks`, `no-deprecated`, and unnecessary type assertions is qualitatively different from 23 755 errors of which 95% is style preference.

## Blast radius

- **CI / dev loop**: oxlint is not wired to fail `bun run typecheck`, `bun run build`, or any Playwright run today. The only consumer is human/Codex review. Demoting categories has no runtime effect and no effect on TypeScript checking.
- **Existing overrides**: keep the current `overrides[*.tsx].typescript/prefer-readonly-parameter-types: off` block. It's redundant after this change but harmless.
- **Existing `rules` block tweaks** (no-alert `warn`, prefer-await-to-then `warn`): retained.
- **Diff size**: edits to `.oxlintrc.json` only. No source-file churn.
- **Per-file lint output**: drops from 50-300 lines/file to a handful, restoring oxlint as a useful per-batch signal.

## Rollback plan

Revert the single commit that modifies `.oxlintrc.json`. No state is migrated; the rule taxonomy lives in the lint config alone, and oxlint is informational only. There is no `oxlint --cache` artifact to invalidate.

## Codex review result

**Round 1 (2026-05-13): REVISE** — `gpt-5.5` at high reasoning. Fixes:
- Category-table misattributions corrected: `no-unsafe-type-assertion` → `suspicious`, `no-ternary` → `style`, `no-unnecessary-condition` → `nursery`.
- Internal contradiction resolved by explicitly demoting `typescript/no-unsafe-type-assertion` to `warn`.
- Estimated post-change error count corrected from the prior wishful "<1 000" to a measured number.
- Added bug-catchers from demoted tiers: `switch-exhaustiveness-check`, `restrict-plus-operands`, `no-explicit-any`, `no-invalid-void-type`, `no-non-null-asserted-nullish-coalescing`, `promise/catch-or-return`.
- Wording: "visible in CI" → "visible in lint output".

**Round 2 (2026-05-13): REVISE** — `gpt-5.5` at high reasoning. Fixes:
- Re-evaluated the `typescript/no-unsafe-*` family (`-assignment`, `-member-access`, `-call`, `-return`, `-argument`). They live in `pedantic` and would drop out under `pedantic: off`. They are real bug-catchers but in this codebase they fire predominantly on the migration-debt surface area. Resolution: enable all five individually at `warn` so they are visible chip-away targets without blocking.
- Re-measured post-change impact and updated the count language.
- Fixed prose that informally grouped `react/rules-of-hooks` and `typescript/no-deprecated` under `correctness`/`suspicious` — they are `pedantic`, which is exactly why this proposal *individually* re-enables them at error.

**Round 3 (2026-05-13): REVISE** — `gpt-5.5` at high reasoning. Fixes:
- Removed redundant individual re-enables for rules that are already at error via the `correctness`/`suspicious` category default: `typescript/no-floating-promises` (correctness), `react/exhaustive-deps` (correctness), `typescript/no-unnecessary-type-assertion` (suspicious), `import/no-self-import` (suspicious). The `rules` block now only contains entries that change behaviour relative to the category defaults.
- Added bug-catchers from `pedantic` flagged by Codex: `eslint/no-promise-executor-return`, `eslint/array-callback-return`, `eslint/no-prototype-builtins`, `eslint/no-redeclare`, `typescript/only-throw-error`, `typescript/prefer-promise-reject-errors`.
- Added `typescript/strict-void-return` (61) and `typescript/no-confusing-void-expression` (150) at `warn` so they remain visible without blocking — documented as readability-debt rather than blocked-bug-signal.
- Updated measured count and added full error/warning breakdowns by rule. Removed `react-perf/jsx-no-new-function-as-prop` from the "top remaining errors" list — it is a *warning* under `perf: warn`.
- One claim from Codex round 3 was incorrect against `bunx oxlint --rules`: it asserted that `react/rules-of-hooks` is `correctness`. oxlint 1.63.0 puts it in `pedantic`. The proposal's individual re-enable line is therefore correct and retained.

**Round 4 (2026-05-13): REVISE** — `gpt-5.5` at high reasoning. Fixes:
- Added `typescript/no-non-null-assertion` at `warn` (Codex round 4 flagged it as a restriction-tier nullability signal worth keeping visible at ~154 sites).
- Normalized hook-rule naming across the prose: oxlint's config taxonomy is `react/exhaustive-deps` and `react/rules-of-hooks` (the diagnostic display label `react-hooks(...)` is misleading). The proposal now uses the canonical `react/*` form everywhere.

**Round 5 (2026-05-13): REVISE** — `gpt-5.5` at high reasoning. Fixes:
- Added `typescript/ban-ts-comment: "error"` — pedantic rule that enforces the runbook's ban on `@ts-ignore` / `@ts-expect-error`. Direct policy alignment.
- Added `react/jsx-no-target-blank: "error"` — pedantic rule that catches `target="_blank"` links missing `rel="noopener noreferrer"` (tabnabbing prevention; security-relevant rather than style).
- Updated measured count to **2 350 errors / 4 271 warnings** with both rules enabled.

**Round 6 (2026-05-13): APPROVED** — `gpt-5.5` at high reasoning. User exercised the soft-cap exception to run one additional round. Codex verdict (verbatim):

> APPROVED — re-tier categories to `correctness/suspicious: error`, `perf: warn`, `pedantic/style/restriction/nursery: off`, with the listed rule-level re-enables/demotions.

Caveats noted by Codex (all wording, no behavioural change):
- Hook rule names: use canonical `react/exhaustive-deps` and `react/rules-of-hooks` in config; `react-hooks/*` is diagnostic display wording.
- The old `<1 000` target is not plausible; the measured ~2.3k target is.
- Stale prose saying `2 316 errors` updated to the current `2 350`.
- `typescript/no-unsafe-type-assertion` is `suspicious`; the rest of the unsafe family is `pedantic`.
- No additional demoted rules are strong enough to block; the kept set covers the main bug / security / runbook signals.

All caveats addressed in this revision.

**Per the runbook rule-change protocol, this proposal is now approved and may be applied** as a single `.oxlintrc.json` commit with message starting `Adjust lint rule:`.

```bash
codex exec \
  -c model='"gpt-5.5"' \
  -c model_reasoning_effort='"high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  < /tmp/codex-proposal-review-prompt.txt > codex-review-oxlint-categories.out 2>&1
```

Per the runbook, automation may apply this rule change only if Codex's review explicitly approves it, the change is committed under a message starting with `Adjust lint rule:`, and the next migration batch confirms the adjusted rule no longer hides unrelated findings (the migration is now complete, so the equivalent confirmation is: per-file oxlint output on three sample TS files drops below 20 errors each).
