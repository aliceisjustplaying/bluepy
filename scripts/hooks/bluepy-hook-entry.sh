#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PAYLOAD="$(cat || true)"
GUARD="${BLUEPY_HOOK_GUARD:-scripts/hooks/bluepy-guard.sh}"

payload_strings() {
	if command -v jq >/dev/null 2>&1 && [ -n "$PAYLOAD" ] && jq -e . >/dev/null 2>&1 <<<"$PAYLOAD"; then
		jq -r '.. | strings' <<<"$PAYLOAD" 2>/dev/null
	else
		printf '%s\n' "$PAYLOAD"
	fi
}

payload_targets_guard() {
	payload_strings | rg -q '(^|/|\*\*\* (Add|Update|Delete) File: )scripts/hooks/bluepy-guard\.sh$'
}

block_on_main_branch() {
	local branch
	branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
	if [ "$branch" = "bluesky" ]; then
		printf 'Bluepy hook blocked: do not edit the guard from bluesky; create a task worktree first\n' >&2
		exit 2
	fi
}

if bash -n "$GUARD" 2>/dev/null; then
	if [ "$MODE" = "stop" ]; then
		output="$(mktemp)"
		if printf '%s' "$PAYLOAD" | bash "$GUARD" "$MODE" >"$output" 2>&1; then
			[ -s "$output" ] && cat "$output" >&2
			rm -f "$output"
			printf '{}\n'
			exit 0
		fi
		status=$?
		[ -s "$output" ] && cat "$output" >&2
		rm -f "$output"
		exit "$status"
	fi

	printf '%s' "$PAYLOAD" | bash "$GUARD" "$MODE" >&2
	exit $?
fi

if [ "$MODE" = "pre-write" ] && payload_targets_guard; then
	block_on_main_branch
	printf 'Bluepy hook warning: guard script is syntactically invalid; allowing this write only to repair it\n' >&2
	exit 0
fi

printf 'Bluepy hook blocked: guard script is syntactically invalid; repair scripts/hooks/bluepy-guard.sh with apply_patch\n' >&2
exit 2
