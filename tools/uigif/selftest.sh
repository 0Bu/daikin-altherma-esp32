#!/usr/bin/env bash
# Does the GIF gate still catch a stale recording?
#
# This gate protects an artefact that CANNOT fail on its own — a recording renders perfectly
# forever, whatever the UI has since become. So the only thing standing between the README and a
# picture of last month's dashboard is this checker still reacting. A checker that has stopped
# reacting turns "clean" from evidence into a lie, and there would be no second symptom: the GIF
# would still look fine.
#
# Every case is re-created in a THROWAWAY COPY of the tree — the working tree is never touched.
#
# Usage: tools/uigif/selftest.sh
# Exit:  0 = every defect still caught, 1 = the gate has gone blind.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

command -v node >/dev/null 2>&1 || { echo "selftest: need node" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

# A copy holding only what the checker reads.
seed() {
    local d="$WORK/$1"; rm -rf "$d"
    mkdir -p "$d/main/www" "$d/tools/uigif" "$d/tools/ui" "$d/scripts" "$d/docs/media"
    cp "$ROOT"/main/www/{index.html,style.css,app.sources} "$d/main/www/"
    cp -R "$ROOT/main/www/js" "$d/main/www/js"
    cp "$ROOT"/tools/uigif/{check_ui_gif.mjs,scenes.js} "$d/tools/uigif/"
    cp "$ROOT/tools/ui/read_app_source.mjs" "$d/tools/ui/"
    cp "$ROOT/tools/uigif/gif_stamp.txt" "$d/tools/uigif/"
    cp "$ROOT"/scripts/{record-dashboard-gif.sh,run-ui-gif-audit.sh} "$d/scripts/"
    cp "$ROOT/docs/media/dashboard.gif" "$d/docs/media/"
    cp "$ROOT/README.md" "$d/"
    echo "$d"
}

# check <case> <expected-exit> <expected-code-or-"-"> <mutation…>
check() {
    local name=$1 want_exit=$2 want_code=$3; shift 3
    local d; d="$(seed "$name")"
    ( cd "$d" && "$@" )
    local out rc
    set +e
    out="$(cd "$d" && node tools/uigif/check_ui_gif.mjs 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne "$want_exit" ]; then
        printf '  ✗ %-28s exit %s, expected %s\n%s\n' "$name" "$rc" "$want_exit" "$out"; fails=$((fails + 1)); return
    fi
    if [ "$want_code" != "-" ] && ! grep -q "$want_code" <<<"$out"; then
        printf '  ✗ %-28s exit %s but no %s in:\n%s\n' "$name" "$rc" "$want_code" "$out"; fails=$((fails + 1)); return
    fi
    if [ "$want_code" = "-" ]; then
        printf '  ✓ %-28s %s\n' "$name" "$([ "$want_exit" = 0 ] && echo "still clean" || echo "exit $want_exit — refuses to check")"
    else
        printf '  ✓ %-28s %s\n' "$name" "$want_code"
    fi
}

echo "uigif selftest — the recording gate:"

# 0. The tree as it stands must PASS, or every case below proves nothing.
check "unchanged tree"        0 -    true

# 1. The defect the gate exists for: the drawing moves, the recording does not.
check "schematic markup moved" 1 U001 \
    perl -0pi -e 's/(<figure\b[^>]*\bid="schem")/$1 data-selftest="moved"/' main/www/index.html
check "schematic css changed"  1 U001 \
    perl -0pi -e 's/(svg \.sc-flow\.on \{[^}]*)/$1 stroke-width: 9px;/' main/www/style.css
check "pump direction changed"  1 U001 \
    perl -0pi -e 's/(@keyframes pump-spin[^}]*rotate\()360deg/${1}-360deg/' main/www/style.css
check "painting code changed"  1 U001 \
    perl -0pi -e 's/(function renderLive\(\) \{)/$1\n  \/\* selftest \*\//' main/www/js/schematic.js
check "scenes changed"         1 U001 \
    perl -0pi -e 's/(name: "Standby")/$1 \/* selftest *\//' tools/uigif/scenes.js
check "recorder framing changed" 1 U001 \
    perl -0pi -e 's/^WIDTH=900.*$/WIDTH=640/m' scripts/record-dashboard-gif.sh

# 2. The artefact swapped or edited outside the recorder.
check "gif replaced"           1 U002 \
    sh -c 'printf "\x00" >> docs/media/dashboard.gif'
check "gif deleted"            1 U003 rm docs/media/dashboard.gif
check "readme drops the gif"   1 U003 \
    perl -0pi -e 's/!\[[^\]]*\]\(docs\/media\/dashboard\.gif\)//' README.md

# 3. The point of the recording: MOTION. A still satisfies every other check on this page — it is a
#    valid GIF, of the right UI, linked from the README — so only the frame count can refuse it.
#    Written byte by byte rather than via ffmpeg: a case that silently tests something else when a
#    tool is missing is exactly the blindness this file exists to rule out.
check "gif is a single still"  1 U004 \
    node -e 'require("fs").writeFileSync("docs/media/dashboard.gif", Buffer.from(
        "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b", "hex"))'

