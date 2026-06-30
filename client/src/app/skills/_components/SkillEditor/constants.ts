import type { IconName } from "@devdigest/ui";

export interface EditorTab {
  key: string;
  labelKey: string;
  icon?: IconName;
  /** A "stub" tab is rendered but explains the feature lands in a later
   *  lesson. The UI element exists so the IA matches the design without
   *  pretending unfinished functionality. */
  stub?: boolean;
}

// Evals + Stats tabs are part of the design but their data plane lands in
// L06/L07. Hidden from the UI until then so the tab strip only shows what
// actually works.
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config" },
  { key: "preview", labelKey: "editor.tabs.preview" },
  { key: "stats", labelKey: "editor.tabs.stats" },
  { key: "versions", labelKey: "editor.tabs.versions" },
];
