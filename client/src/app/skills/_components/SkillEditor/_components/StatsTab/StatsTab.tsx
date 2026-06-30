/* StatsTab — per-skill usage analytics: agents, findings, accept rate. */
"use client";

import React from "react";
import { Icon, MetricCard, Donut, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";

const CATEGORY_COLORS: Record<string, string> = {
  security: "#d97076",
  bug: "#e6a040",
  perf: "#7c83ff",
  style: "#54a374",
  naming: "#9a8bf5",
  async: "#4aafcc",
  "error-handling": "#e88c3a",
};

function fallbackColor(index: number): string {
  const palette = ["#7c83ff", "#54a374", "#d97076", "#e6a040", "#9a8bf5", "#4aafcc"];
  return palette[index % palette.length]!;
}

function AcceptRateRing({ rate }: { rate: number | null }) {
  const pct = rate != null ? Math.round(rate * 100) : null;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = pct != null ? (pct / 100) * circ : 0;

  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.03em",
          display: "block",
          marginBottom: 12,
        }}
      >
        ACCEPT RATE
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
          <svg width={72} height={72} style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx={36}
              cy={36}
              r={r}
              fill="none"
              stroke="var(--border)"
              strokeWidth={8}
            />
            <circle
              cx={36}
              cy={36}
              r={r}
              fill="none"
              stroke="#e6a040"
              strokeWidth={8}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeLinecap="round"
            />
          </svg>
          {pct != null && (
            <span
              className="tnum"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 700,
              }}
            >
              {pct}
            </span>
          )}
        </div>
        <span
          className="tnum"
          style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          {pct != null ? `${pct}` : "—"}
          {pct != null && (
            <span style={{ fontSize: 18, color: "var(--text-muted)" }}>%</span>
          )}
        </span>
      </div>
    </div>
  );
}

export function StatsTab({ skill }: { skill: Skill }) {
  const { data, isLoading } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={{ padding: "24px 28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton height={200} />
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const donutSegments = data.findings_by_category.map((c, i) => ({
    label: c.label,
    value: c.value,
    color: CATEGORY_COLORS[c.label] ?? fallbackColor(i),
  }));

  return (
    <div style={{ padding: "24px 28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Metric cards row */}
      <div style={{ display: "flex", gap: 12 }}>
        <MetricCard
          label="USED BY"
          value={data.used_by}
          suffix={data.used_by === 1 ? " agent" : " agents"}
        />
        <MetricCard
          label="PULL FREQUENCY"
          value={data.pull_frequency != null ? Math.round(data.pull_frequency * 100) : "—"}
          suffix={data.pull_frequency != null ? "%" : undefined}
        />
        <AcceptRateRing rate={data.accept_rate} />
        <MetricCard label="FINDINGS (30D)" value={data.findings_30d} />
      </div>

      {/* Detail panels row */}
      <div style={{ display: "flex", gap: 12 }}>
        {/* Agents using this skill */}
        <div
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 14,
            }}
          >
            <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                letterSpacing: "0.03em",
              }}
            >
              AGENTS USING THIS SKILL
            </span>
          </div>
          {data.agents.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No agents linked yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <Icon.Cpu size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, flex: 1 }}>{agent.name}</span>
                  <a
                    href={`/agents?id=${agent.id}`}
                    style={{
                      fontSize: 12,
                      color: "var(--accent)",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    Open
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Findings by category */}
        <div
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 14,
            }}
          >
            <Icon.Tag size={13} style={{ color: "var(--text-muted)" }} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                letterSpacing: "0.03em",
              }}
            >
              FINDINGS BY CATEGORY
            </span>
          </div>
          {donutSegments.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No findings in the last 30 days.
            </div>
          ) : (
            <Donut segments={donutSegments} valuePrefix="" />
          )}
        </div>
      </div>
    </div>
  );
}
