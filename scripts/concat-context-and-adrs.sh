#!/usr/bin/env bash
# Concatenate CONTEXT.md + every ADR under docs/adr/ into a single review bundle.
# Intended for handing the architecture layer (and only the architecture layer)
# to an external reviewer. Plans, source, and tests are excluded by design — see
# scripts/concat-source-for-llm.sh for the full-repo bundler.
#
# Usage: ./scripts/concat-context-and-adrs.sh [output_path]
#   default output: ~/tmp/bluepy-context-and-adrs.txt
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
out=${1:-"${HOME}/tmp/bluepy-context-and-adrs.txt"}
mkdir -p "$(dirname "$out")"

context="$repo_root/CONTEXT.md"
adr_dir="$repo_root/docs/adr"

[[ -f "$context" ]] || { echo "missing: $context" >&2; exit 1; }
[[ -d "$adr_dir" ]] || { echo "missing: $adr_dir" >&2; exit 1; }

short_sha=$(git -C "$repo_root" rev-parse --short HEAD)
branch=$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
adr_count=$(find "$adr_dir" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')

tmp=$(mktemp "${out}.XXXXXX")
trap 'rm -f "$tmp"' EXIT

{
  echo "# Bluepy — CONTEXT + ADRs bundle"
  echo
  echo "Branch:    $branch @ $short_sha"
  echo "Generated: $now"
  echo "Contents:  CONTEXT.md + ${adr_count} ADRs"
  echo
  echo "================================================================"
  echo "FILE: CONTEXT.md"
  echo "================================================================"
  echo
  cat "$context"
  echo
  for f in "$adr_dir"/*.md; do
    rel="docs/adr/$(basename "$f")"
    echo
    echo "================================================================"
    echo "FILE: $rel"
    echo "================================================================"
    echo
    cat "$f"
    echo
  done
} > "$tmp"

mv "$tmp" "$out"
trap - EXIT

lines=$(wc -l < "$out" | tr -d ' ')
bytes=$(wc -c < "$out" | tr -d ' ')
echo "wrote $out (${lines} lines, ${bytes} bytes)"
