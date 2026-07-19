import type { EvalExpectedItem } from "@devdigest/shared";

/** `EvalCaseInput.input_meta` is untyped (`z.unknown()`) by contract — this
 *  editor's own shape for the PR-meta tab (AC-6: title + description only,
 *  no third "Files" tab — `input_files` reaches no model). */
export interface PrMeta {
  title: string;
  body: string;
}

export function parsePrMeta(raw: unknown): PrMeta {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      title: typeof o.title === "string" ? o.title : "",
      body: typeof o.body === "string" ? o.body : "",
    };
  }
  return { title: "", body: "" };
}

export function emptyExpectedItem(): EvalExpectedItem {
  return { file: "", start_line: 1, end_line: 1, kind: "finding" };
}

export interface ExpectedItemErrors {
  file?: string;
  lines?: string;
}

/** AC-5: each expected item needs, at minimum, a file AND a line range. */
export function validateExpectedItems(
  items: EvalExpectedItem[],
  t: (key: string) => string,
): { itemsError: string | null; itemErrors: ExpectedItemErrors[] } {
  if (items.length === 0) {
    return { itemsError: t("caseEditor.itemsRequired"), itemErrors: [] };
  }
  const itemErrors = items.map((it): ExpectedItemErrors => {
    const e: ExpectedItemErrors = {};
    if (!it.file.trim()) e.file = t("caseEditor.itemFileRequired");
    if (it.start_line == null || it.end_line == null || it.start_line < 1 || it.end_line < it.start_line) {
      e.lines = t("caseEditor.itemLinesRequired");
    }
    return e;
  });
  const hasError = itemErrors.some((e) => e.file || e.lines);
  return { itemsError: hasError ? t("caseEditor.itemsRequired") : null, itemErrors };
}

/** The server's AC-7 rejection message already names the file and lines
 *  (`client/src/lib/api.ts`'s `ApiError.message` carries it verbatim); when
 *  the error also carries structured `details`, prefer the pre-written
 *  templates so the message matches the rest of this editor's copy. */
export function freezeRejectionBody(
  // Loosely typed to accept next-intl's generic/overloaded `t` without
  // fighting its call-signature variance — this helper only ever calls it
  // with a plain string key + a values record.
  t: (key: string, values?: Record<string, unknown>) => string,
  message: string,
  details: unknown,
): string {
  const d = details as
    | { reason?: "no_file" | "no_lines"; file?: string; start_line?: number; end_line?: number }
    | undefined;
  if (d?.reason === "no_file" && d.file) {
    return t("caseEditor.freezeRejectedNoFile", { file: d.file });
  }
  if (d?.reason === "no_lines" && d.file && d.start_line != null && d.end_line != null) {
    return t("caseEditor.freezeRejectedNoLines", { file: d.file, lines: `${d.start_line}-${d.end_line}` });
  }
  return message;
}
