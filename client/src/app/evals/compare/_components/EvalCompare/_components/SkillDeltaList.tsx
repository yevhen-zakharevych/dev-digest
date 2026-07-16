"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { EvalSkillDelta } from "@devdigest/shared";

const CHANGE_KEY: Record<EvalSkillDelta["change"], string> = {
  added: "compare.skillAdded",
  removed: "compare.skillRemoved",
  version_changed: "compare.skillVersionChanged",
  reordered: "compare.skillReordered",
};

/**
 * The skill delta (AC-51) — added / removed / version-changed / REORDERED.
 * `reordered` is load-bearing: a pure re-link that only changes order still
 * changes prompt behaviour, and bumps no agent version, so it is invisible
 * anywhere else.
 */
export function SkillDeltaList({ deltas, unavailable }: { deltas: EvalSkillDelta[]; unavailable: boolean }) {
  const t = useTranslations("eval");

  if (unavailable) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compare.skillDeltaUnavailable")}</div>;
  }
  if (deltas.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compare.skillDeltaNone")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {deltas.map((d) => (
        <div key={`${d.skill_id}-${d.change}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span>{d.name}</span>
          <Badge>
            {d.change === "version_changed"
              ? t(CHANGE_KEY[d.change], { from: d.from_version, to: d.to_version })
              : t(CHANGE_KEY[d.change])}
          </Badge>
        </div>
      ))}
    </div>
  );
}
