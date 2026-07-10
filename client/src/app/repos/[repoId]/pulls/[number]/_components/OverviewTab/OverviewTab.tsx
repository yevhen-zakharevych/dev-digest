"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard } from "../PrBriefCard/PrBriefCard";
import { IntentCard } from "../IntentCard/IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { ReviewFocusCard } from "../ReviewFocusCard/ReviewFocusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | number | null;
  prBody: string | null | undefined;
  repoId: string | null | undefined;
  repoFullName: string | null;
  sha: string;
  /** Opens a review-focus file in-app (threaded from page.tsx's
   * `handleOpenFile` down into `ReviewFocusCard`). */
  onOpenFile: (file: string) => void;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, sha, onOpenFile }: OverviewTabProps) {
  return (
    <>
      {prId != null && (
        <>
          <PrBriefCard prId={prId} repoId={repoId} />
          <div style={s.cardRow}>
            <IntentCard prId={prId} />
            <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} sha={sha} />
          </div>
          <ReviewFocusCard prId={prId} onOpenFile={onOpenFile} />
        </>
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
