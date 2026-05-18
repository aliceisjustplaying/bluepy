#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent-common.sh
source "${script_dir}/agent-common.sh"

pr_number="${1:?usage: scripts/deploy-preview.sh <pr-number>}"
worker_name="bluepy-pr-${pr_number}"
preview_host="pr-${pr_number}.bluepy.social"
preview_url="https://${preview_host}"
commit_hash="$(git rev-parse --short HEAD)"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tmp_body="$(mktemp)"
wrangler_log="${log_dir}/wrangler-preview-pr-${pr_number}-${commit_hash}.log"
preview_actual_commit=""
preview_metadata_client=""
trap 'rm -f "$tmp_body"' EXIT

load_cloudflare_credentials

verify_preview() {
  local attempt version_json metadata_json
  for attempt in {1..24}; do
    version_json="$(curl -fsS --connect-timeout 10 "${preview_url}/version.json" 2>/dev/null || true)"
    metadata_json="$(curl -fsS --connect-timeout 10 "${preview_url}/oauth-client-metadata.json" 2>/dev/null || true)"
    preview_actual_commit="$(jq -r '.commitHash // empty' <<<"$version_json" 2>/dev/null || true)"
    preview_metadata_client="$(jq -r '.client_id // empty' <<<"$metadata_json" 2>/dev/null || true)"
    if [[ "$preview_actual_commit" == "$commit_hash" && "$preview_metadata_client" == "${preview_url}/oauth-client-metadata.json" ]]; then
      return 0
    fi
    if ((attempt < 12)); then
      sleep 5
    else
      sleep 10
    fi
  done

  printf 'Preview verification failed for %s\n' "$preview_url" >&2
  printf 'Expected commit: %s\n' "$commit_hash" >&2
  printf 'Actual commit: %s\n' "${preview_actual_commit:-<missing>}" >&2
  printf 'OAuth client_id: %s\n' "${preview_metadata_client:-<missing>}" >&2
  return 1
}

run_logged "bun install" "${log_dir}/preview-bun-install-pr-${pr_number}-${commit_hash}-$(date -u +%Y%m%d%H%M%S-%N).log" \
  bun install --frozen-lockfile
run_logged "bun build" "${log_dir}/preview-build-pr-${pr_number}-${commit_hash}-$(date -u +%Y%m%d%H%M%S-%N).log" \
  bun run build

if run_logged "wrangler deploy preview" "$wrangler_log" bunx wrangler deploy \
  --env preview \
  --name "$worker_name" \
  --domain "$preview_host" \
  --message "PR #${pr_number} ${commit_hash}" \
  --var "BLUEPY_BUILD_TIME:${build_time}" \
  --var "BLUEPY_COMMIT_HASH:${commit_hash}"; then
  if ! verify_preview; then
    {
      printf "Preview verification failed for \`%s\`.\n\n" "$commit_hash"
      printf "Expected \`%s/version.json\` to report \`%s\` and OAuth metadata to use the preview origin.\n\n" "$preview_url" "$commit_hash"
      printf "Actual commit: \`%s\`\n\n" "${preview_actual_commit:-<missing>}"
      printf "OAuth client_id: \`%s\`\n\n" "${preview_metadata_client:-<missing>}"
      printf "Wrangler log: \`%s\`\n" "$wrangler_log"
    } >"$tmp_body"
    gh pr comment "$pr_number" --repo "$repo" --body-file "$tmp_body" || true
    exit 1
  fi

  {
    printf "Preview deployed for \`%s\`.\n\n" "$commit_hash"
    printf '%s\n\n' "$preview_url"
    printf "OAuth metadata: \`%s/oauth-client-metadata.json\`\n" "$preview_url"
    printf "\nVerified \`version.json\` and OAuth metadata.\n"
  } >"$tmp_body"
  gh pr comment "$pr_number" --repo "$repo" --body-file "$tmp_body"
else
  {
    printf "Preview deploy failed for \`%s\`.\n\n" "$commit_hash"
    printf '```text\n'
    tail -n 120 "$wrangler_log"
    printf '\n```\n'
  } >"$tmp_body"
  gh pr comment "$pr_number" --repo "$repo" --body-file "$tmp_body" || true
  exit 1
fi
