# Data-gathering commands

Every command below was run against this tree and produced the output described. Run them from the
repo root unless stated otherwise. Where behavior differs by package manager, both branches are
given — pick the one the package's **lockfile** says (see `repo-map.md`).

## 1. Scope — which packages, which package manager

```bash
for d in server client reviewer-core e2e mcp-server evals; do
  pm=$([ -f "$d/pnpm-lock.yaml" ] && echo pnpm || echo npm)
  nm=$([ -d "$d/node_modules" ] && echo installed || echo MISSING)
  printf '%-14s %-5s %s\n' "$d" "$pm" "$nm"
done
```

`node_modules MISSING` means size analysis is unavailable for that package. Say so in `## Scope`;
do not estimate.

## 2. Manifests — what each package declares

```bash
for d in server client reviewer-core e2e mcp-server evals; do
  echo "--- $d"
  node -e "const p=require('./$d/package.json');
    console.log('deps:', JSON.stringify(p.dependencies||{},null,1));
    console.log('dev :', JSON.stringify(p.devDependencies||{},null,1));"
done
```

## 3. Internal edges — the path aliases (this is the real graph)

```bash
for d in server client reviewer-core e2e mcp-server evals; do
  echo "--- $d/tsconfig.json"
  awk '/"paths"/,/}/' "$d/tsconfig.json"
done
```

`tsconfig.json` files here carry comments, so they are **not** valid JSON — `JSON.parse` fails on
them. Read them with `awk`/`grep`, or strip comments first. Do not assume `require()` will work.

Then find imports that actually cross a package boundary, including ones that bypass a package's
public entry point (the P0 case — a relative path reaching into another package's internals):

```bash
# alias-based (legitimate) cross-package imports
grep -rn "@devdigest/" --include='*.ts' --include='*.tsx' server/src client/src reviewer-core/src mcp-server/src | grep -c import

# relative imports escaping a package (the violation to hunt for)
grep -rn "from ['\"]\.\./\.\./\.\./" --include='*.ts' --include='*.tsx' server/src client/src mcp-server/src
```

## 4. Sizes — installed size on disk

Use `-L` so the command works under both pnpm layouts (symlinked `node_modules/<pkg>` → `.pnpm/…`,
and the hoisted layout this tree currently uses). Without `-L` a symlinked layout reports ~0.

```bash
# per package, total
for d in server client reviewer-core e2e mcp-server evals; do
  printf '%-14s ' "$d"; du -shL "$d/node_modules" 2>/dev/null | cut -f1 || echo '(not installed)'
done

# heaviest individual dependencies in one package
du -shL client/node_modules/* 2>/dev/null | sort -rh | head -15
```

Measured on this tree: `client` 620M, `evals` 332M, `server` 249M, `mcp-server` 83M,
`reviewer-core` 78M, `e2e` not installed. Inside `client`: `next` 153M, `@next` 124M,
`mermaid` 75M, `lucide-react` 36M, `typescript` 23M.

**Installed size is not bundle size.** `mermaid` at 75M on disk ships a fraction of that to the
browser, and `typescript` at 23M ships none of it. Label which one you are reporting; never present
a `du` figure as what the user downloads.

## 5. Version drift — the same dependency at different versions

```bash
node -e "
const fs=require('fs'); const pkgs=['server','client','reviewer-core','e2e','mcp-server','evals'];
const map={};
for (const p of pkgs) {
  const j = JSON.parse(fs.readFileSync(p+'/package.json','utf8'));
  for (const [k,v] of Object.entries({...j.dependencies, ...j.devDependencies})) (map[k] ||= []).push(p+':'+v);
}
for (const [k,v] of Object.entries(map)) {
  const versions = new Set(v.map(x => x.split(':')[1]));
  if (v.length > 1 && versions.size > 1) console.log(k.padEnd(20), v.join('  '));
}"
```

To see what a range actually *resolved* to (declared drift and resolved drift are different
questions — two packages can declare `^3.24` and `^3.25` and still resolve to the same version):

```bash
cd server && pnpm why zod          # pnpm packages
cd reviewer-core && npm ls zod     # npm packages
```

## 6. Unused — declared but never imported

Grep the package's **own source** for each declared dependency before calling it unused:

```bash
dep=moment; pkg=server
grep -rn "['\"]$dep" "$pkg/src" --include='*.ts' --include='*.tsx' | head
```

No hits is *evidence*, not proof — a dependency can be reached from a config file, a script in
`package.json`, or a type-only import. Widen the search before you commit to the finding:

```bash
grep -rn "$dep" "$pkg" --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
  --exclude-dir=node_modules | head
```

State in the finding exactly where you looked. Then **propose** the removal — never run it.

## 7. Advisories — branch on the lockfile

```bash
# pnpm packages: server, client, mcp-server, evals
cd client && pnpm audit --audit-level high

# npm packages: reviewer-core, e2e
cd reviewer-core && npm audit --audit-level=high
```

Running `npm audit` in a pnpm package fails with `ENOLOCK` — it is not a finding, it is you using
the wrong tool. And note the baseline: `client` reports 11 vulnerabilities (1 critical, 2 high) on a
**clean** tree, all transitive through `@vitejs/plugin-react > vite`. Those are **Info**. Only an
advisory the current change *introduced* rises to P1.

## 8. What changed — scoping the audit to a diff

When the audit is about a branch rather than the whole repo, restrict it to what moved:

```bash
git diff main...HEAD --name-only | grep -E 'package\.json|lock|tsconfig\.json'
```

A changed **lockfile** means the dependency tree moved — audit it. A changed `package.json` alone
(a renamed script, a new keyword) does not, and re-auditing the standing tree on every such touch is
how a gate earns its way into everyone's ignore list.
