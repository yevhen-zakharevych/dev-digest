/* ContextTab (agent editor) — project-context documents attached to this
   agent (AC-8 .. AC-14, AC-18/AC-21 client half; specs/2026-07-10-project-context.md).

   - One row per discovered document: drag handle + keyboard move-up/down
     alternative, attach/detach toggle, filename, folder, bucket badge, and a
     Preview affordance (AC-8). Attach/detach/reorder persists PATHS ONLY
     (never document text) via PUT /agents/:id/docs — the agent's `version`
     is never bumped (mutable config, AC-14, matches the Skills-tab idiom).
   - The running token estimate (AC-11) counts the full de-duplicated
     EFFECTIVE set: this agent's own attached docs plus the attached docs of
     every currently ENABLED linked skill (spec's Open Question 7 /
     assumption), matching what the run executor actually injects.

   An agent has no `repoId` of its own (it is workspace-scoped); this tab
   discovers documents for the shell's ACTIVE repo (`useActiveRepo`), the
   same mechanism `/conventions` already uses for a repo-scoped surface with
   no ambient repoId, and the same choice the sibling Skill editor Context
   tab made (`app/skills/_components/SkillEditor/_components/ContextTab`).
   See this task's final report for the "assumption" note. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import type { Agent, DiscoveredDocument, DocumentBucket } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useProjectContextDocs } from "@/lib/hooks/project-context";
import { useAgentSkills, useSkills } from "@/lib/hooks/skills";
import { useSetAgentAttachedDocs } from "@/lib/hooks/agents";
import { ContextTabRow } from "./ContextTab.Row";
import { PreviewDrawer } from "./_components/PreviewDrawer/PreviewDrawer";
import { computeEffectivePaths, filterDocuments, orderRows, sumEstimatedTokens } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data, isLoading } = useProjectContextDocs(repoId);
  const { data: links } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const setAttachedDocs = useSetAgentAttachedDocs();

  const [query, setQuery] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const attached: string[] = agent.attached_docs ?? [];
  const attachedSet = React.useMemo(() => new Set(attached), [attached]);
  const documents: DiscoveredDocument[] = data?.documents ?? [];

  // Docs contributed by every ENABLED linked skill, in skill-load order — a
  // disabled link or a globally-disabled skill contributes nothing (AC-18).
  const enabledSkillDocs = React.useMemo(() => {
    if (!links || !allSkills) return [];
    const skillsById = new Map(allSkills.map((sk) => [sk.id, sk]));
    return [...links]
      .sort((a, b) => a.order - b.order)
      .filter((l) => l.enabled && (skillsById.get(l.skill_id)?.enabled ?? false))
      .map((l) => skillsById.get(l.skill_id)?.attached_docs ?? []);
  }, [links, allSkills]);

  const effectivePaths = React.useMemo(
    () => computeEffectivePaths(attached, enabledSkillDocs),
    [attached, enabledSkillDocs],
  );
  const tokenEstimate = sumEstimatedTokens(effectivePaths, documents);

  const filtered = filterDocuments(documents, query);
  const rows = orderRows(filtered, attached);

  const setPaths = (paths: string[]) => setAttachedDocs.mutate({ agentId: agent.id, paths });

  const toggle = (path: string) => {
    const next = attachedSet.has(path) ? attached.filter((p) => p !== path) : [...attached, path];
    setPaths(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= attached.length || from === to) return;
    const next = [...attached];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setPaths(next);
  };

  const onDragStart = (e: React.DragEvent, i: number) => {
    e.dataTransfer.setData("text/plain", String(i));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(from)) return;
    move(from, i);
  };

  const previewDoc = previewPath ? documents.find((d) => d.path === previewPath) ?? null : null;
  const bucketLabel = (b: DocumentBucket | null) => (b ? t(`context.bucket.${b}`) : "");

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.title}>{t("editor.tabs.context")}</div>
        <Badge color="var(--text-secondary)">
          {t("context.attachedCount", { attached: attached.length, total: documents.length })}
        </Badge>
      </div>

      <div style={s.estimateRow}>
        <Badge color="var(--text-muted)" mono icon="Hash">
          {t("context.tokenEstimate", { count: tokenEstimate })}
        </Badge>
      </div>
      <div style={s.note}>
        <Icon.Shield size={14} />
        {t("context.untrustedNote")}
      </div>

      {reposLoaded && !repoId && (
        <EmptyState icon="FileText" title={t("context.noRepo.title")} body={t("context.noRepo.body")} />
      )}

      {repoId && (
        <>
          <div style={s.search}>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={t("context.searchPlaceholder")}
              suffix={<Icon.Search size={14} />}
            />
          </div>

          {isLoading && (
            <>
              <Skeleton height={48} />
              <Skeleton height={48} />
              <Skeleton height={48} />
            </>
          )}

          {!isLoading && data && !data.clone_available && (
            <EmptyState
              icon="FileText"
              title={t("context.cloneUnavailable.title")}
              body={t("context.cloneUnavailable.body")}
            />
          )}

          {!isLoading && data?.clone_available && documents.length === 0 && (
            <EmptyState icon="FileText" title={t("context.empty.title")} body={t("context.empty.body")} />
          )}

          {!isLoading && data?.clone_available && documents.length > 0 && rows.length === 0 && (
            <EmptyState icon="Search" title={t("context.noResults", { query })} />
          )}

          {rows.map((doc) => {
            const isAttached = attachedSet.has(doc.path);
            const orderIndex = isAttached ? attached.indexOf(doc.path) : null;
            return (
              <ContextTabRow
                key={doc.path}
                doc={doc}
                attached={isAttached}
                orderIndex={orderIndex}
                attachedCount={attached.length}
                labels={{
                  bucket: bucketLabel(doc.bucket),
                  preview: t("context.preview"),
                  moveUp: t("context.moveUp"),
                  moveDown: t("context.moveDown"),
                }}
                onToggle={toggle}
                onMove={move}
                onPreview={setPreviewPath}
                dnd={{ onDragStart, onDragOver, onDrop }}
              />
            );
          })}
        </>
      )}

      {previewDoc && repoId && (
        <PreviewDrawer
          repoId={repoId}
          doc={previewDoc}
          attached={attachedSet.has(previewDoc.path)}
          labels={{
            bucket: bucketLabel(previewDoc.bucket),
            tokens: t("context.tokens", { count: previewDoc.estimated_tokens }),
            usedByAgents: t("context.usedByAgents", { count: previewDoc.used_by_agents }),
          }}
          onToggle={() => toggle(previewDoc.path)}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  );
}
