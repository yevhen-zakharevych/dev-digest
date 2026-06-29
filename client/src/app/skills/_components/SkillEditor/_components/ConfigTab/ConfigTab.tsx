/* ConfigTab — left side of the new editor design.
   - Top: "Configuration" + v{N} chip + Enabled toggle (right).
   - Fields: Name, Description (interface), Type, Body.
   - Body slot: filename label ({name}.md) + "unsaved" pill + live token count
     + BodyEditor (textarea with line-number gutter).
   - Footer: Delete (left), Save (right) — disabled when nothing changed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import {
  useDeleteSkill,
  useUpdateSkill,
} from "../../../../../../lib/hooks/skills";
import { BodyEditor, approxTokens } from "./BodyEditor";

const TYPE_OPTIONS: { label: string; value: SkillType }[] = [
  { label: "Rubric", value: "rubric" },
  { label: "Convention", value: "convention" },
  { label: "Security", value: "security" },
  { label: "Custom", value: "custom" },
];

export function ConfigTab({
  skill,
  onDeleted,
}: {
  skill: Skill;
  onDeleted: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  // Reset local edit state when the active skill changes.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.id]);

  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;

  const tokens = React.useMemo(() => approxTokens(body), [body]);
  const filename = `${(name || skill.name).trim() || "skill"}.md`;

  const save = async () => {
    await update.mutateAsync({
      id: skill.id,
      patch: { name, description, type, body },
    });
  };

  const remove = async () => {
    if (!window.confirm(t("editor.confirmDelete", { name: skill.name }))) return;
    await del.mutateAsync(skill.id);
    onDeleted();
  };

  return (
    <div
      style={{
        padding: "24px 28px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 600 }}>
          {t("editor.configHeading")}
        </div>
        <Badge color="var(--text-muted)" mono>
          v{skill.version}
        </Badge>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {skill.enabled ? t("editor.enabled") : t("editor.disabled")}
        </span>
        <Toggle
          on={skill.enabled}
          onChange={(enabled) =>
            update.mutate({ id: skill.id, patch: { enabled } })
          }
          size={14}
        />
      </div>

      <FormField label={t("editor.fields.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField
        label={t("editor.fields.description")}
        hint={t("editor.fields.descriptionHint")}
      >
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("editor.fields.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={TYPE_OPTIONS}
        />
      </FormField>

      <FormField
        label={t("editor.fields.body")}
        hint={t("editor.fields.bodyHint")}
        required
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderBottom: "none",
            borderRadius: "8px 8px 0 0",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <Icon.FileText size={13} />
          <span className="mono" style={{ fontFamily: "var(--font-mono)" }}>
            {filename}
          </span>
          {dirty && (
            <span
              style={{
                color: "var(--warn, #d4a04e)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {t("editor.unsaved")}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ color: "var(--text-muted)" }}>
            {t("editor.tokens", { count: tokens })}
          </span>
        </div>
        <div style={{ marginTop: -1 }}>
          <BodyEditor value={body} onChange={setBody} minRows={14} />
        </div>
      </FormField>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
        }}
      >
        <Button
          kind="ghost"
          icon="Trash"
          onClick={remove}
          disabled={del.isPending}
        >
          {t("editor.delete")}
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
