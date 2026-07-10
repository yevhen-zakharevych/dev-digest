/* ContextTab.Row — a single discovered-document row (AC-8): drag handle +
   keyboard move-up/move-down alternative, attach/detach toggle, filename,
   folder path, bucket badge, Preview affordance. Single-use, colocated next
   to `ContextTab.tsx` per the file-naming convention used elsewhere in this
   codebase (`Component.SubComponent.tsx`). */
"use client";

import React from "react";
import { Badge, Button, Icon, Toggle } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { BUCKET_COLOR } from "./constants";
import { splitPath } from "./helpers";
import { s } from "./styles";

export interface ContextRowDnd {
  onDragStart: (e: React.DragEvent, orderIndex: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, orderIndex: number) => void;
}

export function ContextTabRow({
  doc,
  attached,
  orderIndex,
  attachedCount,
  labels,
  onToggle,
  onMove,
  onPreview,
  dnd,
}: {
  doc: DiscoveredDocument;
  attached: boolean;
  /** Index within the attached (reorderable) region, or `null` when this row
   *  is not currently attached. */
  orderIndex: number | null;
  attachedCount: number;
  labels: { bucket: string; preview: string; moveUp: string; moveDown: string };
  onToggle: (path: string) => void;
  onMove: (from: number, to: number) => void;
  onPreview: (path: string) => void;
  dnd: ContextRowDnd;
}) {
  const { filename, folder } = splitPath(doc.path);
  const canDrag = orderIndex != null;
  const canMoveUp = orderIndex != null && orderIndex > 0;
  const canMoveDown = orderIndex != null && orderIndex < attachedCount - 1;

  return (
    <div
      style={s.row(false)}
      data-testid={`context-doc-row-${doc.path}`}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => dnd.onDragStart(e, orderIndex!) : undefined}
      onDragOver={canDrag ? dnd.onDragOver : undefined}
      onDrop={canDrag ? (e) => dnd.onDrop(e, orderIndex!) : undefined}
    >
      <span style={s.handle(canDrag)} aria-hidden>
        <Icon.Menu size={14} />
      </span>
      <div style={s.moveBtns}>
        <button
          type="button"
          style={s.moveBtn}
          aria-label={labels.moveUp}
          disabled={!canMoveUp}
          onClick={() => onMove(orderIndex!, orderIndex! - 1)}
        >
          <Icon.ArrowUp size={12} />
        </button>
        <button
          type="button"
          style={s.moveBtn}
          aria-label={labels.moveDown}
          disabled={!canMoveDown}
          onClick={() => onMove(orderIndex!, orderIndex! + 1)}
        >
          <Icon.ArrowDown size={12} />
        </button>
      </div>
      <Toggle on={attached} onChange={() => onToggle(doc.path)} />
      <div style={s.fileInfo}>
        <span style={s.filename}>{filename}</span>
        <span style={s.folder} data-testid="context-doc-folder">
          {folder}
        </span>
      </div>
      <div style={s.flexGrow} />
      {doc.bucket && <Badge color={BUCKET_COLOR[doc.bucket]}>{labels.bucket}</Badge>}
      <Button kind="ghost" size="sm" icon="Eye" onClick={() => onPreview(doc.path)}>
        {labels.preview}
      </Button>
    </div>
  );
}
