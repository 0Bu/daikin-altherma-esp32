#!/usr/bin/env bash
# Does the skill-audit gate still catch the defects it was built for?
#
# The audit's whole value is that it fires on stale partition offsets, broken markdown links,
# wrong board pins, missing baseline pinning contracts, missing self-analysis sections,
# unknown HTTP endpoints, uncataloged/stale skills and reviewers, or drifted reviewer configs.
# It also verifies that self-optimization (--optimize) cleanly reconciles drifted checklists
# and partition facts.
#
# Usage: tools/skill_audit/selftest.sh    Exit: 0 = all cases caught, 1 = a case slipped through.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
cases=0

new_fixture() {
    rm -rf "$TMP/t"
    mkdir -p "$TMP/t"
    # Symlink read-only sources; copy every surface that a canary may mutate.
    ln -s "$ROOT/scripts" "$TMP/t/scripts"
    ln -s "$ROOT/tools" "$TMP/t/tools"
    ln -s "$ROOT/docs" "$TMP/t/docs"
    ln -s "$ROOT/main" "$TMP/t/main"
    ln -s "$ROOT/test" "$TMP/t/test"
    ln -s "$ROOT/AGENTS.md" "$TMP/t/AGENTS.md"
    ln -s "$ROOT/CONTRIBUTING.md" "$TMP/t/CONTRIBUTING.md"
    ln -s "$ROOT/.githooks" "$TMP/t/.githooks"
    ln -s "$ROOT/.github" "$TMP/t/.github"
    ln -s "$ROOT/sdkconfig.defaults" "$TMP/t/sdkconfig.defaults"
    cp "$ROOT/partitions.csv" "$TMP/t/partitions.csv"
    mkdir -p "$TMP/t/.agents"
    [ -f "$ROOT/.agents/hooks.json" ] && cp "$ROOT/.agents/hooks.json" "$TMP/t/.agents/"
    cp -R "$ROOT/.agents/skills" "$TMP/t/.agents/"
    cp -R "$ROOT/.agents/agents" "$TMP/t/.agents/"

}

fixture_checksums() {
    rg --files --hidden "$TMP/t/.agents" | LC_ALL=C sort | while IFS= read -r fixture_file; do
        cksum "$fixture_file"
    done
}

run_case() {
    local name="$1" setup_cmd="$2" expect_text="$3" expected_rc="${4:-1}" mode="${5:-}"
    cases=$((cases + 1))
    new_fixture

    # Execute defect injection
    (cd "$TMP/t" && eval "$setup_cmd")

    local out rc before after
    local -a args=(--repo-root "$TMP/t")
    [ -z "$mode" ] || args+=("$mode")
    before="$(fixture_checksums)"
    set +e
    out="$(node "$ROOT/tools/skill_audit/check_skills.mjs" "${args[@]}" 2>&1)"
    rc=$?
    set -e
    after="$(fixture_checksums)"
    if [ -z "$mode" ] && [ "$before" != "$after" ]; then
        printf '  FAIL  %s  (read-only audit mutated its inputs)\n' "$name"
        fail=1
        return
    fi
    if [ "$rc" -eq "$expected_rc" ] && printf '%s' "$out" | grep -qF "$expect_text"; then
        printf '  PASS  %s\n' "$name"
    else
        printf '  FAIL  %s  (exit %d, expected %d with pattern "%s")\n%s\n' "$name" "$rc" "$expected_rc" "$expect_text" "$out"
        fail=1
    fi
}

run_optimize_case() {
    local name="$1" setup_cmd="$2" expected_content="${3:-}"
    cases=$((cases + 1))
    new_fixture

    # Execute drift injection
    (cd "$TMP/t" && eval "$setup_cmd")

    local out rc
    set +e
    out="$(node "$ROOT/tools/skill_audit/check_skills.mjs" --repo-root "$TMP/t" --optimize 2>&1)"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
        printf '  FAIL  %s  (--optimize exited %d, expected 0)\n%s\n' "$name" "$rc" "$out"
        fail=1
        return
    fi

    if [ -n "$expected_content" ] && ! rg -qF "$expected_content" "$TMP/t/.agents/skills/absence-review/SKILL.md"; then
        printf '  FAIL  %s  (optimization changed unrelated content)\n' "$name"
        fail=1
        return
    fi

    # Verify that subsequent check_skills.mjs passes cleanly with 0
    set +e
    out="$(node "$ROOT/tools/skill_audit/check_skills.mjs" --repo-root "$TMP/t" 2>&1)"
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
        printf '  PASS  %s\n' "$name"
    else
        printf '  FAIL  %s  (verification after optimize exited %d, expected 0)\n%s\n' "$name" "$rc" "$out"
        fail=1
    fi
}

