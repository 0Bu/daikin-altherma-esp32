#!/usr/bin/env bash
# Offline regression tests for the Verified gh-pages GraphQL publisher. A fake `gh` applies each
# createCommitOnBranch payload to a throwaway bare repository, so these tests cover exact trees,
# binary bytes, expectedHeadOid races and signature fail-closed behavior without network access.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SCRIPT="$(cd "$(dirname "${1:-scripts/publish-pages-branch.sh}")" && pwd)/$(basename "${1:-scripts/publish-pages-branch.sh}")"
HELPER="$(pwd)/scripts/pages-commit-payload.mjs"
FAKE="$(pwd)/test/fake_pages_graphql.mjs"
for file in "$SCRIPT" "$HELPER" "$FAKE"; do
  [ -f "$file" ] || { echo "no such test input: $file" >&2; exit 1; }
done

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

git init -q --bare "$T/origin.git"
git init -q "$T/seed" && (
  cd "$T/seed" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  echo seed > README.md && git add -A && git commit -qm seed
  git branch -M main && git remote add origin "$T/origin.git" && git push -q origin main
)
git -C "$T/origin.git" symbolic-ref HEAD refs/heads/main

mkdir -p "$T/mockbin"
cat > "$T/mockbin/gh" <<MOCK
#!/bin/sh
exec node "$FAKE" "\$@"
MOCK
chmod +x "$T/mockbin/gh"

clone() {
  git clone -q "$T/origin.git" "$T/$1"
  mkdir -p "$T/$1/scripts"
  cp "$SCRIPT" "$T/$1/scripts/publish-pages-branch.sh"
  cp "$HELPER" "$T/$1/scripts/pages-commit-payload.mjs"
  chmod +x "$T/$1/scripts/publish-pages-branch.sh"
}
site_root() { mkdir -p "$T/$1/_site"; echo "root-$2" > "$T/$1/_site/index.html"; }
site_dev()  { mkdir -p "$T/$1/_site/dev"; echo "dev-$2" > "$T/$1/_site/dev/index.html"; }
run() {
  local d="$1"; shift
  ( cd "$T/$d" && env \
      PATH="$T/mockbin:$PATH" \
      GITHUB_REPOSITORY=test/repo \
      MOCK_PAGES_ORIGIN="$T/origin.git" \
      ./scripts/publish-pages-branch.sh "$@" ) > "$T/out.log" 2>&1
}
remote_file() { git -C "$T/origin.git" show "gh-pages:$1" 2>/dev/null; }
remote_has()  { git -C "$T/origin.git" rev-parse --verify -q "gh-pages:$1" >/dev/null 2>&1 && echo yes || echo no; }

clone A; clone B

echo "== 1. missing signed bootstrap fails closed =="
site_root A v1; run A; rc=$?
check "first CI publish is refused" "$([ "$rc" -ne 0 ] && echo yes || echo no)" yes
check "message names signed bootstrap" "$(grep -c 'signed orphan bootstrap' "$T/out.log")" 1

(
  cd "$T/seed" || exit 1
  git checkout -q --orphan gh-pages
  git rm -qf README.md
  echo bootstrap > bootstrap.txt
  git add -A && git commit -qm "signed bootstrap fixture"
  git push -q origin gh-pages
)

echo "== 2. root publish is atomic and removes stale root-owned files =="
run A; rc=$?
check "root publish succeeds" "$rc" 0
check "root landed" "$(remote_file index.html)" root-v1
check "bootstrap placeholder swept" "$(remote_has bootstrap.txt)" no
check "publisher reports Verified" "$(grep -c 'verified ' "$T/out.log")" 1

echo "== 3. dev and root coexist and exact binary bytes survive base64 =="
( cd "$T/B" && git fetch -q origin )
site_dev B d1
printf '\000\001\376\377binary\000' > "$T/B/_site/dev/app.bin"
run B --dev; rc=$?
check "dev publish succeeds" "$rc" 0
check "dev landed" "$(remote_file dev/index.html)" dev-d1
check "root survived dev" "$(remote_file index.html)" root-v1
git -C "$T/origin.git" show gh-pages:dev/app.bin > "$T/remote-app.bin"
check "binary bytes are exact" "$(cmp -s "$T/B/_site/dev/app.bin" "$T/remote-app.bin" && echo yes || echo no)" yes

