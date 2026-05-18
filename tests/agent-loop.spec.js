import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
