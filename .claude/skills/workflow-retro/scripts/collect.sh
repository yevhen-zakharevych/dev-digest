#!/usr/bin/env bash
# Collect orchestration metrics for one Claude Code session.
#
# Usage:  collect.sh [session-id]
#         (no arg = most recently modified session transcript for this repo)
#
# Emits a single JSON object on stdout. Reads only via `jq` aggregation —
# never cats a transcript, which would be megabytes.
set -euo pipefail

SLUG="$(pwd | sed 's|/|-|g')"
PROJ="$HOME/.claude/projects/$SLUG"
[ -d "$PROJ" ] || { echo "{\"error\":\"no transcript dir: $PROJ\"}"; exit 0; }

SID="${1:-}"
if [ -z "$SID" ]; then
  # `|| true`: `head -1` closes the pipe early, so `ls` gets SIGPIPE (exit 141)
  # and `set -o pipefail` would abort the whole script. There are hundreds of
  # session transcripts in this dir, so this fires every time.
  SID="$(ls -t "$PROJ"/*.jsonl 2>/dev/null | head -1 | xargs -r basename | sed 's/\.jsonl$//' || true)"
fi
[ -n "$SID" ] || { echo '{"error":"no session transcript found"}'; exit 0; }

MAIN="$PROJ/$SID.jsonl"
SUB="$PROJ/$SID/subagents"
[ -f "$MAIN" ] || { echo "{\"error\":\"no such session: $SID\"}"; exit 0; }

# ---- main thread -----------------------------------------------------------
main_tokens=$(jq -s '[.[] | select(.message.usage) | .message.usage] |
  {assistant_msgs: length,
   input:        (map(.input_tokens)              | add // 0),
   output:       (map(.output_tokens)             | add // 0),
   cache_read:   (map(.cache_read_input_tokens)   | add // 0),
   cache_create: (map(.cache_creation_input_tokens)| add // 0)}' "$MAIN")

main_tools=$(jq -r '.message.content[]? | select(.type=="tool_use") | .name' "$MAIN" 2>/dev/null \
  | sort | uniq -c | sort -rn | jq -Rs 'split("\n") | map(select(length>0) |
      (capture("\\s*(?<n>\\d+)\\s+(?<tool>.+)") | {tool: .tool, calls: (.n|tonumber)}))')

span=$(jq -s '[.[] | .timestamp // empty] | sort |
  {started: (first // null), ended: (last // null)}' "$MAIN")

# ---- subagents -------------------------------------------------------------
agents='[]'
if [ -d "$SUB" ]; then
  agents=$(for f in "$SUB"/agent-*.jsonl; do
    [ -e "$f" ] || continue
    id=$(basename "$f" .jsonl); meta="${f%.jsonl}.meta.json"
    ty=$(jq -r '.agentType // "unknown"' "$meta" 2>/dev/null || echo unknown)
    ds=$(jq -r '.description // ""'     "$meta" 2>/dev/null || echo "")
    dp=$(jq -r '.spawnDepth // 1'       "$meta" 2>/dev/null || echo 1)
    jq -s --arg id "$id" --arg ty "$ty" --arg ds "$ds" --argjson dp "$dp" '
      {id: $id, agent_type: $ty, description: $ds, spawn_depth: $dp,
       model:  ([.[] | .message.model // empty] | unique | first // "unknown"),
       started:([.[] | .timestamp // empty] | sort | first // null),
       ended:  ([.[] | .timestamp // empty] | sort | last  // null),
       output_tokens: ([.[] | select(.message.usage) | .message.usage.output_tokens] | add // 0),
       cache_read:    ([.[] | select(.message.usage) | .message.usage.cache_read_input_tokens] | add // 0),
       tool_calls:    ([.[] | .message.content[]? | select(.type=="tool_use")] | length),
       tool_errors:   ([.[] | .message.content[]? | select(.type=="tool_result" and .is_error==true)] | length)}
    ' "$f"
  done | jq -s 'sort_by(.started)')
fi

# ---- duplicated context acquisition ---------------------------------------
# Same file Read / same pattern Grep'd by more than one DISTINCT agent.
dup='[]'
if [ -d "$SUB" ]; then
  dup=$(for f in "$SUB"/agent-*.jsonl; do
    id=$(basename "$f" .jsonl)
    jq -r --arg id "$id" '.message.content[]?
      | select(.type=="tool_use" and (.name=="Read" or .name=="Grep"))
      | "\($id)\t\(.name)\t\(.input.file_path // .input.pattern // "?")"' "$f" 2>/dev/null
  done | sort -u \
   | awk -F'\t' '{k=$2"\t"$3; c[k]++} END{for (k in c) if (c[k]>1) printf "%d\t%s\n", c[k], k}' \
   | sort -rn | head -25 \
   | jq -Rs 'split("\n") | map(select(length>0) | split("\t") |
       {agents: (.[0]|tonumber), tool: .[1], target: .[2]})' || true)
  # `|| true`: same SIGPIPE-under-pipefail hazard as the SID line — `head -25`
  # closes the pipe, `sort -rn` gets SIGPIPE, pipefail would abort the run.
fi

jq -n --arg sid "$SID" \
      --argjson span "$span" --argjson main "$main_tokens" \
      --argjson tools "$main_tools" --argjson agents "$agents" --argjson dup "$dup" '
  {session: $sid, span: $span, main_thread: ($main + {tools: $tools}),
   agents: $agents,
   totals: {
     agent_count:        ($agents | length),
     agent_types:        ($agents | group_by(.agent_type) | map({type: .[0].agent_type, n: length})),
     models:             ($agents | group_by(.model)      | map({model: .[0].model, n: length})),
     agent_output_tokens:($agents | map(.output_tokens) | add // 0),
     agent_cache_read:   ($agents | map(.cache_read)    | add // 0),
     agent_tool_calls:   ($agents | map(.tool_calls)    | add // 0),
     agent_tool_errors:  ($agents | map(.tool_errors)   | add // 0)
   },
   duplicated_reads: $dup}'
