#!/usr/bin/env bash
# PreToolUse(Bash): refuse to run prettier. The project formats with oxfmt and has no prettier
# config, so `npx prettier` fetches one from the registry and rewrites whole files to its defaults.

command=$(jq -r '.tool_input.command // empty')

# Invocations only (`npx prettier`, `node_modules/.bin/prettier`, a bare `prettier` command) —
# a `grep prettier` or `npm ls prettier` still goes through.
if printf '%s' "$command" | grep -qE '(^|[;&|(`]|\$\(|npx|bunx|dlx|exec|bin/)[[:space:]]*(-[^[:space:]]+[[:space:]]+)*prettier([[:space:]@]|$)'; then
  echo 'Blocked: this project formats with oxfmt, not prettier. The Write/Edit and Stop hooks already run it; to format by hand use `npx oxfmt <files>`.' >&2
  exit 2
fi

exit 0
