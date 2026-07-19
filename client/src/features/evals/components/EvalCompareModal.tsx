/* EvalCompareModal — "Compare runs" as an inline modal (PR #8 review
   follow-up), opened from an agent's Evals tab once exactly two runs are
   selected. Reuses EvalCompare's body (metric deltas, prompt diff, Promote
   buttons) with its own header hidden (`chrome={false}`) — the modal owns the
   "Compare runs · vA → vB" title. The comparison query is deduped by TanStack
   (same key), so reading it here for the title costs no extra fetch. Both run
   ids are always present, so EvalCompare's run-picker fallback never shows and
   `onPick` is a no-op. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { useEvalComparison } from "@/lib/hooks/evals";
import { EvalCompare } from "./EvalCompare/EvalCompare";
import { runLabel } from "./EvalCompare/helpers";

export function EvalCompareModal({
  runIdA,
  runIdB,
  agentId,
  onClose,
}: {
  runIdA: string;
  runIdB: string;
  agentId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data } = useEvalComparison(runIdA, runIdB);
  const title = data
    ? t("compare.title", { a: runLabel(data.base), b: runLabel(data.candidate) })
    : t("compare.modalTitle");

  return (
    <Modal
      width={1040}
      title={title}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <EvalCompare runIdA={runIdA} runIdB={runIdB} agentId={agentId} onPick={() => {}} chrome={false} />
    </Modal>
  );
}
