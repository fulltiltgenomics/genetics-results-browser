#!/usr/bin/env sh
# Warns when a commit changes something the docs describe but leaves the doc
# untouched. Mappings mirror the "Documentation ownership" table in CLAUDE.md.
#
# The rules are this repo's own; `check` and the rest of the mechanism live in
# scripts/doc-drift-lib.sh, which is the same file in every repo of the suite.

. "$(dirname "$0")/doc-drift-lib.sh"

DOCS_ANY='^(CLAUDE\.md|README\.md)$'

check '^bff/' "$DOCS_ANY" \
    'bff/ -> CLAUDE.md (architecture overview: stage-1/stage-2 split, BFF routes) + README.md (BFF env vars, dev startup)'

# only the checked-in .env.<mode> files; .env.local is gitignored and never staged
check '^\.env\.(dev|prod)(\.(finngen|public))?$' '^README\.md$' \
    '.env.<mode> -> README.md (VITE_* variable table, list of available modes)'

check '^package\.json$' "$DOCS_ANY" \
    'package.json -> README.md + CLAUDE.md (documented dev/build/test commands)'

check '^(Dockerfile|bff/Dockerfile|nginx\.(dev|prod)\.conf)$' '^README\.md$' \
    'Dockerfile/nginx confs -> README.md (build args, DEPLOY_ENV/DATA_SOURCE selection)'

check '^(scripts/(lint-staged|install-git-hooks)\.sh|eslint\.config\.mjs)$' "$DOCS_ANY" \
    'lint gate (scripts/lint-staged.sh, install-git-hooks.sh, eslint.config.mjs) -> README.md + CLAUDE.md (which commits it blocks, that only eslint errors block, that a worktree needs its own npm install)'

doc_drift_finish
