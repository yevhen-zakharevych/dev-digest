---
name: cross-model-plan-review
description: "Cross-model second opinion on an Implementation Plan (docs/plans/*.md). Sends the plan (+ its source spec, if any) to a model from a DIFFERENT family than the one running this session — via OpenRouter — cast as a skeptical staff engineer, and prints its findings back into the chat. Use after implementation-planner produces a plan and before /impl executes it, or any time a second, differently-biased pair of eyes on a plan is wanted. Trigger: /cross-model-plan-review [docs/plans/<file>.md] [--model gpt|gemini|deepseek|<openrouter-id>]."
metadata:
  tags: review, plan, cross-model, second-opinion, openrouter, process
---

# cross-model-plan-review — a staff engineer from another model family reads the plan

Every other review agent in this repo (`plan-verifier`, `architecture-reviewer`,
`/code-review`) runs on Claude — same family as the model that wrote the plan.
This skill deliberately breaks that: it hands the plan to a **non-Anthropic** model
over OpenRouter (the same channel the product itself uses to run GPT / Gemini /
DeepSeek review agents — see `docs/agent-prompts/choosing-a-model.md`), cast as a
**skeptical staff engineer** whose only job is to find reasons the plan is wrong
*before* implementers burn a wave on it. A different model family means different
training biases and blind spots — it is more likely to catch what a same-family
re-read would rubber-stamp.

This is a **plan** review, not a diff review. It runs *before* `/impl`, not after.

## When to use

- Right after `implementation-planner` (or `/spec-creator` → planner) emits a plan,
  before spawning implementers.
- Any time an existing `docs/plans/*.md` needs a second, differently-biased opinion
  (e.g. it "looks fine" but the stakes are high enough to want a skeptic).

Do NOT use this for a diff/PR review (that's `/code-review`, `architecture-reviewer`,
`/security-review`) or for verifying a plan against already-written code (that's
`plan-verifier`). This skill only ever reads a plan file (plus its source spec) and
never reads implementation code.

## Step 0 — resolve inputs

1. **Plan path.** If the `/cross-model-plan-review` argument names a file, use it.
   Otherwise pick the most recently modified file in `docs/plans/`:
   `ls -t docs/plans/*.md | head -1`. If `docs/plans/` is empty, stop and say so.
2. **Read the plan** with `Read`.
3. **Find its source spec, if any.** Grep the plan's `Requirements (as given)` table
   for a `specs/*.md` path in the `Source` column. If found, `Read` that spec too —
   the reviewer needs the WHAT/WHY to judge whether the plan's HOW actually serves it.
   If the plan cites no spec (bare-request plans use `REQ-1…REQ-n`), skip this.

## Step 1 — resolve the model (must be a different family)

Default: `openai/gpt-5.1`. If the argument passes `--model <alias>`, map it:

| Alias | OpenRouter id |
|---|---|
| `gpt` (default) | `openai/gpt-5.1` |
| `gemini` | `google/gemini-3.1-pro-preview` |
| `deepseek` | `deepseek/deepseek-v4-pro` |

Any other string is passed through verbatim as a literal OpenRouter model id (so a
newer id can be used without editing this skill).

**Refuse `anthropic/*` explicitly.** If the resolved id starts with `anthropic/`,
stop and tell the user this defeats the purpose of the skill — the whole point is a
non-Claude opinion.

If the call fails with a "model not found"-shaped error in Step 3, tell the user the
alias table may be stale and to check `https://openrouter.ai/api/v1/models`, or pass
a literal `--model <id>` from that list. Do not silently retry on a Claude model.

## Step 2 — load the OpenRouter key

The key lives in `server/.env` (`OPENROUTER_API_KEY=`), not the shell environment —
the same key the product's own review pipeline uses
(`reviewer-core/src/llm/openrouter.ts`).

```bash
OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' server/.env | cut -d= -f2-)
```

If empty, **stop** and tell the user to set `OPENROUTER_API_KEY` in `server/.env`
(see `server/.env.example`). Never fall back to reviewing the plan with the current
(Claude) session instead — a same-family fallback silently defeats the skill's one
job, so surface the blocker and stop.

Never `echo`, log, or otherwise print the key's value — it only ever goes into the
`Authorization` header inside the `curl` call below.

## Step 3 — call OpenRouter

Build the request with `jq` (avoids manual JSON-escaping the plan/spec text) and
write it to a scratch file, then `curl` it. Use the system prompt in
[references/staff-engineer-prompt.md](references/staff-engineer-prompt.md) verbatim
as the `system` message; the user message is the plan (and spec, if found),
clearly labelled.

```bash
SCRATCH=/private/tmp/claude-501/.../scratchpad   # use this session's actual scratchpad dir
SYSTEM_PROMPT="$(cat .claude/skills/cross-model-plan-review/references/staff-engineer-prompt.md)"

jq -n \
  --arg sys "$SYSTEM_PROMPT" \
  --arg usr "$USER_CONTENT" \
  --arg model "$MODEL" \
  '{model: $model, temperature: 0, messages: [
     {role: "system", content: $sys},
     {role: "user", content: $usr}
   ]}' > "$SCRATCH/cmpr-payload.json"

HTTP_CODE=$(curl -sS -o "$SCRATCH/cmpr-response.json" -w '%{http_code}' \
  https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @"$SCRATCH/cmpr-payload.json")

if [ "$HTTP_CODE" != "200" ]; then
  cat "$SCRATCH/cmpr-response.json"   # surface the provider's error, don't guess
else
  jq -r '.choices[0].message.content' "$SCRATCH/cmpr-response.json"
fi

rm -f "$SCRATCH/cmpr-payload.json" "$SCRATCH/cmpr-response.json"
```

`$USER_CONTENT` = the plan's full text, prefixed with a `## Implementation Plan
(<path>)` heading, followed by `## Source Spec (<path>)` + its full text if one was
found in Step 0.

## Step 4 — present the result

Print the model's raw response to the user under a header naming which model
answered, e.g.:

```
Cross-Model Plan Review — reviewer: openai/gpt-5.1, plan: docs/plans/foo.md
══════════════════════════════════════════
<model's response, verbatim>
```

Do not edit, summarize away, or "fix up" the findings — this is a second opinion,
the value is in seeing it unfiltered. You (the orchestrating Claude session) may add
your own one-paragraph reaction underneath if a finding is clearly wrong or clearly
right, but never merge the two into one voice.

**Chat only.** This skill never writes a file — the plan itself is not touched, and
no `docs/plans/*.cross-review.md` sidecar is created. If the user wants the result
kept, they will say so.

## Hard rules

1. **Never review a diff or code with this skill.** Plan files only
   (`docs/plans/*.md` + their source spec). Reviewing implemented code against a
   plan is `plan-verifier`'s job.
2. **Never resolve to an `anthropic/*` model.** The cross-model property is the
   entire point.
3. **Never print the API key**, and never commit a scratch payload/response file —
   both are scoped to this session's scratchpad and deleted after the call.
4. **Never silently fall back to a same-family review** if the OpenRouter call is
   blocked (missing key, bad model id, network error). Report the blocker and stop.
5. **Read-only on the repo.** This skill never edits `docs/plans/**` or anything
   else — its only side effect is one outbound HTTPS call.
