#!/usr/bin/env bash
# Stop: format + lint-fix changed source files (modified + untracked) in one pass.
# Surviving oxlint diagnostics print to the Claude Code UI.

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0

files=()
while IFS= read -r line; do
  [ -f "$line" ] && files+=("$line")
done < <(
  {
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' | head -50
)
[ ${#files[@]} -eq 0 ] && exit 0

npx oxfmt "${files[@]}" >/dev/null 2>&1
npx oxlint --fix "${files[@]}" 2>&1 | head -40

exit 0
