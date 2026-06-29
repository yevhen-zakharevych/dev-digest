/* PreviewTab — render the skill body the same way the agent sees it.
   This is the rendered Markdown that gets concatenated into the prompt's
   `## Skills / rules` block, so what you see here is what the model reads. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={{ padding: "24px 28px 32px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
          {t("editor.preview.heading")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("editor.preview.subheading")}
        </div>
      </div>
      <div
        style={{
          padding: "20px 24px",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          lineHeight: 1.6,
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
