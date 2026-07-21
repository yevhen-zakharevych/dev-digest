/* PrPicker — step 1 of the Configure-run page: pick a PR from the repo's
   pull requests (AC-4, AC-5). Route-local: only this page consumes it. */
"use client";

import { useTranslations } from "next-intl";
import { FormField, SelectInput } from "@devdigest/ui";
import type { PrMeta } from "@devdigest/shared";

const UNSELECTED = "";

export function PrPicker({
  pulls,
  value,
  onChange,
}: {
  pulls: PrMeta[];
  value: number | null;
  onChange: (prNumber: number | null) => void;
}) {
  const t = useTranslations("multiAgent");
  const options = [
    { value: UNSELECTED, label: t("configure.selectPrPlaceholder") },
    ...pulls.map((p) => ({
      value: String(p.number),
      label: t("configure.prItem", { number: p.number, title: p.title }),
    })),
  ];

  return (
    <FormField label={t("configure.selectPr")}>
      <SelectInput
        value={value != null ? String(value) : UNSELECTED}
        onChange={(v) => onChange(v === UNSELECTED ? null : Number(v))}
        options={options}
      />
    </FormField>
  );
}
