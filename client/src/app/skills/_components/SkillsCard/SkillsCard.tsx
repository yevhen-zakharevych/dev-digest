/* SkillsCard — mirror of the new design:
   - mono name + global-enabled toggle in the header
   - description (line-clamped)
   - meta row: type chip + source chip with icon
   - stats footer: "{N} agents". Pull / accept rates land in L06/L07. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";
import { cardS, s } from "./styles";

const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#7c83ff",
  convention: "#54a374",
  security: "#d97076",
  custom: "#9a8bf5",
};

/** Icon next to the source chip — mirrors the design vocabulary. */
const SOURCE_ICON: Record<SkillSource, "Edit" | "Code" | "Globe" | "Upload"> = {
  manual: "Edit",
  extracted: "Code",
  community: "Globe",
  imported_url: "Upload",
};

export function SkillsCard({
  sk,
  active,
  onClick,
  onToggle,
}: {
  sk: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const SourceIcon = Icon[SOURCE_ICON[sk.source]];
  return (
    <div onClick={onClick} style={cardS(!!active, sk.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name} className="mono">
          {sk.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={sk.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{sk.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={TYPE_COLOR[sk.type]}>{t(`listItem.type.${sk.type}`)}</Badge>
        <Badge color="var(--text-muted)">
          <SourceIcon size={11} style={{ marginRight: 4, verticalAlign: "-2px" }} />
          {t(`listItem.source.${sk.source}`)}
        </Badge>
      </div>
      <div style={s.statsRow}>
        <span style={s.stat}>
          <span style={s.statValue}>{sk.agents_count}</span> {t("card.agentsCount", { count: sk.agents_count })}
        </span>
      </div>
    </div>
  );
}