# 4. No stamp at all is not a pass.
check "stamp missing"          1 U005 rm tools/uigif/gif_stamp.txt

# 5. The WRITE path. Every case above asks whether the check still reacts. This one asks the other
#    question, and it is the one that makes the gate safe to require on every merge: can the stamp
#    still be earned DISHONESTLY? Rewriting it over an unchanged recording is the single move that
#    turns this gate green while the README goes on showing the old drawing — the objection that
#    kept the audit out of CI in the first place. The writer refuses that shape; if this stops being
#    provable, "mandatory" is decoration.
#
# stamp_case <name> <want-exit> <want-needle|-> <same|written> [extra args…]
stamp_case() {
    local name=$1 want_exit=$2 want_needle=$3 want_stamp=$4; shift 4
    local d; d="$(seed "$name")"
    # The sources move; the recording deliberately does NOT. That is the whole shape being tested.
    ( cd "$d" && perl -0pi -e 's/(<figure\b[^>]*\bid="schem")/$1 data-selftest="moved"/' main/www/index.html )
    cp "$d/tools/uigif/gif_stamp.txt" "$d/stamp.before"
    local out rc
    set +e
    out="$(cd "$d" && node tools/uigif/check_ui_gif.mjs --write-stamp "$@" 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne "$want_exit" ]; then
        printf '  ✗ %-28s exit %s, expected %s\n%s\n' "$name" "$rc" "$want_exit" "$out"; fails=$((fails + 1)); return
    fi
    if [ "$want_needle" != "-" ] && ! grep -q "$want_needle" <<<"$out"; then
        printf '  ✗ %-28s exit %s but no "%s" in:\n%s\n' "$name" "$rc" "$want_needle" "$out"; fails=$((fails + 1)); return
    fi
    # A refusal that still wrote the file would be the worst of both: red on the console, a fresh
    # stamp on disk, and the next run green over the old recording.
    if [ "$want_stamp" = same ] && ! cmp -s "$d/stamp.before" "$d/tools/uigif/gif_stamp.txt"; then
        printf '  ✗ %-28s refused, but wrote the stamp anyway\n' "$name"; fails=$((fails + 1)); return
    fi
    if [ "$want_stamp" = written ] && cmp -s "$d/stamp.before" "$d/tools/uigif/gif_stamp.txt"; then
        printf '  ✗ %-28s allowed, but no stamp was written\n' "$name"; fails=$((fails + 1)); return
    fi
    printf '  ✓ %-28s %s\n' "$name" \
        "$([ "$want_stamp" = same ] && echo "refused — stamp untouched" || echo "allowed, but only said out loud")"
}

stamp_case "re-stamp over old recording" 2 "refusing to stamp" same
stamp_case "…unless declared explicitly"  0 -                  written --allow-identical-gif

# 6. Vacuity: if the checker can no longer FIND what it fingerprints, it must stop loudly (exit 2)
#    rather than fingerprint nothing and call the tree clean.
check "painting fn renamed"    2 -  \
    perl -0pi -e 's/function renderLive\(/function renderLiveXX(/' main/www/js/schematic.js
check "schematic css gone"     2 -  \
    perl -0pi -e 's/\.sc-flow/.zz-flow/g' main/www/style.css

# 7. The merge hook must not turn a human checkbox into an override for a red mechanical audit.
# CI alone is not the local merge boundary: the supported CLI merge path must itself reject a stale
# recording even when the PR body carries a current-SHA $ui-gif stamp. The clean direction remains
# conditional — an unrelated PR needs no stamp, while a
# PR carrying a new recording does.
hook_d="$(seed merge-hook)"
git -C "$hook_d" init -q
git -C "$hook_d" remote add origin https://github.com/0Bu/daikin-altherma-esp32.git
mkdir -p "$hook_d/tools/agent-hooks" "$hook_d/tools/agent-policy" "$hook_d/bin"
sed -e "s#^GH_BINARY_CANDIDATES=.*#GH_BINARY_CANDIDATES='$hook_d/bin/gh'#" \
  -e 's#^extra_child_env=()#extra_child_env=("UI_GIF_GATE_BODY=${UI_GIF_GATE_BODY:-}" "UI_GIF_GATE_FILES=${UI_GIF_GATE_FILES:-}")#' \
  "$ROOT/scripts/gh-with-git-credentials.sh" >"$hook_d/scripts/gh-with-git-credentials.sh"
cp "$ROOT/tools/agent-hooks/pr-gate-lib.sh" "$hook_d/tools/agent-hooks/"
cp "$ROOT/tools/agent-hooks/require-pr-gates.sh" "$hook_d/tools/agent-hooks/"
cp "$ROOT/tools/agent-hooks/merge_payload.py" "$hook_d/tools/agent-hooks/"
cp "$ROOT/tools/agent-hooks/run_with_timeout.py" "$hook_d/tools/agent-hooks/"
cp "$ROOT/tools/agent-policy/extract_changed_files.py" "$hook_d/tools/agent-policy/"
cat > "$hook_d/bin/gh" <<'EOF'
#!/usr/bin/env bash
[ "${GH_HOST:-}" = github.com ] || exit 95
[ "${GH_REPO:-}" = github.com/0Bu/daikin-altherma-esp32 ] || exit 96
case "$1 $2" in
  "repo view") printf '%s\n' '0Bu/daikin-altherma-esp32' ;;
  "pr view")
    python3 - <<'PY'
