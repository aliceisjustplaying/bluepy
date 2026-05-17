#!/usr/bin/env bash
set -euo pipefail

mode="${1:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
number="${2:?usage: scripts/agent-loop.sh issue|pr|comment <number>}"
repo="${GITHUB_REPOSITORY:-aliceisjustplaying/bluepy}"
base_branch="${BASE_BRANCH:-bluesky}"
run_id="${GITHUB_RUN_ID:-local}-$(date -u +%Y%m%d%H%M%S)"
root="/workspace/agent-worktrees/bluepy"
mkdir -p "$root"

comment_body() {
  local issue="$1"
  local body_file="$2"
  gh issue comment "$issue" --body-file "$body_file"
}

ensure_label() {
  local name="$1"
  local color="$2"
  gh label create "$name" --color "$color" --repo "$repo" >/dev/null 2>&1 || true
}

run_codex() {
  local prompt_file="$1"
  codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    "$(cat "$prompt_file")" < /dev/null
}

run_verification() {
  bun install --frozen-lockfile
  bun run typecheck
}

open_or_update_pr() {
  local issue="$1"
  local branch="$2"
  local title="$3"
  local body_file="$4"
  git push -u origin "$branch"
  if gh pr view "$branch" --json number --jq .number >/tmp/bluepy-pr-number 2>/dev/null; then
    cat /tmp/bluepy-pr-number
  else
    gh pr create \
      --base "$base_branch" \
      --head "$branch" \
      --title "$title" \
      --body-file "$body_file"
  fi
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

    gh pr diff "$pr" >"$diff_file"
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
      gh issue edit "$pr" --add-label human-review
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
      scripts/deploy-preview.sh "$pr" || true
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
  local title body branch worktree prompt_file pr_body pr_url pr_number
  title="$(gh issue view "$issue" --json title --jq .title)"
  body="$(gh issue view "$issue" --json body --jq '.body // ""')"
  branch="agent/issue-${issue}-${run_id}"
  worktree="${root}/issue-${issue}-${run_id}"
  prompt_file="$(mktemp)"
  pr_body="$(mktemp)"

  git fetch origin "$base_branch"
  git worktree add -b "$branch" "$worktree" "origin/${base_branch}"
  cd "$worktree"

  {
    printf 'Implement Bluepy issue #%s: %s\n\n' "$issue" "$title"
    printf 'Issue body:\n%s\n\n' "$body"
    printf 'Rules:\n'
    printf '%s\n' '- Keep the change narrow.'
    printf '%s\n' '- Use bun/bunx only.'
    printf '%s\n' '- Run verification before finishing.'
    printf '%s\n' '- Do not disable lint/type/test rules.'
  } >"$prompt_file"

  run_codex "$prompt_file"
  run_verification

  if git diff --quiet && git diff --cached --quiet; then
    printf 'Agent finished without code changes.\n' >"$pr_body"
    comment_body "$issue" "$pr_body"
    exit 0
  fi

  git add -A
  git commit -m "Fix issue #${issue}"
  {
    printf 'Fixes #%s\n\n' "$issue"
    printf 'Automated local Codex run on the Bluepy VPS runner.\n'
  } >"$pr_body"
  pr_url="$(open_or_update_pr "$issue" "$branch" "Fix issue #${issue}: ${title}" "$pr_body")"
  pr_number="${pr_url##*/}"
  ensure_label agent:preview 5319e7
  gh issue edit "$pr_number" --add-label agent:preview
  scripts/deploy-preview.sh "$pr_number" || true
  review_and_fix_loop "$pr_number" "$issue"
}

start_pr() {
  local pr="$1"
  local branch worktree
  branch="$(gh pr view "$pr" --json headRefName --jq .headRefName)"
  worktree="${root}/pr-${pr}-${run_id}"
  git fetch origin "$branch"
  git worktree add -B "$branch" "$worktree" "origin/${branch}"
  cd "$worktree"
  review_and_fix_loop "$pr" "$pr"
}

start_comment() {
  local issue="$1"
  if gh pr view "$issue" >/dev/null 2>&1; then
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
