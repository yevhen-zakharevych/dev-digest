import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectContextDocs, DocumentContent } from "@devdigest/shared";
import { useProjectContextDocs, useDocumentContent, useSaveDocument } from "./project-context";

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOCS: ProjectContextDocs = {
  clone_available: true,
  documents: [
    { path: "docs/architecture.md", bucket: "docs", estimated_tokens: 120, used_by_agents: 1 },
  ],
  summary: {
    document_count: 1,
    total_estimated_tokens: 120,
    refreshed_at: "2026-07-10T00:00:00.000Z",
  },
};

const DOC_CONTENT: DocumentContent = {
  path: "docs/architecture.md",
  text: "# Architecture\n",
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

describe("useProjectContextDocs", () => {
  it("issues GET /repos/:repoId/project-context and resolves discovery + summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOCS));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useProjectContextDocs("repo1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/repo1/project-context",
      expect.objectContaining({}),
    );
    expect(result.current.data).toEqual(DOCS);
  });

  it("stays disabled when repoId is not provided", () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOCS));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useProjectContextDocs(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDocumentContent", () => {
  it("issues GET /repos/:repoId/project-context/doc?path=… and resolves the raw markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC_CONTENT));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDocumentContent("repo1", "docs/architecture.md"), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/repo1/project-context/doc?path=docs%2Farchitecture.md",
      expect.objectContaining({}),
    );
    expect(result.current.data).toEqual(DOC_CONTENT);
  });

  it("stays idle when path is null", () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC_CONTENT));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDocumentContent("repo1", null), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSaveDocument", () => {
  it("PUTs to /repos/:repoId/project-context/doc and invalidates the doc-content and discovery queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC_CONTENT));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSaveDocument(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        repoId: "repo1",
        path: "docs/architecture.md",
        text: "# Architecture\n",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/repo1/project-context/doc",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["project-context-doc", "repo1", "docs/architecture.md"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project-context", "repo1"] });
  });
});
