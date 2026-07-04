import React from "react";

/** The Smart-Diff deep-link target — id of the finding to force-expand +
 *  highlight + scroll to. Provided as a React Context (not a prop drilled
 *  through `ReviewRunAccordion`, which is out of scope / must stay
 *  unmodified) so `FindingsPanel`/`FindingCard` can read it despite
 *  `ReviewRunAccordion` not forwarding it explicitly.
 *
 *  Lives in route-local `_lib/` (not in `FindingsTab.tsx`) so both the
 *  provider (`FindingsTab`) and the consumer (`FindingsPanel`, rendered
 *  underneath `FindingsTab` via `ReviewRunAccordion`) can import it without
 *  a leaf importing from the root of its own render subtree — that
 *  FindingsTab -> ReviewRunAccordion -> FindingsPanel -> FindingsTab shape
 *  would be a circular module import. */
export interface FindingTarget {
  id: string | null;
  nonce: number;
}

export const FindingTargetContext = React.createContext<FindingTarget>({
  id: null,
  nonce: 0,
});
