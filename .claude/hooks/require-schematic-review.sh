#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* that touches the DASHBOARD SCHEMATIC until the schematic
# review has been run against the commit being merged.
#
# WHY A FOURTH GATE. The three siblings each ask a question that can be answered YES while the
# picture is false. require-project-review.sh asks whether the project is still consistent;
# require-feature-docs.sh whether the catalog is accurate; require-domain-review.sh whether a
# published value is physically TRUE. The drawing is the one artefact where all three pass and the
# reader is still misinformed: the value is right, there is copy for it, the build is green — and it
# is drawn on the wrong pipe. This drawing has shipped a fan spinning about a point beside its own
# axle, the leaving-water pill floating 40 px off the run it names, the return temperature on the
# heating-only section (a branch R4T does not read), and "HEIZUNG" struck through so it rendered
# "HEIZUNC". Each is the #35-#39 shape drawn in SVG: well-formed, plausible, and attributing a real
# number to the wrong thing.
#
# WHY THE MECHANICAL AUDIT IS NOT ENOUGH. scripts/run-schematic-audit.sh already runs as a CI
# `gates` step on every PR, so placement and reachability are checked without anyone deciding to.
# But the audit says so itself: it gates placement, NOT truth. Whether the drawing is still true of
# the plant, whether a new part sits where the manufacturer puts it, whether the German copy says
# what the English does — none of that is mechanically decidable, and the audit stays deliberately
# quiet rather than guessing. That silence is the hole this gate closes.
#
# This is CONDITIONAL, like require-feature-docs.sh and unlike the other two. THE REGEX AT THE
# BOTTOM OF THIS FILE IS THE ONLY DEFINITION of what counts — the docs that mention this gate
# characterise it and point here rather than repeating the list, because a filter restated in four
# places is a filter that will disagree with itself (this repo has now fixed that exact drift twice
# in one day). Relevance = the PR changed the drawing, its contract, or the tools that judge it:
#   main/www/                      the SVG, its CSS, and the INSPECT/I18N/liveData/paintSchematic
#                                  half of app.js
#   docs/DESIGN.md                 §5.3/§7 ARE the drawing's specification, so an edit there changes
#                                  what "correct" MEANS — the strongest reason to re-review
#   tools/schematic/               the mechanical audit and its adjudication ledger
#   .claude/skills/schematic-review/   the CHECKLIST itself. Same argument the repo already makes one
#                                  level down ("touching the audit means running selftest.sh"):
#                                  changing what the review asks is only safe once the new questions
#                                  have been put to the current drawing. It also makes the gate
#                                  self-gating, which is the honest test of a gate.
#
# The filter is defensible here in a way it was NOT for domain-review, and the difference is worth
# stating because the same reasoning was explicitly rejected there. A value's MEANING can change
# from almost anywhere — #35-#39 reached Home Assistant through the ordinary discovery path — so no
# regex can safely opt a PR out of that question. The drawing cannot: it is one inline SVG in one
# file, with one stylesheet and one binding table, all under the paths above. A PR that edits none
# of them cannot move a pill, a pipe or a caption. If that ever stops being true — a schematic
# fragment moved elsewhere, a binding table split out — this filter must grow with it, or it will
# quietly opt exactly those PRs out.
#
# Same two merge paths and the same record mechanism as its siblings: run /schematic-review, then
# tick + SHA-stamp its box in the PR body:
#     - [x] `/schematic-review` clean — merge gate @ <short-sha>
# Allowed only while checked AND stamped with the PR head, so any later commit forces a fresh
# review. The shared flow is pr-gate-lib.sh -> gate_enforce; this script names the gate + its filter.
#
# Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

gate_enforce "schematic-review" "/schematic-review" "schematic review" \
  '^(main/www/|docs/DESIGN\.md$|tools/schematic/|\.claude/skills/schematic-review/)'
exit $?
