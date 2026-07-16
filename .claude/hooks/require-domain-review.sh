#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* until the DOMAIN-CORRECTNESS review has been run against
# the commit being merged.
#
# WHY A THIRD GATE. The two existing gates ask engineering questions: require-project-review.sh asks
# "is the project still consistent?" and require-feature-docs.sh asks "is the feature catalog still
# accurate?". Neither can answer "is this value physically TRUE?" — and that is the question this
# firmware keeps getting wrong. A wrong converter compiles, passes every host test, drifts no docs,
# and publishes -971.5 °C to Home Assistant as a mixed-water temperature. Eight profiles shipped
# exactly that; a bizone valve POSITION shipped as a 12800 °C temperature sensor; a "no data"
# sentinel shipped as a real -3276.8 °C reading (issues #35-#39). Every one was found by a slow
# manual review, none by a gate. This gate closes that hole.
#
# This is UNCONDITIONAL — every PR merge needs a current domain-correctness review, exactly like
# the sibling require-project-review.sh. (Only require-feature-docs.sh is CONDITIONAL.)
#
# It was briefly scoped to a "value surface" file list (main/def/, the converter/register/discovery/
# detect logic, docs/REGISTERS.md, the generators, test/test_logic.cpp). That filter was a GUESS at
# which files can change what a published value MEANS — and a gate that decides for you whether it
# applies can be wrong in exactly the way this gate exists to catch. #35-#39 shipped precisely
# because everyone assumed the risk was elsewhere: a valve position reached Home Assistant as a
# 12800 °C temperature sensor through the ordinary discovery path, not through anything that
# announced itself as risky. A path the regex forgot would silently opt a PR out of the only check
# that asks "is this value TRUE?". So the judgement is made by a person, against the actual diff,
# every time — and "nothing here can change a value's meaning" becomes a finding someone states,
# not an assumption a regex makes for them.
#
# A PR with no value surface is cheap to clear, not a formality: /domain-review runs the audit in
# seconds and the reviewer confirms the diff cannot change what any value means. See the skill.
#
# Same two merge paths and the same record mechanism as its siblings: run /domain-review, then tick
# + SHA-stamp its box in the PR body:
#     - [x] `/domain-review` clean — merge gate @ <short-sha>
# Allowed only while checked AND stamped with the PR head, so any later commit forces a fresh
# review. The shared flow is pr-gate-lib.sh -> gate_enforce; this script just names the gate
# (no relevance filter -> gate_enforce applies it to every merge).
#
# Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

gate_enforce "domain-review" "/domain-review" "domain-correctness review"
exit $?
