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

current_branch() {
	git branch --show-current 2>/dev/null || true
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

block_on_main_branch() {
	local branch
	branch="$(current_branch)"
	[ "$branch" = "bluesky" ] && deny "do not edit, commit, or push from bluesky; create a task worktree first"
}

guard_bash_command() {
	local cmd="$1"
	[ -z "$cmd" ] && deny "could not parse Bash command from hook payload"

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+push([^;&|]*)(--force|--force-with-lease|-[^-[:space:]]*f)' <<<"$cmd"; then
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

	if rg -q '(^|[;&|[:space:]])git[[:space:]]+(commit|push|add|merge|rebase)(\s|$)' <<<"$cmd"; then
		block_on_main_branch
	fi

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
		if ! rg -q '^(tests/).*sanit|xss|embed|html' <<<"$changed"; then
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
	local scope files status
	if [ "${BLUEPY_HOOK_SKIP_FAST_CHECKS:-0}" = "1" ]; then
		return 0
	fi

	scope="${BLUEPY_HOOK_CHECK_SCOPE:-changed}"
	files="$(source_changed_files | tr '\n' ' ')"
	[ -z "$files" ] && return 0

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
		mapfile -t file_args <<<"$files"
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
	block_on_main_branch
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
