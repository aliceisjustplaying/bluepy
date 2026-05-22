#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PAYLOAD="$(cat || true)"

require_tool() {
	local tool="$1"
	command -v "$tool" >/dev/null 2>&1 || deny "$tool is required for Bluepy hooks"
}

deny() {
	printf 'Bluepy hook blocked: %s\n' "$*" >&2
	exit 2
}

warn() {
	printf 'Bluepy hook warning: %s\n' "$*" >&2
}

json_field() {
	local filter="$1"
	if command -v jq >/dev/null 2>&1 && [ -n "$PAYLOAD" ]; then
		jq -r "$filter // empty" 2>/dev/null <<<"$PAYLOAD" || true
	elif [ -n "$PAYLOAD" ]; then
		deny "jq is required to parse hook payloads"
	fi
}

tool_command() {
	json_field '.tool_input.command // .tool_input.cmd // .tool_input.args.command'
}

tool_workdir() {
	json_field '.tool_input.workdir // .tool_input.working_dir // .tool_input.cwd // .tool_input.current_working_directory // .workdir // .working_dir // .cwd // .current_working_directory'
}

patch_file_paths() {
	[ -n "$PAYLOAD" ] || return 0
	if command -v jq >/dev/null 2>&1 && jq -e . >/dev/null 2>&1 <<<"$PAYLOAD"; then
		jq -r '.. | strings | select(test("\\*\\*\\* (Add|Update|Delete) File: "))' <<<"$PAYLOAD" 2>/dev/null
	else
		printf '%s\n' "$PAYLOAD"
	fi | sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.+)$/\2/p'
}

changed_files() {
	{
		git diff --name-only --diff-filter=ACMR HEAD -- 2>/dev/null || true
		git diff --cached --name-only --diff-filter=ACMR -- 2>/dev/null || true
		git ls-files --others --exclude-standard 2>/dev/null || true
	} | sort -u
}

code_changed_files() {
	changed_files | rg '\.(cjs|js|jsx|mjs|ts|tsx)$' || true
}

source_changed_files() {
	changed_files | rg '^(src|tests|scripts|workers)/|^(vite|playwright|tsconfig|oxlint)\.' || true
}

normalize_path() {
	# Strip one layer of surrounding quotes and expand a leading ~ / $HOME so a
	# parsed path can be tested against the filesystem. We never eval.
	local p="$1"
	p="${p#[\"\']}"
	p="${p%[\"\']}"
	p="${p/#\~/$HOME}"
	p="${p//\$HOME/$HOME}"
	p="${p//\$\{HOME\}/$HOME}"
	printf '%s' "$p"
}

block_on_main_branch() {
	local dir branch
	dir="${1:-$ROOT}"
	# A new file can live under a not-yet-created directory; walk up to the
	# nearest existing ancestor so we still resolve the right worktree.
	while [ -n "$dir" ] && [ "$dir" != "/" ] && [ ! -d "$dir" ]; do
		dir="$(dirname "$dir")"
	done
	branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
	if [ "$branch" = "bluesky" ]; then
		deny "do not edit, commit, or push from bluesky; create a task worktree first"
	fi
}

