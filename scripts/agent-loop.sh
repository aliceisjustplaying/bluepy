#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent-common.sh
source "${script_dir}/agent-common.sh"
configure_agent_browser "$script_dir"

mode="${1:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
number="${2:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
base_branch="${BASE_BRANCH:-bluesky}"
review_schema_file="${script_dir}/agent-review.schema.json"
review_rounds="${BLUEPY_REVIEW_ROUNDS:-5}"
verify_fix_rounds="${BLUEPY_VERIFY_FIX_ROUNDS:-1}"
codex_model="${BLUEPY_CODEX_MODEL:-gpt-5.5}"
codex_reasoning_effort="${BLUEPY_CODEX_REASONING_EFFORT:-high}"
claude_model="${BLUEPY_CLAUDE_MODEL:-claude-opus-4-7}"
claude_effort="${BLUEPY_CLAUDE_EFFORT:-xhigh}"
human_review_mention="${BLUEPY_HUMAN_REVIEW_MENTION:-}"
last_verification_summary=""

comment_body() {
  local issue="$1"
  local body_file="$2"
  gh issue comment "$issue" --repo "$repo" --body-file "$body_file"
}

comment_text() {
  local issue="$1"
  local text="$2"
  local body_file
  body_file="$(mktemp)"
  printf '%s\n' "$text" >"$body_file"
  comment_body "$issue" "$body_file" || true
  rm -f "$body_file"
}

ensure_label() {
  local name="$1"
  local color="$2"
  gh label create "$name" --color "$color" --repo "$repo" >/dev/null 2>&1 || true
}

ensure_agent_labels() {
  ensure_label agent:preview 5319e7
  ensure_label human-review 2da44e
  ensure_label needs-human d73a4a
}

use_repo_ssh_remote() {
  git remote set-url origin "$(gh repo view "$repo" --json sshUrl --jq .sshUrl)"
}

remote_branch_exists() {
  local branch="$1"
  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1
}

worktree_is_dirty() {
  [[ -n "$(git status --porcelain)" ]]
}

push_current_head() {
  local branch="$1"
  git push -u origin "HEAD:${branch}"
}

prepare_issue_worktree() {
  local branch="$1"
  local worktree="$2"

  use_repo_ssh_remote
  git fetch origin "$base_branch"
  if [[ -d "$worktree" ]]; then
    if git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      cd "$worktree"
      use_repo_ssh_remote
      git fetch origin "$base_branch"
      if remote_branch_exists "$branch"; then
        git fetch origin "$branch"
        git checkout "$branch" 2>/dev/null || git checkout -b "$branch" "origin/${branch}"
        if worktree_is_dirty && [[ "${BLUEPY_ALLOW_DIRTY_RESUME:-0}" != "1" ]]; then
          printf 'dirty issue worktree for %s at %s; refusing implicit resume\n' "$branch" "$worktree" >&2
          git status --short >&2 || true
          return 3
        fi
        if ! worktree_is_dirty; then
          git merge --ff-only "origin/${branch}"
        else
          printf 'BLUEPY_ALLOW_DIRTY_RESUME=1; continuing dirty worktree for %s\n' "$branch"
        fi
      else
        git checkout "$branch"
        if worktree_is_dirty && [[ "${BLUEPY_ALLOW_DIRTY_RESUME:-0}" != "1" ]]; then
          printf 'dirty issue worktree for %s at %s; refusing implicit resume\n' "$branch" "$worktree" >&2
          git status --short >&2 || true
          return 3
        fi
      fi
      return 0
    fi
    rm -rf "$worktree"
  fi

  if remote_branch_exists "$branch"; then
    git fetch origin "$branch"
    git worktree add -B "$branch" "$worktree" "origin/${branch}"
  elif git show-ref --verify --quiet "refs/heads/${branch}"; then
    git worktree add "$worktree" "$branch"
  else
    git worktree add -b "$branch" "$worktree" "origin/${base_branch}"
  fi
  cd "$worktree"
  use_repo_ssh_remote
}

