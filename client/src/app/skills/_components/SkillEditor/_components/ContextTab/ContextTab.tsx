/* ContextTab (skill editor) — project-context documents attached to this
   skill (AC-15/AC-16/AC-17, specs/2026-07-10-project-context.md).

   Any agent that loads this skill inherits the documents attached here.
   Attaching/detaching/reordering persists PATHS ONLY (never document text)
   via PUT /skills/:id/docs — the skill's `version` is never bumped (mutable
   config, matches the existing Skills-on-agent idiom).

   Rows carry a reorder affordance (drag handle + keyboard move-up/down
   alternative) mirroring the agent Context tab's row controls (AC-15's "same
   row controls as the agent tab", AC-8's control set), since the skill's
   persisted attach order determines run-time injection order (AC-21). The
   agent tab lives in a separate route-local tree and is deliberately not
   imported from here — the mechanism is copied, not the module. Reorder
   index/mutation math is always computed against the full persisted
   `skill.attached_docs` array, never the search-filtered view (a filtered-out
   attached doc must not shift another row's index).

   A skill has no `repoId` of its own (it is workspace-scoped); this tab
   discovers documents for the shell's ACTIVE repo (`useActiveRepo`, the same
   mechanism `/conventions` already uses for a repo-scoped surface with no
   ambient repoId — see client/AGENTS.md + ConventionsListView.tsx). See the
   final report's "assumption" note for why. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Markdown,
  Modal,
  Skeleton,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { DiscoveredDocument, DocumentBucket, Skill } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useDocumentContent, useProjectContextDocs } from "@/lib/hooks/project-context";
import { useSetSkillAttachedDocs } from "@/lib/hooks/skills";
import type { CSSProperties } from "react";

const BUCKET_COLOR: Record<DocumentBucket, string> = {
  specs: "#7c83ff",
  docs: "#54a374",
  insights: "#d9a534",
};

const s = {
  wrap: { padding: "20px 24px 40px", maxWidth: 920 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  note: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  search: { marginBottom: 14 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    marginBottom: 6,
  } satisfies CSSProperties,
  handle: (draggable: boolean): CSSProperties => ({
    cursor: draggable ? "grab" : "default",
    color: draggable ? "var(--text-muted)" : "var(--border-strong)",
    display: "inline-flex",
    padding: 2,
  }),
  moveBtns: { display: "flex", flexDirection: "column", gap: 1 } satisfies CSSProperties,
  moveBtn: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: 1,
    display: "inline-flex",
  } satisfies CSSProperties,
  fileInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } satisfies CSSProperties,
  filename: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  folder: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  flexGrow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  serializes: {
    marginTop: 24,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
  } satisfies CSSProperties,
  serializesHeading: { fontSize: 14, fontWeight: 600, marginBottom: 2 } satisfies CSSProperties,
  serializesSubheading: { fontSize: 12, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  serializesPre: {
    margin: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;

function splitPath(path: string): { filename: string; folder: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { filename: path, folder: "" };
  return { filename: path.slice(idx + 1), folder: path.slice(0, idx) };
}

/** Order rows for display: attached documents first, in the skill's
 *  persisted order (the reorderable region), then every unattached document
 *  sorted by path. Mirrors the agent Context tab's `helpers.ts:orderRows`. */
