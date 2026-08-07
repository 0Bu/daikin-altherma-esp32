#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* that touches an OPTIONAL SOURCE until the absence review has
# been run against the commit being merged.
#
# WHY ANOTHER GATE. Each sibling asks a question that can be answered YES while a board with a
# missing third-party system is misinformed. require-project-review.sh asks whether the project is
# consistent; require-domain-review.sh whether a published value is physically TRUE;
# require-schematic-review.sh whether the drawing puts it in the right place;
# require-ui-use-case-review.sh whether every visible action works. All four are answered about a
# device where everything is configured and answering. This one is about the other states.
#
# Every source here except the board is optional — the MQTT broker, the MQTT room source, the MQTT
# circulation witness, the HomeHub, ENV III, the Open-Meteo location, the X10A bus — and safe mode
# removes all of them at once. That is a CROSS PRODUCT, and it is where this project has repeatedly
# shipped defects with every gate green: the board's own heap trends stopped recording because the
# X10A bus did not answer (an unrelated feature dying with a different subsystem); the heating-curve
# card told a reader to set up the room source they had configured; the circulation row answered a
# cleared broker with "waiting", forever, with no cause; an unconfigured witness was offered an empty
# 24-hour chart; and ?redact=1 invented identifiers for sources the device did not have.
#
# WHY THE DETERMINISTIC MATRIX IS NOT ENOUGH. test_source_absence_contract.mjs and
# test_ui_absence_matrix.mjs run in CI on every PR (via the two globs), so the states they KNOW are
# checked without anyone deciding to. They cannot decide whether a NEW source is in the matrix,
# whether an absence is honest rather than merely non-crashing, whether removing one source quietly
# removed another, or whether the German and the English name the same blocker. That judgement is
# what this gate buys.
#
# This is CONDITIONAL, like require-feature-docs.sh and require-schematic-review.sh. THE REGEX AT
# THE BOTTOM OF THIS FILE IS THE ONLY DEFINITION of what counts; the docs characterise it and point
# here rather than repeating it, because a filter restated in several places will disagree with
# itself. Relevance = the PR touched a source's lifecycle, a surface that reports one, or the tools
# that judge the pair:
#   main/http_status.cpp        /status + /values: where every source states whether it exists
#   main/http_config.cpp        the /set_* routes: where a source is created and DELETED
#   main/history.cpp            the rings, i.e. which trends are offered and who owns them
#   main/mqtt_ha.cpp            subscriptions, retained-topic cleanup, discovery retraction
#   main/hp_modbus.cpp          the HomeHub stack's own start/retire
#   main/env3.cpp               the ENV III accessory's start/retire
#   main/weather_forecast.cpp   the Open-Meteo client's enabled/disabled states
#   main/hp_poll.cpp            the X10A owner — and the branch that skipped the board trends
#   main/safe_mode.cpp          the state that removes every optional consumer at once
#   main/main.cpp               where each optional consumer is (or is not) started
#   main/logic/redact.hpp       what a report says about a source that does not exist
#   main/logic/heating_curve_diagnosis.hpp   arming vs running, the two that drifted apart
#   main/www/js/               every card that renders a source's condition
#   test/test_ui_absence_matrix.mjs, test/test_source_absence_contract.mjs, tools/absence/
#                              the matrix itself and its selftest
#   .claude/skills/absence-review/   the CHECKLIST, so the gate is self-gating — changing what the
#                              review ASKS is only safe once the new questions have been put to the
#                              current firmware
#
# The filter is defensible here in the way it is NOT for domain-review, and the difference is worth
# stating because that reasoning was explicitly rejected there. A value's MEANING can change from
# almost anywhere, so no regex can safely opt a PR out of that question. A SOURCE's lifecycle cannot:
# it is created in one route, torn down in one place, reported in one builder and rendered in one
# card family, all under the paths above. A PR that edits none of them cannot change what happens
# when a source goes away. If that stops being true — a new optional source living somewhere else —
# this filter must grow with it, or it will quietly opt exactly those PRs out.
#
# Same two merge paths and the same record mechanism as its siblings: run /absence-review, then tick
# + SHA-stamp its box in the PR body:
#     - [x] `/absence-review` clean — merge gate @ <short-sha>
# Allowed only while checked AND stamped with the PR head, so any later commit forces a fresh review.
#
# Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

input="$(cat 2>/dev/null)"

printf '%s' "$input" | gate_enforce "absence-review" "/absence-review" "source-absence review" \
  '^(main/(http_status|http_config|history|mqtt_ha|hp_modbus|hp_poll|env3|weather_forecast|safe_mode|main)\.cpp$|main/logic/(redact|heating_curve_diagnosis|circulation_source|history|env3)\.hpp$|main/www/js/|test/test_(ui_absence_matrix|source_absence_contract)\.mjs$|tools/absence/|\.claude/skills/absence-review/)'
rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

# gate_enforce returns 0 for ordinary Bash calls too. Run the expensive part only for an actual PR
# merge; the matcher invokes this script for every Bash command, so the distinction is essential.
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)"
is_merge=false
case "$tool" in
  mcp__github__merge_pull_request|mcp__codex_apps__github_merge_pull_request) is_merge=true ;;
  Bash)
    norm="$(printf '%s' "$cmd" | sed -E 's/^[[:space:]]+//; s/^cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*//')"
    printf '%s' "$norm" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' && is_merge=true
    ;;
esac
[ "$is_merge" = true ] || exit 0

# The selftest, not the matrix: CI already runs both halves of the matrix on every PR through the two
# globs, so re-running them here would buy a slower merge and nothing else. What CI does NOT run is
# the proof that the matrix can still go red — and both halves are assertions about text, where a
# check that has stopped matching reports success. That is the one thing worth spending merge time on.
if ! "$proj/tools/absence/selftest.sh" >/dev/null 2>&1; then
  {
    echo "BLOCKED: the source-absence matrix no longer catches a defect it was built for."
    echo
    "$proj/tools/absence/selftest.sh" 2>&1 | sed 's/^/    /'
    echo
    echo "Both halves of this matrix assert over TEXT, so a check that has stopped matching the code"
    echo "it describes goes GREEN. Fix the check, then re-run /absence-review and re-stamp the PR."
  } >&2
  exit 2
fi

exit 0
