import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord, BriefResponse } from "@devdigest/shared";
import { usePrIntent, useRecomputeIntent, usePrBrief, useGenerateBrief } from "./brief";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECORD: PrIntentRecord = {
  pr_id: "pr1",
  intent: "Add pagination controls to the repos list",
  in_scope: ["Add page query param"],
  out_of_scope: ["Sorting"],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

describe("usePrIntent", () => {
  it("issues GET /pulls/:id/intent and resolves the stored PrIntentRecord", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RECORD));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePrIntent("pr1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/pulls/pr1/intent",
      expect.objectContaining({}),
    );
    expect(result.current.data).toEqual(RECORD);
  });

  it("resolves null when the endpoint reports intent has not been computed yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePrIntent("pr1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useRecomputeIntent", () => {
  it("POSTs to /pulls/:id/intent and invalidates the [\"intent\", prId] query on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RECORD));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useRecomputeIntent(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ prId: "pr1" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/pulls/pr1/intent",
      expect.objectContaining({ method: "POST" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["intent", "pr1"] });
  });
});

const FRESH_BRIEF: BriefResponse = {
  status: "fresh",
  brief: {
    what: "Adds pagination to the repos list.",
    why: "Users asked for it in issue #12.",
    risk_level: "medium",
    risks: [],
    review_focus: [],
  },
  head_sha: "deadbeef",
  generated_at: "2026-07-10T00:00:00.000Z",
  cost: { usd: 0.01, tokens_in: 800, tokens_out: 200, model: "openai/gpt-4.1" },
};

describe("usePrBrief", () => {
  it("issues GET /pulls/:id/brief and resolves the non-null BriefResponse wrapper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FRESH_BRIEF));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePrBrief("pr1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/pulls/pr1/brief",
      expect.objectContaining({}),
    );
    expect(result.current.data).toEqual(FRESH_BRIEF);
  });

  it("resolves a status:'not_generated' wrapper (never null) for a PR with no stored brief", async () => {
    const notGenerated: BriefResponse = { status: "not_generated" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(notGenerated));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePrBrief("pr1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ status: "not_generated" });
  });
});

describe("useGenerateBrief", () => {
  it("POSTs {force:true} for Regenerate and invalidates the [\"brief\", prId] query on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FRESH_BRIEF));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useGenerateBrief(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ prId: "pr1", force: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/pulls/pr1/brief",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["brief", "pr1"] });
  });

  it("POSTs without force for the initial Generate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FRESH_BRIEF));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGenerateBrief(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ prId: "pr1" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/pulls/pr1/brief",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });
});
