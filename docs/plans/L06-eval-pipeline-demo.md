# L06 demo runbook — "corrupt the prompt, watch precision fall"

This is the human-facing reproduction of `server/test/eval-ab-experiment.it.test.ts`
(T20) against a **real** model provider, not the mock. The automated test proves the
pipeline is *wired correctly* end-to-end with a deterministic fixture; this runbook
proves the same thing to a person watching a browser, with real (small) model spend.

Anyone who has never seen the code should be able to follow this and watch the
**Precision** number fall.

## What you need

- The app running: `./scripts/dev.sh` (Postgres + API + web, seeded).
- A model API key configured for the provider the demo agent uses — go to
  **Settings** and add a key for whichever provider `Eval Demo Reviewer` is set
  to (OpenAI/Anthropic/OpenRouter). Without a key, a run will fail every case
  and report "Run failed" with no metrics (this is AC-37 working correctly —
  an infra failure must never be scored as a quality datum — but it isn't the demo).
- A few cents of model budget: the demo agent's set is 8 cases, so one run is
  **8 model calls minimum**. This runbook asks for 3 runs ≈ 24 calls.

## The agent and the case set

Open **Agents → Eval Demo Reviewer → Evals** tab. This agent ships pre-seeded
(`server/src/db/seed.ts`, extended by T18) with **8 eval cases** — 5 `MUST FIND`
(a hardcoded Stripe key, an SSRF, a missing `Retry-After` header, an N+1 query,
a lethal-trifecta importer job) and 3 `MUST NOT FLAG` (three previously-dismissed
nitpicks). The tab's metric cards read "—" until the first run.

## Step 1 — establish the baseline

1. On the **Evals** tab, click **Run all evals**. The button names the case
   count and therefore the call count before it starts (AC-34) — confirm it
   says "8 cases" and start it.
2. Watch the progress state advance ("k of 8"); it finishes in well under a
   minute for 8 single-file diffs.
3. Note the three metric cards: **Recall**, **Precision**, **Citation
   accuracy**, and the "N / 8 passing" headline. Write down the **Precision**
   number — this is the number you're about to watch move. On the unmodified
   `GENERAL_REVIEWER_PROMPT` it is typically at or near 100% (the fixtures are
   designed to be unambiguous), but read whatever your run actually reports —
   don't assume the number in this doc.

## Step 2 — corrupt the prompt

1. Still on the agent, open the **Prompt** field (the main editor tab, not
   Evals) and **append** this single sentence to the end of the existing
   system prompt:

   > Also flag anything that could conceivably be improved, however minor or
   > speculative — when in doubt, report it rather than staying silent.

   This is a realistic corruption: it's the kind of well-meaning instruction
   someone adds to "be more thorough" that actually widens the net past what
   the reviewer can defend. It does not touch the "what to look for" sections
   that make the 5 `MUST FIND` fixtures findable — recall should stay roughly
   where it was.
2. Save. This bumps the agent's version (a system-prompt edit is a
   config-affecting change — `isConfigChange`, `server/src/modules/agents/helpers.ts`).
3. Go back to **Evals** and click **Run all evals** again.

## Step 3 — read the comparison, not just the second number

1. On the **Evals** tab (or the **Eval Dashboard**), open **Compare** and pick
   the two runs you just produced — the one from Step 1 (older version) and
   the one from Step 2 (newer version).
2. Read the **Precision** row: before → after, with the direction of change
   (never colour alone — AC-38/a11y). It should have **dropped**.
3. Read the **cases that flipped** list (AC-26). For this specific corruption,
   expect **few or no case flips** — the `MUST FIND` cases you already had
   right are probably still individually "passing" (an extra flagged detail on
   a case that already found its real defect does not fail that case — AC-22)
   — but the **Precision** number still moved, because it is computed once
   over **every surviving finding in the whole set**, not per case. This is
   the exact mechanism `eval-ab-experiment.it.test.ts` assertion (b) encodes:
   noise anywhere in the set costs precision even when it lands on a case that
   still passes, and even when it never touches a `MUST NOT FLAG` case's
   forbidden region at all.
4. If a case *did* flip — most likely one of the 3 `MUST NOT FLAG` cases now
   has a comment inside its forbidden region — the compare view names it
   explicitly; that's the sharper, more obvious version of the same failure.

## The caveat this demo exists to make you check (AC-25, AC-38)

**A metric delta between two runs of the identical, unchanged config is not
automatically a regression — it's the model's own run-to-run noise floor.**
Before trusting the drop you just saw as "the corrupted prompt did this,"
rule out noise:

1. **Revert** the prompt edit from Step 2 (remove the sentence you added,
   save — this appends yet another version, restoring the original prompt).
2. Run **Run all evals** twice in a row with nothing else changed.
3. Compare those two runs. Any Precision movement you see here is pure model
   noise — the same config measured twice. If it's non-trivial, your model's
   noise floor is wide, and the Step-3 drop needs to clearly exceed it before
   you act on it. If it's ~0 (a fully deterministic provider, temperature 0),
   the drop you measured in Step 3 is real.

This is `eval-ab-experiment.it.test.ts` assertion (c) — two runs of an
unchanged agent are comparable, their prompt diff is empty, and any delta
between them is, by construction, noise, not a finding.

## What "good" looks like at the end of this runbook

- Step 1 → Step 3: Precision measurably lower after the corruption, named with
  a before → after pair, not just eyeballed off two separate screens.
- The noise-floor check (the caveat section) shows a materially smaller (or
  zero) delta than the corruption did — otherwise the corruption's drop isn't
  distinguishable from noise, and that's worth reporting, not explaining away.
- Nothing here required reading a line of code — only clicking **Run all
  evals**, **Compare**, and reading the Precision row.

## Where this maps back to the acceptance criteria

| Step | Criterion |
|---|---|
| Run count named before the run starts | AC-34 |
| Progress + non-blocking run | AC-11, AC-12 |
| Precision defined at SET level, noise anywhere costs it | AC-19 |
| Extra finding on an already-passing case doesn't fail that case | AC-22 |
| Compare shows a metric delta + which cases flipped, never a bare number | AC-24, AC-26, AC-38 |
| Two same-config runs are comparable and their prompt diff is empty | AC-25 |
| Citation accuracy help text states the "real hunk, not the right line" caveat | AC-21 |

## Automated equivalent

`server/test/eval-ab-experiment.it.test.ts` reproduces this whole narrative
deterministically against a `MockLLMProvider`-backed fixture, plus two facets
this manual runbook cannot show without editing two agents' worth of skills:
linking a skill between two runs of an otherwise-unchanged agent (same version
tag, different effective config — AC-51, AC-10) and promoting a run that
differs from the live agent only in its skill set (AC-27). Run it with:

```
cd server && pnpm exec vitest run test/eval-ab-experiment.it.test.ts
```
