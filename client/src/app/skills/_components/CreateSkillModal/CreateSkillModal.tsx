/* CreateSkillModal — name / description / type / body.
   Uses the same BodyEditor (line-numbered gutter) as the inline ConfigTab so
   the create-flow body matches the editor body 1:1. Form padding is owned here
   because Modal renders children at zero padding (it's a generic container). */
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
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import {
  BodyEditor,
  approxTokens,
} from "../SkillEditor/_components/ConfigTab/BodyEditor";

const TYPE_OPTIONS: { label: string; value: SkillType }[] = [
  { label: "Rubric", value: "rubric" },
  { label: "Convention", value: "convention" },
  { label: "Security", value: "security" },
  { label: "Custom", value: "custom" },
];

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || body.trim().length === 0) return;
    const sk = await create.mutateAsync({ name: trimmed, description, type, body });
    onCreated(sk.id);
    onClose();
  };

  const tokens = React.useMemo(() => approxTokens(body), [body]);
  const filename = `${name.trim() || "skill"}.md`;

  return (
    <Modal
      width={680}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={create.isPending || name.trim().length === 0 || body.trim().length === 0}
          >
            {create.isPending ? t("create.creating") : t("create.create")}
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
        <FormField label={t("create.fields.name")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("create.fields.namePlaceholder")}
            mono
          />
        </FormField>
        <FormField
          label={t("create.fields.description")}
          hint={t("create.fields.descriptionHint")}
        >
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={TYPE_OPTIONS}
          />
        </FormField>
        <FormField
          label={t("create.fields.body")}
          hint={t("create.fields.bodyHint")}
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
            <span style={{ fontFamily: "var(--font-mono)" }}>{filename}</span>
            <div style={{ flex: 1 }} />
            <span style={{ color: "var(--text-muted)" }}>
              {t("editor.tokens", { count: tokens })}
            </span>
          </div>
          <div style={{ marginTop: -1 }}>
            <BodyEditor
              value={body}
              onChange={setBody}
              minRows={8}
              placeholder={t("create.fields.bodyPlaceholder")}
            />
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