import json, os
print(json.dumps({
    "number": 468,
    "body": os.environ.get("UI_GIF_GATE_BODY", ""),
    "headRefOid": "abcdef1234567890abcdef1234567890abcdef12",
    "changedFiles": len(os.environ.get("UI_GIF_GATE_FILES", "docs/README.md").splitlines()),
}))
PY
    ;;
  "api --hostname")
    [ "${3:-}" = github.com ] || exit 97
    python3 - <<'PY'
import json, os
print(json.dumps([[{"filename": line} for line in
                   os.environ.get("UI_GIF_GATE_FILES", "docs/README.md").splitlines()]]))
PY
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$hook_d/bin/gh" "$hook_d/scripts/gh-with-git-credentials.sh" \
    "$hook_d/tools/agent-hooks/require-pr-gates.sh"

ui_gif_head=abcdef1234567890abcdef1234567890abcdef12
merge_input="$(python3 - "$hook_d" "$ui_gif_head" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "Bash", "tool_input": {
    "command": f"gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 468 --match-head-commit {sys.argv[2]} --squash"
}}))
PY
)"
mcp_merge_input="$(python3 - "$ui_gif_head" <<'PY'
import json, sys
print(json.dumps({"tool_name": "mcp__codex_apps__github_merge_pull_request", "tool_input": {
    "pr_number": 468,
    "repository_full_name": "0Bu/daikin-altherma-esp32",
    "expected_head_sha": sys.argv[1],
}}))
PY
)"
base_reviews="$(printf '%s\n' \
    "- [x] \`\$project-review\` clean - merge gate @ $ui_gif_head" \
    "- [x] \`\$domain-review\` clean - merge gate @ $ui_gif_head")"
review_stamp="$base_reviews
- [x] \`\$ui-gif\` clean - merge gate @ $ui_gif_head"

hook_run() {
    local input=$1; shift
    printf '%s' "$input" | env PATH="$hook_d/bin:$PATH" GH_TOKEN=uigif-hook-selftest-token \
        AGENT_PROJECT_DIR="$hook_d" "$@" \
        bash "$hook_d/tools/agent-hooks/require-pr-gates.sh" >/dev/null 2>&1
}

# Clean + unrelated: no UI-GIF review needed. Clean + new recording: refuse until stamped, then pass.
hook_run "$merge_input" env UI_GIF_GATE_FILES=docs/README.md UI_GIF_GATE_BODY="$base_reviews" || {
    echo "uigif selftest: clean unrelated PR was gated" >&2; exit 1; }
set +e
hook_run "$merge_input" env UI_GIF_GATE_FILES=docs/media/dashboard.gif UI_GIF_GATE_BODY="$base_reviews"
new_unstamped_rc=$?
set -e
[ "$new_unstamped_rc" -eq 2 ] || {
    echo "uigif selftest: a new unreviewed recording did not block merge" >&2; exit 1; }
hook_run "$merge_input" env UI_GIF_GATE_FILES=docs/media/dashboard.gif UI_GIF_GATE_BODY="$review_stamp" || {
    echo "uigif selftest: a current reviewed recording did not pass the merge hook" >&2; exit 1; }

# MCP merge remains unsupported and cannot become an alternate path around the exact CLI binding.
set +e
hook_run "$mcp_merge_input" env UI_GIF_GATE_FILES=docs/README.md UI_GIF_GATE_BODY="$review_stamp"
mcp_rc=$?
set -e
[ "$mcp_rc" -eq 2 ] || {
    echo "uigif selftest: unsupported MCP merge bypassed the CLI-only gate" >&2; exit 1; }

# Now make the source/GIF pair mechanically stale. The same valid human stamp must not override it,
# through the supported CLI merge entry point.
perl -0pi -e 's/(<figure\b[^>]*\bid="schem")/$1 data-selftest="stale-hook"/' "$hook_d/main/www/index.html"
set +e
hook_run "$merge_input" env UI_GIF_GATE_FILES=docs/README.md UI_GIF_GATE_BODY="$review_stamp"
stale_bash_rc=$?
set -e
[ "$stale_bash_rc" -eq 2 ] || {
    echo "uigif selftest: a current review stamp overrode a stale audit (cli=$stale_bash_rc)" >&2
    exit 1
}
printf '  ✓ %-28s %s\n' "stale merge with stamp" "blocked on CLI; MCP remains unsupported"

echo
if [ "$fails" -eq 0 ]; then echo "uigif selftest: all cases still caught"; exit 0; fi
echo "uigif selftest: $fails case(s) NOT caught — the gate has gone blind" >&2
exit 1
