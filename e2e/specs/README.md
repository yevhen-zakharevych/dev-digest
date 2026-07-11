# e2e/specs

Flow specifications (`NN-name.flow.json`) and the conventions they share —
locator rules, seed-data assumptions, step-naming. Cross-module e2e
contracts (what the UI guarantees so flows can rely on it) belong in
`../../specs/`.

**This directory is not for SDD specs.** Unlike `server/specs/`,
`client/specs/`, and `reviewer-core/specs/`, it holds browser flow *fixtures*,
not prose specifications — never write a `.md` spec here. A browser flow always
verifies a feature owned by another module, so an e2e concern is cross-module by
construction and its spec belongs in `../../specs/`. The `spec-creator` agent is
instructed to refuse this path.
