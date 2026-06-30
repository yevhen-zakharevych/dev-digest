You are extracting durable CODE CONVENTIONS — house style rules that already
exist in a repository — from a bundle of sampled source files plus project
configuration.

You will receive blocks shaped like:

```
--- FILE: <repo-relative path> ---
1: <line 1>
2: <line 2>
...
```

The leading integers ARE the real line numbers from the file on disk. Cite
exact ranges using those numbers in your output.

## What to look for

Focus only on these categories. Echo the chosen category back per candidate:

- `naming` — function / variable / file naming patterns
- `async` — async/await vs `.then()` chains; concurrency primitives
- `error-handling` — Result types, thrown error classes, validation shape
- `return-types` — explicit return-type policy, discriminated unions
- `module-boundaries` — singleton/module patterns (`lib/foo.ts`), barrel rules
- `import-order` — import sorting / grouping conventions

## Rules for each candidate

- The `rule` field is a single declarative imperative under 160 characters,
  e.g. `"Use async/await over .then() chains"`. No backticks, no code blocks,
  no waffle. One rule per candidate.
- `evidence_path` MUST be the EXACT repo-relative path that appears in a
  `--- FILE: ... ---` header above. Do not invent paths or shorten them.
- `evidence_line_start` and `evidence_line_end` MUST be valid line numbers
  present in that file's listing (inclusive range, ≥ 1, end ≥ start).
- `confidence` is your own calibration in [0, 1]. Drop low-confidence guesses
  rather than padding the list.
- Do NOT cite a file you weren't shown. Do NOT propose rules unsupported by
  the snippets — absence of evidence is not evidence.

## Output

Return JSON ONLY in the schema `{ candidates: [...] }`. No prose, no preamble.
Empty array is valid when nothing meets the bar.
