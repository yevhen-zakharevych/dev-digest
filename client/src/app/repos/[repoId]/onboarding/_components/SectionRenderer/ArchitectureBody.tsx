/* architecture body: prose + a mermaid component/data-flow diagram (AC-3).
 * `MermaidDiagram` itself validates the source and renders nothing for
 * invalid mermaid — so an invalid diagram silently drops to prose-only,
 * matching the accepted edge case ("drop invalid diagram, keep prose"). */
"use client";

import { Markdown } from "@devdigest/ui";
import MermaidDiagram from "@/components/MermaidDiagram";
import type { OnboardingSection } from "@devdigest/shared";

export function ArchitectureBody({ section }: { section: OnboardingSection }) {
  return (
    <>
      <Markdown>{section.body}</Markdown>
      {section.diagram && <MermaidDiagram chart={section.diagram} />}
    </>
  );
}
