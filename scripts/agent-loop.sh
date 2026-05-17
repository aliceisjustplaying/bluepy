#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent-common.sh
source "${script_dir}/agent-common.sh"
configure_agent_browser "$script_dir"

mode="${1:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
number="${2:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
base_branch="${BASE_BRANCH:-bluesky}"

comment_body() {
  local issue="$1"
  local body_file="$2"
  gh issue comment "$issue" --repo "$repo" --body-file "$body_file"
}

ensure_label() {
  local name="$1"
  local color="$2"
  gh label create "$name" --color "$color" --repo "$repo" >/dev/null 2>&1 || true
}

use_repo_ssh_remote() {
  git remote set-url origin "$(gh repo view "$repo" --json sshUrl --jq .sshUrl)"
}

remote_branch_exists() {
  local branch="$1"
  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1
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
        git checkout "$branch"
        if git diff --quiet && git diff --cached --quiet; then
          git merge --ff-only "origin/${branch}"
        else
          printf 'preserving dirty issue worktree for %s; continuing from local state\n' "$branch"
        fi
      else
        git checkout "$branch"
      fi
      return 0
    fi
    rm -rf "$worktree"
  fi

  if remote_branch_exists "$branch"; then
    git fetch origin "$branch:${branch}" || git fetch origin "$branch"
    git worktree add "$worktree" "$branch"
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
  git worktree add -B "$branch" "$worktree" "origin/${branch}"
  cd "$worktree"
  use_repo_ssh_remote
}

run_codex() {
  local prompt_file="$1"
  local log_file
  log_file="${log_dir}/codex-$(date -u +%Y%m%d%H%M%S-%N).log"
  run_logged "codex exec" "$log_file" codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    "$(cat "$prompt_file")"
}

run_verification() {
  run_logged "bun install" "${log_dir}/bun-install-$(date -u +%Y%m%d%H%M%S-%N).log" \
    bun install --frozen-lockfile
  run_logged "bun typecheck" "${log_dir}/typecheck-$(date -u +%Y%m%d%H%M%S-%N).log" \
    bun run typecheck
}

commits_ahead_base() {
  git rev-list --count "origin/${base_branch}..HEAD"
}

open_or_update_pr() {
  local issue="$1"
  local branch="$2"
  local title="$3"
  local body_file="$4"
  git push -u origin "HEAD:${branch}"
  if ! gh pr view "$branch" --repo "$repo" --json number --jq .number >/dev/null 2>&1; then
    gh pr create \
      --repo "$repo" \
      --base "$base_branch" \
      --head "$branch" \
      --title "$title" \
      --body-file "$body_file" >/dev/null
  fi
  gh pr view "$branch" --repo "$repo" --json number --jq .number
}

review_and_fix_loop() {
  local pr="$1"
  local issue="$2"
  local round
  for round in 1 2 3 4 5; do
    local diff_file review_file prompt_file body_file
    diff_file="$(mktemp)"
    review_file="$(mktemp)"
    prompt_file="$(mktemp)"
    body_file="$(mktemp)"

    gh pr diff "$pr" --repo "$repo" >"$diff_file"
    {
      printf 'You are reviewing Bluepy PR #%s. Review for correctness only.\n\n' "$pr"
      printf 'Find behavioral regressions, unsafe type claims, missing tests for changed behavior, rule bypasses, and unrelated drive-bys.\n'
      printf 'Return findings with file:line refs. If none, say exactly "no actionable findings" and then name residual risks.\n\n'
      printf 'Diff:\n'
      cat "$diff_file"
    } >"$prompt_file"

    claude -p \
      --model claude-opus-4-7 \
      --effort xhigh \
      --no-session-persistence \
      "$(cat "$prompt_file")" < /dev/null >"$review_file" 2>&1

    {
      printf 'Claude review round %s:\n\n' "$round"
      cat "$review_file"
    } >"$body_file"
    comment_body "$pr" "$body_file"

    if grep -qi 'no actionable findings' "$review_file"; then
      ensure_label human-review 2da44e
      gh pr edit "$pr" --repo "$repo" --add-label human-review
      printf 'Ready for human review.\n' >"$body_file"
      comment_body "$pr" "$body_file"
      rm -f "$diff_file" "$review_file" "$prompt_file" "$body_file"
      return 0
    fi

    {
      printf 'Fix the actionable Claude review findings for Bluepy PR #%s.\n\n' "$pr"
      printf 'Rules:\n'
      printf '%s\n' '- Touch only files needed for the findings.'
      printf '%s\n' '- Use bun/bunx only.'
      printf '%s\n' '- Do not disable lint/type/test rules.'
      printf '%s\n\n' '- Run verification before finishing.'
      printf 'Claude review:\n'
      cat "$review_file"
    } >"$prompt_file"

    run_codex "$prompt_file"
    run_verification

    if ! git diff --quiet || ! git diff --cached --quiet; then
      git add -A
      git commit -m "Address Claude review for PR #${pr}"
      git push
      "${script_dir}/deploy-preview.sh" "$pr" || true
    fi

    rm -f "$diff_file" "$review_file" "$prompt_file" "$body_file"
  done

  local cap_file
  cap_file="$(mktemp)"
  printf 'Agent review loop stopped after 5 rounds. Human review needed.\n' >"$cap_file"
  comment_body "$issue" "$cap_file"
  rm -f "$cap_file"
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

  printf 'phase: prepare issue worktree %s\n' "$branch"
  prepare_issue_worktree "$branch" "$worktree"

  {
    printf 'Implement Bluepy issue #%s: %s\n\n' "$issue" "$title"
    printf 'Issue body:\n%s\n\n' "$body"
    printf 'Rules:\n'
    printf '%s\n' '- Keep the change narrow.'
    printf '%s\n' '- Use bun/bunx only.'
    printf '%s\n' '- Run verification before finishing.'
    printf '%s\n' '- Do not disable lint/type/test rules.'
  } >"$prompt_file"

  printf 'phase: implement issue #%s\n' "$issue"
  run_codex "$prompt_file"
  printf 'phase: verify issue #%s\n' "$issue"
  run_verification

  if git diff --quiet && git diff --cached --quiet && [[ "$(commits_ahead_base)" == "0" ]]; then
    printf 'Agent finished without code changes.\n' >"$pr_body"
    comment_body "$issue" "$pr_body"
    exit 0
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    git add -A
    git commit -m "Fix issue #${issue}"
  fi
  {
    printf 'Fixes #%s\n\n' "$issue"
    printf 'Automated local Codex run on the Bluepy VPS runner.\n'
  } >"$pr_body"
  printf 'phase: push and open PR for issue #%s\n' "$issue"
  pr_number="$(open_or_update_pr "$issue" "$branch" "Fix issue #${issue}: ${title}" "$pr_body")"
  ensure_label agent:preview 5319e7
  gh pr edit "$pr_number" --repo "$repo" --add-label agent:preview
  printf 'phase: deploy preview for PR #%s\n' "$pr_number"
  "${script_dir}/deploy-preview.sh" "$pr_number" || true
  printf 'phase: review and fix PR #%s\n' "$pr_number"
  review_and_fix_loop "$pr_number" "$issue"
}

start_pr() {
  local pr="$1"
  local branch worktree status
  branch="$(gh pr view "$pr" --repo "$repo" --json headRefName --jq .headRefName)"
  worktree="${agent_root}/pr-${pr}-${run_id}"
  prepare_pr_worktree "$branch" "$worktree"
  status=0
  review_and_fix_loop "$pr" "$pr" || status="$?"
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
