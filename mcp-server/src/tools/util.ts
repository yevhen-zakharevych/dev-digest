/**
 * Shared tool helpers. `errorResult` is the "error leads onward" envelope —
 * an `isError:true` `CallToolResult` whose text tells the model what to do
 * next (call list_agents, run run_agent_on_pr, add the repo, …). Centralised
 * here so all 5 tools emit the identical shape.
 */
export function errorResult(text: string): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  return { content: [{ type: 'text', text }], isError: true as const };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
