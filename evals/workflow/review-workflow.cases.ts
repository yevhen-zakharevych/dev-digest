import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read when…" routing + subagent dispatch, together ----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // Routing row under test: "…editing API routes, DB schema, or adapters → server/AGENTS.md".
    name: "API-route task reads server/AGENTS.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/AGENTS.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): the reviewer-core "Read when…" row ------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read when…" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Phrasing like "розберись, як усе влаштовано" sends the model straight into
    // prompt.ts / review/run.ts and it never opens the routed doc. One anchor doc keeps this a
    // deterministic routing check — asserting two docs in one session is inherently flaky.
    // Routing row under test: "…changing prompts / grounding / structured output → reviewer-core/AGENTS.md".
    name: "prompt/grounding task follows CLAUDE.md routing to reviewer-core/AGENTS.md",
    prompt:
      "Я збираюся змінити складання промпту і grounding-гейт у review pipeline. Перш ніж торкатися коду — " +
      "звірся з настановами цього репо (CLAUDE.md) щодо того, яку документацію треба прочитати для таких " +
      "змін, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/AGENTS.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): the "past landmine" routing row + the Session-protocol module rule -----
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read the file, making the negative flaky. As a single-session trace it
  // reliably checks the same rule: in the real repo, a "this surprised me" prompt lands in INSIGHTS.
  // Two CLAUDE.md rules must compose for this to pass: the "Read when… → INSIGHTS.md" row picks the
  // KIND of file, and the Session-protocol rule ("read THAT module's INSIGHTS.md") picks the module.
  {
    kind: "trace",
    name: "CLAUDE.md routes a landmine lookup to reviewer-core/INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де вже могли задокументувати таку міну саме для цього модуля? " +
      "Прочитай той файл.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 6,
  },
  {
    // Turn budget is load-bearing on a NEGATIVE: the runner now fails an incomplete session, because
    // a run that died at max-turns never reached the point where it could have invoked the skill —
    // its silence would be a free pass, not evidence. This prompt is an explain-request, but it runs
    // in the live repo, so the model first greps schema/migrations for real pgvector usage before it
    // answers. That exploration ate the old 4-turn budget. 8 lets it actually finish and stay silent.
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 8,
  },
];
