"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer/SmartDiffViewer";
import { usePrComments, useCreatePrComment, usePrReviews } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/brief";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";

type DiffOrder = "smart" | "original";

// `Button`'s built-in `active` styling only applies to kind="tertiary"; these
// are ghost (bordered) toggles, so give the selected one an explicit filled look.
const TOGGLE_ACTIVE_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  borderColor: "var(--border-strong)",
  fontWeight: 600,
};

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Smart-Diff severity badge click → deep-link to the Findings tab (threaded
   *  from page.tsx's `handleOpenFinding`, docs/plans/smart-diff.md §5). */
  onOpenFinding: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order is the default (docs/plans/smart-diff.md §5); Original order
  // keeps the existing DiffViewer + inline commenting untouched.
  const [order, setOrder] = React.useState<DiffOrder>("smart");

  const { data: smartDiff, isLoading: smartDiffLoading } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  // Findings that drive the per-line severity badges: the newest review that
  // actually CARRIES findings. Reviews come newest-first (see page.tsx); a newer
  // re-run or a `summary` row can be empty while an older run still holds the
  // findings the Findings tab shows — filtering only on `kind==='review'` would
  // then silently render zero badges. Prefer a `review`-kind row, but fall back
  // to any review with findings so the badges never vanish.
  const latestReviewFindings: FindingRecord[] = React.useMemo(() => {
    const list = reviews ?? [];
    const chosen =
      list.find((r) => r.kind === "review" && (r.findings?.length ?? 0) > 0) ??
      list.find((r) => (r.findings?.length ?? 0) > 0);
    return chosen?.findings ?? [];
  }, [reviews]);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              kind="ghost"
              size="sm"
              active={order === "smart"}
              style={order === "smart" ? TOGGLE_ACTIVE_STYLE : undefined}
              onClick={() => setOrder("smart")}
            >
              {t("smartDiff.smartOrder")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              active={order === "original"}
              style={order === "original" ? TOGGLE_ACTIVE_STYLE : undefined}
              onClick={() => setOrder("original")}
            >
              {t("smartDiff.originalOrder")}
            </Button>
            {order === "original" && commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {order === "smart" ? (
        smartDiff ? (
          <SmartDiffViewer
            smartDiff={smartDiff}
            files={files}
            findings={latestReviewFindings}
            onOpenFinding={onOpenFinding}
          />
        ) : smartDiffLoading ? (
          <Skeleton height={220} />
        ) : null
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
