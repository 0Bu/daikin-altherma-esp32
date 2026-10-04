#!/usr/bin/env bash
# Exercise production browser routing with offline Git and Node fixtures. The Node stub proves
# that every rendering stage is reached; real browser rendering remains a separate CI gate.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
T="$(mktemp -d)"
trap 'rm -rf -- "$T"' EXIT
python3 tools/release/test_dev_publication.py

mkdir -p "$T/work/scripts" "$T/work/main/www" "$T/bin"
cp scripts/run-browser-render-tests.sh "$T/work/scripts/"
cat > "$T/bin/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$BROWSER_FIXTURE_LOG"
if [ "$1" = tools/browser/find_browser.mjs ]; then printf '%s\n' /fixture/browser; fi
NODE
chmod +x "$T/bin/node"
export PATH="$T/bin:$PATH"
export BROWSER_FIXTURE_LOG="$T/node.log"
export CI=true
export DAIKIN_BROWSER_PARALLEL=1
unset BEFORE GITHUB_EVENT_BEFORE EVENT_BASE_SHA BASE_SHA GITHUB_EVENT_NAME
cd "$T/work"
git init -q
git config user.name Fixture
git config user.email fixture@example.invalid
git config commit.gpgsign false
git branch -M main
printf '%s\n' baseline > README.md
printf '%s\n' baseline > main/www/fixture.css
git add -A
git commit -qm 'fixture: baseline'

commit_fixture() {
  git add -A
  git commit -qm "$1"
}
checks=0
check_scope() {
  local name="$1" expected="$2" reason="${3:-}" output
  : > "$BROWSER_FIXTURE_LOG"
  output="$(bash scripts/run-browser-render-tests.sh --if-ui-changed)"
  if [ "$expected" = skip ]; then
    [[ "$output" = *'no UI/browser-relevant changes in diff'* ]]
    [ ! -s "$BROWSER_FIXTURE_LOG" ]
  else
    [[ "$output" != *'no UI/browser-relevant changes in diff'* ]]
    [[ "$output" = *'complete browser rendering and accessibility gate passed'* ]]
    [ "$(grep -c '^tools/browser/find_browser.mjs$' "$BROWSER_FIXTURE_LOG")" -eq 1 ]
    [ "$(grep -c '^tools/browser/assemble_page.mjs ' "$BROWSER_FIXTURE_LOG")" -eq 1 ]
    [ "$(grep -c '^test/test_browser_render.mjs --viewport ' "$BROWSER_FIXTURE_LOG")" -eq 2 ]
    [ "$(grep -c '^tools/browser/selftest.mjs$' "$BROWSER_FIXTURE_LOG")" -eq 1 ]
  fi
  if [ -n "$reason" ]; then [[ "$output" = *"$reason"* ]]; fi
  checks=$((checks + 1))
  printf '  PASS  %s\n' "$name"
}

printf '%s\n' docs >> README.md
commit_fixture 'fixture: docs only'
check_scope 'local docs-only comparison skips every browser stage' skip
mkdir -p tools/ui_localization
printf '%s\n' locale > tools/ui_localization/fixture.txt
commit_fixture 'fixture: localization input'
check_scope 'localization tooling invokes every browser stage' run 'UI changes detected'
multi_before="$(git rev-parse HEAD)"
printf '%s\n' ui >> main/www/fixture.css
commit_fixture 'fixture: earlier UI change'
printf '%s\n' docs >> README.md
commit_fixture 'fixture: last commit docs only'
BEFORE="$multi_before" check_scope 'push includes UI before the last commit' run 'UI changes detected'
GITHUB_EVENT_BEFORE="$multi_before" check_scope 'event BEFORE alias covers the whole push' run 'UI changes detected'
EVENT_BASE_SHA="$multi_before" check_scope 'explicit base covers the whole branch' run 'UI changes detected'
BASE_SHA="$multi_before" check_scope 'base alias covers the whole branch' run 'UI changes detected'
BEFORE=1111111111111111111111111111111111111111 check_scope 'unknown BEFORE with valid HEAD runs full suite' run 'unresolvable comparison range'
BEFORE=0000000000000000000000000000000000000000 check_scope 'initial-push BEFORE runs full suite' run 'unresolvable comparison range'
BEFORE=1111111111111111111111111111111111111111 EVENT_BASE_SHA="$(git rev-parse HEAD^)" \
  check_scope 'invalid push range cannot degrade to a smaller base range' run 'unresolvable comparison range'
