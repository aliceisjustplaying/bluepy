#!/usr/bin/env bash
# shellcheck shell=bash

repo="${BLUEPY_REPO:-${GITHUB_REPOSITORY:-aliceisjustplaying/bluepy}}"
run_id="${GITHUB_RUN_ID:-local}-$(date -u +%Y%m%d%H%M%S)"
agent_root="${BLUEPY_AGENT_ROOT:-/workspace/agent-worktrees/bluepy}"
log_dir="${BLUEPY_AGENT_LOG_DIR:-${agent_root}/logs/${run_id}}"
cloudflare_env_file="${BLUEPY_CF_ENV_FILE:-/home/agent/alice-cf.env}"
cloudflare_email="${BLUEPY_CF_EMAIL:-aliceisjustplaying@gmail.com}"

mkdir -p "$agent_root" "$log_dir"
: "$repo"

summary_line() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >>"$GITHUB_STEP_SUMMARY"
  fi
}

stream_log_progress() {
  local name="$1"
  local log_file="$2"
  local pattern="${BLUEPY_LOG_STREAM_PATTERN:-apply patch|patch: completed|codex|claude|exec|running|Run |Running |passed|failed|Error|error|warning|commit|pull request|created|updated|Verification|Browser|Playwright|agent-browser|wrangler|deploy|upload|Success|Done}"
  local limit="${BLUEPY_LOG_STREAM_LIMIT:-120}"
  local max_len="${BLUEPY_LOG_STREAM_LINE_CHARS:-300}"
  local count=0 line

  while IFS= read -r line; do
    if [[ "$line" =~ $pattern ]]; then
      line="${line//$'\r'/}"
      if (( ${#line} > max_len )); then
        line="${line:0:max_len} ..."
      fi
      printf 'live %s: %s\n' "$name" "$line"
      count=$((count + 1))
      if (( count >= limit )); then
        printf 'live %s: stream limit reached; continuing in full log only\n' "$name"
        return 0
      fi
    fi
  done < <(tail -n 0 -f "$log_file" 2>/dev/null)
}

_run_logged_impl() {
  local name="$1"
  local log_file="$2"
  local stdin_file="$3"
  local status shell_flags command_pid stream_pid start elapsed interval line_count next_heartbeat
  shift 3

  if [[ ! -r "$stdin_file" ]]; then
    printf 'run_logged stdin file is not readable: %s\n' "$stdin_file" >&2
    return 2
  fi

  printf '::group::%s\n' "$name"
  printf 'running %s; full log: %s\n' "$name" "$log_file"
  : >"$log_file"

  shell_flags="$-"
  set +e
  if [[ -n "${BLUEPY_COMMAND_TIMEOUT_SECONDS:-}" ]] && command -v timeout >/dev/null 2>&1; then
    timeout --kill-after="${BLUEPY_COMMAND_KILL_AFTER_SECONDS:-60}" \
      "${BLUEPY_COMMAND_TIMEOUT_SECONDS}" "$@" \
      >>"$log_file" 2>&1 <"$stdin_file" &
  else
    "$@" >>"$log_file" 2>&1 <"$stdin_file" &
  fi
  command_pid="$!"
  stream_pid=""
  if [[ "${BLUEPY_LOG_STREAM:-1}" != "0" ]]; then
    stream_log_progress "$name" "$log_file" &
    stream_pid="$!"
  fi
  start="$SECONDS"
  interval="${BLUEPY_LOG_HEARTBEAT_SECONDS:-30}"
  next_heartbeat="$interval"
  while kill -0 "$command_pid" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((SECONDS - start))
    if (( elapsed >= next_heartbeat )) && kill -0 "$command_pid" >/dev/null 2>&1; then
      line_count="$(wc -l <"$log_file" 2>/dev/null || printf '0')"
      printf 'still running %s (%ss elapsed, %s log lines)\n' "$name" "$elapsed" "$line_count"
      next_heartbeat=$((next_heartbeat + interval))
    fi
  done
  wait "$command_pid"
  status="$?"
  if [[ -n "$stream_pid" ]]; then
    kill "$stream_pid" >/dev/null 2>&1 || true
    wait "$stream_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$shell_flags" == *e* ]]; then
    set -e
  else
    set +e
  fi

  if [[ "$status" -eq 0 ]]; then
    printf '%s ok\n' "$name"
    summary_line "- ${name}: ok (${log_file})"
    tail -n "${BLUEPY_LOG_SUCCESS_TAIL:-40}" "$log_file" || true
    printf '::endgroup::\n'
    return 0
  fi

  printf '%s failed with exit %s; last %s lines from %s:\n' \
    "$name" "$status" "${BLUEPY_LOG_FAILURE_TAIL:-160}" "$log_file" >&2
  tail -n "${BLUEPY_LOG_FAILURE_TAIL:-160}" "$log_file" >&2 || true
  summary_line "- ${name}: failed (${log_file})"
  printf '::endgroup::\n'
  return "$status"
}

run_logged() {
  local name="$1"
  local log_file="$2"
  shift 2
  _run_logged_impl "$name" "$log_file" /dev/null "$@"
}

run_logged_stdin() {
  local name="$1"
  local log_file="$2"
  local stdin_file="$3"
  shift 3
  _run_logged_impl "$name" "$log_file" "$stdin_file" "$@"
}

load_cloudflare_credentials() {
  local api_token global_key
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" || -n "${CLOUDFLARE_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ ! -f "$cloudflare_env_file" ]]; then
    return 0
  fi

  api_token="$(
    sed -n -E 's/^CLOUDFLARE_API_TOKEN=(.*)$/\1/p' "$cloudflare_env_file" |
      tail -n 1 |
      sed -E "s/^['\"]//; s/['\"]$//"
  )"
  if [[ -n "$api_token" ]]; then
    export CLOUDFLARE_API_TOKEN="$api_token"
    return 0
  fi

  global_key="$(
    sed -n -E 's/^ALICE_CF_GLOBAL_KEY=(.*)$/\1/p' "$cloudflare_env_file" |
      tail -n 1 |
      sed -E "s/^['\"]//; s/['\"]$//"
  )"
  if [[ -n "$global_key" ]]; then
    export CLOUDFLARE_API_KEY="$global_key"
    export CLOUDFLARE_EMAIL="${CLOUDFLARE_EMAIL:-${cloudflare_email}}"
  fi
}

configure_agent_browser() {
  local _scripts_dir="$1"
  export BLUEPY_AGENT_BROWSER=1
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-/run/current-system/sw/bin/chromium}"
}
