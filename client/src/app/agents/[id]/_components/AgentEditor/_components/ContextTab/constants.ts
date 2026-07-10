import type { DocumentBucket } from "@devdigest/shared";

/** Bucket → accent color for the badge. Never colour-alone: `Badge` always
 *  renders a text label alongside (WCAG AA). Mirrors the skill editor's
 *  Context tab (`app/skills/_components/SkillEditor/_components/ContextTab`)
 *  for visual consistency between the two surfaces. */
export const BUCKET_COLOR: Record<DocumentBucket, string> = {
  specs: "#7c83ff",
  docs: "#54a374",
  insights: "#d9a534",
};
