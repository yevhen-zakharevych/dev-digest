/* The fixed five-kind vocabulary + display order (AC-1/AC-2). The server
 * enforces this vocabulary against the free-string `kind` field (the wire
 * contract keeps `kind: z.string()` — see knowledge.ts) and guarantees the
 * `sections` array already arrives in this order; the client renders
 * whatever order it's given (it does not re-sort) but uses this list for
 * the anchor nav — which must show all five slots even if a degraded
 * skeleton response omits one, so a reader always sees the full tour shape. */
import type { IconName } from "@devdigest/ui";

export const ONBOARDING_SECTION_KINDS = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
] as const;

export type OnboardingSectionKind = (typeof ONBOARDING_SECTION_KINDS)[number];

export const ONBOARDING_SECTION_ICONS: Record<OnboardingSectionKind, IconName> = {
  architecture: "Layers",
  critical_paths: "Workflow",
  run_locally: "Play",
  reading_path: "FileText",
  first_tasks: "ListChecks",
};

export function isOnboardingSectionKind(kind: string): kind is OnboardingSectionKind {
  return (ONBOARDING_SECTION_KINDS as readonly string[]).includes(kind);
}
