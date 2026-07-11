import React from "react";
import { Icon } from "../icons";

/** Small, focusable copy-to-clipboard affordance (R3). Generic — no
 * feature-specific styling. Native `<button>` so it's keyboard-operable
 * (Enter/Space) with zero extra wiring; the transient "copied" state is
 * purely visual (icon swap), never conveyed by colour alone since the
 * `aria-label`/`title` also flip to the copied-label text. */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
  size = 13,
}: {
  /** The exact text placed on the clipboard. */
  text: string;
  label?: string;
  copiedLabel?: string;
  size?: number;
}) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 4,
        borderRadius: 5,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: copied ? "var(--ok)" : "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {copied ? <Icon.Check size={size} /> : <Icon.Copy size={size} />}
    </button>
  );
}
