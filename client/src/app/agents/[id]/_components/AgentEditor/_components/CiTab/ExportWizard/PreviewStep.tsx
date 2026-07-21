/* PreviewStep — wizard step 2/4. Lists the generated bundle (AC-6/AC-9) and
   lets the user edit ONLY the workflow file's text (AC-9 UI half, AC-10).
   The runner entry's `contents` arrives empty by contract (AC-9) and is
   never shown as code — a placeholder note explains why (AC-8 UI half
   covers the "bundle absent entirely" failure, handled by the parent). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton, Textarea } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { isRunnerFile } from "./wizard.helpers";

export function PreviewStep({
  files,
  isLoading,
  error,
  workflowOverride,
  onWorkflowChange,
}: {
  files: CiFile[] | undefined;
  isLoading: boolean;
  error: Error | null;
  workflowOverride: string | undefined;
  onWorkflowChange: (text: string) => void;
}) {
  const t = useTranslations("ci");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  if (error) {
    return (
      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginBottom: 8 }}>
          {t("exportWizard.runnerMissing")}
        </div>
        <div style={{ fontSize: 13, color: "var(--crit)" }}>{error.message}</div>
      </div>
    );
  }

  if (isLoading || !files) {
    return (
      <div style={{ padding: "20px 24px" }}>
        <Skeleton height={220} />
      </div>
    );
  }

  const selected = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;
  const selectedIsRunner = selected != null && isRunnerFile(selected.path);

  return (
    <div style={{ padding: "20px 24px", display: "flex", gap: 16 }}>
      <div style={{ width: 220, flexShrink: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "var(--text-muted)",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          {t("exportWizard.filesToCreate")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelectedPath(f.path)}
              aria-current={selected?.path === f.path}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 6,
                border: "none",
                background: selected?.path === f.path ? "var(--bg-hover)" : "transparent",
                fontSize: 12.5,
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
            >
              <Icon.File size={13} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
              <span className="mono" style={{ wordBreak: "break-all" }}>
                {f.path}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {selected != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span className="mono" style={{ fontSize: 12.5, color: "var(--text-secondary)", wordBreak: "break-all" }}>
              {selected.path}
            </span>
            {selected.editable && (
              <Badge mono icon="Edit" style={{ flexShrink: 0 }}>
                {t("exportWizard.editable")}
              </Badge>
            )}
          </div>
        )}
        {selected == null ? null : selected.editable ? (
          <Textarea value={workflowOverride ?? selected.contents} onChange={onWorkflowChange} rows={18} mono />
        ) : selectedIsRunner ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              padding: 16,
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
          >
            {t("exportWizard.runnerPlaceholder")}
          </div>
        ) : (
          <pre className="mono" style={{ fontSize: 12.5, whiteSpace: "pre-wrap", margin: 0 }}>
            {selected.contents}
          </pre>
        )}
      </div>
    </div>
  );
}
