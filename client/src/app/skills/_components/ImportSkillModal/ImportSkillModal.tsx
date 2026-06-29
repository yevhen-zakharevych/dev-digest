/* ImportSkillModal — md/zip upload → preview → confirm.
   1. Step "pick": user chooses a .md or .zip file.
   2. Step "preview": the API parsed the core; user can edit name/desc/type/body
      and SEE the skippedFiles (zip contents we ignored). Nothing is persisted.
   3. Step "save": the confirmed preview is POSTed; only then a Skill row exists.
   Executable contents in a zip are NEVER extracted or run — only listed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import { BodyEditor } from "../SkillEditor/_components/ConfigTab/BodyEditor";
import type { SkillType } from "@devdigest/shared";
import {
  importSkillFile,
  useSaveImportedSkill,
  type ImportPreview,
} from "../../../../lib/hooks/skills";

const TYPE_OPTIONS: { label: string; value: SkillType }[] = [
  { label: "Rubric", value: "rubric" },
  { label: "Convention", value: "convention" },
  { label: "Security", value: "security" },
  { label: "Custom", value: "custom" },
];

export function ImportSkillModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const save = useSaveImportedSkill();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pickFile = async (f: File) => {
    setFile(f);
    setLoading(true);
    setError(null);
    try {
      const p = await importSkillFile(f);
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    const sk = await save.mutateAsync(preview);
    onImported(sk.id);
    onClose();
  };

  return (
    <Modal
      width={680}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Upload"
            onClick={confirm}
            disabled={!preview || save.isPending || preview.body.trim().length === 0}
          >
            {save.isPending ? t("import.saving") : t("import.save")}
          </Button>
        </div>
      }
    >
      <div
        style={{
          padding: "20px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <FormField label={t("import.fileLabel")} hint={t("import.fileHint")}>
          <input
            type="file"
            accept=".md,.markdown,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
            }}
            style={{ fontSize: 13, color: "var(--text-secondary)" }}
          />
        </FormField>

        {loading && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {t("import.parsing")}
          </div>
        )}

        {error && (
          <div
            style={{
              fontSize: 13,
              color: "var(--crit)",
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              borderRadius: 6,
              border: "1px solid var(--crit)",
            }}
          >
            {error}
          </div>
        )}

        {preview && (
          <>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                padding: "10px 12px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                lineHeight: 1.45,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <Icon.Shield size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>{t("import.trustNotice")}</span>
            </div>

            <FormField label={t("create.fields.name")} required>
              <TextInput
                value={preview.name}
                onChange={(v) => setPreview({ ...preview, name: v })}
              />
            </FormField>
            <FormField label={t("create.fields.description")}>
              <TextInput
                value={preview.description}
                onChange={(v) => setPreview({ ...preview, description: v })}
              />
            </FormField>
            <FormField label={t("create.fields.type")}>
              <SelectInput
                value={preview.type}
                onChange={(v) => setPreview({ ...preview, type: v as SkillType })}
                options={TYPE_OPTIONS}
              />
            </FormField>
            <FormField label={t("create.fields.body")} hint={t("import.bodyHint")}>
              <BodyEditor
                value={preview.body}
                onChange={(v) => setPreview({ ...preview, body: v })}
                minRows={8}
              />
            </FormField>

            {preview.warnings.length > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  padding: "10px 12px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {t("import.warningsLabel")}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.skippedFiles.length > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  padding: "10px 12px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {t("import.skippedLabel")}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5, maxHeight: 120, overflowY: "auto" }}>
                  {preview.skippedFiles.map((f) => (
                    <li key={f} className="mono" style={{ fontFamily: "var(--font-mono)" }}>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {!preview && !loading && !file && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              lineHeight: 1.45,
            }}
          >
            {t("import.untrustedNotice")}
          </div>
        )}
      </div>
    </Modal>
  );
}
