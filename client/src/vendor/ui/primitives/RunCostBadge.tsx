import React from "react";
import { Badge } from "./Badge";

/**
 * Display the cost (and optionally token usage) of one or more runs.
 * - `compact` — just the dollar figure (`$0.014`), used in dense rows.
 * - `detailed` — dollar + token in→out (`$0.014 · 8.2K→1.3K`).
 *
 * A `null` cost renders as `—` (not `$0.00`): the run reported no usage data
 * (e.g. 429 before any tokens were spent). `0` is a valid free-tier cost and
 * renders as `$0.0000`.
 */
export function RunCostBadge({
  value,
  tokensIn,
  tokensOut,
  variant = "compact",
  mono = true,
  style,
}: {
  value: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "detailed";
  mono?: boolean;
  style?: React.CSSProperties;
}) {
  const cost = formatCost(value);
  if (variant === "compact") {
    return (
      <Badge color="var(--text-secondary)" bg="transparent" mono={mono} style={style}>
        {cost}
      </Badge>
    );
  }
  const tokens = formatTokenFlow(tokensIn, tokensOut);
  return (
    <Badge color="var(--text-secondary)" bg="transparent" mono={mono} style={style}>
      {tokens ? `${cost} · ${tokens}` : cost}
    </Badge>
  );
}

/** Render a USD cost with a precision that fits the magnitude. */
export function formatCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.0000";
  const abs = Math.abs(value);
  // Sub-cent runs need 4 decimals to be readable ($0.0013, not $0.00).
  // Below $1 we keep 3; ≥ $1 we drop to 2.
  const decimals = abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return `$${value.toFixed(decimals)}`;
}

/** Render a token in→out flow as a compact `8.2K→1.3K` string. */
export function formatTokenFlow(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  return `${formatTokens(tokensIn)}→${formatTokens(tokensOut)}`;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1) : k.toFixed(0)}K`;
}