prepare_pr_worktree() {
  local branch="$1"
  local worktree="$2"
  use_repo_ssh_remote
  git fetch origin "$branch"
  rm -rf "$worktree"
  git worktree add --detach "$worktree" "origin/${branch}"
  cd "$worktree"
  use_repo_ssh_remote
}

run_codex() {
  local prompt_file="$1"
  local log_file
  log_file="${log_dir}/codex-$(date -u +%Y%m%d%H%M%S-%N).log"
  run_logged_stdin "codex exec" "$log_file" "$prompt_file" codex exec \
    --cd "$PWD" \
    -c "model=\"${codex_model}\"" \
    -c "model_reasoning_effort=\"${codex_reasoning_effort}\"" \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    -
}

write_verification_summary() {
  local summary_file="$1"
  local status="$2"
  shift 2
  local log_file
  {
    printf 'Verification status: %s\n\n' "$status"
    for log_file in "$@"; do
      [[ -f "$log_file" ]] || continue
      printf '===== %s =====\n' "$(basename "$log_file")"
      tail -n "${BLUEPY_VERIFY_SUMMARY_TAIL:-200}" "$log_file" || true
      printf '\n'
    done
  } >"$summary_file"
}

run_verification() {
  local install_log typecheck_log build_log summary_file status install_status typecheck_status build_status
  install_log="${log_dir}/bun-install-$(date -u +%Y%m%d%H%M%S-%N).log"
  typecheck_log="${log_dir}/typecheck-$(date -u +%Y%m%d%H%M%S-%N).log"
  build_log="${log_dir}/build-$(date -u +%Y%m%d%H%M%S-%N).log"
  summary_file="${log_dir}/verification-summary-$(date -u +%Y%m%d%H%M%S-%N).txt"
  status=0
  install_status=0
  typecheck_status=0
  build_status=0

  if run_logged "bun install" "$install_log" bun install --frozen-lockfile; then
    install_status=0
  else
    install_status="$?"
    status="$install_status"
  fi

  if [[ "$status" -eq 0 ]]; then
    if run_logged "bun typecheck" "$typecheck_log" bun run typecheck; then
      typecheck_status=0
    else
      typecheck_status="$?"
      status="$typecheck_status"
    fi
  fi

  if [[ "$status" -eq 0 && "${BLUEPY_VERIFY_BUILD:-0}" == "1" ]]; then
    if run_logged "bun build" "$build_log" bun run build; then
      build_status=0
    else
      build_status="$?"
      status="$build_status"
    fi
  fi

  {
    printf 'bun install --frozen-lockfile: %s\n' "$([[ "$install_status" -eq 0 ]] && printf pass || printf 'fail (%s)' "$install_status")"
    if [[ -f "$typecheck_log" ]]; then
      printf 'bun run typecheck: %s\n' "$([[ "$typecheck_status" -eq 0 ]] && printf pass || printf 'fail (%s)' "$typecheck_status")"
    fi
    if [[ "${BLUEPY_VERIFY_BUILD:-0}" == "1" && -f "$build_log" ]]; then
      printf 'bun run build: %s\n' "$([[ "$build_status" -eq 0 ]] && printf pass || printf 'fail (%s)' "$build_status")"
    fi
    printf '\n'
  } >"$summary_file"
  write_verification_summary "${summary_file}.logs" "$([[ "$status" -eq 0 ]] && printf pass || printf 'fail (%s)' "$status")" \
    "$install_log" "$typecheck_log" "$build_log"
  cat "${summary_file}.logs" >>"$summary_file"
  rm -f "${summary_file}.logs"
  last_verification_summary="$summary_file"
  summary_line "- verification summary: ${summary_file}"
  return "$status"
}

