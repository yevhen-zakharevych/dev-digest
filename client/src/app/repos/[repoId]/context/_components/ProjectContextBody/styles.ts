import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page body: the two-pane
 * master-detail layout (list left, selected document right), and the
 * padded wrapper used for the loading/error/clone-unavailable/empty states
 * that precede it (those aren't panes — same idiom as `SkillsListView`, which
 * wraps its own list states in the left-pane padding rather than a
 * standalone full-bleed block). */
export const s = {
  page: { display: "flex", height: "100%", overflow: "hidden" } satisfies CSSProperties,
  stateWrap: { padding: "24px 28px" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
};
