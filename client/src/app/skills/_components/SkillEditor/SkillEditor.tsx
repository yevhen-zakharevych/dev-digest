/* SkillEditor — right pane of /skills. Top bar: name + type chip + version
   chip; below: Tabs (Config / Preview / Evals / Stats / Versions). Evals + Stats
   are stub tabs until L06/L07 land; Versions reads /skills/:id/versions. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Tabs } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab/VersionsTab";
import { TABS } from "./constants";

const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#7c83ff",
  convention: "#54a374",
  security: "#d97076",
  custom: "#9a8bf5",
};

export function SkillEditor({
  skill,
  onDeleted,
}: {
  skill: Skill;
  onDeleted: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<string>("config");
  // Reset to Config when the user picks a different skill.
  React.useEffect(() => setTab("config"), [skill.id]);

  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "20px 28px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Icon.Sparkles size={16} />
        <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
          {skill.name}
        </span>
        <Badge color={TYPE_COLOR[skill.type]}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <Badge color="var(--text-muted)" mono>
          v{skill.version}
        </Badge>
      </div>

      <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 24px" />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "config" && <ConfigTab skill={skill} onDeleted={onDeleted} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}
