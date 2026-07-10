import type { DocumentBucket } from "@devdigest/shared";

/** Bucket badge colours. Colour is a SECONDARY cue only — the badge always
 * pairs it with the bucket's translated text label (`projectContext.bucket.*`)
 * so meaning never rests on colour alone (WCAG 2.1 AA). */
export const BUCKET_COLOR: Record<DocumentBucket, { fg: string; bg: string }> = {
  specs: { fg: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { fg: "var(--ok)", bg: "var(--ok-bg)" },
  insights: { fg: "var(--warn)", bg: "var(--warn-bg)" },
};
