/* VersionsTab — history of skill_versions snapshots (newest-first). Clicking a
   row expands its body inline so the user can compare an old prompt with the
   current one without losing the active edit in the Config tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../lib/hooks/skills";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data, isLoading } = useSkillVersions(skill.id);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  return (
    <div style={{ padding: "24px 28px 32px" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
          {t("editor.versions.heading")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("editor.versions.subheading")}
        </div>
      </div>

      {isLoading && (
        <>
          <Skeleton height={56} />
          <Skeleton height={56} />
        </>
      )}

      {!isLoading &&
        (data ?? []).map((v) => (
          <div
            key={v.version}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-surface)",
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setExpanded((cur) => (cur === v.version ? null : v.version))
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              <Badge color="var(--text-muted)" mono>
                v{v.version}
              </Badge>
              {v.version === skill.version && (
                <Badge color="#54a374">{t("editor.versions.current")}</Badge>
              )}
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {new Date(v.created_at).toLocaleString()}
              </span>
              <div style={{ flex: 1 }} />
              <Icon.ChevronRight
                size={14}
                style={{
                  color: "var(--text-muted)",
                  transform:
                    expanded === v.version ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform .15s",
                }}
              />
            </button>
            {expanded === v.version && (
              <pre
                style={{
                  margin: 0,
                  padding: "12px 16px",
                  background: "var(--bg-secondary)",
                  borderTop: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--text-secondary)",
                  maxHeight: 360,
                  overflow: "auto",
                }}
              >
                {v.body}
              </pre>
            )}
          </div>
        ))}

      {!isLoading && (data ?? []).length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("editor.versions.empty")}
        </div>
      )}
    </div>
  );
}
