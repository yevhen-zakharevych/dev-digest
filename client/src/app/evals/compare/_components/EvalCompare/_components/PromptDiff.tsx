"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { diffLines, hasLineChanges } from "../helpers";
import { s } from "../styles";

/** Line-level diff of the two config snapshots' system prompts (AC-24).
 *  `unavailable` covers a run with no stored snapshot — rendered, never an
 *  error (AC-52). Two runs of the same version legitimately diff to nothing
 *  (AC-25) — that empty diff IS the noise-floor signal, not a bug. */
export function PromptDiff({
  basePrompt,
  candidatePrompt,
  unavailable,
}: {
  basePrompt: string | null;
  candidatePrompt: string | null;
  unavailable: boolean;
}) {
  const t = useTranslations("eval");

  if (unavailable || basePrompt == null || candidatePrompt == null) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compare.promptDiffUnavailable")}</div>;
  }

  const ops = diffLines(basePrompt, candidatePrompt);
  if (!hasLineChanges(ops)) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compare.promptDiffEmpty")}</div>;
  }

  return (
    <div style={s.promptDiffWrap} aria-label={t("compare.promptDiff")}>
      {ops.map((op, i) => (
        <div key={i} style={s.diffLine(op.type)}>
          {op.type === "add" ? "+ " : op.type === "remove" ? "- " : "  "}
          {op.text}
        </div>
      ))}
    </div>
  );
}
