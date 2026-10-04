#!/usr/bin/env bash
# Does the doc entity-id audit still catch the defects it was built for?
#
# The audit's whole value is that it fires on an id no device publishes. A checker that has quietly
# stopped resolving anything reports "clean" just as loudly as a correct one — and this one runs
# against DOCS, where nobody would notice it had gone blind. So re-seed each historical defect into a
# throwaway copy of the tree and require a non-zero exit.
#
# Every case here is a REAL defect that shipped, not an invented one:
#   1. `flow_rate_lmin`                      — a slug that was never valid ("l/min" -> `l_min`)
#   2. `return_water_temp_before_phe_r4t`    — a real label, but only on def/altherma3_r_erga.hpp,
#                                              the host-test fixture is_detection_model() refuses
#   3. a plain typo in an otherwise-correct id
# Both 1 and 2 shipped in the heat-meter recipe from legacy-206 until 2026-07-29. Case 2 is the one that
# matters most: it is the reason the audit resolves against DETECTABLE profiles only, and a version
# that scanned the whole registry would call it clean.
#
# Usage: tools/docs/selftest.sh    Exit: 0 = all cases caught, 1 = a case slipped through.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/t"
# Copy only what the audit reads + compiles against.
cp -R "$ROOT/main" "$ROOT/tools" "$ROOT/scripts" "$ROOT/docs" "$TMP/t/"
cp "$ROOT/README.md" "$TMP/t/"
cp "$ROOT/docs/HOME_ASSISTANT.md" "$TMP/HOME_ASSISTANT.md.pristine"

# A mutation can prove detection only after the pristine tree passes. Build its binary once, then
# explicitly reuse it for document-only changes in this same throwaway tree.
if ! (cd "$TMP/t" && scripts/run-doc-entity-audit.sh >"$TMP/pristine.log" 2>&1); then
    echo "doc entity-id selftest: the audit is not green on the pristine tree" >&2
    cat "$TMP/pristine.log" >&2
    exit 1
fi
AUDIT_BINARY="$TMP/t/build_mock/entity_id_audit"

fail=0
run_case() {   # run_case <name> <expected-id> <sed-expression>; `grep -c '^run_case '` = the case count (anchored:
               # the bare word matches this definition line and the comments about it too)
    local name="$1" expected_id="$2" expr="$3"
    cp "$TMP/HOME_ASSISTANT.md.pristine" "$TMP/t/docs/HOME_ASSISTANT.md"
    sed -i.bak "$expr" "$TMP/t/docs/HOME_ASSISTANT.md" && rm -f "$TMP/t/docs/HOME_ASSISTANT.md.bak"
    if cmp -s "$TMP/HOME_ASSISTANT.md.pristine" "$TMP/t/docs/HOME_ASSISTANT.md"; then
        printf '  FAIL  %s  (mutation changed nothing)\n' "$name"
        fail=1
        return
    fi
    local out rc reported_ids
    set +e
    out="$(cd "$TMP/t" && scripts/run-doc-entity-audit.sh --binary "$AUDIT_BINARY" 2>&1)"
    rc=$?
    set -e
    reported_ids="$(sed -n 's/^  \[E-ID\] docs\/HOME_ASSISTANT\.md:[0-9][0-9]*  //p' <<<"$out")"
    if [ "$rc" -eq 1 ] && grep -Fxq "$expected_id" <<<"$reported_ids"; then
        printf '  PASS  %s\n' "$name"
    else
        printf '  FAIL  %s  (exit %d, expected 1 with E-ID for %s)\n%s\n' \
            "$name" "$rc" "$expected_id" "$out"
        fail=1
    fi
    cp "$TMP/HOME_ASSISTANT.md.pristine" "$TMP/t/docs/HOME_ASSISTANT.md"
}

echo "doc entity-id audit selftest — re-seeding each historical defect"

# 1. The slug that was never valid: ha_slug("(l/min)") yields `l_min`, never `lmin`.
run_case "invalid slug (flow_rate_lmin)" \
    'sensor.daikin_altherma_flow_rate_lmin' \
    's|sensor\.daikin_altherma_flow_sensor_l_min|sensor.daikin_altherma_flow_rate_lmin|g'

# 2. A real label that lives ONLY on the undetectable host-test fixture. The audit must reject it;
#    resolving against the whole registry instead of detectable profiles would accept it.
run_case "id only on the test fixture (return_water_temp_before_phe_r4t)" \
    'sensor.daikin_altherma_return_water_temp_before_phe_r4t' \
    's|sensor\.daikin_altherma_inlet_water_temp_r4t|sensor.daikin_altherma_return_water_temp_before_phe_r4t|g'

# 3. An ordinary typo in an id that is otherwise correct — the commonest way this breaks.
run_case "typo in a valid id" \
    'sensor.daikin_altherma_leaving_water_temp_after_buh_r2x' \
    's|sensor\.daikin_altherma_leaving_water_temp_after_buh_r2t|sensor.daikin_altherma_leaving_water_temp_after_buh_r2x|g'

if [ "$fail" -eq 0 ]; then
    echo "selftest ok: $(grep -c '^run_case ' "$ROOT/tools/docs/selftest.sh") re-introduced defects caught."
else
    echo "selftest FAILED — the audit no longer catches a defect it was built for." >&2
fi
exit "$fail"
