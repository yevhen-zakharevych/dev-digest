/* DocumentRow — one discovered document in the LEFT pane's flat list: a file
   icon, the filename, its OWN folder path as muted subtext (documents span
   multiple folders — `docs/agent-prompts`, `specs/…`, etc. — so this is
   always the row's own `dir`, never a single hardcoded bucket path), and a
   bucket badge (colour + text, never colour alone). A native `<button>` so
   the row is keyboard-operable for free; the selected row is highlighted
   (background + left accent). Clicking (or Enter/Space) selects the row via
   `onSelect`, which the parent `DocumentList`/`ProjectContextBody` uses to
   drive the right-pane `DocumentDetail`. No preview/edit lives here anymore —
   that moved to `DocumentDetail` once the page became two-pane master-detail
   instead of an inline-expand list. */
"use client";

import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { BUCKET_COLOR } from "../../_lib/bucket";
import { splitDocPath } from "../../_lib/format";
import { s } from "./styles";

export function DocumentRow({
  doc,
  selected,
  onSelect,
}: {
  doc: DiscoveredDocument;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("projectContext");
  const { dir, file } = splitDocPath(doc.path);
  // A file outside every specs/docs/insights folder has bucket null — it still
  // appears (all markdown is discovered), it just carries no category badge.
  const bucketColor = doc.bucket ? BUCKET_COLOR[doc.bucket] : null;

  return (
    <button
      type="button"
      style={{ ...s.row, ...(selected ? s.rowSelected : undefined) }}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(doc.path)}
      data-testid={`doc-row-${doc.path}`}
    >
      <Icon.FileText size={14} style={s.fileIcon} />
      <span style={s.titleWrap}>
        <span style={s.filename}>{file}</span>
        {dir && <span style={s.dirPath}>{dir}</span>}
      </span>
      {doc.bucket && bucketColor && (
        <Badge color={bucketColor.fg} bg={bucketColor.bg} style={s.bucketBadge}>
          {t(`bucket.${doc.bucket}`)}
        </Badge>
      )}
    </button>
  );
}