function orderRows(
  documents: readonly DiscoveredDocument[],
  attachedPaths: readonly string[],
): DiscoveredDocument[] {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  const attachedRows = attachedPaths
    .map((p) => byPath.get(p))
    .filter((d): d is DiscoveredDocument => d != null);
  const attachedSet = new Set(attachedPaths);
  const unattached = documents
    .filter((d) => !attachedSet.has(d.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [...attachedRows, ...unattached];
}

function DocPreviewBody({
  repoId,
  path,
  bucket,
  estimatedTokens,
  usedByAgents,
  attached,
  onToggle,
}: {
  repoId: string;
  path: string;
  bucket: DocumentBucket | null;
  estimatedTokens: number;
  usedByAgents: number;
  attached: boolean;
  onToggle: (on: boolean) => void;
}) {
  const t = useTranslations("skills");
  const { data, isLoading } = useDocumentContent(repoId, path);

  return (
    <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {bucket && <Badge color={BUCKET_COLOR[bucket]}>{t(`contextTab.bucket.${bucket}`)}</Badge>}
        <Badge color="var(--text-muted)" mono>{t("contextTab.tokens", { count: estimatedTokens })}</Badge>
        <Badge color="var(--text-muted)">{t("contextTab.usedByAgents", { count: usedByAgents })}</Badge>
        <div style={{ marginLeft: "auto" }}>
          <Toggle on={attached} onChange={onToggle} />
        </div>
      </div>
      {isLoading && <Skeleton height={200} />}
      {!isLoading && <Markdown>{data?.text ?? ""}</Markdown>}
    </div>
  );
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const { data, isLoading } = useProjectContextDocs(repoId);
  const setAttachedDocs = useSetSkillAttachedDocs();

  const [query, setQuery] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const attached: string[] = skill.attached_docs ?? [];
  const attachedSet = React.useMemo(() => new Set(attached), [attached]);

  const documents: DiscoveredDocument[] = data?.documents ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? documents.filter((d) => d.path.toLowerCase().includes(q))
    : documents;
  const rows = orderRows(filtered, attached);

  const toggle = (path: string, on: boolean) => {
    const next = on
      ? [...attached, path]
      : attached.filter((p) => p !== path);
    setAttachedDocs.mutate({ skillId: skill.id, paths: next });
  };

  // Reorder math always runs against the FULL persisted `attached` array
  // (never the search-filtered `rows`/`filtered` view) — a hidden attached
  // doc must not shift another row's index.
  const move = (from: number, to: number) => {
    if (to < 0 || to >= attached.length || from === to) return;
    const next = [...attached];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setAttachedDocs.mutate({ skillId: skill.id, paths: next });
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

  const previewDoc = previewPath
    ? documents.find((d) => d.path === previewPath) ?? null
    : null;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.title}>{t("editor.tabs.context")}</div>
        <Badge color="var(--text-secondary)">
          {t("contextTab.attachedCount", { count: attached.length })}
        </Badge>
      </div>

      <div style={s.note}>
        <Icon.Sparkles size={14} />
        {t("contextTab.inheritNote")}
      </div>

      {reposLoaded && !repoId && (
        <EmptyState
          icon="FileText"
          title={t("contextTab.noRepo.title")}
          body={t("contextTab.noRepo.body")}
        />
      )}

      {repoId && (
        <>
          <div style={s.search}>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={t("contextTab.searchPlaceholder")}
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
              title={t("contextTab.cloneUnavailable.title")}
              body={t("contextTab.cloneUnavailable.body")}
            />
          )}

          {!isLoading && data?.clone_available && documents.length === 0 && (
            <EmptyState
              icon="FileText"
              title={t("contextTab.empty.title")}
              body={t("contextTab.empty.body")}
            />
          )}

          {!isLoading &&
            data?.clone_available &&
            documents.length > 0 &&
            filtered.length === 0 && (
              <EmptyState icon="Search" title={t("contextTab.noResults", { query })} />
            )}

          {rows.map((doc) => {
            const { filename, folder } = splitPath(doc.path);
            const isOn = attachedSet.has(doc.path);
            // Index/mutation math resolves against the FULL persisted
            // `attached` array, never `filtered`/`rows` — see the `move`
            // comment above.
            const orderIndex = isOn ? attached.indexOf(doc.path) : null;
            const canDrag = orderIndex != null;
            const canMoveUp = orderIndex != null && orderIndex > 0;
            const canMoveDown = orderIndex != null && orderIndex < attached.length - 1;
            return (
              <div
                key={doc.path}
                style={s.row}
                data-testid={`context-doc-row-${doc.path}`}
                draggable={canDrag}
                onDragStart={canDrag ? (e) => onDragStart(e, orderIndex!) : undefined}
                onDragOver={canDrag ? onDragOver : undefined}
                onDrop={canDrag ? (e) => onDrop(e, orderIndex!) : undefined}
              >
                <span style={s.handle(canDrag)} aria-hidden>
                  <Icon.Menu size={14} />
                </span>
                <div style={s.moveBtns}>
                  <button
                    type="button"
                    style={s.moveBtn}
                    aria-label={t("contextTab.moveUp")}
                    disabled={!canMoveUp}
                    onClick={() => move(orderIndex!, orderIndex! - 1)}
                  >
                    <Icon.ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    style={s.moveBtn}
                    aria-label={t("contextTab.moveDown")}
                    disabled={!canMoveDown}
                    onClick={() => move(orderIndex!, orderIndex! + 1)}
                  >
                    <Icon.ArrowDown size={12} />
                  </button>
                </div>
                <Toggle on={isOn} onChange={(on) => toggle(doc.path, on)} />
                <div style={s.fileInfo}>
                  <span style={s.filename}>{filename}</span>
                  <span style={s.folder}>{folder}</span>
                </div>
                <div style={s.flexGrow} />
                {doc.bucket && (
                  <Badge color={BUCKET_COLOR[doc.bucket]}>{t(`contextTab.bucket.${doc.bucket}`)}</Badge>
                )}
                <Button kind="ghost" size="sm" icon="Eye" onClick={() => setPreviewPath(doc.path)}>
                  {t("contextTab.preview")}
                </Button>
              </div>
            );
          })}
        </>
      )}

      <div style={s.serializes} data-testid="skill-context-serializes-as">
        <div style={s.serializesHeading}>{t("contextTab.serializesAs.heading")}</div>
        <div style={s.serializesSubheading}>{t("contextTab.serializesAs.subheading")}</div>
        {attached.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("contextTab.serializesAs.empty")}
          </div>
        ) : (
          <pre style={s.serializesPre}>
            {`## Project context\n${attached.join("\n")}`}
          </pre>
        )}
      </div>

      {previewDoc && repoId && (
        <Modal
          title={t("contextTab.previewModal.title")}
          subtitle={previewDoc.path}
          onClose={() => setPreviewPath(null)}
        >
          <DocPreviewBody
            repoId={repoId}
            path={previewDoc.path}
            bucket={previewDoc.bucket}
            estimatedTokens={previewDoc.estimated_tokens}
            usedByAgents={previewDoc.used_by_agents}
            attached={attachedSet.has(previewDoc.path)}
            onToggle={(on) => toggle(previewDoc.path, on)}
          />
        </Modal>
      )}
    </div>
  );
}
