import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Agent, AgentEstimate } from "@devdigest/shared";
import { AgentPickList } from "./AgentPickList";

afterEach(cleanup);

const AGENTS: Agent[] = [
  {
    id: "a1",
    name: "Security Reviewer",
    description: "Flags secrets and injection",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    attached_docs: [],
    skills_count: 0,
    enabled: true,
    version: 1,
  },
  {
    id: "a2",
    name: "Perf Reviewer",
    description: "Flags perf regressions",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    attached_docs: [],
    skills_count: 0,
    enabled: true,
    version: 1,
  },
];

const ESTIMATES: AgentEstimate[] = [
  { agent_id: "a1", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 4 },
];

describe("AgentPickList", () => {
  it("renders one checkbox row per agent with its hint (or — for no history)", () => {
    render(
      <AgentPickList agents={AGENTS} estimates={ESTIMATES} selectedIds={new Set()} onToggle={() => {}} />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Perf Reviewer")).toBeInTheDocument();
    expect(screen.getByText("8.2s · $0.060")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the one-line description only when showDescription is set", () => {
    const { rerender } = render(
      <AgentPickList agents={AGENTS} estimates={ESTIMATES} selectedIds={new Set()} onToggle={() => {}} />,
    );
    expect(screen.queryByText("Flags secrets and injection")).not.toBeInTheDocument();

    rerender(
      <AgentPickList
        agents={AGENTS}
        estimates={ESTIMATES}
        selectedIds={new Set()}
        onToggle={() => {}}
        showDescription
      />,
    );
    expect(screen.getByText("Flags secrets and injection")).toBeInTheDocument();
  });

  it("calls onToggle with the agent id when its checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(
      <AgentPickList agents={AGENTS} estimates={ESTIMATES} selectedIds={new Set()} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(onToggle).toHaveBeenCalledWith("a1");
  });

  it("reflects a selected agent as checked", () => {
    render(
      <AgentPickList
        agents={AGENTS}
        estimates={ESTIMATES}
        selectedIds={new Set(["a2"])}
        onToggle={() => {}}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "false");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
  });
});
