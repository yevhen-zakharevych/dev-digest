/* DocumentList — LEFT pane of the Project Context master-detail layout: a
   "Project Context" header label, a search box that filters the flat
   document list by filename/path (AC-12's filter idea, scoped to this page
   rather than an agent/skill attach tab), the scrollable list of rows
   (DocumentRow), and the AC-7 summary footer. The footer always reflects the
   FULL discovered set (`summary`), never the filtered view — filtering only
   narrows what's visually shown, it never changes discovery counts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DiscoveredDocument, DiscoverySummary } from "@devdigest/shared";
import { describeRelativeTime, formatTokenCount } from "../../_lib/format";
import { DocumentRow } from "../DocumentRow/DocumentRow";
import { s } from "./styles";

/** AC-7 footer: file count + summed token estimate + last-refreshed time,
 * built as ONE template-string child so RTL's `getByText` (which only
 * concatenates an element's direct child text nodes) can match the whole
 * line — see client/INSIGHTS.md's "single template-string child" rule.
 * Contains no "chunks"/"indexed"/vector-index wording (AC-7). */
function Footer({ summary }: { summary: DiscoverySummary }) {
  const t = useTranslations("projectContext");
  const rel = describeRelativeTime(summary.refreshed_at);
  const relative =
    rel.unit === "now"
      ? t("footer.justNow")
      : rel.unit === "minutes"
        ? t("footer.minutesAgo", { minutes: rel.value })
        : rel.unit === "hours"
          ? t("footer.hoursAgo", { hours: rel.value })
          : t("footer.daysAgo", { days: rel.value });

  return (
    <div style={s.footer} data-testid="project-context-footer">
      {t("footer.summary", {
        count: summary.document_count,
        tokens: formatTokenCount(summary.total_estimated_tokens),
        relative,
      })}
    </div>
  );
}

export function DocumentList({
  documents,
  summary,
  selectedPath,
  onSelect,
}: {
  documents: DiscoveredDocument[];
  summary: DiscoverySummary;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("projectContext");
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) => doc.path.toLowerCase().includes(q));
  }, [documents, search]);

  return (
    <div style={s.left}>
      <h2 style={s.header}>{t("title")}</h2>

      <div style={s.search}>
        <Icon.Search size={13} style={s.searchIcon} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("list.searchPlaceholder")}
          aria-label={t("list.searchLabel")}
          style={s.searchInput}
        />
      </div>

      <div style={s.list}>
        {filtered.length === 0 ? (
          <p style={s.noMatches}>{t("list.noMatches")}</p>
        ) : (
          filtered.map((doc) => (
            <DocumentRow
              key={doc.path}
              doc={doc}
              selected={doc.path === selectedPath}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      <Footer summary={summary} />
    </div>
  );
}
