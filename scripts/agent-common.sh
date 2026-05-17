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

run_logged() {
  local name="$1"
  local log_file="$2"
  local status shell_flags
  shift 2

  printf '::group::%s\n' "$name"
  printf 'running %s; full log: %s\n' "$name" "$log_file"

  shell_flags="$-"
  set +e
  "$@" >"$log_file" 2>&1 < /dev/null
  status="$?"
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
