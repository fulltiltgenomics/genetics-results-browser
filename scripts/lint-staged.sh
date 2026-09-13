#!/usr/bin/env sh
# Lints the staged JS/TS files and FAILS the commit when eslint reports an error.
#
# Deliberately blocking: a gate that only warns is one nobody reads. `git commit
# --no-verify` is the escape hatch.
#
# Errors block; warnings do not. eslint's own exit code already draws that line, and the
# split is load-bearing here — no-explicit-any and react-hooks/exhaustive-deps are
# advisory (100 warnings on adoption) while the defect-finding rules are errors.
#
# Three things this does NOT do, all on purpose:
#
#   * It does not run tsc. typescript-eslint's type-checked presets, or a typecheck of
#     the project, would put a full TypeScript program on every commit. `npm run
#     typecheck` and `npm run bff:typecheck` cover that, and CI runs both on every PR.
#   * It lints the WORKING TREE copies of the staged paths, not the staged blobs; a hook
#     that stashes to do better can lose work if interrupted. The gap only bites when a
#     file is partially staged, so that case is reported rather than hidden.
#   * It does not lint the whole repo, so a finding in a file you did not touch never
#     blocks you. `scripts/lint-staged.sh --all` (or `npm run lint`) does that.
#
# Usage:
#   scripts/lint-staged.sh         lint the staged JS/TS files (what the hook runs)
#   scripts/lint-staged.sh --all   lint the whole repo

set -eu

root=$(git rev-parse --show-toplevel) || exit 2
cd "$root"

# Unlike ruff, eslint is not a self-contained binary: it resolves its config's plugin
# imports out of node_modules next to that config. Borrowing the main checkout's binary
# from a worktree therefore does not work, so a worktree needs its own install.
eslint="$root/node_modules/.bin/eslint"
if [ ! -x "$eslint" ]; then
    printf '\nlint-staged: no eslint in %s/node_modules.\n\n' "$root" >&2
    printf '  Fix: npm install\n\n' >&2
    printf '  A worktree needs its own node_modules — eslint resolves the plugins named\n' >&2
    printf '  in eslint.config.mjs relative to that config, so the main checkout copy\n' >&2
    printf '  cannot stand in for it.\n\n' >&2
    printf '  Refusing to pass the commit unchecked; --no-verify bypasses deliberately.\n\n' >&2
    exit 1
fi

if [ "${1:-}" = "--all" ]; then
    exec "$eslint" .
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git diff --cached --name-only --diff-filter=ACMR -z \
    -- '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.mts' '*.cts' > "$tmp/staged"
[ -s "$tmp/staged" ] || exit 0

# a path that is both staged and dirty gets linted in its working-tree state, which is
# not what is about to be committed; say so rather than let the difference pass unseen
git diff --name-only -z \
    -- '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.mts' '*.cts' > "$tmp/dirty"
tr '\0' '\n' < "$tmp/staged" | sort > "$tmp/staged.lines"
tr '\0' '\n' < "$tmp/dirty" | sort > "$tmp/dirty.lines"
if [ -s "$tmp/dirty.lines" ] && overlap=$(comm -12 "$tmp/staged.lines" "$tmp/dirty.lines") && [ -n "$overlap" ]; then
    printf '\nlint-staged: these paths have unstaged edits, so the lint below reflects the\n' >&2
    printf 'working tree rather than what is being committed:\n' >&2
    printf '%s\n' "$overlap" | sed 's/^/  /' >&2
    printf '\n' >&2
fi

# --no-error-on-unmatched-pattern: a staged path that eslint.config.mjs ignores would
# otherwise be an error in itself
if ! xargs -0 "$eslint" --no-error-on-unmatched-pattern -- < "$tmp/staged"; then
    printf '\nlint-staged: eslint rejected the staged files (above).\n\n' >&2
    printf '  Auto-fixable?  npm run lint:fix\n' >&2
    printf '  Deliberate?    add a targeted eslint-disable-next-line with a reason\n' >&2
    printf '  Bypass:        git commit --no-verify\n\n' >&2
    exit 1
fi