echo "skill-audit selftest — re-seeding defects to prove gate has teeth"

# 1. Wrong partition offset in a skill
run_case "wrong nvs partition offset" \
    "sed -i.bak 's|nvs@0x9000|nvs@0x10000|g' .agents/skills/flash-esp32/SKILL.md" \
    "wrong nvs offset"

# 2. Broken relative markdown link in a skill
run_case "broken relative markdown link" \
    "echo '[broken link](../../../nonexistent_file.md)' >> .agents/skills/absence-review/SKILL.md" \
    "broken relative link"

# 3. Wrong XIAO board pin assignment
run_case "wrong board pin assignment" \
    "sed -i.bak 's|RX=44|RX=99|g' .agents/skills/skill-audit/SKILL.md" \
    "XIAO ESP32-S3 pin assignment must cite RX=44/TX=43"

# 4. Missing baseline pinning contract in a review skill
run_case "missing baseline pinning contract in review skill" \
    "sed -i.bak '/pin the baseline/d' .agents/skills/project-review/SKILL.md" \
    "review skill missing baseline pinning contract"

# 5. Missing self-analysis section
run_case "missing self-analysis section" \
    "sed -i.bak '/Self-analysis/d' .agents/skills/add-logic-test/SKILL.md" \
    "skill missing 'Self-analysis and review audit'"

# 6. Invalid YAML frontmatter
run_case "mismatched frontmatter name" \
    "sed -i.bak 's|name: deploy-prod|name: wrong-name|g' .agents/skills/deploy-prod/SKILL.md" \
    "frontmatter name 'wrong-name' does not match directory 'deploy-prod'"

# 7. Non-read-only reviewer agent configuration
run_case "reviewer agent non-read-only sandbox mode" \
    "sed -i.bak 's|sandbox_mode = \"read-only\"|sandbox_mode = \"read-write\"|g' .agents/agents/heap-safety-reviewer.toml" \
    "sandbox_mode must be 'read-only'"

# 8. Dynamic partition offset discovery from partitions.csv
run_case "dynamic partition offset discovery" \
    "sed -i.bak 's|coredump,  data, coredump, 0x12000|coredump,  data, coredump, 0x14000|g' partitions.csv" \
    "wrong coredump offset 'coredump@0x12000' (expected coredump@0x14000)"

# 9. Dynamic HTTP endpoint checking
run_case "unknown HTTP endpoint in skill" \
    "echo 'Verify endpoints \`/nonexistent_route\`.' >> .agents/skills/device-triage/SKILL.md" \
    "unknown or removed HTTP endpoint '/nonexistent_route'"

# 10. Dynamic skill discovery & self-audit (missing from skill-audit checklist)
run_case "new skill missing from skill-audit checklist" \
    "mkdir -p .agents/skills/mock-new-skill && printf -- '---\nname: mock-new-skill\ndescription: Mock new skill.\n---\n## Mock\nBody text.\n## Self-analysis and review audit\nSelf-analysis text.\n' > .agents/skills/mock-new-skill/SKILL.md" \
    "Per-target checklist missing discovered skill(s): mock-new-skill"

# 11. Stale skill in skill-audit checklist
run_case "stale skill in skill-audit checklist" \
    "rm -rf .agents/skills/ui-gif" \
    "Per-target checklist contains non-existent skill(s): ui-gif"

# 12. Self-optimization --optimize synchronizes checklist and passes cleanly
run_optimize_case "self-optimization adds new skill to checklist and passes cleanly" \
    "mkdir -p .agents/skills/auto-sync-skill && printf -- '---\nname: auto-sync-skill\ndescription: Auto synchronized test skill.\n---\n## Instructions\nPure logic test.\n## Self-analysis and review audit\nSelf-analysis text.\n' > .agents/skills/auto-sync-skill/SKILL.md"

# 13. Self-optimization --optimize corrects partition offset drift and passes cleanly
run_optimize_case "self-optimization corrects partition offset drift and passes cleanly" \
    "sed -i.bak 's|nvs@0x9000|nvs@0x10000|g' .agents/skills/flash-esp32/SKILL.md"

# 14. Unknown partition in a skill
run_case "unknown partition in a skill" \
    "sed -i.bak 's|nvs@0x9000|unknown_part@0x9000|g' .agents/skills/flash-esp32/SKILL.md" \
    "unknown partition 'unknown_part@0x9000'"

# 15. Multiple HTTP endpoints on one line
run_case "multiple HTTP endpoints on one line" \
    "echo 'Verify endpoints \`/status\`, \`/fake_route_two\`.' >> .agents/skills/device-triage/SKILL.md" \
    "unknown or removed HTTP endpoint '/fake_route_two'"