run_codex_then_verify() {
  local prompt_file="$1"
  local phase="$2"
  local attempt fix_prompt

  run_codex "$prompt_file"
  attempt=0
  while true; do
    if run_verification; then
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt > verify_fix_rounds )); then
      printf 'verification failed after %s Codex verification-fix attempt(s) during %s\n' "$verify_fix_rounds" "$phase" >&2
      return 1
    fi

    fix_prompt="$(mktemp)"
    {
      printf 'The deterministic verification step failed after your previous Bluepy changes.\n\n'
      printf 'Phase: %s\n\n' "$phase"
      printf 'Fix the verification failure with the smallest safe code change.\n\n'
      printf 'Rules:\n'
      printf '%s\n' '- Touch only files needed for the failure.'
      printf '%s\n' '- Use bun/bunx only.'
      printf '%s\n' '- Do not disable lint/type/test/build rules.'
      printf '%s\n' '- Do not commit or push; the wrapper script will do that.'
      printf '\nVerification summary:\n'
      cat "$last_verification_summary"
    } >"$fix_prompt"
    run_codex "$fix_prompt"
    rm -f "$fix_prompt"
  done
}

commits_ahead_base() {
  git rev-list --count "origin/${base_branch}..HEAD"
}

commit_if_changes() {
  local message="$1"
  if [[ -z "$(git status --porcelain)" ]]; then
    return 1
  fi
  git status -sb
  git diff --name-status || true
  git add -A
  if git diff --cached --quiet; then
    return 1
  fi
  git commit -m "$message"
  return 0
}

open_or_update_pr() {
  local issue="$1"
  local branch="$2"
  local title="$3"
  local body_file="$4"
  local pr_number
  push_current_head "$branch" >&2
  if gh pr view "$branch" --repo "$repo" --json number --jq .number >/dev/null 2>&1; then
    pr_number="$(gh pr view "$branch" --repo "$repo" --json number --jq .number)"
    gh pr edit "$pr_number" --repo "$repo" --title "$title" --body-file "$body_file" >/dev/null || true
  else
    gh pr create \
      --repo "$repo" \
      --base "$base_branch" \
      --head "$branch" \
      --title "$title" \
      --body-file "$body_file" >/dev/null
    pr_number="$(gh pr view "$branch" --repo "$repo" --json number --jq .number)"
  fi
  printf '%s\n' "$pr_number"
}

local_pr_diff() {
  git fetch origin "$base_branch" >/dev/null 2>&1 || true
  git diff --no-color "origin/${base_branch}...HEAD"
}

make_review_prompt() {
  local pr="$1"
  local issue="$2"
  local out_file="$3"
  local pr_info
  pr_info="$(gh pr view "$pr" --repo "$repo" --json title,body,headRefName,baseRefName --jq '{title, body, headRefName, baseRefName}')"
  {
    printf 'You are a read-only reviewer for Bluepy PR #%s.\n' "$pr"
    printf 'The coding agent is Codex; do not propose changes by editing files.\n'
    printf 'Return only JSON matching the supplied schema.\n\n'
    printf 'Review priorities:\n'
    printf '%s\n' '- Correctness and behavioral regressions.'
    printf '%s\n' '- Unsafe type claims/casts or hidden runtime assumptions.'
    printf '%s\n' '- Missing tests for changed behavior.'
    printf '%s\n' '- Rule bypasses, generated-file churn, lockfile churn, locale churn, or unrelated drive-bys.'
    printf '%s\n' '- Treat deterministic verification failures as actionable findings.'
    printf '\nIf there are no actionable findings, use verdict "clean" and an empty findings array.\n'
    printf 'If any actionable fix is needed, use verdict "needs_fix".\n\n'
    printf 'Issue / PR context target: #%s\n\n' "$issue"
    printf 'PR metadata JSON:\n%s\n\n' "$pr_info"
    if [[ -n "$last_verification_summary" && -f "$last_verification_summary" ]]; then
      printf 'Latest deterministic verification summary:\n'
      cat "$last_verification_summary"
      printf '\n'
    else
      printf 'Latest deterministic verification summary: unavailable.\n\n'
    fi
    printf 'PR diff against origin/%s:\n' "$base_branch"
    local_pr_diff
  } >"$out_file"
}

