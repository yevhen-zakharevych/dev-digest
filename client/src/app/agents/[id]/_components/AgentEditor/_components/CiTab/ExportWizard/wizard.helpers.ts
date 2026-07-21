/* wizard.helpers.ts — pure helpers + the wizard's own state shape for the
   Export-to-CI wizard. No React, no I/O, no i18n — every branch here is
   unit-testable without mounting a component (co-location rule: this file
   has >1 consumer inside ExportWizard/, so it is one file, not inlined into
   each step). */
import type { CiTarget } from "@devdigest/shared";

/** The four wizard steps, in the pinned literal order (AC-1): Target,
 *  Preview, Configure, Install. Index == the `step` prop `ExportWizardSteps`
 *  expects. */
export const WIZARD_STEP_KEYS = ["target", "preview", "configure", "install"] as const;
export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number];
export const TARGET_STEP = 0;
export const PREVIEW_STEP = 1;
export const CONFIGURE_STEP = 2;
export const INSTALL_STEP = 3;

/** Only GitHub Actions ships (spec Non-goal); the other three cards render
 *  disabled + "coming soon" (AC-2). */
export const DISABLED_TARGETS: readonly CiTarget[] = ["circle", "jenkins", "cli"];

export const DEFAULT_TRIGGERS = ["opened", "synchronize", "reopened"] as const;
export type TriggerKey = (typeof DEFAULT_TRIGGERS)[number];

/**
 * `owner/name` validation for the Target step's free-text repo field
 * (AC-4, client half — UX only; the server independently re-validates and
 * is the actual security boundary). Rejects empty input, a bare name with
 * no slash ("acme"), a trailing empty segment ("acme/"), and a full URL
 * ("https://github.com/acme/x") — the character class excludes ":" and a
 * second "/", so a URL fails on both counts.
 */
export function isValidRepoName(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo.trim());
}

/**
 * Distinguishes the bundled runner entry (AC-9: contents arrive empty, shows
 * a placeholder note instead of code) from every other non-editable file —
 * notably the empty `.devdigest/memory.jsonl` (AC-6), which is ALSO
 * non-editable with empty contents but is a real (if currently blank) file,
 * not a stripped bundle placeholder. Matched by path segment rather than the
 * exact constant (owned server-side, `modules/ci/constants.ts`) since the
 * client has no reason to import server path constants — the `/runner/`
 * folder segment is the stable, observable part of AC-6's file list.
 */
export function isRunnerFile(path: string): boolean {
  return path.includes("/runner/");
}

/** The wizard's own working state — everything the four steps read/write.
 *  `workflow` is `undefined` until the user actually edits the Preview
 *  step's textarea; only then is it sent as `CiExportInput.workflow` (AC-10)
 *  — an untouched preview must not round-trip a copy of the generated text
 *  back to the server as if it were a deliberate override. */
export interface WizardState {
  target: CiTarget;
  repo: string;
  triggers: string[];
  postAs: "github_review" | "pr_comment" | "none";
  base: string;
  /** Present only once the user has edited the Preview step's workflow text. */
  workflow: string | undefined;
}

export function initialWizardState(defaultRepo: string): WizardState {
  return {
    target: "gha",
    repo: defaultRepo,
    triggers: [...DEFAULT_TRIGGERS],
    postAs: "github_review",
    base: "main",
    workflow: undefined,
  };
}
