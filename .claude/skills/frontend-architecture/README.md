# frontend-architecture

> Frontend code organization and file layout for React + Next.js (App Router).

## Version

**1.0.0** — initial release (2026-06-29).

The same version is set in `SKILL.md` frontmatter under `version:`. See [Versioning policy](#versioning-policy) below.

## Focus

This skill answers **one question**: *where in the project tree should this code live?*

It is intentionally narrow. It does not tell you *how* a component should behave, how to memoize it, or how to optimize Core Web Vitals — sibling skills do that. It tells you which folder, which file, which suffix, and which boundary.

## What this skill covers

- Project-level folder structure (`app/` ← `features/` ← `shared/` layering rule)
- Feature module anatomy (`components/`, `hooks/`, `services/`, `schemas/`, `actions.ts`, `types.ts`, `constants.ts`)
- The co-location principle and the "lift on second consumer" rule
- Where to put business logic (hooks vs services vs utils vs schemas)
- `utils/` vs `helpers/` — the difference and how to choose
- Constants placement (app-wide vs feature-scoped vs inline)
- Types placement (colocated → feature → shared)
- Component decomposition signals (when to split a fat component)
- File naming conventions (suffix-based)
- Export style (named vs default; when barrel `index.ts` is a smell)
- Module boundaries, public API of a feature, alias paths
- Next.js App Router specifics: route groups `(group)`, private `_folders/`, colocation inside `app/`, where `actions.ts` lives, layout vs template

## What this skill does NOT cover

Excluded by design to avoid overlap with sibling skills:

| Out of scope | Goes to |
|---|---|
| React behavior rules (hooks, state, effects, memoization, anti-patterns) | `react-best-practices` |
| Next.js framework mechanics (RSC, special files, async APIs, hydration, suspense) | `next-best-practices` |
| Image / font / bundling / Core Web Vitals / runtime performance | `next-best-practices` |
| Server Actions vs Route Handlers — *decision matrix* | `next-best-practices/data-patterns.md` |
| Special file conventions (`page.tsx`, `layout.tsx`, `error.tsx`, …) | `next-best-practices/file-conventions.md` |
| Type-level TypeScript patterns | `typescript-expert` |
| Zod schema patterns | `zod` |
| Testing structure & RTL queries | `react-testing-library` |

## When to use

Invoke this skill when:

- Starting a new feature and deciding folder layout
- Reviewing a PR that adds files in unclear locations
- Refactoring a "junk drawer" `components/`, `utils/`, or `helpers/` folder
- Onboarding a new contributor who asks *"where does X go?"*
- Splitting a fat component, page, or utility module
- Deciding whether something is `shared/` or feature-local
- Designing how a Next.js `app/` segment relates to its `features/` counterpart

## Related skills (delta vs this one)

| Skill | Overlap | Difference |
|---|---|---|
| `react-best-practices` | Both touch component design | That one: *how the component behaves*. This one: *where it lives*. |
| `next-best-practices` | Both touch Next.js layout | That one: framework mechanics + perf. This one: organizing *your* code around those mechanics. |
| `typescript-expert` | Both touch type placement | That one: type-level programming. This one: which file the type lives in. |
| `react-testing-library` | Test colocation | That one: how to write tests. This one: where the test file goes. |
| `zod` | Both touch schemas | That one: how to write the schema. This one: which folder it lives in. |

If a question is about *behavior, mechanics, or correctness* → it belongs to a sibling skill. If it is about *placement, layout, or boundary* → it belongs here.

## Files

- [`SKILL.md`](./SKILL.md) — high-level rules with severity tags (CRITICAL / HIGH / MEDIUM)
- [`nextjs-layout.md`](./nextjs-layout.md) — Next.js App Router specifics
- [`examples.md`](./examples.md) — concrete folder trees and decision walkthroughs
- [`README.md`](./README.md) — this file (meta, scope, sources, version)

## Versioning policy

- **Major (X.0.0)** — incompatible reorganization (e.g. renaming the top-level layer model, removing a section)
- **Minor (0.X.0)** — new rule, section, or examples block
- **Patch (0.0.X)** — clarification, typo, source update, severity tweak

The version lives both in `SKILL.md` frontmatter (for tooling) and at the top of this README (for humans). Bump both together.

---

## Research Sources

All sources consulted while assembling the rules in this skill, grouped by topic.

### Architecture & Project Structure

- [Bulletproof React (alan2207)](https://github.com/alan2207/bulletproof-react)
- [Bulletproof React — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Robin Wieruch — React Folder Structure 2026](https://www.robinwieruch.de/react-folder-structure/)
- [Josh W. Comeau — Delightful React File Structure](https://www.joshwcomeau.com/react/file-structure/)
- [Tania Rascia — How to Structure and Organize a React Application](https://www.taniarascia.com/react-architecture-directory-structure/)
- [Web Dev Simplified — How To Structure React Projects](https://blog.webdevsimplified.com/2022-07/react-folder-structure/)
- [Max Rozen — Guidelines to improve your React folder structure](https://maxrozen.com/guidelines-improve-react-app-folder-structure)
- [React Legacy Docs — File Structure FAQ](https://legacy.reactjs.org/docs/faq-structure.html)

### Component Organization Approaches

- [Feature-Sliced Design (official)](https://feature-sliced.design/)
- [FSD — Scalable React Architecture](https://feature-sliced.design/blog/scalable-react-architecture)
- [FSD — UI Architecture Patterns](https://feature-sliced.design/blog/ui-architecture-patterns)
- [Atomic Design — Janelle Wong](https://medium.com/@janelle.wg/atomic-design-pattern-how-to-structure-your-react-application-2bb4d9ca5f97)
- [Atomic Design + FSD combined — Code With Seb](https://www.codewithseb.com/blog/from-components-to-systems-scalable-frontend-with-atomiec-design)
- [Atomic Design in 2025 — DEV](https://dev.to/m_midas/atomic-design-and-its-relevance-in-frontend-in-2025-32e9)
- [Container/Presentational pattern — patterns.dev](https://www.patterns.dev/react/presentational-container-pattern/)
- [Container/Presentational still relevant in 2026 — Mirror Codex](https://mirrorcodex.com/presentational-vs-container-components/)

### Co-location

- [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation)
- [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- [Matias Kinnunen — Locality of Behavior / Co-location](https://mtsknn.fi/blog/locality-of-behavior-and-co-location/)
- [Sean McP — Colocate functionally-related code](https://www.seanmcp.com/articles/colocate-functionally-related-code/)

### Component Splitting

- [Kent C. Dodds — When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component)
- [David Tang — Techniques for decomposing React components](https://medium.com/dailyjs/techniques-for-decomposing-react-components-e8a1081ef5da)
- [Kirill Kurko — I write big React components](https://kkurko.dev/blog/i-write-big-react-components)
- [Splitting Components in React (Thiraphat Phutson)](https://thiraphat-ps-dev.medium.com/splitting-components-in-react-a-path-to-cleaner-and-more-maintainable-code-f0828eca627c)

### Business Logic Placement

- [Juntao Qiu — The right way to place business logic in React](https://itnext.io/the-right-way-to-place-business-logic-in-your-react-application-8bf16145f48d)
- [Asrul Kadir — Why separating business logic matters in React](https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba)
- [DEV — Custom hooks vs services](https://dev.to/chiangs/custom-react-hooks-vs-services-mcm)
- [Luke — Using Custom Hooks to Encapsulate Service Logic](https://medium.com/@szz185/using-custom-hooks-in-react-to-encapsulate-service-logic-f60d24410bbf)
- [React Docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Sairys — Separating responsibilities using Hooks](https://sairys.medium.com/react-separating-responsibilities-using-hooks-b9c90dbb3ab9)

### Utils vs Helpers

- [Josh W. Comeau — Delightful React File Structure](https://www.joshwcomeau.com/react/file-structure/) (utils vs helpers distinction)
- [Redux issue #1709 — Where do helper and utility methods go?](https://github.com/reduxjs/redux/issues/1709)

### Constants

- [Austin Paley — Adding a Constants File to React](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774)

### TypeScript Types Placement

- [Total TypeScript — Where to put your types in application code](https://www.totaltypescript.com/where-to-put-your-types-in-application-code)
- [Wisp CMS — How Should I Organize My Types as a React Developer](https://www.wisp.blog/blog/how-should-i-organize-my-types-as-a-react-developer)
- [Patrick Desjardins — Organizing interfaces in TypeScript](https://patrickdesjardins.com/blog/how-to-organize-all-the-model-interfaces-and-types-in-your-typescript-project)
- [Become A Better Programmer — Organizing TS Types and Interfaces](https://www.becomebetterprogrammer.com/typescript-organizing-and-storing-types-and-interfaces/)

### Imports & Exports

- [TkDodo — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files)
- [Steven Lemon — Are TypeScript Barrel Files an Anti-pattern?](https://steven-lemon182.medium.com/are-typescript-barrel-files-an-anti-pattern-72a713004250)
- [Viget — Avoiding Import Hell](https://www.viget.com/articles/avoiding-import-hell)
- [Aritra Basu — The Silent Killer in Your React Imports (barrel bloat)](https://aritrakrbasu.medium.com/the-silent-killer-in-your-react-imports-understanding-barrel-import-bloat-f587b53f930c)
- [Jenkens — Named versus Default exports](https://www.jenkens.dev/blog/named-versus-default-export-react/)
- [React Docs — Importing and Exporting Components](https://react.dev/learn/importing-and-exporting-components)
- [Andrew Tarry — Putting React in Barrels](https://andrewtarry.com/posts/react-barrels/)

### Next.js App Router Layout

- [Next.js Docs — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js Docs — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js Docs — Project Organization & Colocation](https://nextjs.org/docs/13/app/building-your-application/routing/colocation)
- [Next.js Colocation Template (live)](https://next-colocation-template.vercel.app/)
- [The Next.js 15 App Router Project Structure That Scales (DEV)](https://dev.to/krunal_groovy/the-nextjs-15-app-router-project-structure-that-scales-with-examples-47ha)
- [Architecting Large-Scale Next.js Applications (DEV)](https://dev.to/addwebsolutionpvtltd/architecting-large-scale-nextjs-applications-folder-structure-patterns-best-practices-2dpj)
- [Wisp CMS — Ultimate Guide to Next.js 15 Project Structure](https://www.wisp.blog/blog/the-ultimate-guide-to-organizing-your-nextjs-15-project-structure)
- [Understanding Route Visibility and Colocation in Next.js App Router](https://dev.to/bridget_amana/understanding-route-visibility-and-colocation-in-nextjs-app-router-2bni)
- [Mastering Next.js 15+ Folder Structure (Hari)](https://medium.com/@j.hariharan005/mastering-next-js-15-folder-structure-a-developers-guide-b9b0461e2d27)
- [Next.js 16 App Router Folder Structure Best Practices (Dharmsy)](https://www.dharmsy.com/blog/nextjs-16-app-router-folder-structure)
- [Next.js App Router common mistakes (Upsun)](https://upsun.com/blog/avoid-common-mistakes-with-next-js-app-router/)

### Next.js Server vs Client Components (architecture impact)

- [Next.js Docs — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Saroj Bist — Client vs Server Components: What Goes Where?](https://medium.com/@Saroj_bist/client-vs-server-components-in-next-js-what-goes-where-74badf8c5620)
- [React Server Components in practice (Valentyn Yakymenko)](https://medium.com/@vyakymenko/react-server-components-in-practice-next-js-d1c3c8a4971f)

### Next.js Data Layer (for module placement decisions)

- [MakerKit — Server Actions vs Route Handlers](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers)
- [Next.js Docs — Mutating Data (Server Actions)](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [Vercel discussion #72919 — Server Actions for fetching?](https://github.com/vercel/next.js/discussions/72919)
- [Nuwan Thuduwage — Route Handlers vs Server Actions](https://medium.com/@nuwan.thuduwage/route-handlers-vs-server-actions-the-old-way-vs-the-modern-way-in-next-js-a78d2300bb48)