run_claude_review() {
  local prompt_file="$1"
  local raw_json_file="$2"
  local normalized_json_file="$3"
  local log_file raw_log_file normalized_log_file tmpdir status
  log_file="${log_dir}/claude-review-$(date -u +%Y%m%d%H%M%S-%N).log"
  raw_log_file="${log_file%.log}-raw.json"
  normalized_log_file="${log_file%.log}-normalized.json"
  tmpdir="$(mktemp -d)"
  status=0
  (
    cd "$tmpdir"
    run_logged_stdin "claude review" "$log_file" "$prompt_file" bash -c '
      set -euo pipefail
      schema_file="$1"
      output_file="$2"
      model="$3"
      effort="$4"
      claude -p \
        --model "$model" \
        --effort "$effort" \
        --no-session-persistence \
        --output-format json \
        --json-schema "$(cat "$schema_file")" \
        "Review the Bluepy PR data provided on stdin. Return only JSON matching the schema." \
        >"$output_file"
    ' bash "$review_schema_file" "$raw_json_file" "$claude_model" "$claude_effort"
  ) || status="$?"
  rm -rf "$tmpdir"
  if [[ "$status" -ne 0 ]]; then
    return "$status"
  fi

  jq '
    def parse_json_string:
      if type == "string" then (fromjson? // .) else . end;

    def review_candidate:
      parse_json_string
      | if type == "object" and (.verdict == "clean" or .verdict == "needs_fix") then .
        elif type == "object" and has("structured_output") then (.structured_output | parse_json_string)
        elif type == "object" and .name == "StructuredOutput" and has("input") then (.input | parse_json_string)
        elif type == "object" and has("result") then (.result | parse_json_string)
        else empty
        end;

    [
      (review_candidate),
      (.. | objects | review_candidate)
    ]
    | map(select(type == "object" and (.verdict == "clean" or .verdict == "needs_fix")))
    | last // .
  ' "$raw_json_file" >"$normalized_json_file"
  cp "$raw_json_file" "$raw_log_file"
  cp "$normalized_json_file" "$normalized_log_file"

  local verdict
  verdict="$(jq -r 'if type == "object" then .verdict // empty else empty end' "$normalized_json_file")"
  case "$verdict" in
    clean|needs_fix) return 0 ;;
    *)
      printf 'Claude review JSON did not contain a valid verdict. Raw output: %s\n' "$raw_json_file" >&2
      printf 'Normalized output: %s\n' "$normalized_json_file" >&2
      printf 'Preserved raw output: %s\n' "$raw_log_file" >&2
      printf 'Preserved normalized output: %s\n' "$normalized_log_file" >&2
      return 1
      ;;
  esac
}

post_review_comment() {
  local pr="$1"
  local round="$2"
  local review_json="$3"
  local body_file verdict
  body_file="$(mktemp)"
  verdict="$(jq -r '.verdict' "$review_json")"
  {
    printf 'Claude review round %s: `%s`\n\n' "$round" "$verdict"
    jq -r '
      if (.findings | length) == 0 then
        "No actionable findings."
      else
        .findings[] |
        "- [" + .severity + "] " + .file + (if .line then ":" + (.line|tostring) else "" end) + ": " + .summary + "\n  Recommendation: " + .recommendation
      end
    ' "$review_json"
    printf '\n'
    jq -r '
      if (.residual_risks | length) == 0 then empty
      else "Residual risks:\n" + (.residual_risks | map("- " + .) | join("\n"))
      end
    ' "$review_json"
    printf '\n\n<details><summary>Structured review JSON</summary>\n\n```json\n'
    jq . "$review_json"
    printf '\n```\n</details>\n'
  } >"$body_file"
  comment_body "$pr" "$body_file" || true
  rm -f "$body_file"
}

make_fix_prompt() {
  local pr="$1"
  local issue="$2"
  local review_json="$3"
  local out_file="$4"
  {
    printf 'Fix the actionable Claude review findings for Bluepy PR #%s.\n\n' "$pr"
    printf 'Issue / PR context target: #%s\n\n' "$issue"
    printf 'Rules:\n'
    printf '%s\n' '- Touch only files needed for the findings.'
    printf '%s\n' '- Use bun/bunx only.'
    printf '%s\n' '- Do not disable lint/type/test/build rules.'
    printf '%s\n' '- Do not commit, push, label, comment, or deploy; the wrapper script will do that.'
    printf '%s\n' '- Preserve the existing branch and keep the change narrow.'
    printf '\nClaude structured review JSON:\n'
    jq . "$review_json"
    printf '\nCurrent PR diff against origin/%s:\n' "$base_branch"
    local_pr_diff
  } >"$out_file"
}

