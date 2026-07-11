import type { CSSProperties } from "react";

/** Co-located styles for the Onboarding page body: a two-column grid — a
 * sticky left "on this page" rail (`minmax(160px, 190px)`) + a ~40px gutter
 * + a content column, capped at ~1080px total — plus the loading/error/empty
 * state wrapper, same idiom as `ProjectContextBody`'s `stateWrap`. The
 * content column uses `minmax(0, 1fr)` (not bare `1fr`) so a wide mermaid
 * diagram or terminal block can never force the grid — and with it the page
 * body — to scroll horizontally; those blocks scroll inside their own
 * `overflow-x: auto` container instead. */
export const s = {
  page: { padding: "24px 28px", maxWidth: 1080 } satisfies CSSProperties,
  stateWrap: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(160px, 190px) minmax(0, 1fr)",
    columnGap: 40,
    // `stretch` (not `start`): the rail column must be as tall as the content
    // row so the `position: sticky` nav inside it has room to stick as the
    // page scrolls. `start` collapses the rail cell to the nav's own height,
    // leaving no scroll range — the nav then scrolls away with the page.
    alignItems: "stretch",
  } satisfies CSSProperties,
  rail: { minWidth: 0 } satisfies CSSProperties,
  content: { minWidth: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  sections: { display: "flex", flexDirection: "column", gap: 16, marginTop: 8 } satisfies CSSProperties,
};
