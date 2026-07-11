/* PreviewDrawer — AC-13: renders a discovered document's markdown plus four
   metadata items (bucket badge, token count, "Used by N agents", and an
   attach/detach toggle reflecting current state). Toggling here updates the
   same attach state the row list reads, so the header count updates too. */
"use client";

import React from "react";
import { Badge, Drawer, Markdown, Skeleton, Toggle } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useDocumentContent } from "@/lib/hooks/project-context";
import { BUCKET_COLOR } from "../../constants";
import { splitPath } from "../../helpers";
import { s } from "../../styles";

export function PreviewDrawer({
  repoId,
  doc,
  attached,
  labels,
  onToggle,
  onClose,
}: {
  repoId: string;
  doc: DiscoveredDocument;
  attached: boolean;
  labels: { bucket: string; tokens: string; usedByAgents: string };
  onToggle: (on: boolean) => void;
  onClose: () => void;
}) {
  const { filename } = splitPath(doc.path);
  const { data, isLoading } = useDocumentContent(repoId, doc.path);

  return (
    <Drawer title={filename} subtitle={doc.path} onClose={onClose}>
      <div style={s.previewBody}>
        <div style={s.previewMeta}>
          {doc.bucket && <Badge color={BUCKET_COLOR[doc.bucket]}>{labels.bucket}</Badge>}
          <Badge color="var(--text-muted)" mono>
            {labels.tokens}
          </Badge>
          <Badge color="var(--text-muted)">{labels.usedByAgents}</Badge>
          <div style={{ marginLeft: "auto" }}>
            <Toggle on={attached} onChange={onToggle} />
          </div>
        </div>
        {isLoading && <Skeleton height={200} />}
        {!isLoading && <Markdown>{data?.text ?? ""}</Markdown>}
      </div>
    </Drawer>
  );
}
