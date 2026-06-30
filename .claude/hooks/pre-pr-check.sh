#!/usr/bin/env bash
# Pre-PR hook: blocks gh pr create until /pr-self-review has cleared the gate.
#
# Reads the Bash tool input from stdin (JSON: { "command": "..." }).
# If the command is a gh pr create/edit/open call, checks that the sentinel
# .claude/.review-passed matches the current HEAD SHA.
# Exit 0 = allow. Exit 2 = block with feedback shown to Claude.

set -euo pipefail

input=$(cat)

# Extract the bash command from the tool input JSON
command=$(printf '%s' "$input" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('command', ''))
except Exception:
    print('')
" 2>/dev/null || true)

# Only intercept gh pr create / gh pr edit (not gh pr view, gh pr list, etc.)
if ! printf '%s' "$command" | grep -qE 'gh pr (create|edit)[^-]'; then
  exit 0
fi

sentinel=".claude/.review-passed"
current_sha=$(git rev-parse HEAD 2>/dev/null || true)

if [[ -f "$sentinel" ]]; then
  saved_sha=$(cat "$sentinel" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ "$saved_sha" == "$current_sha" ]]; then
    # Gate cleared for this commit — allow
    exit 0
  fi
fi

# Gate not cleared — block and instruct Claude
cat <<'MSG'
PR Self-Review gate is not cleared for the current HEAD.

Run /pr-self-review first. The skill will:
  1. Diff this branch against main
  2. Route files to specialized skills (react, next, onion-architecture, fastify, drizzle, security, zod)
  3. Check for CRITICAL, HIGH, and MEDIUM issues
  4. Write .claude/.review-passed if no CRITICAL issues are found

Once the gate is cleared, retry gh pr create.
MSG

exit 2
