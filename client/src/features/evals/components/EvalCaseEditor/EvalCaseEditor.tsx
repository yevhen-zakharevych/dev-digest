"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, CategoryTag, FormField, SeverityBadge, Tabs, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { EvalCase, EvalExpectedItem } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreateEvalCase, useEvalCaseDraft, useRunEvalDraft, useUpdateEvalCase } from "@/lib/hooks/evals";
import { emptyExpectedItem, freezeRejectionBody, parsePrMeta, validateExpectedItems, type ExpectedItemErrors } from "./helpers";
import { ExpectedItemsEditor } from "./_components/ExpectedItemsEditor";
import { DraftFooter } from "./_components/DraftFooter";
import { s } from "./styles";

type InputTab = "diff" | "prMeta";

/**
 * The eval case editor (AC-4..AC-8, AC-47/48) — shared by `cases/new` and
 * `cases/[id]`. Exactly two input tabs (Diff, PR meta) and NO Files tab
 * (AC-6). A `must_not_flag` case only ever arrives here via seeding — its
 * expectation is never chosen in this UI (AC-3), so this editor lets the
 * user pick nothing but the case's CONTENT, never its kind.
 */
export function EvalCaseEditor({
  agentId,
  existingCase,
  onSaved,
  onCancel,
  chrome = true,
}: {
  agentId: string;
  existingCase?: EvalCase | null;
  onSaved: (c: EvalCase) => void;
  /** When provided (modal usage), renders a Cancel button that dismisses the
   *  editor. Omitted on the standalone pages, which navigate instead. */
  onCancel?: () => void;
  /** Standalone pages render the editor's own title header; a modal wrapper
   *  supplies the title in the modal chrome, so it passes `chrome={false}`. */
  chrome?: boolean;
}) {
  const t = useTranslations("eval");
  const isNegative = existingCase?.expectation === "must_not_flag";

  const [name, setName] = React.useState(existingCase?.name ?? "");
  const [tab, setTab] = React.useState<InputTab>("diff");
  const [inputDiff, setInputDiff] = React.useState(existingCase?.input_diff ?? "");
  const initialMeta = React.useMemo(() => parsePrMeta(existingCase?.input_meta), [existingCase]);
  const [prTitle, setPrTitle] = React.useState(initialMeta.title);
  const [prBody, setPrBody] = React.useState(initialMeta.body);
  const [items, setItems] = React.useState<EvalExpectedItem[]>(
    existingCase?.expected_output && existingCase.expected_output.length > 0
      ? existingCase.expected_output
      : [emptyExpectedItem()],
  );
  const [notes, setNotes] = React.useState(existingCase?.notes ?? "");
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [itemErrors, setItemErrors] = React.useState<ExpectedItemErrors[]>([]);
  const [itemsError, setItemsError] = React.useState<string | null>(null);
  const [notesError, setNotesError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [pollingDraft, setPollingDraft] = React.useState(false);

  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const runDraft = useRunEvalDraft();
  const { data: polledDraft } = useEvalCaseDraft(existingCase?.id, { pollWhileRunning: pollingDraft });

  // The freshly-polled draft, falling back to the case's own persisted
  // latest draft — so the footer reads correctly on first paint AND
  // survives a reload without waiting on a poll tick (AC-48).
  const effectiveDraft = polledDraft ?? existingCase?.latest_draft ?? null;

  React.useEffect(() => {
    if (effectiveDraft?.status === "running") {
      setPollingDraft(true);
    } else {
      setPollingDraft(false);
    }
  }, [effectiveDraft?.status]);

  const save = async () => {
    setSaveError(null);

    let valid = true;
    if (isNegative) {
      if (!notes.trim()) {
        setNotesError(t("caseEditor.recordedReasonRequired"));
        valid = false;
      } else {
        setNotesError(null);
      }
    } else {
      const { itemsError: ie, itemErrors: ies } = validateExpectedItems(items, t);
      setItemsError(ie);
      setItemErrors(ies);
      if (ie) valid = false;
    }
    if (!valid) return;

    try {
      let saved: EvalCase;
      if (existingCase) {
        saved = await update.mutateAsync({
          caseId: existingCase.id,
          patch: {
            name,
            input_diff: inputDiff,
            input_meta: { title: prTitle, body: prBody },
            expected_output: isNegative ? existingCase.expected_output : items,
            forbidden_region: existingCase.forbidden_region,
            notes: notes || null,
          },
        });
      } else {
        saved = await create.mutateAsync({
          agentId,
          input: {
            name: name || t("caseEditor.newCase"),
            expectation: "must_find",
            input_diff: inputDiff,
            input_files: null,
            input_meta: { title: prTitle, body: prBody },
            expected_output: items,
            forbidden_region: null,
            source_finding_id: null,
            notes: notes || null,
          },
        });
      }
      if (runOnSave) {
        setPollingDraft(true);
        runDraft.mutate(saved.id);
      }
      onSaved(saved);
    } catch (err) {
      // AC-7: the diff-freeze rejection is never persisted — no navigation,
      // the server's message (naming the file and lines) is shown in place.
      const apiErr = err instanceof ApiError ? err : null;
      setSaveError(
        apiErr
          ? freezeRejectionBody((key, values) => t(key, values as Record<string, string | number>), apiErr.message, apiErr.details)
          : "This case could not be saved.",
      );
    }
  };

  const runCaseNow = () => {
    if (!existingCase) return; // nothing persisted yet to draft-run
    setPollingDraft(true);
    runDraft.mutate(existingCase.id);
  };

  const isSaving = create.isPending || update.isPending;

  return (
    <div style={s.wrap}>
      {chrome && (
        <div style={s.head}>
          <span style={s.title}>
            {existingCase ? t("caseEditor.caseTitle", { name: existingCase.name }) : t("caseEditor.newCase")}
          </span>
          {existingCase && <Badge mono>{existingCase.expectation === "must_find" ? t("badges.mustFind") : t("badges.mustNotFlag")}</Badge>}
        </div>
      )}

      {isNegative && existingCase?.forbidden_region && (
        <div style={s.negativeBanner}>
          <span style={s.negativeBannerLabel}>{t("caseEditor.negativeBanner")}</span>
          <span>
            {t("caseEditor.negativeBannerBody", {
              file: existingCase.forbidden_region.file,
              lines: `${existingCase.forbidden_region.start_line}-${existingCase.forbidden_region.end_line}`,
            })}
          </span>
        </div>
      )}

      {existingCase?.source_finding && (
        <Card style={s.sourceCard}>
          {/* Display-only provenance — participates in NO match (AC-17). */}
          <div style={s.provenanceRow}>
            <SeverityBadge severity={existingCase.source_finding.severity} />
            <CategoryTag category={existingCase.source_finding.category} />
            <Badge mono>{existingCase.source_finding.kind}</Badge>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("help.provenanceChip")}</div>

          {isNegative && (
            <>
              {/* AC-4 — TWO distinct texts. The finding's ORIGINAL rationale
                  (read-only, frozen at seed time) is never the same field as
                  the user's own RECORDED reason below. */}
              <FormField label={t("caseEditor.sourceRationale")} hint={t("caseEditor.sourceRationaleHint")}>
                <div data-testid="source-rationale" style={{ fontSize: 14, lineHeight: 1.5 }}>
                  {existingCase.source_finding.rationale}
                </div>
              </FormField>
              <FormField label={t("caseEditor.recordedReason")} required>
                <Textarea
                  value={notes}
                  onChange={(v) => {
                    setNotes(v);
                    if (notesError) setNotesError(null);
                  }}
                  placeholder={t("caseEditor.recordedReasonPlaceholder")}
                  rows={3}
                />
                {notesError && <div style={s.fieldError}>{notesError}</div>}
              </FormField>
            </>
          )}
        </Card>
      )}

      <FormField label={t("caseEditor.nameLabel")}>
        <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
      </FormField>

      <FormField label={t("caseEditor.inputLabel")}>
        <Tabs
          tabs={[
            { key: "diff", label: t("caseEditor.tabs.diff") },
            { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
          ]}
          value={tab}
          onChange={(k) => setTab(k as InputTab)}
          pad="0"
        />
        <div style={{ marginTop: 12 }}>
          {tab === "diff" ? (
            <Textarea
              value={inputDiff}
              onChange={setInputDiff}
              placeholder={t("caseEditor.diffPlaceholder")}
              rows={12}
              mono
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <FormField label={t("caseEditor.titleLabel")}>
                <TextInput value={prTitle} onChange={setPrTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              </FormField>
              <FormField label={t("caseEditor.bodyLabel")}>
                <Textarea value={prBody} onChange={setPrBody} placeholder={t("caseEditor.bodyPlaceholder")} rows={5} />
              </FormField>
            </div>
          )}
        </div>
      </FormField>

      {isNegative ? (
        <FormField label={t("caseEditor.expectedNoFinding")} hint={t("caseEditor.expectedNoFindingNote")}>
          <div />
        </FormField>
      ) : (
        <>
          <ExpectedItemsEditor items={items} errors={itemErrors} onChange={setItems} />
          {itemsError && <div style={s.fieldError}>{itemsError}</div>}
        </>
      )}

      {saveError && (
        <div style={s.saveErrorBox} data-testid="save-error">
          <strong>{t("caseEditor.freezeRejectedTitle")}</strong>
          <span>{saveError}</span>
        </div>
      )}

      <div style={s.footer}>
        <Button kind="primary" onClick={save} disabled={isSaving} loading={isSaving}>
          {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
        </Button>
        <label style={s.footerToggle}>
          <Toggle on={runOnSave} onChange={setRunOnSave} />
          {t("caseEditor.runOnSave")}
        </label>
        {onCancel && (
          <Button kind="secondary" onClick={onCancel} style={{ marginLeft: "auto" }}>
            {t("caseEditor.cancel")}
          </Button>
        )}
      </div>

      {existingCase && (
        <DraftFooter
          draft={effectiveDraft}
          onRun={runCaseNow}
          runPending={runDraft.isPending}
          runError={runDraft.error instanceof ApiError ? runDraft.error.message : null}
        />
      )}
    </div>
  );
}
