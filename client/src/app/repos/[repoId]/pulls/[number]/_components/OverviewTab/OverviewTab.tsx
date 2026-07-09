"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard/IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | number | null;
  prBody: string | null | undefined;
  repoId: string | null | undefined;
  repoFullName: string | null;
  sha: string;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, sha }: OverviewTabProps) {
  return (
    <>
      {prId != null && (
        <div style={s.cardRow}>
          <IntentCard prId={prId} />
          <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} sha={sha} />
        </div>
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
