#!/usr/bin/env bash
# PostToolUse(Write|Edit): format the edited file with oxfmt. Silent.

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

# Files outside the repo (memory, scratchpad) have no oxfmt config and must keep their own style.
case "$file" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mts|*.cts|*.css|*.json|*.md) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -f "$file" ] && npx oxfmt "$file" >/dev/null 2>&1

exit 0
