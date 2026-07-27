#!/usr/bin/env sh
# Warns when a commit changes something the docs describe but leaves the doc
# untouched. Mappings mirror the "Documentation ownership" table in CLAUDE.md.
#
# This never blocks. A warning that is occasionally ignored beats a gate that
# gets bypassed with --no-verify, because a bypassed gate is both absent and
# assumed present.

set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

staged=$(git diff --cached --name-only --diff-filter=ACMRD)
[ -n "$staged" ] || exit 0

hit() {
    printf '%s\n' "$staged" | grep -qE "$1"
}

found=0
check() {
    if hit "$1" && ! hit "$2"; then
        if [ "$found" -eq 0 ]; then
            printf '\ndoc-drift warning — this commit changes code the docs describe:\n\n' >&2
            found=1
        fi
        printf '  %s\n' "$3" >&2
    fi
}

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

if [ "$found" -eq 1 ]; then
    printf '\n  Update the doc in this commit, or note why it does not apply.\n' >&2
    printf '  Not blocking. Mappings live in CLAUDE.md > Documentation ownership.\n\n' >&2
fi

exit 0
