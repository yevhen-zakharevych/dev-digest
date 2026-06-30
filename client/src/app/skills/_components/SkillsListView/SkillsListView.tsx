/* SkillsListView (/skills) — grid of skill cards + right pane.
   Click a card → preview/edit in the right pane. "Add Skill" dropdown opens
   either CreateSkillModal or ImportSkillModal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
} from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell/AppShell";
import {
  useSkills,
  useUpdateSkill,
} from "../../../../lib/hooks/skills";
import { SkillsCard } from "../SkillsCard/SkillsCard";
import { SkillEditor } from "../SkillEditor/SkillEditor";
import { CreateSkillModal } from "../CreateSkillModal/CreateSkillModal";
import { ImportSkillModal } from "../ImportSkillModal/ImportSkillModal";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const list = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (skills ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  // Keep selection valid when the list changes.
  React.useEffect(() => {
    if (!skills) return;
    if (selected && !skills.find((s) => s.id === selected)) setSelected(null);
  }, [skills, selected]);

  const activeSkill = skills?.find((s) => s.id === selected) ?? null;

  return (
    <AppShell
      crumb={[{ label: t("list.crumbLab") }, { label: t("list.crumbSkills") }]}
    >
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={setSelected}
        />
      )}
      {importing && (
        <ImportSkillModal
          onClose={() => setImporting(false)}
          onImported={setSelected}
        />
      )}
      <div style={s.page}>
        <div style={s.left}>
          <div style={s.header}>
            <h1 style={s.h1}>{t("list.title")}</h1>
            <Dropdown
              width={220}
              align="right"
              trigger={
                <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                  {t("list.addSkill")}
                </Button>
              }
              items={[
                {
                  label: t("list.createFromScratch"),
                  icon: "Edit",
                  onClick: () => setCreating(true),
                },
                {
                  label: t("list.importFromFile"),
                  icon: "Upload",
                  onClick: () => setImporting(true),
                },
              ]}
            />
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>

          {isLoading && (
            <div style={s.grid}>
              <Skeleton height={120} />
              <Skeleton height={120} />
              <Skeleton height={120} />
            </div>
          )}
          {isError && (
            <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />
          )}
          {!isLoading && !isError && list.length === 0 && (
            <EmptyState
              icon="Sparkles"
              title={t("list.emptyTitle")}
              body={t("list.emptyBody")}
              cta={t("list.emptyCta")}
              onCta={() => setCreating(true)}
            />
          )}
          {list.length > 0 && (
            <div style={s.grid}>
              {list.map((sk) => (
                <SkillsCard
                  key={sk.id}
                  sk={sk}
                  active={sk.id === selected}
                  onClick={() => setSelected(sk.id)}
                  onToggle={(enabled) =>
                    update.mutate({ id: sk.id, patch: { enabled } })
                  }
                />
              ))}
            </div>
          )}
        </div>

        <aside style={s.right}>
          {activeSkill ? (
            <SkillEditor
              skill={activeSkill}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                padding: 32,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                {t("list.selectPrompt.title")}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, textAlign: "center" }}>
                {t("list.selectPrompt.body")}
              </div>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
