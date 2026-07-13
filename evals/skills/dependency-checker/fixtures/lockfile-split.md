Here is the raw data you'd normally gather yourself — treat it as already collected, and answer directly from it (do not ask for tool access or more data).

`ls` of each package directory (top level only):

```
server/        package.json  pnpm-lock.yaml  tsconfig.json  node_modules/  src/
client/        package.json  pnpm-lock.yaml  tsconfig.json  node_modules/  src/
reviewer-core/ package.json  package-lock.json  tsconfig.json  node_modules/  src/
e2e/           package.json  package-lock.json  tsconfig.json  src/
mcp-server/    package.json  pnpm-lock.yaml  tsconfig.json  node_modules/  src/
evals/         package.json  pnpm-lock.yaml  tsconfig.json  node_modules/  src/
```

There is no `package.json`, no `pnpm-workspace.yaml`, and no lockfile at the repository root.

`compilerOptions.paths` from each tsconfig.json:

```
server/tsconfig.json:
  "@devdigest/shared": ["./src/vendor/shared/index.ts"]
  "@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]

client/tsconfig.json:
  "@/*": ["./src/*"]
  "@devdigest/shared": ["./src/vendor/shared/index.ts"]
  "@devdigest/ui": ["./src/vendor/ui/index.ts"]

reviewer-core/tsconfig.json:
  "@devdigest/shared": ["../server/src/vendor/shared/index.ts"]
  "zod": ["./node_modules/zod"]

mcp-server/tsconfig.json:
  "@devdigest/shared": ["../server/src/vendor/shared/index.ts"]

e2e/tsconfig.json:   (no paths)
evals/tsconfig.json: (no paths)
```

Declared versions of dependencies that appear in more than one package:

```
typescript    server:^5.7.2  client:^5.7.2  reviewer-core:^5.7.2  e2e:^5.7.2  mcp-server:^5.7.2  evals:^5.6.0
vitest        server:^2.1.8  client:^2.1.8  reviewer-core:^2.1.8  mcp-server:^2.1.8  evals:^2.1.0
@types/node   server:^22.10.0  client:^22.10.0  reviewer-core:^22.10.0  e2e:^22.10.0  mcp-server:^22.10.0  evals:^22.0.0
zod           server:^3.25.76  client:^3.24.1  reviewer-core:^3.25.76
```

`reviewer-core/package.json` has `"build": "tsc --noEmit"` and no `"main"`/`"exports"` field. The repo root README states the packages share code but does not say how.

The team wants to know how to check every package for known security vulnerabilities, and what to fix first.