mark_needs_human() {
  local target="$1"
  local message="$2"
  ensure_agent_labels
  gh issue edit "$target" --repo "$repo" --add-label needs-human >/dev/null 2>&1 || true
  comment_text "$target" "Agent needs human attention: ${message}"
}

wait_for_preview_deploy() {
  local pr="$1"
  local timeout="${BLUEPY_PREVIEW_WAIT_SECONDS:-900}"
  local interval="${BLUEPY_PREVIEW_WAIT_INTERVAL_SECONDS:-10}"
  local elapsed=0 checks

  while (( elapsed <= timeout )); do
    checks="$(gh pr checks "$pr" --repo "$repo" --json name,state,bucket,link,workflow 2>/dev/null || printf '[]')"
    if jq -e '.[] | select(.name == "deploy-preview" and .state == "SUCCESS")' >/dev/null <<<"$checks"; then
      return 0
    fi
    if jq -e '.[] | select(.name == "deploy-preview" and (.state == "FAILURE" or .bucket == "fail"))' >/dev/null <<<"$checks"; then
      printf 'deploy-preview failed for PR #%s\n' "$pr" >&2
      jq -r '.[] | select(.name == "deploy-preview") | .link' <<<"$checks" >&2
      return 1
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  printf 'timed out waiting for deploy-preview on PR #%s after %ss\n' "$pr" "$timeout" >&2
  return 1
}

review_and_fix_loop() {
  local pr="$1"
  local issue="$2"
  local branch="$3"
  local round prompt_file raw_review_file review_file fix_prompt verdict before_head after_head

  for ((round = 1; round <= review_rounds; round++)); do
    prompt_file="$(mktemp)"
    raw_review_file="$(mktemp)"
    review_file="$(mktemp)"
    make_review_prompt "$pr" "$issue" "$prompt_file"

    if ! run_claude_review "$prompt_file" "$raw_review_file" "$review_file"; then
      mark_needs_human "$pr" "Claude review failed or returned unparsable structured output. See logs under ${log_dir}."
      rm -f "$prompt_file" "$raw_review_file" "$review_file"
      return 1
    fi

    post_review_comment "$pr" "$round" "$review_file"
    verdict="$(jq -r '.verdict' "$review_file")"

    if [[ "$verdict" == "clean" ]]; then
      ensure_agent_labels
      if ! wait_for_preview_deploy "$pr"; then
        mark_needs_human "$pr" "Preview deploy did not pass before human-review handoff."
        rm -f "$prompt_file" "$raw_review_file" "$review_file"
        return 1
      fi
      gh pr edit "$pr" --repo "$repo" --add-label human-review >/dev/null
      comment_text "$pr" "Ready for human review.${human_review_mention:+ ${human_review_mention}}"
      rm -f "$prompt_file" "$raw_review_file" "$review_file"
      return 0
    fi

    fix_prompt="$(mktemp)"
    make_fix_prompt "$pr" "$issue" "$review_file" "$fix_prompt"
    before_head="$(git rev-parse HEAD)"
    if ! run_codex_then_verify "$fix_prompt" "Claude review round ${round} for PR #${pr}"; then
      mark_needs_human "$pr" "Codex could not make deterministic verification pass after Claude review round ${round}."
      rm -f "$prompt_file" "$raw_review_file" "$review_file" "$fix_prompt"
      return 1
    fi

    after_head="$(git rev-parse HEAD)"
    if [[ -z "$(git status --porcelain)" && "$after_head" != "$before_head" ]]; then
      push_current_head "$branch"
      rm -f "$prompt_file" "$raw_review_file" "$review_file" "$fix_prompt"
      continue
    fi

    if [[ -z "$(git status --porcelain)" ]]; then
      mark_needs_human "$pr" "Claude requested fixes in round ${round}, but Codex made no file changes."
      rm -f "$prompt_file" "$raw_review_file" "$review_file" "$fix_prompt"
      return 1
    fi

    if commit_if_changes "Address Claude review for PR #${pr}"; then
      push_current_head "$branch"
    else
      mark_needs_human "$pr" "No committable changes after Claude review round ${round}."
      rm -f "$prompt_file" "$raw_review_file" "$review_file" "$fix_prompt"
      return 1
    fi

    rm -f "$prompt_file" "$raw_review_file" "$review_file" "$fix_prompt"
  done

  mark_needs_human "$pr" "Agent review loop stopped after ${review_rounds} rounds."
  return 1
}

