/* SkillsTab — Skills attached to this agent.
   - List rows with a drag-handle (reorder → setSkills), checkbox (per-link
     enabled → setLinkEnabled), and an unlink button.
   - "Link a skill" dropdown adds any skill not yet linked.
   The prompt assembly reads (in this exact order) the rows whose checkbox is
   on AND whose underlying skill is globally enabled. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  Dropdown,
  EmptyState,
  Icon,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import {
  useAgentSkills,
  useSetAgentSkills,
  useSetAgentSkillEnabled,
  useSkills,
  useUnlinkAgentSkill,
} from "../../../../../../../lib/hooks/skills";
import type { CSSProperties } from "react";

const s = {
  wrap: { padding: "20px 24px 40px", maxWidth: 920 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  row: (dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: dragging ? "var(--bg-secondary)" : "var(--bg-surface)",
    marginBottom: 6,
    cursor: "default",
  }),
  handle: {
    cursor: "grab",
    color: "var(--text-muted)",
    display: "inline-flex",
    padding: 2,
  } satisfies CSSProperties,
  name: { fontFamily: "var(--font-mono)", fontSize: 13 } satisfies CSSProperties,
  flexGrow: { flex: 1 } satisfies CSSProperties,
  unlink: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: 4,
    display: "inline-flex",
  } satisfies CSSProperties,
} as const;

const TYPE_COLOR: Record<string, string> = {
  rubric: "#7c83ff",
  convention: "#54a374",
  security: "#d97076",
  custom: "#9a8bf5",
};

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("skills");
  const { data: links, isLoading } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const setSkills = useSetAgentSkills();
  const setEnabled = useSetAgentSkillEnabled();
  const unlink = useUnlinkAgentSkill();

  const skillsById = React.useMemo(() => {
    const m = new Map<string, Skill>();
    (allSkills ?? []).forEach((sk) => m.set(sk.id, sk));
    return m;
  }, [allSkills]);

  // Ordered list of linked skills, resolved against the catalog.
  const ordered = React.useMemo(() => {
    if (!links) return [];
    return [...links]
      .sort((a, b) => a.order - b.order)
      .map((l) => ({ link: l, skill: skillsById.get(l.skill_id) }));
  }, [links, skillsById]);

  const enabledCount = ordered.filter(
    (o) => o.link.enabled && (o.skill?.enabled ?? false),
  ).length;

  const unlinked = (allSkills ?? []).filter(
    (sk) => !ordered.find((o) => o.link.skill_id === sk.id),
  );

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...ordered];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m!);
    setSkills.mutate({ agentId: agent.id, skillIds: next.map((n) => n.link.skill_id) });
  };

  // Track drag source index via dataTransfer (HTML5 DnD).
  const onDragStart = (e: React.DragEvent, i: number) => {
    e.dataTransfer.setData("text/plain", String(i));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(from)) return;
    move(from, i);
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.flexGrow}>
          <div style={s.title}>{t("agentTab.title")}</div>
          <div style={s.subtitle}>{t("agentTab.subtitle")}</div>
        </div>
        <Badge color="var(--text-secondary)">
          {t("agentTab.enabledCount", { enabled: enabledCount, total: ordered.length })}
        </Badge>
        <Dropdown
          width={260}
          align="right"
          trigger={
            <Button kind="secondary" size="sm" icon="Plus" iconRight="ChevronDown">
              {t("agentTab.link")}
            </Button>
          }
          items={
            unlinked.length === 0
              ? [{ label: t("agentTab.noUnlinkedSkills"), muted: true, onClick: () => {} }]
              : unlinked.map((sk) => ({
                  label: sk.name,
                  icon: "Sparkles" as const,
                  onClick: () =>
                    setSkills.mutate({
                      agentId: agent.id,
                      skillIds: [...ordered.map((o) => o.link.skill_id), sk.id],
                    }),
                }))
          }
        />
      </div>

      {isLoading && (
        <>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </>
      )}

      {!isLoading && ordered.length === 0 && (
        <EmptyState
          icon="Sparkles"
          title={t("agentTab.empty.title")}
          body={t("agentTab.empty.body")}
        />
      )}

      {ordered.map((o, i) => {
        const sk = o.skill;
        if (!sk) return null;
        const link = o.link;
        return (
          <div
            key={link.skill_id}
            style={s.row(false)}
            draggable
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
          >
            <span style={s.handle} aria-hidden>
              <Icon.Menu size={14} />
            </span>
            <Checkbox
              checked={link.enabled && sk.enabled}
              onChange={(checked) =>
                setEnabled.mutate({
                  agentId: agent.id,
                  skillId: link.skill_id,
                  enabled: checked,
                })
              }
            />
            <span style={s.name}>{sk.name}</span>
            <div style={s.flexGrow} />
            <Badge color={TYPE_COLOR[sk.type] ?? "var(--text-muted)"}>
              {t(`listItem.type.${sk.type}`)}
            </Badge>
            <button
              type="button"
              style={s.unlink}
              title={t("agentTab.unlink")}
              aria-label={t("agentTab.unlink")}
              onClick={() => unlink.mutate({ agentId: agent.id, skillId: link.skill_id })}
            >
              <Icon.X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
