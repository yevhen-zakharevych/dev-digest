"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, SelectInput, TextInput } from "@devdigest/ui";
import type { EvalExpectedItem, FindingKind } from "@devdigest/shared";
import { emptyExpectedItem, type ExpectedItemErrors } from "../helpers";
import { s } from "../styles";

const KINDS: FindingKind[] = ["finding", "secret_leak", "lethal_trifecta", "phantom", "hook"];

/** `must_find` may list >1 expected item, each needing a file + a line range
 *  (AC-5). `kind` selects the scorer's locality rule (AC-17) and is the only
 *  field here that participates in matching — file/lines aside. */
export function ExpectedItemsEditor({
  items,
  errors,
  onChange,
}: {
  items: EvalExpectedItem[];
  errors: ExpectedItemErrors[];
  onChange: (items: EvalExpectedItem[]) => void;
}) {
  const t = useTranslations("eval");

  const update = (i: number, patch: Partial<EvalExpectedItem>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, emptyExpectedItem()]);

  return (
    <div style={s.itemsWrap}>
      <div style={s.itemsHeadRow}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("caseEditor.expectedItems")}</span>
        <Button kind="secondary" size="sm" icon="Plus" onClick={add}>
          {t("caseEditor.addExpectedItem")}
        </Button>
      </div>

      {items.map((item, i) => {
        const err = errors[i];
        return (
          <div key={i} style={s.itemRow}>
            <div>
              <TextInput
                value={item.file}
                onChange={(v) => update(i, { file: v })}
                placeholder={t("caseEditor.itemFileLabel")}
                mono
                aria-label={`${t("caseEditor.itemFileLabel")} ${i + 1}`}
              />
              {err?.file && <div style={s.fieldError}>{err.file}</div>}
            </div>
            <TextInput
              type="number"
              value={String(item.start_line)}
              onChange={(v) => update(i, { start_line: Number(v) || 0 })}
              aria-label={`start line ${i + 1}`}
            />
            <div>
              <TextInput
                type="number"
                value={String(item.end_line)}
                onChange={(v) => update(i, { end_line: Number(v) || 0 })}
                aria-label={`end line ${i + 1}`}
              />
              {err?.lines && <div style={s.fieldError}>{err.lines}</div>}
            </div>
            <SelectInput value={item.kind} onChange={(v) => update(i, { kind: v as FindingKind })} options={KINDS} />
            <IconBtn icon="Trash" label={t("caseEditor.removeExpectedItem")} onClick={() => remove(i)} danger />
          </div>
        );
      })}
    </div>
  );
}
