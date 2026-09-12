# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm install
npm run dev        # vite dev server on :3000
npm run bff:dev    # BFF on :5000 (watch mode); `npm run bff` for one-shot
npm run build      # production bundle into static/
npm run typecheck  # tsc --noEmit over src/
npm run bff:typecheck # tsc -p bff/tsconfig.json over bff/ (sources + tests)
npm test           # vitest unit/component tests under src/ (jsdom, MSW-mocked API)
npm run bff:test   # vitest tests for the BFF
npm run e2e        # Playwright specs in e2e/ (headless chromium)
```

`npm run lint` is eslint (flat config in `eslint.config.mjs`), and `npm run lint:fix`
applies what it can fix. It is deliberately **not** type-aware: the type-checked
typescript-eslint presets re-run the TypeScript program on every invocation, and
`npm run typecheck` already covers that ground. `tsc` settings live in `tsconfig.json`
(strict). `npm run build` is `vite build`, which strips types via rolldown *without*
checking them, so the `typecheck` scripts are the only things that actually type-check.
CI runs both on pull requests, before the build.

`scripts/lint-staged.sh` runs eslint over the staged files from the `pre-commit` hook and
**blocks the commit** on an error. Only errors block — warnings are advisory, and
`@typescript-eslint/no-explicit-any` and `react-hooks/exhaustive-deps` are deliberately
warnings rather than errors, since they are strictness preferences rather than defect
detectors. A worktree needs its own `npm install`: eslint resolves the plugins named in
`eslint.config.mjs` relative to that config, so the main checkout's copy cannot stand in
for it. `git commit --no-verify` is the bypass.

Type checking is split across two projects because the root `tsconfig.json` has
`include: ["./src/"]` and so cannot see the BFF: `typecheck` covers `src/`, and
`bff:typecheck` covers `bff/` via `bff/tsconfig.json`. Both must stay green — `tsx` and
vitest transpile without checking, so neither `npm run bff` nor `npm run bff:test` will
catch a BFF type error. `bff/tsconfig.json` sets `"types": ["node"]`, which is why
`@types/node` is an explicit devDependency rather than a transitive one (npm hoisting is
not guaranteed under `npm ci`).

See `README.md` for the full dev startup sequence and environment variables.

## Architecture Overview

React 19 + TypeScript SPA (Vite, MUI v6, material-react-table, zustand, react-router,
@tanstack/react-query) plus a small Express BFF in `bff/`.

Data flow: browser → vite dev server or nginx → BFF (`:5000`) → `genetics-results-api` (`:2000`).
The chat views are the exception — they talk directly to the chat backend
(`../genetics-mcp-server`) at `VITE_CHAT_URL`.

The annotation path is split in two stages so that changing a UI control never re-hits the API:

- **stage 1, in the BFF** — `POST /api/v1/results` (variant list) and `GET /api/v1/gene_results/:gene`
  fan out over the API's granular endpoints (credible sets, variant annotation, nearest genes,
  datasets/resources) and return one raw, unfiltered `NormalizedResponse`; the variant-list path is
  cached in-process by query hash. `POST /api/v1/gnomad` serves the lazy per-page gnomAD enrichment.
  `GET /api/v1/ld` (`bff/ldRoute.ts`) proxies the external FinnGen LD API (`LD_API_URL`), which the
  browser may not call directly under the production CSP's `connect-src 'self'`.
  Everything else under `/api` falls through `bff/passthrough.ts` to the API unchanged — except
  that both upstream paths attach `Authorization: Bearer $GENETICS_API_TOKEN`
  (`upstream.ts` for the assembled routes, `passthrough.ts` for the rest, and only when the
  caller sent no `Authorization` of their own). results-api honours the forwarded
  `X-Goog-Authenticated-User-Email` **only** from a caller presenting that secret, so dropping
  the bearer from the passthrough 401s every browser request. **Deploy ordering: bff ships
  before results-api** — see the suite repo's README, "Deploying the trusted-proxy marker".
  Before parsing, `POST /api/v1/results` tries three single-token expansions in order
  (`bff/inputParse.ts`), each falling through to the next on a 404 or a non-match: a
  `pheno:{resource}:{code}` token → that phenotype's credible-set lead variants with their betas; a
  curated set name → its variant list; a bare gene symbol → that gene's coding variants
  (gnomAD-annotated, `gene_most_severe` scoped, AF > 1e-4), reported back as
  `inputVariants.expandedFromGene`. Order matters — all three are bare tokens, so a curated set named
  after a gene stays a set. `GET /api/v1/gene_results/:gene` is a different thing (all credible-set
  member variants in a gene region, `queryType: "gene"`) and currently has no caller in `src/`.
- **stage 2, in the browser** — pure filter/group/summarize functions in `src/store/munge.normalized.ts`
  recompute reactively from the normalized records held in the zustand store.

Layout:

- `src/features/**` — views, grouped by feature (`table`, `gene`, `phenoSearch`, `chat`, `controls`,
  `admin`, `input`, `page`)
- `src/store/**` — zustand store, server queries, munging
- `src/types/**` — `types.normalized.ts` is the current credible-set-primary contract; `types.ts` and
  `types.gene.ts` still hold legacy pre-refactor types
- `src/test/**` — vitest setup, MSW handlers, API fixtures (see `src/test/fixtures/README.md`)
- `bff/**` — BFF sources and their vitest suite
- `e2e/**` — Playwright specs

`refactor.md` and `refactor.backend.md` document the credible-set-only rewrite that produced this
architecture; they are historical design records, not a to-do list.

## Conventions & Patterns

- comments start lowercase (unless a proper noun) and explain *why*, not *what*; no comments that
  restate the code
- import from `src/` via the `@/*` path alias
- tests are colocated next to the code they cover, `*.test.ts(x)`
- `*.normalized.*` file/type suffixes mark the post-refactor credible-set data path; unsuffixed
  siblings are the legacy path being retired
- deployment differences (FinnGen vs public, dev vs prod) come from build-time config only —
  `.env.<mode>` files and `src/config.<data source>.json`, never branching on hostname
- documentation lives in markdown files at the repo root (`README.md`, `refactor*.md`); there is
  currently no `docs/` directory

## Documentation ownership

Changing a path on the left makes the doc on the right wrong until it is updated in
the same commit. `scripts/check-doc-drift.sh` warns (never blocks) on commits that
violate this; it runs from the `pre-commit` hook.

The same hook also runs `scripts/lint-staged.sh`, which **does** block: a commit whose
staged files the linter rejects is refused. Neither hook runs until
`scripts/install-git-hooks.sh` has been run once in the clone — `core.hooksPath` is
local git config that no clone carries — and because that setting is shared across
worktrees, one run also covers every worktree, existing and future.

| changed path | doc to update | what to check |
|---|---|---|
| `bff/**` | `CLAUDE.md`, `README.md` | architecture overview (stage-1/stage-2 split, BFF routes), BFF env vars, dev startup sequence |
| `.env.dev*`, `.env.prod*` | `README.md` | the `VITE_*` variable table, the list of available modes |
| `package.json` | `README.md`, `CLAUDE.md` | documented dev/build/test commands |
| `Dockerfile`, `bff/Dockerfile`, `nginx.*.conf` | `README.md` | docker build args, `DEPLOY_ENV`/`DATA_SOURCE` selection |
| `scripts/lint-staged.sh`, `scripts/install-git-hooks.sh`, `eslint.config.mjs` | `README.md`, `CLAUDE.md` | the lint gate: which commits it blocks, that only eslint *errors* block while warnings do not, and that a worktree needs its own `npm install` |

`refactor.md` and `refactor.backend.md` are deliberately *not* drift targets — they are
historical records of a completed rewrite, not living documentation.

A doc is stale the moment it *enumerates* something the code no longer matches.
Counts and lists rot silently — env-var tables, route lists, npm script lists — so
re-derive them from the code rather than trusting them.

## Cross-repo documentation

`genetics-results-suite` is the spec of record for the suite as a whole; this repo
documents only itself. When a change here alters the contract with the backing API
or the BFF's shape of it, check whether that repo's `docs/project-spec.md` needs
updating too — do not assume this repo's docs cover it.
