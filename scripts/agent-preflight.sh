#!/usr/bin/env bash
set -euo pipefail

mode="${1:-agent}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent-common.sh
source "${script_dir}/agent-common.sh"
configure_agent_browser "$script_dir"

require_cmd() {
  command -v "$1" >/dev/null || {
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  }
}

smoke_contains() {
  local name="$1"
  local expected="$2"
  shift 2
  local log_file="${log_dir}/preflight-${name// /-}.log"
  BLUEPY_LOG_SUCCESS_TAIL=8 run_logged "preflight ${name}" "$log_file" "$@"
  grep -q "$expected" "$log_file" || {
    printf 'preflight %s did not print %s\n' "$name" "$expected" >&2
    exit 1
  }
}

smoke_contains_stdin() {
  local name="$1"
  local expected="$2"
  local stdin_file="$3"
  shift 3
  local log_file="${log_dir}/preflight-${name// /-}.log"
  BLUEPY_LOG_SUCCESS_TAIL=8 run_logged_stdin "preflight ${name}" "$log_file" "$stdin_file" "$@"
  grep -q "$expected" "$log_file" || {
    printf 'preflight %s did not print %s\n' "$name" "$expected" >&2
    exit 1
  }
}

check_base() {
  require_cmd bash
  require_cmd bun
  require_cmd curl
  require_cmd gh
  require_cmd git
  require_cmd jq
  require_cmd ssh

  gh auth status -h github.com >/dev/null
  gh repo view "$repo" --json nameWithOwner --jq '.nameWithOwner' >/dev/null

  local ssh_url
  ssh_url="$(gh repo view "$repo" --json sshUrl --jq .sshUrl)"
  run_logged "preflight git ssh" "${log_dir}/preflight-git-ssh.log" \
    git ls-remote "$ssh_url" HEAD

  printf test >"${agent_root}/.preflight-write-test"
  rm -f "${agent_root}/.preflight-write-test"
  printf test >"${log_dir}/.preflight-write-test"
  rm -f "${log_dir}/.preflight-write-test"
}

check_agent() {
  local prompt_file
  require_cmd agent-browser
  require_cmd codex
  require_cmd claude
  run_logged "preflight codex login" "${log_dir}/preflight-codex-login.log" \
    codex login status
  if [[ "${BLUEPY_PREFLIGHT_LLM_SMOKE:-0}" == "1" ]]; then
    prompt_file="$(mktemp)"
    printf 'Reply with EXACTLY CODEX_OK and nothing else.\n' >"$prompt_file"
    smoke_contains_stdin codex CODEX_OK "$prompt_file" codex exec \
      -c "model=\"${BLUEPY_CODEX_MODEL:-gpt-5.5}\"" \
      -c "model_reasoning_effort=\"${BLUEPY_CODEX_REASONING_EFFORT:-high}\"" \
      --dangerously-bypass-approvals-and-sandbox \
      --ignore-rules \
      --skip-git-repo-check \
      -
    rm -f "$prompt_file"
  fi
  smoke_contains claude CLAUDE_OK claude -p \
    --model "${BLUEPY_CLAUDE_MODEL:-claude-opus-4-7}" \
    --effort "${BLUEPY_CLAUDE_EFFORT:-xhigh}" \
    --no-session-persistence \
    "Reply with EXACTLY CLAUDE_OK and nothing else."
}

check_deploy() {
  load_cloudflare_credentials
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" ]]; then
    printf 'missing Cloudflare credentials\n' >&2
    exit 1
  fi

  BLUEPY_LOG_SUCCESS_TAIL=0 run_logged "preflight wrangler whoami" "${log_dir}/preflight-wrangler-whoami.log" \
    bunx wrangler whoami

  local zone
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    zone="$(curl -fsS \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      'https://api.cloudflare.com/client/v4/zones?name=bluepy.social' |
      jq -r '.result[0].id // empty')"
  else
    zone="$(curl -fsS \
      -H "X-Auth-Email: ${CLOUDFLARE_EMAIL}" \
      -H "X-Auth-Key: ${CLOUDFLARE_API_KEY}" \
      'https://api.cloudflare.com/client/v4/zones?name=bluepy.social' |
      jq -r '.result[0].id // empty')"
  fi
  if [[ -z "$zone" ]]; then
    printf 'Cloudflare zone bluepy.social was not visible to the configured credentials\n' >&2
    exit 1
  fi

  bunx wrangler deploy --help | grep -Eq -- '--domain|--custom-domain' || {
    printf 'wrangler deploy does not support custom domains\n' >&2
    exit 1
  }
}

check_base
case "$mode" in
  agent)
    check_agent
    ;;
  deploy)
    check_deploy
    ;;
  all)
    check_agent
    check_deploy
    ;;
  *)
    printf 'usage: scripts/agent-preflight.sh agent|deploy|all\n' >&2
    exit 2
    ;;
esac

summary_line "- preflight ${mode}: ok"
printf 'preflight %s ok\n' "$mode"
