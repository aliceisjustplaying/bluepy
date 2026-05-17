#!/usr/bin/env bash
set -euo pipefail

pr_number="${1:?usage: scripts/deploy-preview.sh <pr-number>}"
worker_name="bluepy-pr-${pr_number}"
commit_hash="$(git rev-parse --short HEAD)"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tmp_output="$(mktemp)"
tmp_body="$(mktemp)"
trap 'rm -f "$tmp_output" "$tmp_body"' EXIT

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" && -f /home/agent/alice-cf.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /home/agent/alice-cf.env
  set +a
  export CLOUDFLARE_API_KEY="${ALICE_CF_GLOBAL_KEY:-}"
  export CLOUDFLARE_EMAIL="${CLOUDFLARE_EMAIL:-aliceisjustplaying@gmail.com}"
fi

bun install --frozen-lockfile
bun run build

if bunx wrangler deploy \
  --env preview \
  --name "$worker_name" \
  --message "PR #${pr_number} ${commit_hash}" \
  --var "BLUEPY_BUILD_TIME:${build_time}" \
  --var "BLUEPY_COMMIT_HASH:${commit_hash}" \
  >"$tmp_output" 2>&1; then
  preview_url="$(grep -Eo 'https://[^[:space:]]+workers\.dev' "$tmp_output" | head -n 1 || true)"
  {
    printf "Preview deployed for \`%s\`.\n\n" "$commit_hash"
    if [[ -n "$preview_url" ]]; then
      printf '%s\n\n' "$preview_url"
      printf "OAuth metadata: \`%s/oauth-client-metadata.json\`\n" "$preview_url"
    else
      printf 'Wrangler did not print a workers.dev URL. Check the workflow log.\n'
    fi
  } >"$tmp_body"
  gh pr comment "$pr_number" --body-file "$tmp_body"
else
  {
    printf "Preview deploy failed for \`%s\`.\n\n" "$commit_hash"
    printf '```text\n'
    tail -n 120 "$tmp_output"
    printf '\n```\n'
  } >"$tmp_body"
  gh pr comment "$pr_number" --body-file "$tmp_body" || true
  cat "$tmp_output"
  exit 1
fi
