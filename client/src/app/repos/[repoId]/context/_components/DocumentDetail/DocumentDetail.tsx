/* DocumentDetail — RIGHT pane of the Project Context master-detail layout:
   the currently-selected document. Header row is filename (left) + a
   Preview/Edit toggle next to it + "Used by N agents" (AC-13, far right).
   Below: Preview renders the markdown (`<Markdown>`); Edit shows the
   resync-clobber warning (AC-34, every edit — the v1 superset, since the
   port has no per-file git-tracked check) + the raw-text editor + Save
   (AC-31/32), surfacing a save failure inline (`role="alert"`) rather than
   dropping it silently. When nothing is selected yet, shows a muted
   empty-state placeholder — `ProjectContextBody` auto-selects the first
   document once discovery loads, so this only shows transiently (or if the
   filtered/discovered set is empty, which it guards against upstream). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Markdown } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useDocumentContent, useSaveDocument } from "@/lib/hooks/project-context";
import { splitDocPath } from "../../_lib/format";
import { DocumentEditor } from "../DocumentEditor/DocumentEditor";
import { s } from "./styles";

type Mode = "preview" | "edit";

export function DocumentDetail({
  repoId,
  doc,
}: {
  repoId: string;
  doc: DiscoveredDocument | null;
}) {
  const t = useTranslations("projectContext");
  const [mode, setMode] = React.useState<Mode>("preview");
  const [draft, setDraft] = React.useState<string | null>(null);

  const { data: content, isLoading: contentLoading } = useDocumentContent(
    repoId,
    doc?.path ?? null,
  );
  const save = useSaveDocument();

  // Switching the SELECTED document resets to Preview and drops any
  // in-progress draft for the previously-selected doc — an edit in flight on
  // one document must never leak onto another.
  React.useEffect(() => {
    setMode("preview");
    setDraft(null);
  }, [doc?.path]);

  // Seed the editable draft from the freshly-loaded raw text the first time
  // this document is opened in Edit mode — never clobber an in-progress edit
  // on a refetch (e.g. the invalidation that follows a successful save).
  React.useEffect(() => {
    if (mode === "edit" && draft === null && content?.text != null) {
      setDraft(content.text);
    }
  }, [mode, content, draft]);

  if (!doc) {
    return (
      <div style={s.right}>
        <div style={s.emptyState}>{t("detail.selectPrompt")}</div>
      </div>
    );
  }

  const { file } = splitDocPath(doc.path);

  const handleSave = () => {
    if (draft == null) return;
    save.mutate({ repoId, path: doc.path, text: draft });
  };

  return (
    <div style={s.right}>
      <div style={s.header}>
        <span style={s.filename}>{file}</span>
        <div style={s.modeToggle} role="group" aria-label={t("modeToggleLabel")}>
          <Button
            kind="ghost"
            size="sm"
            active={mode === "preview"}
            aria-pressed={mode === "preview"}
            style={mode === "preview" ? s.modeActive : undefined}
            onClick={() => setMode("preview")}
          >
            {t("mode.preview")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            active={mode === "edit"}
            aria-pressed={mode === "edit"}
            style={mode === "edit" ? s.modeActive : undefined}
            onClick={() => setMode("edit")}
          >
            {t("mode.edit")}
          </Button>
        </div>
        <span style={s.usedBy}>{t("detail.usedByAgents", { count: doc.used_by_agents })}</span>
      </div>

      <div style={s.body}>
        {contentLoading ? (
          <p style={s.muted}>{t("loadingDoc")}</p>
        ) : mode === "preview" ? (
          content?.text ? (
            <Markdown>{content.text}</Markdown>
          ) : (
            <p style={s.muted}>{t("docEmpty")}</p>
          )
        ) : (
          <div style={s.editArea}>
            {/* AC-34: warn on every edit — a per-file git-tracked check
                would need a git call the port doesn't expose (a harmless
                superset per the plan's Open Question 3). */}
            <div style={s.editWarning} role="note">
              <Icon.AlertTriangle size={13} style={s.warnIcon} />
              <span>{t("editWarning")}</span>
            </div>
            <DocumentEditor value={draft ?? ""} onChange={setDraft} aria-label={t("mode.edit")} />
            <div style={s.editActions}>
              <Button
                kind="primary"
                size="sm"
                onClick={handleSave}
                loading={save.isPending}
                disabled={draft == null}
              >
                {save.isPending ? t("saving") : t("save")}
              </Button>
              {save.isError && (
                <span role="alert" style={s.saveError}>
                  {t("saveError", {
                    message:
                      save.error instanceof Error ? save.error.message : t("genericSaveError"),
                  })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