guard_bash_command() {
	local cmd="$1"
	[ -z "$cmd" ] && deny "could not parse Bash command from hook payload"

	local effective_root requested_workdir
	effective_root="$ROOT"
	requested_workdir="$(tool_workdir)"
	if [ -n "$requested_workdir" ]; then
		requested_workdir="$(normalize_path "$requested_workdir")"
		if [ -d "$requested_workdir" ]; then
			effective_root="$(git -C "$requested_workdir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$requested_workdir")"
		fi
	fi

	# Match force flags only as whole tokens. The previous `-[^-[:space:]]*f`
	# matched the `-f` *inside* ordinary branch/ref names (e.g. `kill-feature`,
	# `my-fix`, `refs/heads/foo-f`), false-blocking legitimate pushes.
	if rg -q '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]]+([^;&|]*[[:space:]])?(--force(-with-lease|-if-includes)?([[:space:]=]|$)|-[[:alpha:]]*f[[:alpha:]]*([[:space:]]|$))' <<<"$cmd"; then
		deny "force-push is not part of the Bluepy workflow"
	fi

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*[[:space:]]\+[^[:space:];&|]+' <<<"$cmd"; then
		deny "force-push refspecs are not part of the Bluepy workflow"
	fi

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+reset[[:space:]]+--hard(\s|$)' <<<"$cmd"; then
		deny "git reset --hard needs explicit human approval"
	fi

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+clean[[:space:]][^;&|]*-[^;&|]*f' <<<"$cmd"; then
		deny "git clean -f needs explicit human approval"
	fi

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+checkout[[:space:]]+--(\s|$)' <<<"$cmd"; then
		deny "broad git checkout -- needs explicit human approval"
	fi

	# Direct `git <verb>` runs in the shell's cwd. Determining that cwd from an
	# arbitrary shell string is unsound, so this is deliberately conservative:
	# we only trust the exact `cd <existing-dir> && git …` worktree idiom — a
	# single leading `cd`, joined with `&&`, to a directory that exists.
	# Anything else (bare git, multiple cds, `;`/`||` separators, a non-existent
	# target) falls back to the session root and so fails closed on bluesky.
	if rg -q '(^|[;&|[:space:]])git[[:space:]]+(commit|push|add|merge|rebase)(\s|$)' <<<"$cmd"; then
		local workdir="$effective_root" cdcount cdre target
		# `|| true` keeps a no-match `rg` (exit 1) from tripping `set -o pipefail`
		# and aborting the hook before the branch check — that would fail open.
		cdcount="$({ rg -o '(^|[;&|])[[:space:]]*cd[[:space:]]' <<<"$cmd" || true; } | wc -l | tr -d '[:space:]')"
		cdre=$'^[[:space:]]*cd[[:space:]]+("[^"]+"|\'[^\']+\'|[^[:space:];&|]+)[[:space:]]*&&'
		if [ "$cdcount" = "1" ] && [[ "$cmd" =~ $cdre ]]; then
			target="$(normalize_path "${BASH_REMATCH[1]}")"
			[ -d "$target" ] && workdir="$target"
		fi
		block_on_main_branch "$workdir"
	fi

	# `git -C <dir> <verb>` runs against <dir> regardless of the shell's cwd, so
	# check that target directly (the `-C` form is not matched by the rule above).
	local gitcre
	gitcre=$'git[[:space:]]+-C[[:space:]]+("[^"]+"|\'[^\']+\'|[^[:space:];&|]+)[[:space:]]+(commit|push|add|merge|rebase)'
	if [[ "$cmd" =~ $gitcre ]]; then
		block_on_main_branch "$(normalize_path "${BASH_REMATCH[1]}")"
	fi

	# NOTE: Statically determining git's effective target from a shell string is
	# unsound. This guard is a tripwire for the cooperative agent workflow, not a
	# security boundary: deliberate target overrides (multiple `-C`, `GIT_DIR`/
	# `GIT_WORK_TREE`, `--git-dir`, `eval`, command substitution) can still slip
	# past. For airtight enforcement add a git `pre-commit`/`pre-push` hook (via
	# core.hooksPath) that rejects work on the `bluesky` branch in git's own
	# resolved context.

	if rg -q '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create(\s|$)' <<<"$cmd" && ! rg -q '(^|\s)--draft(\s|$)' <<<"$cmd"; then
		deny "Bluepy PRs must be opened as draft"
	fi

	if rg -q '(^|[;&|[:space:]])wrangler[[:space:]]+deploy(\s|$)' <<<"$cmd" && ! rg -q -- '--env[[:space:]]+dev|--env=dev' <<<"$cmd"; then
		deny "production Worker deploys are human-only; agent deploy commands must use --env dev"
	fi

	if rg -q '(^|[;&|[:space:]])(cat|sed|grep|rg|awk|nl|head|tail|less|more)[[:space:]][^;&|]*~?/?\.secrets/bluepy/' <<<"$cmd"; then
		deny "do not print Bluepy secret files; source ~/.secrets/bluepy/source.env is allowed"
	fi

	if rg -q '(^|[;&|[:space:]])(env|printenv)(\s|$).*(CLOUDFLARE|ATPROTO|PASSWORD|API_KEY)|echo[[:space:]]+["'\'']?\$[A-Z0-9_]*(PASSWORD|API_KEY|SECRET|TOKEN)' <<<"$cmd"; then
		deny "do not print secret-shaped environment variables"
	fi

	if rg -q 'set[[:space:]]+-x.*\.secrets/bluepy|\.secrets/bluepy.*set[[:space:]]+-x' <<<"$cmd"; then
		deny "do not enable shell tracing around secret loading"
	fi

	if rg -q -- '(^|[;&|[:space:]])git[[:space:]]+(commit|push)[^;&|]*(--no-verify|--no-gpg-sign)(\s|$)' <<<"$cmd"; then
		deny "do not bypass verification flags"
	fi
}

