#!/usr/bin/env bash
# Self-test for the PR-text privacy/language gate. Builds one throwaway git history and, for each
# case, points the checker at exactly the one seeded commit or event fixture — mirroring
# tools/user_docs/selftest.sh's run_case pattern, adapted from file patches to commit construction.
#
# GITHUB_EVENT_PATH is explicitly controlled (never inherited) in every case below: this selftest
# itself runs inside mechanical_gates under a real `pull_request` event, so an ambient
# GITHUB_EVENT_PATH left unset here would make "expect clean" cases check the REAL PR's own
# title/description instead of the fixture — passing or failing by coincidence rather than by what
# this file actually seeded.
set -uo pipefail
cd "$(dirname "$0")/../.."
unset GITHUB_EVENT_PATH

command -v node >/dev/null 2>&1 || { echo "selftest: need node (>=18)" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "selftest: need git" >&2; exit 2; }

CHECK="$PWD/tools/pr_hygiene/check_pr_hygiene.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"
EMPTY_EXCEPTIONS="$WORK/empty_exceptions.txt"
NO_EVENT="$WORK/no-such-event.json"
: > "$EMPTY_EXCEPTIONS"

git init -q "$REPO"
git -C "$REPO" config user.email "selftest@example.com"
git -C "$REPO" config user.name "PR Hygiene Selftest"
git -C "$REPO" commit -q --allow-empty -m "initial commit"

pass=0 fail=0

