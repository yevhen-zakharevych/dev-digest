/**
 * Renders the checked-in `.devdigest/agents/<slug>.yaml` manifest (AC-7).
 *
 * PURE: imports only `@devdigest/shared` and `yaml`. No `fs`, no DB, no
 * network. The caller (`service.ts`, owned by A2) resolves the stored agent
 * row and its enabled skill slugs and hands them in as plain data.
 *
 * The emitted YAML is read back by `agent-runner/src/manifest.ts`
 * (`loadAgentManifest`), which parses it with the same `yaml` package and
 * validates it with the same `AgentManifest` Zod contract this module
 * imports — the "one contract, two consumers" guarantee (AC-7).
 */
import { stringify } from 'yaml';
import type { AgentManifestInput, CiFailOn, Provider } from '@devdigest/shared';

/** The subset of a stored agent this module needs to render a manifest. */
export interface ManifestAgent {
  name: string;
  /** Emitted verbatim even though the runner always calls OpenRouter (OQ-3). */
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  ciFailOn: CiFailOn;
}

/**
 * Builds the manifest YAML for `agent` with `skillSlugs` (already filtered to
 * enabled skills, in link order — the caller's job, not this function's).
 *
 * AC-13: the same `agent` + `skillSlugs` always produce byte-identical text.
 * This is achieved by building an EXPLICITLY ORDERED plain object — never a
 * spread — and calling `yaml.stringify` on it, so the key order below is the
 * key order on disk: name, provider, model, system_prompt, skills, strategy,
 * ci_fail_on (the same order `AgentManifest` declares its fields in).
 */
export function renderManifest(agent: ManifestAgent, skillSlugs: readonly string[]): string {
  const doc: AgentManifestInput = {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: [...skillSlugs],
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    // Deliberately no `post_as` key — AC-20 requires that choice to travel as
    // a workflow env var instead, so `AgentManifest` never needs it (AC-48).
  };
  return stringify(doc);
}