guard_forbidden_patterns() {
	local files diff pattern
	pattern='(@ts-ignore|@ts-expect-error|eslint-disable|\.skip\(|\.only\(|xfail|as[[:space:]]+any\b|:[[:space:]]*any([,;)=]|$))'
	files="$(code_changed_files | rg -v '^scripts/hooks/' || true)"
	[ -z "$files" ] && return 0

	diff="$(
		printf '%s\n' "$files" | git diff --cached -U0 --pathspec-from-file=- -- 2>/dev/null || true
		printf '%s\n' "$files" | git diff -U0 --pathspec-from-file=- -- 2>/dev/null || true
	)"
	diff="$(printf '%s\n' "$diff" | rg '^\+' | rg -v '^\+\+\+' || true)"
	if [ -n "$diff" ] && rg -q "$pattern" <<<"$diff"; then
		deny "forbidden bypass added in code diff"
	fi

	while IFS= read -r file; do
		if [ -n "$(git ls-files --others --exclude-standard -- "$file" 2>/dev/null || true)" ]; then
			if rg -q "$pattern" "$file"; then
				deny "forbidden bypass added in new code file"
			fi
		fi
	done <<<"$files"
}

guard_runbook_mirror() {
	local changed
	changed="$(changed_files)"
	if rg -q '^AGENTS\.md$' <<<"$changed" || rg -q '^CLAUDE\.md$' <<<"$changed"; then
		if ! rg -q '^AGENTS\.md$' <<<"$changed" || ! rg -q '^CLAUDE\.md$' <<<"$changed"; then
			deny "AGENTS.md and CLAUDE.md mirror each other; change both together"
		fi
		bun scripts/hooks/mirror-runbooks.js
	fi
}

guard_locale_churn() {
	local changed po_count
	changed="$(changed_files)"

	if rg -q '^src/locales/pseudo-LOCALE\.po$' <<<"$changed"; then
		if ! [ -e src/locales/pseudo-LOCALE.po ]; then
			deny "pseudo-LOCALE.po was deleted; restore it from fork/bluesky"
		fi
	fi

	po_count="$(printf '%s\n' "$changed" | rg -c '^src/locales/.*\.po$' || true)"
	if [ "${po_count:-0}" -gt 3 ]; then
		warn "broad locale catalog churn detected (${po_count} .po files); keep catalog diffs limited to this PR's source string changes"
	fi
}

warn_i18n_needed() {
	local diff changed
	diff="$(
		git diff --cached -U0 -- src 2>/dev/null || true
		git diff -U0 -- src 2>/dev/null || true
	)"
	diff="$(printf '%s\n' "$diff" | rg '^\+' | rg -v '^\+\+\+' || true)"
	changed="$(changed_files)"
	if rg -q '(<Trans\b|t`|msg`|i18n\._|defineMessage|message=[{"][^}"])' <<<"$diff"; then
		if ! rg -q '^src/locales/.*\.po$' <<<"$changed"; then
			warn "user-facing string changes detected without locale catalog changes; run bun run messages:extract or explain why not"
		fi
	fi
}

