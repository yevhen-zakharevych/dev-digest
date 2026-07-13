Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, drizzle-orm@0.36.0, zod@3.23.8, pg@8.13.0, moment@2.30.1
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tsx@4.19.0
client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.22.4, date-fns@4.1.0
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tailwindcss@3.4.14
reviewer-core/package.json dependencies: zod@3.23.8
reviewer-core/package.json devDependencies: typescript@5.6.3
e2e/package.json dependencies: (none runtime)
e2e/package.json devDependencies: playwright@1.48.2, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/moment: 4.2M
server/node_modules/drizzle-orm: 8.1M
server/node_modules/fastify: 6.5M
server/node_modules/pg: 3.8M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/react-dom: 6.9M
client/node_modules/date-fns: 22M
client/node_modules/zod: 1.9M
reviewer-core/node_modules/zod: 2.1M
e2e/node_modules/playwright: 210M

server/package.json also declares zod@3.23.8, client/package.json declares zod@3.22.4, reviewer-core/package.json declares zod@3.23.8 — three different resolved zod versions across packages.

grep for imports crossing package boundaries:
- server/src/routes/reviews.ts imports types from "@shared/review-types" (alias to server/src/vendor/shared)
- server/src/services/review-service.ts imports "reviewer-core/src/pipeline.js" directly by relative path (not via the package's public entry point)
- client/src/lib/api-types.ts imports "@shared/review-types" (same alias as server)
- grep found no import of "moment" anywhere under server/src — only present in package.json
