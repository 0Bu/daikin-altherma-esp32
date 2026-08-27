#!/usr/bin/env bash
# Mutation-style checks: every portable formatting rule must reject its own seeded defect.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHECK="$PWD/tools/format/check_format.py"
STYLE_CHECK="$PWD/tools/format/check_style_config.py"
RUNNER="$PWD/scripts/run-format-check.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/daikin-format-selftest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/main/def" "$TMP/main/logic" "$TMP/test" "$TMP/tools/audit"
pass=0
fail=0

check_status() {
    local name="$1" expected="$2" actual="$3"
    if [ "$actual" -eq "$expected" ]; then
        pass=$((pass + 1))
    else
        echo "FAIL: $name (expected $expected, got $actual)" >&2
        fail=$((fail + 1))
    fi
}

run_check() {
    python3 "$CHECK" --root "$TMP" "$@" >/dev/null 2>&1
}

seed_good() {
    printf '%s\n' '#pragma once' 'inline int answer() { return 42; }' >"$TMP/main/logic/good.hpp"
    printf '%s\n' 'int main() { return 0; }' >"$TMP/test/good.cpp"
    printf '%s\n' 'int audit() { return 0; }' >"$TMP/tools/audit/good.cpp"
}

set +e
python3 "$STYLE_CHECK" "$PWD/.clang-format" >/dev/null 2>&1
check_status "the reviewed repository style authority passes" 0 "$?"

cp "$PWD/.clang-format" "$TMP/.clang-format"
printf '%s\n' 'DisableFormat: true' >>"$TMP/.clang-format"
python3 "$STYLE_CHECK" "$TMP/.clang-format" >/dev/null 2>&1
check_status "a formatter-disabling repository style mutation fails closed" 1 "$?"

seed_good
run_check
check_status "clean sources pass" 0 "$?"

printf 'inline int bad() {\treturn 1; }\n' >"$TMP/main/logic/good.hpp"
run_check
check_status "a tab fails" 1 "$?"

seed_good
printf 'inline int bad() { return 1; } \n' >"$TMP/main/logic/good.hpp"
run_check
check_status "trailing whitespace fails" 1 "$?"

seed_good
printf 'inline int bad() { return 1; }\r\n' >"$TMP/main/logic/good.hpp"
run_check
check_status "CRLF fails" 1 "$?"

seed_good
printf '%s' 'inline int bad() { return 1; }' >"$TMP/main/logic/good.hpp"
run_check
check_status "a missing final newline fails" 1 "$?"

seed_good
printf 'inline int bad() { return 1; }\n\n' >"$TMP/main/logic/good.hpp"
run_check
check_status "a duplicate final newline fails" 1 "$?"

seed_good
printf '\377\n' >"$TMP/main/logic/good.hpp"
run_check
check_status "invalid UTF-8 fails" 1 "$?"

seed_good
printf 'generated\tcontent \r\n' >"$TMP/main/def/generated.hpp"
run_check
check_status "generated definitions stay out of the first-party format gate" 0 "$?"

seed_good
printf 'int audit() {\treturn 1; }\n' >"$TMP/tools/audit/good.cpp"
run_check
check_status "first-party C++ tooling is inside the format gate" 1 "$?"

seed_good
printf '%s\n' 'int       badly_formatted( ){return(  1 );}' >"$TMP/main/logic/good.hpp"
run_check
check_status "bad C++ token spacing fails without an external formatter" 1 "$?"

seed_good
printf '%s\n' 'const char* sample = "return("; // if(' >"$TMP/main/logic/good.hpp"
run_check
check_status "format tokens inside strings and comments are ignored" 0 "$?"

seed_good
printf '%s\n' '#!/usr/bin/env bash' \
    'if [ "$1" = --version ]; then echo "Ubuntu clang-format version 18.1.3 (1ubuntu1)"; exit 0; fi' \
    'test "$1" = --dry-run && test "$2" = --Werror && test "$3" = --style=file' \
    >"$TMP/fake-clang-format"
