import { fixtureReader, type SkillCase } from "../../src/index.js";

// This skill's job is to analyze real files (package.json, tsconfig.json, node_modules sizes),
// but "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts). So each prompt inlines a fixture standing in for what the skill would normally
// gather itself with Read/Bash/Grep.
//
// Two fixtures, deliberately different in what they give away:
//   repo-snapshot.md  — a synthetic repo whose facts are pre-digested (it literally says "no
//                       import of moment was found"). Measures whether the skill REPORTS well:
//                       structure, tiering, specificity. Low benchmark lift by construction —
//                       a raw model can summarize this too, and that is fine; it is not what
//                       these cases are for.
//   lockfile-split.md — this repo's real shape, given as RAW observations (an `ls` listing, the
//                       tsconfig paths blocks) with no conclusion drawn. Measures whether the
//                       skill REASONS: pnpm vs npm per lockfile, path aliases vs npm edges, not
//                       a workspace. A model without the skill reliably says "run npm audit
//                       everywhere" here, so this is the case that carries honest lift.
const fixture = fixtureReader(import.meta.url);
const REPO_SNAPSHOT = fixture("repo-snapshot.md");
const LOCKFILE_SPLIT = fixture("lockfile-split.md");

export const cases: SkillCase[] = [
  {
    // Cheap deterministic gate: no judge, pure substring coverage, must score 1.0. If the report
    // skeleton is wrong there is no point paying a judge to tell us the prose inside it is nice.
    name: "report emits the five required sections verbatim",
    kind: "grounding",
    prompt: `Run a dependency check on this repo and give me the full report.\n\n${REPO_SNAPSHOT}`,
    grounding: [
      "## Scope",
      "```mermaid",
      "flowchart",
      "## Size Breakdown",
      "## Findings & Priorities",
      "## Summary",
      "P0",
    ],
    maxTurns: 10,
  },
  {
    name: "full report follows the required 5-section structure with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_SNAPSHOT}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a section named 'Scope' listing which packages (client, server, reviewer-core, e2e) were analyzed",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report has a section with a size breakdown table showing dependencies and their installed size, not just a vague size statement",
      "the report has a 'Findings & Priorities' section (or equivalently named) that groups findings under explicit severity tiers such as P0, P1, P2, or Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
      "every finding names a specific package, dependency, or file rather than giving generic advice like 'consider optimizing dependencies'",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "distinguishes internal (path-alias) dependencies from external npm dependencies",
    kind: "quality",
    prompt: `This repo isn't a monorepo — server, client, reviewer-core, and e2e share code via TypeScript path aliases, not workspace:* packages. Analyze our dependencies, including how these packages depend on each other internally.\n\n${REPO_SNAPSHOT}`,
    practices: [
      "the answer explicitly distinguishes internal cross-package dependencies (the @shared/review-types alias and the direct relative import into reviewer-core/src/pipeline.js) from external npm package dependencies, rather than treating them as the same kind of dependency",
      "the answer flags server/src/services/review-service.ts importing reviewer-core/src/pipeline.js by relative path instead of through reviewer-core's public entry point as a P0-tier or otherwise explicitly called-out issue",
      "the answer does not claim these packages are linked via workspace:* or pnpm workspaces, since the project explicitly is not a monorepo",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "severity tiers are used consistently and recommendations are specific, not vague",
    kind: "quality",
    prompt: `We suspect some npm dependencies in server/ and client/ are unused or duplicated across packages with different versions. Check our dependencies and tell me what to prioritize fixing first.\n\n${REPO_SNAPSHOT}`,
    practices: [
      "findings are explicitly labeled with one of the defined severity tiers (P0, P1, P2, or Info) rather than left unranked",
      "the three different zod versions across server, client, and reviewer-core are called out explicitly as version drift",
      "moment being declared in server/package.json but never imported anywhere under server/src is called out explicitly as an unused dependency",
      "each recommendation names a specific package name and package.json/file location (e.g. server/package.json, moment, zod) rather than a generic suggestion",
      "removing a dependency (e.g. moment) is presented as a recommendation for the user to confirm, not something already executed",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    // The discriminating case. The fixture gives raw observations only (an `ls` listing, the
    // tsconfig paths blocks) and never states the rule, so a model without the skill has to
    // derive "the audit tool follows the lockfile" on its own — and typically does not.
    //
    // The prompt asks BOTH questions the practices score (how to audit, and how the packages are
    // linked). An earlier draft asked only the first while the practices also demanded the second;
    // the model answered the question it was asked and the case failed it for the answer it never
    // requested. A practice must be answerable from its own prompt.
    name: "picks the audit tool per lockfile instead of assuming one package manager repo-wide",
    kind: "quality",
    prompt: `How do we check every package in this repo for known vulnerabilities, and what should we fix first? Also explain how these six packages actually depend on each other, since there's no root package.json.\n\n${LOCKFILE_SPLIT}`,
    practices: [
      // Note: the prescription and its rationale are scored SEPARATELY (here vs the third
      // practice). Bundling "prescribe pnpm audit *on the grounds that* the lockfile is
      // pnpm-lock.yaml" into one practice charges the model twice for the same reasoning and
      // fails a correct answer that stated the rule once, globally.
      "the answer prescribes pnpm audit (not npm audit) for the server, client, mcp-server and evals packages",
      "the answer prescribes npm audit for reviewer-core and e2e — i.e. it does not apply one package manager uniformly across the repo",
      "the answer states that the choice of audit command follows the lockfile actually present in each package, rather than a repo-wide convention",
      "the answer identifies e2e — and only e2e — as the package with no node_modules directory, rather than lumping reviewer-core (which does have one) in with it or silently omitting the gap",
      "the answer attributes the cross-package linkage to the tsconfig path aliases (@devdigest/shared, @devdigest/reviewer-core), and does not describe the repo as a pnpm workspace / monorepo linked by workspace:*",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    // Tiering discipline. The calibration rule ("already red on a clean tree ⇒ Info, never P0")
    // is what keeps a gate alive, and it is the first rule a model abandons the moment the word
    // "critical" appears in its input.
    name: "a pre-existing transitive advisory is tiered Info, not P0",
    kind: "quality",
    prompt: `Audit our dependencies and tell me what to prioritize.

Note: on a completely clean checkout of main, with zero local changes, \`cd client && pnpm audit --audit-level high\` already reports "11 vulnerabilities found — Severity: 1 low | 7 moderate | 2 high | 1 critical". All of them are transitive through @vitejs/plugin-react > vite. My current branch changed only server/package.json (it adds one new dependency, pino-pretty) and server/pnpm-lock.yaml.\n\n${REPO_SNAPSHOT}`,
    practices: [
      "the 11 pre-existing client advisories are tiered as Info (or at most P2) and explicitly described as pre-existing / not introduced by this branch, rather than being raised to P0 or presented as merge-blocking",
      "the answer reasons that a finding already red on a clean main branch should not block the current change, rather than tiering purely on the word 'critical'",
      "the answer still reports the pre-existing advisories rather than omitting them, naming @vitejs/plugin-react or vite as the transitive source",
      "the answer directs its highest-priority attention at what the current branch actually changed (server/package.json and server/pnpm-lock.yaml) rather than at the standing client advisories",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
