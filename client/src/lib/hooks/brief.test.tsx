import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import { usePrIntent, useRecomputeIntent } from "./brief";

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
