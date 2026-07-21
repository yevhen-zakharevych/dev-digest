import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreateMultiRunResponse } from "@devdigest/shared";
import { useCreateMultiRun } from "./multi-agent";
import { latestMultiRunKey } from "./multi-agent-runs";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CREATED: CreateMultiRunResponse = {
  multi_run_id: "mr1",
  pr_id: "pr1",
  runs: [{ run_id: "run1", agent_id: "a1", agent_name: "Security Reviewer" }],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 201, json: async () => body } as Response;
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

describe("useCreateMultiRun", () => {
  it("POSTs the checked agent set to /pulls/:id/multi-agent-runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CREATED));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useCreateMultiRun(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ prId: "pr1", agentIds: ["a1", "a2"] });
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3001/pulls/pr1/multi-agent-runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ agentIds: ["a1", "a2"] });
  });

  /**
   * AC-13. Without this invalidation the results page serves the PREVIOUS
   * multi-run (or a cached `null` empty state on a first run) for up to the
   * global 30s `staleTime`, and `multiRunPollInterval` has already stopped
   * polling because no cached column is `running` — so nothing self-corrects.
   * The spy must be attached to the SAME QueryClient the wrapper provides:
   * `useMutation`'s `onSuccess` closes over whatever `useQueryClient()`
   * resolved inside that provider (client/INSIGHTS.md:101).
   */
  it("invalidates the latest-multi-run query for that PR on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(CREATED)));
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCreateMultiRun(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ prId: "pr1", agentIds: ["a1"] });
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: latestMultiRunKey("pr1") }),
    );
  });

  it("does not invalidate when the create request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response),
    );
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCreateMultiRun(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ prId: "pr1", agentIds: ["a1"] }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
