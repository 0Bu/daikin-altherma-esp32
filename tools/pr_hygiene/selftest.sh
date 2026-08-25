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
set -euo pipefail
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
# A maintainer may require signed commits globally. Throwaway mutation fixtures must remain
# hermetic and must never contact the maintainer's signing agent or keyring.
git -C "$REPO" config commit.gpgSign false
git -C "$REPO" commit -q --allow-empty -m "initial commit"

pass=0 fail=0

# run_case NAME WANT_RC NEEDLE BASE HEAD [EVENT_FILE]
# EVENT_FILE defaults to omitted, so the PR-title/description check is deliberately skipped unless
# a case explicitly supplies its own fixture (including a missing path for the fail-closed case).
run_case() {
    local name="$1" want_rc="$2" needle="$3" base="$4" head="$5" event="${6:-}" out rc
    local -a args=(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$head"
        --exceptions-file "$EMPTY_EXCEPTIONS")
    [ -z "$event" ] || args+=(--event-file "$event")
    if out="$("${args[@]}" 2>&1)"; then rc=0; else rc=$?; fi
    if [ "$rc" -ne "$want_rc" ] || ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — expected exit $want_rc containing '$needle', got $rc"
        printf '%s\n' "$out" | sed -n '1,8p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

# Adds one commit with the given subject/body atop current HEAD and records its parent/new SHAs.
SEED_BASE=""
SEED_HEAD=""
seed_commit() {
    local subject="$1" body="${2:-}"
    SEED_BASE="$(git -C "$REPO" rev-parse HEAD)"
    if [ -n "$body" ]; then
        git -C "$REPO" commit -q --allow-empty -m "$subject" -m "$body"
    else
        git -C "$REPO" commit -q --allow-empty -m "$subject"
    fi
    SEED_HEAD="$(git -C "$REPO" rev-parse HEAD)"
}

echo "== 0. clean commit =="
seed_commit "fix: adjust timeout backoff for X10A retries"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "clean commit passes" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 1. email address in commit subject =="
seed_commit "fix: reach the fixture at jane.doe@privacy-fixture.example.com"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "email in subject is caught" 1 "P001 commit" "$base" "$head"

echo "== 2. phone number in commit body =="
seed_commit "fix: bench retest" "Called the reserved fixture number +1 202 555 0100 just now."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "phone number in body is caught" 1 "P002 commit" "$base" "$head"

echo "== 3. private key material in commit body =="
# Built at runtime, not written as one contiguous literal: this repo's own
# scripts/run-public-readiness-audit.sh git-greps every tracked file for the complete BEGIN-PRIVATE-KEY
# marker so no real one ever ships, and a literal fixture here would trip that same check on itself.
key_marker="$(printf -- '-----BEGIN %s PRIVATE KEY-----' RSA)"
seed_commit "fix: rotate signing key" "$key_marker"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "private key block is caught" 1 "P003 commit" "$base" "$head"

echo "== 4. GPS coordinate pair in commit body =="
seed_commit "fix: note install site" "Installed at 52.5200, 13.4050 on the north wall."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "GPS coordinate pair is caught" 1 "P004 commit" "$base" "$head"

echo "== 5. German commit subject =="
seed_commit "Dieser Commit ist nicht auf Englisch geschrieben."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "German commit subject is caught" 1 "L001 commit" "$base" "$head"

echo "== 6. ASCII-only German commit body (no umlauts) =="
seed_commit "fix: translate status text" "Diese Aenderung ist nicht in englischer Sprache verfasst."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "ASCII-only German body is caught" 1 "L001 commit" "$base" "$head"

echo "== 7. legitimate Co-authored-by trailer is NOT flagged =="
seed_commit "fix: pair on retry logic" "Co-authored-by: Someone Real <someone@privacy-fixture.example.com>"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "attribution trailer stays clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 8. GitHub noreply / example.com addresses are NOT flagged =="
seed_commit "fix: cite report contact" "See the report filed via 12345+octocat@users.noreply.github.com or test@example.com."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "allowlisted email domains stay clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 9. placeholder local parts do NOT allowlist non-allowlisted domains =="
seed_commit "fix: remove user@privacy-fixture.example.com and name@privacy-fixture.example.net"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "placeholder local parts on non-allowlisted domains are caught" 1 "P001 commit" "$base" "$head"

echo "== 10. trailer-like prefixes do NOT bypass ordinary prose checks =="
seed_commit "fix: check trailer parsing" "Reviewed-by: Call the reserved fixture number (202) 555-0101."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "trailer-prefixed phone is caught" 1 "P002 commit" "$base" "$head"
EVENT_10="$WORK/event10.json"
printf '{"pull_request":{"title":"Add board support","body":"Reviewed-by: Dieser Text ist nicht auf Englisch geschrieben."}}' > "$EVENT_10"
run_case "trailer-prefixed PR prose is caught" 1 "L001 PR description" "$base" "$base" "$EVENT_10"

echo "== 11. fine-grained GitHub token shape is caught =="
github_pat_fixture="$(printf 'github_pat_%040d' 0)"
seed_commit "fix: remove credential fixture" "$github_pat_fixture"; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "fine-grained token is caught" 1 "P003 commit" "$base" "$head"

echo "== 12. version numbers, hex offsets, IPs and MACs are NOT flagged as phone numbers =="
# 203.0.113.0/24 is the IANA TEST-NET-3 documentation range (RFC 5737), and 02: is a
# locally-administered unicast MAC prefix — both required by this repo's own
# scripts/run-public-readiness-audit.sh, which rejects RFC1918-shaped IPs and non-synthetic MACs in
# any test/tools fixture, this file included.
seed_commit "fix: bump dependency to v46.2.4" "Bench reachable at 203.0.113.42, register 0x60 offset 6, MAC 02:71:BF:AA:12:34."; base="$SEED_BASE"; head="$SEED_HEAD"
run_case "numeric-shaped false positives stay clean" 0 "pr hygiene audit: clean" "$base" "$head"

echo "== 13. PR title carries personal information =="
seed_commit "fix: no-op"; base="$SEED_BASE"; head="$SEED_HEAD"
EVENT_13="$WORK/event13.json"
printf '{"pull_request":{"title":"Contact jane.doe@privacy-fixture.example.com for questions","body":""}}' > "$EVENT_13"
run_case "PII in PR title is caught" 1 "P001 PR title" "$base" "$base" "$EVENT_13"

echo "== 14. PR description carries a phone number, on its third line =="
EVENT_14="$WORK/event14.json"
printf '{"pull_request":{"title":"Add board support","body":"Great feature.\\n\\nCall the reserved fixture number +1 202 555 0102."}}' > "$EVENT_14"
run_case "phone number in PR description is caught" 1 "P002 PR description:3" "$base" "$base" "$EVENT_14"

echo "== 15. malformed or missing event payload fails closed with a usage error =="
EVENT_15="$WORK/event15.json"
printf 'not json' > "$EVENT_15"
run_case "malformed event JSON is a usage error" 2 "not valid JSON" "$base" "$base" "$EVENT_15"
run_case "explicitly missing event file is a usage error" 2 "event file not found" "$base" "$base" "$NO_EVENT"

echo "== 16. an adjudicated fingerprint is suppressed =="
EVENT_16="$WORK/event16.json"
printf '{"pull_request":{"title":"Add board support","body":"Demo contact: demo.reviewer@privacy-fixture.example.com"}}' > "$EVENT_16"
if raw_out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$base" \
    --exceptions-file "$EMPTY_EXCEPTIONS" --event-file "$EVENT_16" 2>&1)"; then raw_rc=0; else raw_rc=$?; fi
fp="$(printf '%s\n' "$raw_out" | awk '/^    fingerprint: /{print $2; exit}')"
if [ "$raw_rc" -ne 1 ] || [ -z "$fp" ]; then
    echo "  MISSED: adjudication case — the unadjudicated fixture did not fail with a fingerprint as expected"
    printf '%s\n' "$raw_out" | sed -n '1,8p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    ADJUDICATED="$WORK/adjudicated_exceptions.txt"
    printf '%s  # selftest: adjudicated demo address\n' "$fp" > "$ADJUDICATED"
    if adjudicated_out="$(node "$CHECK" --repo-root "$REPO" --base "$base" --head "$base" \
        --exceptions-file "$ADJUDICATED" --event-file "$EVENT_16" 2>&1)"; then adjudicated_rc=0; else adjudicated_rc=$?; fi
    if [ "$adjudicated_rc" -ne 0 ] || ! printf '%s' "$adjudicated_out" | grep -qF "pr hygiene audit: clean"; then
        echo "  MISSED: an adjudicated fingerprint should clear its finding"
        printf '%s\n' "$adjudicated_out" | sed -n '1,8p' | sed 's/^/            /'
        fail=$((fail + 1))
    else
        echo "  PASS  adjudicated fingerprint clears its finding"
        pass=$((pass + 1))
    fi
fi

echo "== 17. origin/main..HEAD auto-detection for a local dry run =="
git -C "$REPO" update-ref refs/remotes/origin/main HEAD
seed_commit "fix: local dry-run fixture" "Contact jane.doe@privacy-fixture.example.com about this."
if out="$(node "$CHECK" --repo-root "$REPO" --exceptions-file "$EMPTY_EXCEPTIONS" 2>&1)"; then rc=0; else rc=$?; fi
if [ "$rc" -ne 1 ] || ! printf '%s' "$out" | grep -qF "P001 commit"; then
    echo "  MISSED: origin/main..HEAD auto-detection should catch the local commit's finding"
    printf '%s\n' "$out" | sed -n '1,8p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    echo "  PASS  origin/main..HEAD auto-detection catches the local commit's finding"
    pass=$((pass + 1))
fi

echo "== 18. invalid or mismatched explicit ranges are usage errors =="
if out="$(node "$CHECK" --repo-root "$REPO" --base "$base" 2>&1)"; then rc=0; else rc=$?; fi
if [ "$rc" -ne 2 ] || ! printf '%s' "$out" | grep -qF "must be given together"; then
    echo "  MISSED: mismatched --base/--head should be a usage error"
    fail=$((fail + 1))
else
    echo "  PASS  mismatched --base/--head is a usage error"
    pass=$((pass + 1))
fi
run_case "invalid explicit range is a usage error" 2 "could not read commit range" definitely-not-a-ref HEAD

echo
if [ "$fail" -eq 0 ]; then
    echo "pr hygiene audit selftest: all $pass cases caught"
else
    echo "pr hygiene audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