# 16. Dynamic HTTP endpoint checking with file extension .html
run_case "unknown HTTP endpoint with .html extension" \
    "echo 'Verify endpoint \`/fake.html\`.' >> .agents/skills/device-triage/SKILL.md" \
    "unknown or removed HTTP endpoint '/fake.html'"

# 17. Broken repository file reference in backticks
run_case "broken repository file reference in backticks" \
    "echo 'Check \`main/logic/nonexistent_header.hpp\`.' >> .agents/skills/absence-review/SKILL.md" \
    "referenced repository file does not exist: main/logic/nonexistent_header.hpp"

# 18. Stale partition offset examples in skill-audit line 31
run_case "stale partition offset examples in skill-audit" \
    "sed -i.bak 's|coredump@0x12000|coredump@0x99999|g' .agents/skills/skill-audit/SKILL.md" \
    "partition offset examples in line 31 are out of sync with partitions.csv"

# 19. Self-optimization prunes removed skill from checklist and passes cleanly
run_optimize_case "self-optimization prunes removed skill from checklist and passes cleanly" \
    "rm -rf .agents/skills/ui-gif"

# 20. Self-optimization synchronizes partition offset examples in skill-audit
run_optimize_case "self-optimization synchronizes partition offset examples in skill-audit" \
    "sed -i.bak 's|coredump,  data, coredump, 0x12000|coredump,  data, coredump, 0x14000|g' partitions.csv"

# Correct only each partition claim, preserving valid claims and unrelated identical numbers.
run_optimize_case "partition phrase fixes preserve other offsets and numeric literals" \
    "echo 'NVS at 0x12000; preserve coredump@0x12000 and mask 0x12000; history offset 0xf000; preserve otadata@0xf000.' >> .agents/skills/absence-review/SKILL.md" \
    "NVS at 0x9000; preserve coredump@0x12000 and mask 0x12000; history offset 0x400000; preserve otadata@0xf000."

run_case "swapped board pins cannot satisfy each other" \
    "sed -i.bak 's|XIAO ESP32-S3 RX=44/TX=43, M5Stack AtomS3 Lite RX=1/TX=2|XIAO ESP32-S3 RX=1/TX=2, M5Stack AtomS3 Lite RX=44/TX=43|' .agents/skills/skill-audit/SKILL.md" \
    "XIAO ESP32-S3 pin assignment must cite RX=44/TX=43"

run_case "a correct board claim does not hide a conflicting claim" \
    "echo 'XIAO ESP32-S3 RX=1/TX=2.' >> .agents/skills/skill-audit/SKILL.md" \
    "XIAO ESP32-S3 pin assignment must cite RX=44/TX=43"

run_case "wrapped and reversed board pin pairs remain valid" \
    "printf '\nXIAO ESP32-S3:\nTX=43/RX=44.\nAtomS3 Lite: TX=2/RX=1.\n' >> .agents/skills/absence-review/SKILL.md" \
    "18 skills and 3 reviewer agents clean" 0

run_case "nested reviewer file references are checked" \
    "sed -i.bak 's|main/logic/convert.hpp|main/logic/nonexistent.hpp|' .agents/agents/x10a-decode-reviewer.toml" \
    "referenced file does not exist: main/logic/nonexistent.hpp"

run_case "missing canonical reviewer directory fails closed" \
    "rm -rf .agents/agents" \
    "reviewer directory missing" 2

run_case "optimization cannot prune a missing reviewer inventory" \
    "rm -rf .agents/agents" \
    "reviewer directory missing" 2 --optimize

run_case "empty canonical reviewer directory fails closed" \
    "rm .agents/agents/*.toml" \
    "reviewer inventory is empty" 2

run_case "malformed YAML collection is rejected" \
    "sed -i.bak 's|^description:|description: [|' .agents/skills/absence-review/SKILL.md" \
    "invalid restricted YAML string for frontmatter description"

run_case "duplicate YAML key is rejected" \
    "sed -i.bak 's|^name: absence-review|name: absence-review\nname: absence-review|' .agents/skills/absence-review/SKILL.md" \
    "duplicate frontmatter key: name"

run_case "quoted YAML strings are accepted" \
    "sed -i.bak 's|^name: absence-review|name: \"absence-review\"|' .agents/skills/absence-review/SKILL.md" \
    "18 skills and 3 reviewer agents clean" 0

run_case "optimization verifies final content when repair is unavailable" \
    "sed -i.bak '/^- a \*\*wrong number\*\*/d' .agents/skills/skill-audit/SKILL.md" \
    "final read-only verification after optimization failed" 1 --optimize

if [ "$fail" -eq 0 ]; then
    echo "selftest ok: all $cases canaries and self-optimization cases verified."
else
    echo "selftest FAILED — skill-audit no longer catches a defect it was built for." >&2
fi
exit "$fail"