warn_behavioral_tests() {
	local changed assertion_files payload_diff
	changed="$(changed_files)"

	if rg -q 'src/(components/(timeline|status|compose|notification)|pages/(status|settings|login|notifications)|utils/(atproto|router|route|compose|notification|settings))' <<<"$changed"; then
		if ! rg -q '^(tests/|src/.*\.(test|spec)\.)' <<<"$changed"; then
			warn "behavioral surface changed without an obvious regression test"
		fi
	fi

	if rg -q 'src/.*(sanitize|embed|html|emoj|status-content|post-embed)' <<<"$changed"; then
		if ! rg -q '^tests/.*(sanit|xss|embed|html)' <<<"$changed"; then
			warn "HTML/sanitizer-adjacent code changed without an obvious XSS/sanitizer test"
		fi
	fi

	if rg -q 'src/.*compose' <<<"$changed"; then
		assertion_files="$(changed_files | rg '^(tests|src)/' || true)"
		payload_diff="$(
			git diff --cached -- tests src 2>/dev/null
			git diff -- tests src 2>/dev/null
		)"
		if rg -q 'com\.atproto\.repo\.createRecord|createRecord' <<<"$payload_diff"; then
			return 0
		fi
		if [ -n "$assertion_files" ]; then
			while IFS= read -r file; do
				if rg -q 'com\.atproto\.repo\.createRecord|createRecord' "$file" 2>/dev/null; then
					return 0
				fi
			done <<<"$assertion_files"
		fi
		warn "compose code changed without an obvious createRecord payload assertion"
	fi
}

run_fast_checks() {
	local scope status
	local -a file_args
	if [ "${BLUEPY_HOOK_SKIP_FAST_CHECKS:-0}" = "1" ]; then
		return 0
	fi

	scope="${BLUEPY_HOOK_CHECK_SCOPE:-changed}"
	mapfile -t file_args < <(source_changed_files)
	[ "${#file_args[@]}" -eq 0 ] && return 0

	status=0

	if [ ! -d node_modules ]; then
		warn "node_modules is missing; run bun install before trusting typecheck/lint hooks"
		return 0
	fi

	if [ ! -d src/iconify-icons ]; then
		warn "generated icons are missing; run bun install before trusting typecheck/lint hooks"
		return 0
	fi

	if ! bun run typecheck; then
		warn "typecheck failed; fix before PR handoff"
		status=1
	fi

	if [ "$scope" = "full" ]; then
		bunx oxlint . || status=1
		bunx oxfmt --check . || status=1
	else
		bunx oxlint "${file_args[@]}" || status=1
		bunx oxfmt --check "${file_args[@]}" || status=1
	fi

	if [ "$status" -ne 0 ]; then
		if [ "${BLUEPY_HOOK_STRICT_CHECKS:-0}" = "1" ]; then
			deny "fast verification failed"
		fi
		warn "fast verification failed; set BLUEPY_HOOK_STRICT_CHECKS=1 to make this blocking"
	fi
}

case "$MODE" in
pre-bash)
	require_tool rg
	require_tool jq
	guard_bash_command "$(tool_command)"
	;;
pre-write)
	file_path="$(json_field '.tool_input.file_path')"
	workdir="$(tool_workdir)"
	paths="$(patch_file_paths)"
	patch_root="$ROOT"
	if [ -n "$workdir" ]; then
		patch_root="$(normalize_path "$workdir")"
	fi
	checked_target=0

	if [ -n "$file_path" ]; then
		block_on_main_branch "$(dirname "$file_path")"
		checked_target=1
	fi
	if [ -n "$workdir" ]; then
		block_on_main_branch "$(normalize_path "$workdir")"
		checked_target=1
	fi
	if [ -n "$paths" ]; then
		while IFS= read -r patch_path; do
			[ -n "$patch_path" ] || continue
			patch_path="$(normalize_path "$patch_path")"
			if [[ "$patch_path" = /* ]]; then
				block_on_main_branch "$(dirname "$patch_path")"
			else
				block_on_main_branch "$(dirname "$patch_root/$patch_path")"
			fi
		done <<<"$paths"
		checked_target=1
	fi
	if [ "$checked_target" -eq 0 ]; then
		block_on_main_branch
	fi
	;;
post-edit)
	require_tool rg
	guard_forbidden_patterns
	guard_runbook_mirror
	guard_locale_churn
	warn_i18n_needed
	warn_behavioral_tests
	;;
stop)
	require_tool rg
	guard_forbidden_patterns
	guard_runbook_mirror
	guard_locale_churn
	warn_i18n_needed
	warn_behavioral_tests
	run_fast_checks
	;;
*)
	deny "unknown hook mode: ${MODE:-<empty>}"
	;;
esac
