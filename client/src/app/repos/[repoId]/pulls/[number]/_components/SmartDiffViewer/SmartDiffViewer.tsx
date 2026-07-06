/* SmartDiffViewer — pure/presentational Smart Diff render: three grouped
   sections (core / wiring / boilerplate) in the order the server already
   risk-sorted (docs/plans/smart-diff.md §5). No data hooks, no network — the
   parent (Task C3's DiffTab) fetches `useSmartDiff`/`usePrReviews` and passes
   the results down as props. Boilerplate starts collapsed; core + wiring
   start expanded. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartDiff, SmartDiffGroup, SmartDiffRole, PrFile, FindingRecord } from "@devdigest/shared";
import { SmartDiffFileCard } from "./SmartDiffFileCard";
import { s } from "./styles";

export interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  files: PrFile[];
  findings: FindingRecord[];
  onOpenFinding: (findingId: string) => void;
}

const GROUP_LABEL_KEY: Record<SmartDiffRole, "coreLabel" | "wiringLabel" | "boilerplateLabel"> = {
  core: "coreLabel",
  wiring: "wiringLabel",
  boilerplate: "boilerplateLabel",
};

/** `PrFile.path` -> the file's patch text, for the SmartDiffFile join. */
function buildPatchByPath(files: PrFile[]): Map<string, string | null | undefined> {
  const map = new Map<string, string | null | undefined>();
  for (const f of files) map.set(f.path, f.patch);
  return map;
}

/** `FindingRecord.file` -> findings anchored to that path (client-side join,
 * per docs/plans/smart-diff.md §9 assumption 8 — `SmartDiff.finding_lines` has
 * no severity/id, so the clickable badges read from the already-loaded
 * `usePrReviews` findings instead). */
function buildFindingsByPath(findings: FindingRecord[]): Map<string, FindingRecord[]> {
  const map = new Map<string, FindingRecord[]>();
  for (const f of findings) {
    const list = map.get(f.file);
    if (list) list.push(f);
    else map.set(f.file, [f]);
  }
  return map;
}

function SmartDiffGroupSection({
  group,
  patchByPath,
  findingsByPath,
  onOpenFinding,
}: {
  group: SmartDiffGroup;
  patchByPath: Map<string, string | null | undefined>;
  findingsByPath: Map<string, FindingRecord[]>;
  onOpenFinding: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const defaultOpen = group.role !== "boilerplate";

  return (
    <details style={s.section} open={defaultOpen}>
      <summary style={s.sectionSummary}>
        <span>{t(`smartDiff.${GROUP_LABEL_KEY[group.role]}`)}</span>
        <span style={s.sectionCount}>{t("smartDiff.filesCount", { count: group.files.length })}</span>
      </summary>
      {group.files.length === 0 ? (
        <div style={s.emptyGroup}>{t("smartDiff.filesCount", { count: 0 })}</div>
      ) : (
        <div style={s.sectionBody}>
          {group.files.map((file) => (
            <SmartDiffFileCard
              key={file.path}
              file={file}
              patch={patchByPath.get(file.path)}
              findings={findingsByPath.get(file.path) ?? []}
              onOpenFinding={onOpenFinding}
            />
          ))}
        </div>
      )}
    </details>
  );
}

export function SmartDiffViewer({ smartDiff, files, findings, onOpenFinding }: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const patchByPath = React.useMemo(() => buildPatchByPath(files), [files]);
  const findingsByPath = React.useMemo(() => buildFindingsByPath(findings), [findings]);
  const { too_big, total_lines, proposed_splits } = smartDiff.split_suggestion;

  return (
    <div style={s.root}>
      {too_big && (
        <div style={s.banner}>
          <div style={s.bannerTitle}>
            <Icon.AlertTriangle size={14} />
            {t("smartDiff.largeTitle", { lines: total_lines })}
          </div>
          <div style={s.bannerBody}>{t("smartDiff.largeBody")}</div>
          <ul style={s.bannerList}>
            {proposed_splits.map((split) => (
              <li key={split.name}>
                {split.name} — {t("smartDiff.filesCount", { count: split.files.length })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {smartDiff.groups.map((group) => (
        <SmartDiffGroupSection
          key={group.role}
          group={group}
          patchByPath={patchByPath}
          findingsByPath={findingsByPath}
          onOpenFinding={onOpenFinding}
        />
      ))}
    </div>
  );
}
