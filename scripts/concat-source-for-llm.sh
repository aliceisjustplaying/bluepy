#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [output-file]\n' "${0##*/}"
  printf '\n'
  printf 'Concatenates Bluepy source/config text into one file for LLM upload.\n'
  printf 'Default output: bluepy-source-for-llm.txt\n'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

output="${1:-bluepy-source-for-llm.txt}"
case "$output" in
  /*) output_abs="$(realpath -m "$output")" ;;
  *) output_abs="$(realpath -m "$PWD/$output")" ;;
esac

should_include() {
  local path="$1"

  case "$path" in
    .env|.env.*|*.local|*.pem|*.key|*.crt|*.p12)
      return 1
      ;;
    node_modules/*|dist/*|dist-ssr/*|coverage/*|logs/*)
      return 1
      ;;
    .git/*|.vite/*|.wrangler/*|.cache/*|.sonda/*)
      return 1
      ;;
    test-results/*|playwright-report/*|blob-report/*|mock-screenshots/*)
      return 1
      ;;
    src/locales/*.po|src/locales/*.js|src/iconify-icons/*)
      return 1
      ;;
    src/assets/*|design/*|readme-assets/*)
      return 1
      ;;
    bun.lock|package-lock.json|yarn.lock|pnpm-lock.yaml)
      return 1
      ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.avif|*.svg)
      return 1
      ;;
    *.mp3|*.mp4|*.webm|*.mov|*.wav|*.ogg)
      return 1
      ;;
    *.zip|*.gz|*.br|*.pdf|*.af|*.afdesign)
      return 1
      ;;
    *.woff|*.woff2|*.ttf|*.eot|*.wasm|*.map)
      return 1
      ;;
  esac

  case "$path" in
    .github/*)
      return 0
      ;;
    src/*|scripts/*|docs/*|public/*.html|public/*.js|public/*.css|public/*.txt|compose/*.html)
      return 0
      ;;
    AGENTS.md|CLAUDE.md|GOAL.md|README.md|CHANGELOG.md|SECURITY.md|PRIVACY.MD)
      return 0
      ;;
    package.json|tsconfig*.json|vite.config.*|playwright.config.*|lingui.config.*|wrangler.*|rollbar.js)
      return 0
      ;;
    env.d.ts|env.schema.json|oauth-client-metadata.template.json|crowdin.yml|.gitignore|.gitattributes|.oxlintrc.json|.oxfmtrc.json)
      return 0
      ;;
    *.js|*.jsx|*.ts|*.tsx|*.css|*.html|*.json|*.jsonc|*.yml|*.yaml|*.md|*.sh|*.mjs|*.cjs)
      return 0
      ;;
  esac

  return 1
}

is_text_file() {
  local path="$1"
  [[ -s "$path" ]] || return 0
  LC_ALL=C grep -Iq . "$path"
}

tmp="$(mktemp)"
manifest="$(mktemp)"
trap 'rm -f "$tmp" "$manifest"' EXIT

while IFS= read -r -d '' path; do
  [[ -f "$path" ]] || continue
  [[ "$(realpath -m "$path")" != "$output_abs" ]] || continue
  should_include "$path" || continue
  is_text_file "$path" || continue
  printf '%s\n' "$path" >> "$manifest"
done < <(git ls-files -z --cached --others --exclude-standard)

file_count="$(wc -l < "$manifest" | tr -d ' ')"

{
  printf '# Bluepy source bundle\n\n'
  printf 'Generated: %s UTC\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'Commit: %s\n' "$(git rev-parse --short HEAD)"
  printf 'Files: %s\n\n' "$file_count"
  printf 'This bundle includes tracked plus untracked non-ignored source/config text.\n'
  printf 'Excluded: env files, lockfiles, generated locales, binary assets, dependency/build/test output directories.\n\n'
  printf '## Manifest\n\n'
  sed 's/^/- /' "$manifest"
  printf '\n'
} > "$tmp"

while IFS= read -r path; do
  {
    printf '\n'
    printf '===== BEGIN FILE: %s =====\n' "$path"
    printf '\n'
    sed -e '$a\' "$path"
    printf '\n'
    printf '===== END FILE: %s =====\n' "$path"
  } >> "$tmp"
done < "$manifest"

mkdir -p "$(dirname "$output_abs")"
mv "$tmp" "$output_abs"
trap 'rm -f "$manifest"' EXIT

bytes="$(wc -c < "$output_abs" | tr -d ' ')"
printf 'Wrote %s files, %s bytes: %s\n' "$file_count" "$bytes" "$output_abs"
