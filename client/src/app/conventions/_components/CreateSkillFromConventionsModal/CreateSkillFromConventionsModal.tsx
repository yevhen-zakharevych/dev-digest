/* CreateSkillFromConventionsModal — merge accepted candidates into a Skill.

   Seeds name/description/body from the server-side preview endpoint so the
   markdown layout matches what gets persisted; the user can edit all three
   before clicking Save. The skill type is locked to `convention` and the
   source ends up as `extracted` server-side. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import {
  BodyEditor,
  approxTokens,
} from "../../../skills/_components/SkillEditor/_components/ConfigTab/BodyEditor";
import {
  useConventionSkillPreview,
  useCreateSkillFromConventions,
} from "../../../../lib/hooks/conventions";
import { useAgents, useLinkSkillToAgent } from "../../../../lib/hooks/agents";

interface CreateSkillFromConventionsModalProps {
  repoId: string;
  candidates: ConventionCandidate[];
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}

export function CreateSkillFromConventionsModal({
  repoId,
  candidates,
  onClose,
  onCreated,
}: CreateSkillFromConventionsModalProps) {
  const t = useTranslations("conventions");
  const candidateIds = candidates.map((c) => c.id);
  const preview = useConventionSkillPreview(repoId, candidateIds);
  const create = useCreateSkillFromConventions();
  const agents = useAgents();
  const linkSkill = useLinkSkillToAgent();

  // Local edit state — seeded once from the preview payload, then owned by the
  // user. We don't re-seed on subsequent preview fetches; that would clobber
  // their edits.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const seeded = React.useRef(false);

  // Step 2 state: after skill is created, offer to link it to an agent.
  const [createdSkill, setCreatedSkill] = React.useState<Skill | null>(null);
  const [selectedAgentId, setSelectedAgentId] = React.useState("");

  React.useEffect(() => {
    if (seeded.current || !preview.data) return;
    setName(preview.data.name);
    setDescription(preview.data.description);
    setBody(preview.data.body);
    seeded.current = true;
  }, [preview.data]);

  const tokens = React.useMemo(() => approxTokens(body), [body]);
  const filename = `${name.trim() || "conventions"}.md`;
  const ready =
    preview.isSuccess &&
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    candidateIds.length > 0;

  const submit = async () => {
    if (!ready) return;
    const skill = await create.mutateAsync({
      repoId,
      candidateIds,
      name: name.trim(),
      description,
      body,
      enabled,
    });
    setCreatedSkill(skill);
    // Pre-select first available agent if any.
    const firstAgent = agents.data?.[0];
    if (firstAgent) setSelectedAgentId(firstAgent.id);
  };

  const finishAndClose = async (link: boolean) => {
    if (link && createdSkill && selectedAgentId) {
      await linkSkill.mutateAsync({ agentId: selectedAgentId, skillId: createdSkill.id });
    }
    onCreated(createdSkill!);
    onClose();
  };

  // Step 2: skill created, offer to link to an agent.
  if (createdSkill) {
    const agentOptions = [
      { value: "", label: t("modal.link.agentPlaceholder") },
      ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    ];
    return (
      <Modal
        width={480}
        title={t("modal.link.title")}
        subtitle={t("modal.link.subtitle")}
        onClose={() => finishAndClose(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
            <Button kind="ghost" onClick={() => finishAndClose(false)}>
              {t("modal.link.skip")}
            </Button>
            <Button
              kind="primary"
              icon="Link"
              onClick={() => finishAndClose(true)}
              disabled={!selectedAgentId || linkSkill.isPending}
              loading={linkSkill.isPending}
            >
              {t("modal.link.link")}
            </Button>
          </div>
        }
      >
        <div style={{ padding: "20px 24px 24px" }}>
          <FormField label={t("modal.link.agentLabel")}>
            <SelectInput
              value={selectedAgentId}
              onChange={setSelectedAgentId}
              options={agentOptions}
              mono={false}
            />
          </FormField>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      width={720}
      title={t("modal.title")}
      subtitle={t("modal.subtitle", { count: candidateIds.length })}
      onClose={onClose}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("modal.footerHint")}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="ghost" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={submit}
              disabled={!ready || create.isPending}
              loading={create.isPending}
            >
              {t("modal.create")}
            </Button>
          </div>
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
        <FormField label={t("modal.fields.name")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("modal.fields.namePlaceholder")}
            mono
          />
        </FormField>
        <FormField label={t("modal.fields.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("modal.fields.descriptionPlaceholder")}
          />
        </FormField>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
          <FormField label={t("modal.fields.type")}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <Badge color="#54a374">{t("modal.typeConvention")}</Badge>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("modal.typeLockedHint")}
              </span>
            </div>
          </FormField>
          <FormField label={t("modal.fields.enabled")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>

        <FormField
          label={t("modal.fields.body")}
          hint={t("modal.fields.bodyHint")}
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
              {t("modal.tokens", { count: tokens })}
            </span>
          </div>
          <div style={{ marginTop: -1 }}>
            <BodyEditor
              value={body}
              onChange={setBody}
              minRows={10}
              placeholder={
                preview.isLoading
                  ? t("modal.bodyLoading")
                  : t("modal.fields.bodyPlaceholder")
              }
            />
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
