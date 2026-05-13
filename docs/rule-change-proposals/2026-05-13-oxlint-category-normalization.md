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
| `typescript/no-unsafe-type-assertion` | 1 394 | restriction |
| `eslint/no-ternary` | 1 256 | restriction |
| `eslint/capitalized-comments` | 1 076 | style |
| `eslint/sort-keys` | 859 | style |
| `import/no-relative-parent-imports` | 813 | restriction |
| `typescript/explicit-function-return-type` | 803 | restriction |
| `react-perf/jsx-no-new-function-as-prop` | 721 | perf |
| `eslint/curly` | 700 | style |
| `typescript/no-unnecessary-condition` | 670 | pedantic |

`correctness` and `suspicious` rules sit far down the list — `react-hooks/exhaustive-deps` (161) and `react-hooks/rules-of-hooks` (146) are the only sub-200 rules in those tiers, and most other entries are `restriction` / `style` / `pedantic` noise.

## Files blocked

The configuration does not block builds — `bun run build` and `bun run typecheck` pass. It blocks human review delta: when a migration batch lands, the per-file oxlint output is unreadable because it surfaces hundreds of pre-existing rule violations alongside the actual delta. The migration runbook already names this: oxlint output is `informational — project baseline is ~32 000 errors`. With 23 755 errors after the TypeScript conversion, oxlint is still functionally muted.

Effects observed during the migration:

- Codex review prompts had to include the disclaimer `Oxlint output (informational, project baseline ~32 510 errors)` to stop the reviewer from flagging unrelated style violations as findings.
- Per-file oxlint runs against migrated leaves produce 50-300 lines of output where the *new* violation count for the converted file is usually 0-3 lines.
- Several real lint signals (e.g. `react-hooks/exhaustive-deps` at 161 hits, `typescript/no-floating-promises` at 207) are buried under thousands of `capitalized-comments`, `sort-keys`, and `no-ternary` hits.

## Why compliant code is worse for this codebase

The codebase was authored upstream (`cheeaun/phanpy`) without these category bans active. Mechanical compliance would mean:

- **`no-ternary` (1 256) + `no-nested-ternary` (126) + `no-implicit-coercion` (402)** — rewrites idiomatic JSX render code into verbose `if/else` branches. The single-expression style is intentional in this codebase.
- **`capitalized-comments` (1 076) + `no-inline-comments` (222)** — purely cosmetic; touches over a thousand lines.
- **`sort-keys` (859) + `sort-imports` (531) + `group-exports` (162) + `exports-last` (105) + `no-named-export` (196)** — opinionated module-layout rules that contradict the existing pattern of mixed named + default exports.
- **`explicit-function-return-type` (803) + `explicit-module-boundary-types` (315) + `prefer-readonly-parameter-types` (459)** — would require annotating every callback in JSX (`onClick`, `onChange`, …) with a return type and `readonly` on every props object. TypeScript inference already covers these. Several modern style guides (Effective TypeScript, Anthony Fu's, the AT Protocol SDK itself) explicitly disable these for non-public APIs.
- **`strict-boolean-expressions` (2 352)** — bans `if (foo)` when `foo: string | undefined`; forces `if (foo != null && foo !== '')`. The current code path is correct and idiomatic; the rule does not catch a real class of bugs in this codebase.
- **`no-unsafe-type-assertion` (1 394)** — the migration deliberately introduced `as unknown as X` shims as documented bridging debt. The rule, at error level, contradicts the migration runbook.
- **`react-perf/jsx-no-new-function-as-prop` (721) + `jsx-no-new-object-as-prop` (153) + `jsx-no-jsx-as-prop` (117)** — would force `useCallback` / `useMemo` around almost every inline handler. The runtime cost of inline closures in Preact is negligible at this app's scale; the readability cost of memoising every handler is large.
- **`unicorn/no-null` (442)** — bans `null` in favour of `undefined`. The DOM and `masto` API both return `null`; matching them is correct.
- **`oxc/no-async-await` (425)** — bans `async`/`await`. The codebase is built on async/await throughout.

The cumulative cost of mechanical fixes is on the order of tens of thousands of touched lines for zero behavioural improvement, and the rules that *would* catch real bugs (`react-hooks/*`, `typescript/no-floating-promises`, `typescript/no-deprecated`) are drowned out today.

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

Then, in the `rules` block, re-enable the individually-valuable rules from the demoted tiers at the level we actually want:

```jsonc
"rules": {
  // Bug-catching rules from pedantic / restriction that we DO want at error:
  "typescript/no-floating-promises":      "error",
  "typescript/no-deprecated":             "error",
  "typescript/no-misused-promises":       "error",
  "typescript/no-unnecessary-type-assertion": "error",
  "react-hooks/exhaustive-deps":          "error",
  "react-hooks/rules-of-hooks":           "error",
  "import/no-cycle":                      "error",
  "import/no-self-import":                "error",

  // Style rules worth keeping as warn (visible in CI, not gating):
  "eslint/no-console":                    "warn",   // already pre-existing warn intent
  "eslint/no-alert":                      "warn",   // already in current overrides
  "promise/prefer-await-to-then":         "warn",   // already in current overrides

  // Existing overrides retained as-is.
}
```

Estimated effect on the error count: most of the top 25 rules drop out (style + restriction + pedantic categories collectively account for >18 000 hits). Remaining error count target: under 1 000, dominated by `react-hooks/*`, `typescript/no-floating-promises`, and any genuine correctness violations.

## Blast radius

- **CI / dev loop**: oxlint is not wired to fail `bun run typecheck`, `bun run build`, or any Playwright run today. The only consumer is human/Codex review. Demoting categories has no runtime effect and no effect on TypeScript checking.
- **Existing overrides**: keep the current `overrides[*.tsx].typescript/prefer-readonly-parameter-types: off` block. It's redundant after this change but harmless.
- **Existing `rules` block tweaks** (no-alert `warn`, prefer-await-to-then `warn`): retained.
- **Diff size**: edits to `.oxlintrc.json` only. No source-file churn.
- **Per-file lint output**: drops from 50-300 lines/file to a handful, restoring oxlint as a useful per-batch signal.

## Rollback plan

Revert the single commit that modifies `.oxlintrc.json`. No state is migrated; the rule taxonomy lives in the lint config alone, and oxlint is informational only. There is no `oxlint --cache` artifact to invalidate.

## Codex review result

Pending. Will run with the canonical CLI invocation:

```bash
codex exec \
  -c model='"gpt-5.5"' \
  -c model_reasoning_effort='"high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  "$PROMPT" < /dev/null > codex-review-oxlint-categories.out 2>&1
```

Review prompt asks Codex to verify:

- The proposed `correctness`/`suspicious` retention catches the same real-bug class as the current `error` setting for those categories (no regression in bug detection).
- The individually re-enabled rules (`react-hooks/*`, `typescript/no-floating-promises`, `typescript/no-deprecated`, etc.) are correctly named and supported by oxlint.
- No rule in `restriction` or `pedantic` is silently load-bearing for bug detection in this codebase — i.e. demoting them to `off` does not unmask a real defect.
- The change is narrower than disabling oxlint entirely.

Per the runbook, automation may apply this rule change only if Codex's review explicitly approves it, the change is committed under a message starting with `Adjust lint rule:`, and the next migration batch confirms the adjusted rule no longer hides unrelated findings (the migration is now complete, so the equivalent confirmation is: per-file oxlint output on three sample TS files drops below 20 errors each).