chmod 0755 "$TMP/fake-clang-format"
run_check --clang-format "$TMP/fake-clang-format" --clang-format-version 18.1.3
check_status "the pinned read-only clang-format adapter receives dry-run flags" 0 "$?"

printf '%s\n' '#!/usr/bin/env bash' \
    'if [ "$1" = --version ]; then echo "Ubuntu clang-format version 18.1.3 (1ubuntu1)"; exit 0; fi' \
    'exit 1' >"$TMP/failing-clang-format"
chmod 0755 "$TMP/failing-clang-format"
run_check --clang-format "$TMP/failing-clang-format" --clang-format-version 18.1.3
check_status "clang-format style drift fails the gate" 1 "$?"

printf '%s\n' '#!/usr/bin/env bash' \
    'echo "Ubuntu clang-format version 17.0.6"' >"$TMP/wrong-clang-format"
chmod 0755 "$TMP/wrong-clang-format"
run_check --clang-format "$TMP/wrong-clang-format" --clang-format-version 18.1.3
check_status "an unpinned clang-format release fails closed" 2 "$?"

CI=true env -u CLANG_FORMAT "$RUNNER" tools/fuzz/logic_property_tests.cpp >/dev/null 2>&1
check_status "the CI runner fails closed without its pinned formatter" 2 "$?"

seed_good
printf '%s\n' '#pragma once' 'int       legacy_style( ) { return (  1 ); }' \
    >"$TMP/main/logic/good.hpp"
printf '%s\n' 'BasedOnStyle: LLVM' 'ColumnLimit: 100' >"$TMP/.clang-format"
git -C "$TMP" init -q
git -C "$TMP" config user.name format-selftest
git -C "$TMP" config user.email format-selftest@example.invalid
git -C "$TMP" config commit.gpgsign false
git -C "$TMP" add .clang-format main test tools/audit
git -C "$TMP" commit -qm baseline
printf '%s\n' 'inline int added_cleanly() { return 7; }' >>"$TMP/main/logic/good.hpp"
printf '%s\n' '#!/usr/bin/env bash' \
    'if [ "$1" = --version ]; then echo "Ubuntu clang-format version 18.1.3 (1ubuntu1)"; exit 0; fi' \
    'for arg in "$@"; do [ "$arg" = --lines=3:3 ] && exit 0; done' \
    'exit 1' >"$TMP/range-clang-format"
chmod 0755 "$TMP/range-clang-format"
run_check --clang-format "$TMP/range-clang-format" --clang-format-version 18.1.3 \
    --changed-since HEAD
check_status "changed-line discovery isolates the new hunk from legacy formatting" 0 "$?"

if command -v clang-format-18 >/dev/null 2>&1; then
    run_check --clang-format clang-format-18 --clang-format-version 18.1.3 \
        --changed-since HEAD
    check_status "real clang-format-18 accepts a clean new hunk beside legacy drift" 0 "$?"

    printf '%s\n' 'int       newly_bad( ) { return (  2 ); }' >>"$TMP/main/logic/good.hpp"
    run_check --clang-format clang-format-18 --clang-format-version 18.1.3 \
        --changed-since HEAD
    check_status "real clang-format-18 rejects bad spacing in a new hunk" 1 "$?"

    seed_good
    run_check --clang-format clang-format-18 --clang-format-version 18.1.3
    check_status "real clang-format-18 accepts the canonical fixture" 0 "$?"

    printf '%s\n' 'int       badly_formatted( ) { return (  1 ); }' \
        >"$TMP/main/logic/good.hpp"
    run_check --clang-format clang-format-18 --clang-format-version 18.1.3
    check_status "real clang-format-18 rejects nontrivial token spacing" 1 "$?"
elif [ -n "${CI:-}" ]; then
    echo "FAIL: CI selftest requires clang-format-18" >&2
    fail=$((fail + 1))
fi
set -e

if [ "$fail" -ne 0 ]; then
    echo "format selftest: $fail of $((pass + fail)) checks FAILED" >&2
    exit 1
fi
echo "format selftest: all $pass checks passed"
