#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const normalize = (text) =>
  text
    .replace(
      /^# Bluepy Agent Runbook \((Codex|Claude)\)$/m,
      '# Bluepy Agent Runbook (AGENT)',
    )
    .replace(
      /^> .* mirrors this file\..*$/m,
      '> RUNBOOKS mirror each other. Reviewer-specific CLI sections may differ.',
    )
    .replace(/Codex coders/g, 'AGENT coders')
    .replace(/Claude coders/g, 'AGENT coders')
    .replace(
      /Claude reviews Codex-authored work/g,
      'REVIEWER reviews AGENT-authored work',
    )
    .replace(
      /Codex reviews Claude-authored work/g,
      'REVIEWER reviews AGENT-authored work',
    )
    .replace(
      /CLAUDE\.md is for Claude coders; Codex reviews Claude-authored work\./g,
      'OTHER.md is for REVIEWER coders; AGENT reviews REVIEWER-authored work.',
    )
    .replace(
      /AGENTS\.md is for Codex coders; Claude reviews Codex-authored work\./g,
      'OTHER.md is for REVIEWER coders; AGENT reviews REVIEWER-authored work.',
    )
    .replace(/Claude reviews → you fix/g, 'REVIEWER reviews -> you fix')
    .replace(/Codex reviews → you fix/g, 'REVIEWER reviews -> you fix')
    .replace(
      /until (Claude|Codex) reports "no actionable findings"/g,
      'until REVIEWER reports "no actionable findings"',
    )
    .replace(
      /Send your work to Claude for review\. Codex does not review Codex-authored work\./g,
      'Send your work to REVIEWER for review. AGENT does not review AGENT-authored work.',
    )
    .replace(
      /Send your work to Codex for review\. Claude does not review Claude-authored work\./g,
      'Send your work to REVIEWER for review. AGENT does not review AGENT-authored work.',
    )
    .replace(
      /## Review CLI — Claude reviews Codex's work[\s\S]*?(?=## Secrets & Paths)/,
      '## Review CLI - REVIEWER reviews AGENT work\n\n',
    )
    .replace(
      /## Review CLI — Codex reviews Claude's work[\s\S]*?(?=## Secrets & Paths)/,
      '## Review CLI - REVIEWER reviews AGENT work\n\n',
    )
    .replace(/→/g, '->')
    .trim();

const agents = normalize(readFileSync('AGENTS.md', 'utf8'));
const claude = normalize(readFileSync('CLAUDE.md', 'utf8'));

if (agents !== claude) {
  console.error(
    [
      'Bluepy hook blocked: AGENTS.md and CLAUDE.md drift outside reviewer-specific sections.',
      'Keep shared guidance identical in both files, or put reviewer-only differences in the normalized sections.',
      'Run: bun scripts/hooks/mirror-runbooks.js',
    ].join('\n'),
  );
  process.exit(2);
}