EVENT_BASE_SHA=1111111111111111111111111111111111111111 check_scope 'unknown explicit base runs full suite' run 'unresolvable comparison range'
docs_before="$(git rev-parse HEAD)"
printf '%s\n' docs >> README.md
commit_fixture 'fixture: first docs commit'
printf '%s\n' docs >> README.md
commit_fixture 'fixture: second docs commit'
BEFORE="$docs_before" check_scope 'multi-commit docs-only push skips' skip

large_before="$(git rev-parse HEAD)"
printf '%s\n' ui >> main/www/fixture.css
python3 - <<'PY'
from pathlib import Path
folder = Path('zz_many_files')
folder.mkdir()
for number in range(3000):
    (folder / (f'file_{number:04d}_' + 'x' * 180 + '.txt')).write_text('fixture\n')
PY
commit_fixture 'fixture: large diff with early UI path'
git diff --name-only "$large_before" HEAD > "$T/large-diff.txt"
[ "$(wc -c < "$T/large-diff.txt")" -gt 500000 ]
BEFORE="$large_before" check_scope 'over 500 KB of paths cannot SIGPIPE into a skip' run 'UI changes detected'
real_git="$(command -v git)"
cat > "$T/bin/git" <<'GIT'
#!/usr/bin/env bash
if [ "$1" = diff ]; then exit 2; fi
exec "$BROWSER_FIXTURE_GIT" "$@"
GIT
chmod +x "$T/bin/git"
export BROWSER_FIXTURE_GIT="$real_git"
BEFORE="$large_before" check_scope 'Git diff failure invokes full suite' run 'git diff failed'
rm "$T/bin/git"
hash -r

# The actual merge parent is authoritative even if the base independently changed its UI.
git checkout -qb fixture_docs
printf '%s\n' feature > feature-docs.md
commit_fixture 'fixture: docs PR'
git checkout -q main
printf '%s\n' base >> main/www/fixture.css
commit_fixture 'fixture: base UI moved'
git merge --no-ff -qm 'fixture: docs merge tree' fixture_docs
GITHUB_EVENT_NAME=pull_request check_scope 'docs PR skips despite independent base UI change' skip
git checkout -qb fixture_ui
printf '%s\n' feature >> main/www/fixture.css
commit_fixture 'fixture: UI PR'
git checkout -q main
printf '%s\n' base >> README.md
commit_fixture 'fixture: base docs moved'
git merge --no-ff -qm 'fixture: UI merge tree' fixture_ui
GITHUB_EVENT_NAME=pull_request check_scope 'UI PR tests its actual merge-parent range' run 'UI changes detected'

# Pushes may end in a merge: its first parent describes only that merge, not the whole push.
push_before="$(git rev-parse HEAD)"
printf '%s\n' earlier-ui >> main/www/fixture.css
commit_fixture 'fixture: UI before a docs merge'
git checkout -qb fixture_push_docs
printf '%s\n' feature > merged-docs.md
commit_fixture 'fixture: docs merge branch'
git checkout -q main
printf '%s\n' docs >> README.md
commit_fixture 'fixture: main docs'
git merge --no-ff -qm 'fixture: docs-only final merge' fixture_push_docs
GITHUB_EVENT_NAME=push BEFORE="$push_before" check_scope 'push ending in a merge includes its earlier UI commit' run 'UI changes detected'
GITHUB_EVENT_NAME=push check_scope 'push without its event comparison runs full suite' run 'unresolvable comparison range'
GITHUB_EVENT_NAME=push BEFORE=1111111111111111111111111111111111111111 \
  check_scope 'unknown push comparison cannot use merge parents' run 'unresolvable comparison range'
mkdir -p "$T/empty/scripts"
cp "$REPO/scripts/run-browser-render-tests.sh" "$T/empty/scripts/"
cd "$T/empty"
git init -q
check_scope 'missing HEAD cannot silently skip browser tests' run 'unresolvable comparison range'
printf 'build change detection: all %s browser routing checks passed\n' "$checks"