# run_case NAME WANT_RC NEEDLE BASE HEAD [EVENT_FILE]
# EVENT_FILE defaults to a guaranteed-nonexistent path, so the PR-title/description check is always
# deliberately skipped unless a case explicitly supplies its own fixture.
run_case() {
    local name="$1" want_rc="$2" needle="$3" base="$4" head="$5" event="${6:-$NO_EVENT}" out rc
    out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$head" \
        --exceptions-file "$EMPTY_EXCEPTIONS" --event-file "$event" 2>&1)"; rc=$?
    if [ "$rc" -ne "$want_rc" ] || ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — expected exit $want_rc containing '$needle', got $rc"
        printf '%s\n' "$out" | sed -n '1,8p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

# Adds one commit with the given subject/body atop current HEAD and echoes "parent new" SHAs.
seed_commit() {
    local subject="$1" body="${2:-}"
    local parent; parent="$(git -C "$REPO" rev-parse HEAD)"
    if [ -n "$body" ]; then
        git -C "$REPO" commit -q --allow-empty -m "$subject" -m "$body"
    else
        git -C "$REPO" commit -q --allow-empty -m "$subject"
    fi
    printf '%s %s\n' "$parent" "$(git -C "$REPO" rev-parse HEAD)"
}

echo "== 0. clean commit =="
read -r base head <<< "$(seed_commit "fix: adjust timeout backoff for X10A retries")"
run_case "clean commit passes" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 1. email address in commit subject =="
read -r base head <<< "$(seed_commit "fix: reach me at jane.doe@gmail.com about this")"
run_case "email in subject is caught" 1 "P001 commit" "$base" "$head"

echo "== 2. phone number in commit body =="
read -r base head <<< "$(seed_commit "fix: bench retest" "Called it in on +49 151 12345678 just now.")"
run_case "phone number in body is caught" 1 "P002 commit" "$base" "$head"

echo "== 3. private key material in commit body =="
read -r base head <<< "$(seed_commit "fix: rotate signing key" "-----BEGIN RSA PRIVATE KEY-----")"
run_case "private key block is caught" 1 "P003 commit" "$base" "$head"

echo "== 4. GPS coordinate pair in commit body =="
read -r base head <<< "$(seed_commit "fix: note install site" "Installed at 52.5200, 13.4050 on the north wall.")"
run_case "GPS coordinate pair is caught" 1 "P004 commit" "$base" "$head"

echo "== 5. German commit subject =="
read -r base head <<< "$(seed_commit "Dieser Commit ist nicht auf Englisch geschrieben.")"
run_case "German commit subject is caught" 1 "L001 commit" "$base" "$head"

echo "== 6. ASCII-only German commit body (no umlauts) =="
read -r base head <<< "$(seed_commit "fix: translate status text" "Diese Aenderung ist nicht in englischer Sprache verfasst.")"
run_case "ASCII-only German body is caught" 1 "L001 commit" "$base" "$head"

echo "== 7. legitimate Co-authored-by trailer is NOT flagged =="
read -r base head <<< "$(seed_commit "fix: pair on retry logic" "Co-authored-by: Someone Real <someone.real@gmail.com>")"
run_case "attribution trailer stays clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 8. GitHub noreply / example.com addresses are NOT flagged =="
read -r base head <<< "$(seed_commit "fix: cite report contact" "See the report filed via 12345+octocat@users.noreply.github.com or test@example.com.")"
run_case "allowlisted email domains stay clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 9. version numbers, hex offsets, IPs and MACs are NOT flagged as phone numbers =="
read -r base head <<< "$(seed_commit "fix: bump dependency to v46.2.4" "Bench reachable at 192.168.1.42, register 0x60 offset 6, MAC 3C:71:BF:AA:12:34.")"
run_case "numeric-shaped false positives stay clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 10. PR title carries personal information =="
read -r base head <<< "$(seed_commit "fix: no-op")"
EVENT_10="$WORK/event10.json"
printf '{"pull_request":{"title":"Contact jane.doe@gmail.com for questions","body":""}}' > "$EVENT_10"
run_case "PII in PR title is caught" 1 "P001 PR title" "$base" "$base" "$EVENT_10"

echo "== 11. PR description carries a phone number, on its third line =="
EVENT_11="$WORK/event11.json"
printf '{"pull_request":{"title":"Add board support","body":"Great feature.\\n\\nCall +1 415 555 0134 with questions."}}' > "$EVENT_11"
run_case "phone number in PR description is caught" 1 "P002 PR description:3" "$base" "$base" "$EVENT_11"

echo "== 12. malformed event payload fails closed with a usage error =="
EVENT_12="$WORK/event12.json"
printf 'not json' > "$EVENT_12"
run_case "malformed event JSON is a usage error" 2 "not valid JSON" "$base" "$base" "$EVENT_12"

echo "== 13. an adjudicated fingerprint is suppressed =="
EVENT_13="$WORK/event13.json"
printf '{"pull_request":{"title":"Add board support","body":"Demo contact: demo.reviewer@gmail.com"}}' > "$EVENT_13"
raw_out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$base" \
    --exceptions-file "$EMPTY_EXCEPTIONS" --event-file "$EVENT_13" 2>&1)"; raw_rc=$?
fp="$(printf '%s\n' "$raw_out" | awk '/^    fingerprint: /{print $2; exit}')"
if [ "$raw_rc" -ne 1 ] || [ -z "$fp" ]; then
    echo "  MISSED: adjudication case — the unadjudicated fixture did not fail with a fingerprint as expected"
    printf '%s\n' "$raw_out" | sed -n '1,8p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    ADJUDICATED="$WORK/adjudicated_exceptions.txt"
    printf '%s  # selftest: adjudicated demo address\n' "$fp" > "$ADJUDICATED"
    adjudicated_out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$base" \
        --exceptions-file "$ADJUDICATED" --event-file "$EVENT_13" 2>&1)"; adjudicated_rc=$?
    if [ "$adjudicated_rc" -ne 0 ] || ! printf '%s' "$adjudicated_out" | grep -qF "pr hygiene audit: clean"; then
        echo "  MISSED: an adjudicated fingerprint should clear its finding"
        printf '%s\n' "$adjudicated_out" | sed -n '1,8p' | sed 's/^/            /'
        fail=$((fail + 1))
    else
        echo "  PASS  adjudicated fingerprint clears its finding"
        pass=$((pass + 1))
    fi
fi

echo "== 14. HEAD^1/HEAD^2 auto-detection on a merge commit (mirrors CI's pull_request checkout) =="
git -C "$REPO" branch -f pr-base HEAD
git -C "$REPO" checkout -q -b pr-topic pr-base
git -C "$REPO" commit -q --allow-empty -m "fix: topic change" -m "Contact jane.doe@gmail.com about this."
git -C "$REPO" checkout -q pr-base
git -C "$REPO" merge -q --no-ff -m "Merge pr-topic into pr-base" pr-topic
out="$(node "$CHECK" --repo-root "$REPO" --exceptions-file "$EMPTY_EXCEPTIONS" --event-file "$NO_EVENT" 2>&1)"; rc=$?
if [ "$rc" -ne 1 ] || ! printf '%s' "$out" | grep -qF "P001 commit"; then
    echo "  MISSED: HEAD^1/HEAD^2 auto-detection should catch the merged commit's finding"
    printf '%s\n' "$out" | sed -n '1,8p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    echo "  PASS  HEAD^1/HEAD^2 auto-detection catches the merged commit's finding"
    pass=$((pass + 1))
fi

echo "== 15. --base without --head is a usage error =="
out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --event-file "$NO_EVENT" 2>&1)"; rc=$?
if [ "$rc" -ne 2 ] || ! printf '%s' "$out" | grep -qF "must be given together"; then
    echo "  MISSED: mismatched --base/--head should be a usage error"
    fail=$((fail + 1))
else
    echo "  PASS  mismatched --base/--head is a usage error"
    pass=$((pass + 1))
fi

echo
if [ "$fail" -eq 0 ]; then
    echo "pr hygiene audit selftest: all $pass cases caught"
else
    echo "pr hygiene audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
