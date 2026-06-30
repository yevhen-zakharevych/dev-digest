/* hooks/skills.ts — React Query hooks for the Skills page + Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "../api";
import type { AgentSkillLink, Skill, SkillDetailStats, SkillType, SkillVersion } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillDetailStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export function useRestoreSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/restore`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export interface ImportPreview {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  skippedFiles: string[];
  warnings: string[];
}

/** Upload a .md or .zip via multipart, return a preview WITHOUT writing anything. */
export async function importSkillFile(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/skills/import`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as ImportPreview;
}

export function useSaveImportedSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preview: ImportPreview) =>
      api.post<Skill>("/skills/import/save", preview),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- Agent skill links ----

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", vars.agentId] });
    },
  });
}

export function useSetAgentSkillEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      skillId,
      enabled,
    }: {
      agentId: string;
      skillId: string;
      enabled: boolean;
    }) =>
      api.put<AgentSkillLink[]>(`/agents/${agentId}/skills/${skillId}`, {
        enabled,
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", vars.agentId] });
    },
  });
}

export function useUnlinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.del<AgentSkillLink[]>(`/agents/${agentId}/skills/${skillId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", vars.agentId] });
    },
  });
}
