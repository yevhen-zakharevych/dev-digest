/* ExportWizard — "Add to CI" modal (AC-1). Owns the wizard's step/state
   machine and every hook call; the four step components are presentational
   (data + callbacks only), so each is independently testable and none of
   them calls `api`/a hook directly (client/CLAUDE.md).

   Step order is pinned literally: Target, Preview, Configure, Install
   (AC-1) — reused from `ExportWizardSteps`'s existing demo call
   (`components/showcase/Showcase.tsx`), not reinvented here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiExportInputBody, CiTarget } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useCiPreview, useExportToCi } from "@/lib/hooks/ci-export";
import { TargetStep } from "./TargetStep";
import { PreviewStep } from "./PreviewStep";
import { ConfigureStep } from "./ConfigureStep";
import { InstallStep } from "./InstallStep";
import {
  CONFIGURE_STEP,
  INSTALL_STEP,
  PREVIEW_STEP,
  TARGET_STEP,
  initialWizardState,
  isValidRepoName,
  type TriggerKey,
} from "./wizard.helpers";

export function ExportWizard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("ci");
  const { activeRepo } = useActiveRepo();
  const [step, setStep] = React.useState(TARGET_STEP);
  const [state, setState] = React.useState(() => initialWizardState(activeRepo?.full_name ?? ""));

  const preview = useCiPreview();
  const exportCi = useExportToCi();

  const buildInput = React.useCallback(
    (): CiExportInputBody => ({
      repo: state.repo,
      target: state.target,
      action: "open_pr",
      post_as: state.postAs,
      triggers: state.triggers,
      base: state.base,
      ...(state.workflow != null ? { workflow: state.workflow } : {}),
    }),
    [state],
  );

  // Fire (or re-fire) the preview whenever the Preview step is showing with a
  // valid repo and the params that shape the bundle have changed since the
  // last fetch — a trigger/post-as/base edit made on Configure and then
  // revisited from Preview must not show a stale render.
  const previewKey = [state.repo, state.target, state.postAs, state.base, state.triggers.join(",")].join("|");
  const lastPreviewKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (step !== PREVIEW_STEP) return;
    if (!isValidRepoName(state.repo)) return;
    if (lastPreviewKeyRef.current === previewKey) return;
    lastPreviewKeyRef.current = previewKey;
    preview.mutate({ agentId: agent.id, input: buildInput() });
    // `preview`/`buildInput` intentionally excluded: `previewKey` already
    // captures every input that should re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, previewKey, agent.id]);

  const canContinue =
    step === TARGET_STEP
      ? state.target === "gha" && isValidRepoName(state.repo)
      : step === PREVIEW_STEP
        ? !preview.isError
        : step === CONFIGURE_STEP
          ? state.triggers.length > 0
          : true;

  const handleSelectTarget = (target: CiTarget) => {
    if (target !== "gha") return; // AC-2: disabled targets are a no-op
    setState((s) => ({ ...s, target }));
  };

  const handleToggleTrigger = (trig: TriggerKey) => {
    setState((s) => ({
      ...s,
      triggers: s.triggers.includes(trig) ? s.triggers.filter((x) => x !== trig) : [...s.triggers, trig],
    }));
  };

  const handleInstall = () => {
    exportCi.mutate({ agentId: agent.id, input: buildInput() });
  };

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];

  return (
    <Modal
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      width={860}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {step > TARGET_STEP && step !== INSTALL_STEP && (
              <Button kind="secondary" onClick={() => setStep((s) => s - 1)}>
                {t("exportWizard.back")}
              </Button>
            )}
          </div>
          {step !== INSTALL_STEP && (
            <Button kind="primary" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              {t("exportWizard.continue")}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ padding: "18px 24px 0" }}>
        <ExportWizardSteps step={step} labels={stepLabels} />
        {/* The stepper itself carries no ARIA role/state (vendored primitive,
            `vendor/ui/ExportWizardSteps.tsx`) — an `aria-live` region that
            re-announces the current step's own (already-translated) label
            on every step change exposes the current step to assistive tech
            without inventing any new catalogue string. */}
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {stepLabels[step]}
        </div>
      </div>

      {step === TARGET_STEP && (
        <TargetStep
          target={state.target}
          repo={state.repo}
          onSelectTarget={handleSelectTarget}
          onRepoChange={(repo) => setState((s) => ({ ...s, repo }))}
        />
      )}
      {step === PREVIEW_STEP && (
        <PreviewStep
          files={preview.data}
          isLoading={preview.isPending}
          error={preview.error}
          workflowOverride={state.workflow}
          onWorkflowChange={(workflow) => setState((s) => ({ ...s, workflow }))}
        />
      )}
      {step === CONFIGURE_STEP && (
        <ConfigureStep
          triggers={state.triggers}
          onToggleTrigger={handleToggleTrigger}
          postAs={state.postAs}
          onPostAsChange={(postAs) => setState((s) => ({ ...s, postAs }))}
          base={state.base}
          onBaseChange={(base) => setState((s) => ({ ...s, base }))}
        />
      )}
      {step === INSTALL_STEP && (
        <InstallStep
          repo={state.repo}
          fileCount={preview.data?.length ?? 0}
          prUrl={exportCi.data?.pr_url ?? null}
          isPending={exportCi.isPending}
          error={exportCi.error}
          onInstall={handleInstall}
        />
      )}
    </Modal>
  );
}
