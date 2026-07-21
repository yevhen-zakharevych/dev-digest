/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "onboarding-tour", label: "Onboarding Tour", icon: "Layers", href: "/repos/:repoId/onboarding" },
      { key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills",      label: "Skills",         icon: "Sparkles",   href: "/skills",      gKey: "s" },
      { key: "agents",      label: "Agents",          icon: "Cpu",        href: "/agents",      gKey: "a" },
      { key: "conventions", label: "Conventions",     icon: "ListChecks", href: "/conventions", gKey: "c" },
      { key: "eval",        label: "Eval Dashboard",  icon: "BarChart",   href: "/evals" },
    ],
  },
  {
    // GLOBAL holds cross-cutting review surfaces. The design also places
    // Memory, Agent Performance and CI Runs here — deliberately NOT added:
    // none of those routes exists yet, and a nav entry pointing at a missing
    // route is a dangling link (the starter already ships one such trap).
    // Multi-Agent Review keeps its repo-scoped href; `resolveHref` fills
    // `:repoId` from the active repo exactly as it does for the WORKSPACE items.
    section: "GLOBAL",
    items: [
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
