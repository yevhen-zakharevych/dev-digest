"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRunStatus } from "@devdigest/shared";

/**
 * Status of one CI run, as a pill.
 *
 * Lifted to `features/` rather than living beside either caller because it has TWO
 * consumers — the CI Runs table and the agent CI tab's installation rows. Keeping a copy
 * in each would let the two drift into different vocabularies for the same four states.
 *
 * `status: null` is a real, distinct case (an installation that has never had a run
 * ingested) and must NOT render as `failed` — a repository nobody has opened a PR against
 * has not failed at anything.
 *
 * The label is always text. Colour carries no information on its own here (WCAG AA), which
 * matters more than usual: `failed` and `no_findings` are visually adjacent but mean
 * opposite things.
 */
const KNOWN_STATUSES: readonly CiRunStatus[] = ["succeeded", "failed", "no_findings", "running"];

/**
 * The prop is the LOOSE `string | null` the `CiRun` contract actually carries, not the
 * closed enum — and the narrowing lives here, inside the shared component, on purpose.
 *
 * A shared `toKnownStatus()` helper beside the component would work only for callers who
 * remember to call it; one that instead casts (`status as CiRunStatus`) compiles just as
 * happily and blows up at render time on any value ingestion did not anticipate. Owning
 * the narrowing here makes that mistake unavailable: every caller passes the raw field and
 * an unrecognized value degrades to the neutral state rather than to a lookup miss.
 */
export function CiRunStatusPill({ status }: { status: string | null | undefined }) {
  const t = useTranslations("ci");

  const known: CiRunStatus | null =
    status != null && (KNOWN_STATUSES as readonly string[]).includes(status)
      ? (status as CiRunStatus)
      : null;

  if (known === null) {
    return <Badge dot>{t("runs.status.none")}</Badge>;
  }

  // Colours come from the theme's existing token pairs (`tokens.ts` uses the same ones for
  // severity) — not hand-mixed values, so the pill follows a theme change for free.
  const meta: Record<CiRunStatus, { color: string; bg: string; label: string }> = {
    succeeded: {
      color: "var(--ok)",
      bg: "var(--ok-bg)",
      label: t("runs.status.succeeded"),
    },
    no_findings: {
      color: "var(--text-secondary)",
      bg: "var(--bg-hover)",
      label: t("runs.status.noFindings"),
    },
    failed: {
      color: "var(--crit)",
      bg: "var(--crit-bg)",
      label: t("runs.status.failed"),
    },
    running: {
      color: "var(--accent)",
      bg: "var(--accent-bg)",
      label: t("runs.status.running"),
    },
  };

  const m = meta[known];
  return (
    <Badge dot color={m.color} bg={m.bg}>
      {m.label}
    </Badge>
  );
}