start_issue() {
  local issue="$1"
  local title body branch worktree prompt_file pr_body pr_number
  title="$(gh issue view "$issue" --repo "$repo" --json title --jq .title)"
  body="$(gh issue view "$issue" --repo "$repo" --json body --jq '.body // ""')"
  branch="agent/issue-${issue}"
  worktree="${agent_root}/issue-${issue}"
  prompt_file="$(mktemp)"
  pr_body="$(mktemp)"

  ensure_agent_labels
  printf 'phase: prepare issue worktree %s\n' "$branch"
  if ! prepare_issue_worktree "$branch" "$worktree"; then
    comment_text "$issue" "Agent could not prepare worktree ${worktree}. It is probably dirty from a previous failed run. Set BLUEPY_ALLOW_DIRTY_RESUME=1 only if you intentionally want to continue that local state."
    exit 1
  fi

  {
    printf 'Implement Bluepy issue #%s: %s\n\n' "$issue" "$title"
    printf 'Issue body:\n%s\n\n' "$body"
    printf 'Rules:\n'
    printf '%s\n' '- Keep the change narrow and directly tied to the issue.'
    printf '%s\n' '- Use bun/bunx only.'
    printf '%s\n' '- Do not disable lint/type/test/build rules.'
    printf '%s\n' '- Do not commit, push, label, comment, or deploy; the wrapper script will do that.'
    printf '%s\n' '- Do not touch Cloudflare/deploy credentials or deployment scripts unless the issue explicitly asks for that.'
  } >"$prompt_file"

  printf 'phase: implement issue #%s\n' "$issue"
  if ! run_codex_then_verify "$prompt_file" "implement issue #${issue}"; then
    mark_needs_human "$issue" "Codex could not produce a verification-clean implementation for issue #${issue}."
    exit 1
  fi

  if [[ -z "$(git status --porcelain)" && "$(commits_ahead_base)" == "0" ]]; then
    comment_text "$issue" "Agent finished without code changes."
    exit 0
  fi

  commit_if_changes "Fix issue #${issue}" || true
  {
    printf 'Fixes #%s\n\n' "$issue"
    printf 'Automated local Codex run on the Bluepy VPS runner.\n\n'
    printf 'Verification summary: `%s`\n' "$last_verification_summary"
  } >"$pr_body"
  printf 'phase: push and open PR for issue #%s\n' "$issue"
  pr_number="$(open_or_update_pr "$issue" "$branch" "Fix issue #${issue}: ${title}" "$pr_body")"
  gh pr edit "$pr_number" --repo "$repo" --add-label agent:preview >/dev/null
  printf 'phase: review and fix PR #%s\n' "$pr_number"
  review_and_fix_loop "$pr_number" "$issue" "$branch"

  rm -f "$prompt_file" "$pr_body"
}

start_pr() {
  local pr="$1"
  local branch worktree status
  branch="$(gh pr view "$pr" --repo "$repo" --json headRefName --jq .headRefName)"
  worktree="${agent_root}/pr-${pr}-${run_id}"
  prepare_pr_worktree "$branch" "$worktree"
  status=0
  run_verification || true
  review_and_fix_loop "$pr" "$pr" "$branch" || status="$?"
  cd "$script_dir/.."
  git worktree remove --force "$worktree" >/dev/null 2>&1 || rm -rf "$worktree"
  return "$status"
}

start_comment() {
  local issue="$1"
  if gh pr view "$issue" --repo "$repo" >/dev/null 2>&1; then
    start_pr "$issue"
  else
    start_issue "$issue"
  fi
}

case "$mode" in
  issue) start_issue "$number" ;;
  pr) start_pr "$number" ;;
  comment) start_comment "$number" ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
