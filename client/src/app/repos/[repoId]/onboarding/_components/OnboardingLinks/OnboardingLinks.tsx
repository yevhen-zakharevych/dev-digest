/* OnboardingLinks — the compact "Open" link row rendered under a section's
 * body (AC-4: critical_paths' file links; reused as-is by reading_path and
 * first_tasks, which share the same `{label, path}` shape). A single line
 * per link: a muted file icon, the mono `path` (the file — prominent) then
 * an em dash and the `label` (the "why it matters" caption — muted,
 * truncated), with the "Open" affordance aligned to the right. Follows the
 * `MonoLink` href-or-inert idiom from BlastRadiusCard: renders a real `<a>`
 * when we can resolve a github blob URL (repoFullName known), and an inert
 * control otherwise — never a dead link. */
"use client";

import React from "react";
import { Icon, MonoLink } from "@devdigest/ui";
import type { OnboardingLink } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

export function OnboardingLinks({
  links,
  repoFullName,
  sha,
  openLabel,
}: {
  links: OnboardingLink[];
  repoFullName: string | null;
  sha: string;
  openLabel: string;
}) {
  if (links.length === 0) return null;

  return (
    <ul style={listStyle}>
      {links.map((link) => (
        <li key={link.path} style={rowStyle}>
          <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={captionStyle}>
            <span className="mono" style={pathStyle}>
              {link.path}
            </span>
            {" — "}
            <span>{link.label}</span>
          </span>
          <span style={openStyle}>
            <MonoLink href={repoFullName ? githubBlobUrl(repoFullName, sha, link.path) : undefined}>
              {openLabel}
            </MonoLink>
          </span>
        </li>
      ))}
    </ul>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: "8px 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 4px",
  borderBottom: "1px solid var(--border)",
};

const captionStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pathStyle: React.CSSProperties = {
  color: "var(--text-primary)",
};

const openStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "3px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
};
