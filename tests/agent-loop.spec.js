import { test, expect } from '@playwright/test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result;
}

function agentWorktreeFunctions() {
  const agentLoop = readFileSync('scripts/agent-loop.sh', 'utf8');
  const match = agentLoop.match(
    /use_repo_ssh_remote\(\) \{[\s\S]*?\n\}\n\nrun_codex\(\)/,
  );
  expect(match).not.toBeNull();
  return match?.[0].replace(/\n\nrun_codex\(\)$/, '');
}

test('open_or_update_pr returns only the PR number after push output', () => {
  const agentLoop = readFileSync('scripts/agent-loop.sh', 'utf8');
  const match = agentLoop.match(
    /open_or_update_pr\(\) \{[\s\S]*?\n\}\n\nlocal_pr_diff\(\)/,
  );
  expect(match).not.toBeNull();
  const openOrUpdatePr = match?.[0].replace(/\n\nlocal_pr_diff\(\)$/, '');
  const dir = mkdtempSync(join(tmpdir(), 'bluepy-agent-loop-'));
  const harness = join(dir, 'harness.sh');
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'body\n');
  writeFileSync(
    harness,
    `#!/usr/bin/env bash
set -euo pipefail
repo=aliceisjustplaying/bluepy
base_branch=bluesky
push_current_head() {
  printf "branch 'agent/issue-26' set up to track 'origin/agent/issue-26'.\\n"
}
gh() {
  if [[ "$1 $2" == "pr view" && "$3" == "agent/issue-26" ]]; then
    if [[ "\${created:-0}" == "1" ]]; then
      printf '28\\n'
      return 0
    fi
    return 1
  fi
  if [[ "$1 $2" == "pr create" ]]; then
    created=1
    return 0
  fi
  return 2
}
${openOrUpdatePr}
pr_number="$(open_or_update_pr 26 agent/issue-26 'Fix issue #26' '${bodyFile}')"
printf '%s\\n' "$pr_number"
`,
  );

  try {
    const result = spawnSync('bash', [harness], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.stderr).toContain("branch 'agent/issue-26'");
    expect(result.stdout).toBe('28\n');
    expect(result.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_pr_worktree can recreate a persistent repo worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bluepy-agent-loop-'));
  const remote = join(dir, 'remote.git');
  const seed = join(dir, 'seed');
  const agentRoot = join(dir, 'agent-root');
  const agentRepo = join(agentRoot, 'repo');
  const worktree = join(dir, 'pr-worktree');
  const harness = join(dir, 'harness.sh');

  try {
    run('git', ['init', '--bare', remote], dir);
    mkdirSync(seed);
    run('git', ['init'], seed);
    run('git', ['config', 'user.email', 'agent@example.com'], seed);
    run('git', ['config', 'user.name', 'Agent Test'], seed);
    writeFileSync(join(seed, 'README.md'), 'base\n');
    run('git', ['add', 'README.md'], seed);
    run('git', ['commit', '-m', 'base'], seed);
    run('git', ['branch', '-M', 'bluesky'], seed);
    run('git', ['remote', 'add', 'origin', remote], seed);
    run('git', ['push', '-u', 'origin', 'bluesky'], seed);
    run('git', ['checkout', '-b', 'pr-29'], seed);
    writeFileSync(join(seed, 'README.md'), 'pr\n');
    run('git', ['commit', '-am', 'pr'], seed);
    run('git', ['push', '-u', 'origin', 'pr-29'], seed);

    writeFileSync(
      harness,
      `#!/usr/bin/env bash
set -euo pipefail
repo=aliceisjustplaying/bluepy
base_branch=bluesky
agent_root='${agentRoot}'
agent_repo='${agentRepo}'
gh() {
  if [[ "$1 $2" == "repo view" ]]; then
    printf '%s\\n' '${remote}'
    return 0
  fi
  return 2
}
${agentWorktreeFunctions()}
mkdir -p "$agent_root"
prepare_pr_worktree pr-29 '${worktree}'
first="$(git -C '${worktree}' rev-parse HEAD)"
cd "$agent_root"
prepare_pr_worktree pr-29 '${worktree}'
second="$(git -C '${worktree}' rev-parse HEAD)"
printf '%s\\n%s\\n' "$first" "$second"
`,
    );

    const result = spawnSync('bash', [harness], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const heads = result.stdout
      .trim()
      .split('\n')
      .filter((line) => /^[0-9a-f]{40}$/.test(line));
    expect(heads).toHaveLength(2);
    expect(heads[0]).toBe(heads[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
