import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Repo-authored markdown can embed a `javascript:` (or similar) href; only
    allow protocols that can't execute script, plus protocol-relative links. */
function isSafeHref(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("/")) return true;
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(href, "http://localhost").protocol);
  } catch {
    return false;
  }
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a
              href={href && isSafeHref(href) ? href : undefined}
              rel="noopener noreferrer"
              style={{ color: "var(--accent-text)", textDecoration: "underline" }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