echo "== 4. an unchanged tree is accepted only when GitHub says Verified =="
run B --dev; rc=$?
check "verified no-op succeeds" "$rc" 0
check "no-op was reported" "$(grep -c 'unchanged, verified' "$T/out.log")" 1
(
  cd "$T/B" && env PATH="$T/mockbin:$PATH" GITHUB_REPOSITORY=test/repo \
    MOCK_PAGES_ORIGIN="$T/origin.git" MOCK_PAGES_EXISTING_UNVERIFIED=1 \
    ./scripts/publish-pages-branch.sh --dev
) > "$T/out.log" 2>&1
rc=$?
check "unverified no-op is rejected" "$([ "$rc" -ne 0 ] && echo yes || echo no)" yes

echo "== 5. each slice is declarative; root also sweeps retired PR previews =="
(
  cd "$T/seed" || exit 1
  git fetch -q origin gh-pages
  git checkout -q -B gh-pages origin/gh-pages
  mkdir -p PR/42 dev
  echo stale > PR/42/index.html
  echo stale > dev/old.bin
  git add -A && git commit -qm stale && git push -q origin gh-pages
)
site_root A v2; run A; rc=$?
check "root replacement succeeds" "$rc" 0
check "retired PR preview removed" "$(remote_has PR/42/index.html)" no
check "dev stale file preserved by root" "$(remote_has dev/old.bin)" yes
( cd "$T/B" && git fetch -q origin )
rm -f "$T/B/_site/dev/app.bin"
site_dev B d2; run B --dev; rc=$?
check "dev replacement succeeds" "$rc" 0
check "dev stale file removed" "$(remote_has dev/old.bin)" no
check "removed local binary removed remotely" "$(remote_has dev/app.bin)" no
check "root remains" "$(remote_file index.html)" root-v2

echo "== 6. expectedHeadOid race retries against the winner =="
site_root A v3
(
  cd "$T/A" && env PATH="$T/mockbin:$PATH" GITHUB_REPOSITORY=test/repo \
    MOCK_PAGES_ORIGIN="$T/origin.git" MOCK_PAGES_RACE_ONCE="$T/raced" \
    ./scripts/publish-pages-branch.sh
) > "$T/out.log" 2>&1
rc=$?
check "raced publish succeeds" "$rc" 0
check "retry actually ran" "$(grep -c 'moved under us' "$T/out.log")" 1
check "root landed after retry" "$(remote_file index.html)" root-v3
check "dev survived retry" "$(remote_file dev/index.html)" dev-d2

echo "== 7. API and signature failures fail closed =="
site_dev B d3
before="$(git -C "$T/origin.git" rev-parse gh-pages)"
(
  cd "$T/B" && env PATH="$T/mockbin:$PATH" GITHUB_REPOSITORY=test/repo \
    MOCK_PAGES_ORIGIN="$T/origin.git" MOCK_PAGES_FAIL=unretryable \
    ./scripts/publish-pages-branch.sh --dev
) > "$T/out.log" 2>&1
rc=$?; after="$(git -C "$T/origin.git" rev-parse gh-pages)"
check "unretryable API failure exits nonzero" "$([ "$rc" -ne 0 ] && echo yes || echo no)" yes
check "unretryable failure did not move branch" "$after" "$before"
check "unretryable failure did not retry" "$(grep -c 'moved under us' "$T/out.log")" 0
(
  cd "$T/B" && env PATH="$T/mockbin:$PATH" GITHUB_REPOSITORY=test/repo \
    MOCK_PAGES_ORIGIN="$T/origin.git" MOCK_PAGES_BAD_SIGNATURE=1 \
    ./scripts/publish-pages-branch.sh --dev
) > "$T/out.log" 2>&1
rc=$?
check "bad signature exits nonzero" "$([ "$rc" -ne 0 ] && echo yes || echo no)" yes
check "bad signature reason is explicit" "$(grep -c 'not GitHub-signed and verified' "$T/out.log")" 1

echo "== 8. retired and malformed modes are rejected before mutation =="
run A --pr 12; rc_pr=$?
run A --rm 12; rc_rm=$?
run A --dev extra; rc_extra=$?
check "retired --pr rejected" "$([ "$rc_pr" -ne 0 ] && echo yes || echo no)" yes
check "retired --rm rejected" "$([ "$rc_rm" -ne 0 ] && echo yes || echo no)" yes
check "extra --dev value rejected" "$([ "$rc_extra" -ne 0 ] && echo yes || echo no)" yes

echo
if [ "$fail" -eq 0 ]; then
  echo "pages publish: all $pass checks passed"
else
  echo "pages publish: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
