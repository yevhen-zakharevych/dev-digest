# Plan — Eval flows as modals (PR #8 review follow-up)

Reviewer feedback on L06: "Turn into eval case" navigates to a **separate page**
instead of an **inline modal** with save + "Run case" straight from the finding
card; and "Compare runs" should also be a **modal**. Decision: keep the existing
editor/compare internals as-is (option 1-a), keep the old pages working (2-ok).

## Architecture

Both editors live as route-local `_components/` and cannot be imported across
routes (convention: sibling routes don't import each other's `_components`).
Lift them into a new **`src/features/evals/`** module so pages AND modals share
one component (app → features is the allowed direction).

```
src/features/evals/
  format.ts                         (moved from app/evals/_lib/format.ts)
  components/
    EvalCaseEditor/…                (moved; +optional onCancel prop)
    EvalCaseModal.tsx               (NEW — Modal + useEvalCase + EvalCaseEditor)
    EvalCompare/…                   (moved)
    EvalCompareModal.tsx            (NEW — Modal + EvalCompare + Close footer)
```

## Steps

1. **Move to features** (`git mv`):
   - `app/evals/cases/_components/EvalCaseEditor/*` → `features/evals/components/EvalCaseEditor/`
   - `app/evals/compare/_components/EvalCompare/*` → `features/evals/components/EvalCompare/`
   - `app/evals/_lib/format.ts` → `features/evals/format.ts`
2. **Fix imports in moved files**: deep `../../../../../lib/*` → `@/lib/*`;
   `_lib/format` → intra-feature relative (`../../format`, `../../../format`).
3. **Update format importers** (app → `@/features/evals/format`):
   `EvalDashboard/_components/{AgentEvalCard,RecentRunsTable}.tsx`,
   `agents/…/EvalsTab/helpers.ts`.
4. **Update 3 consumer pages** to import from features:
   `cases/new/page.tsx`, `cases/[id]/page.tsx`, `compare/page.tsx`.
5. **EvalCaseEditor**: add optional `onCancel?: () => void`; render a Cancel
   button (`caseEditor.cancel`, exists) in the footer when provided. `onSaved`
   in modal context is a no-op so the modal stays open to show draft results.
6. **EvalCaseModal.tsx** (new): `{ caseId, onClose }` → `useEvalCase(caseId)` →
   `<Modal onClose>` (no title bar text; editor keeps its own head) with
   Skeleton while loading, else `<EvalCaseEditor existingCase … onSaved={noop}
   onCancel={onClose} />`.
7. **EvalCompareModal.tsx** (new): `{ runIdA, runIdB, agentId, onClose }` →
   `<Modal onClose footer={Close button}>` wrapping `<EvalCompare … onPick={noop} />`.
   `compare.close` key already exists.
8. **Rewire entry points**:
   - `FindingsPanel.tsx`: on seed success set `modalCaseId` instead of
     `router.push` → render `<EvalCaseModal caseId onClose />`.
   - `EvalsTab.tsx`: Compare button sets `{a,b}` state instead of `router.push`
     → render `<EvalCompareModal … />`.
9. **Tests**: move colocated tests (fix `messages` relative depth); update
   `FindingsPanel.test` (modal open, not `push`); add modal tests. `EvalsTab.test`
   compare enable/disable assertions stay valid.
10. `pnpm typecheck` + `pnpm test`; architecture review.

Old pages remain reachable (Edit case / New case / deep links) sharing the same
lifted components.
</content>
</invoke>
