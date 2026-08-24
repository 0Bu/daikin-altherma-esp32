#!/usr/bin/env bash
# Fast, hardware-free contracts for the CI trust split and release/version plumbing. These tests
# intentionally exercise the boundaries without needing ESP-IDF, a signing key, GitHub or a board.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check_rc() {
    local name="$1" want="$2"; shift 2
    "$@" >"$T/out.log" 2>&1; local got=$?
    if [ "$got" -eq "$want" ]; then ok "$name"; else bad "$name (expected rc=$want, got rc=$got)"; fi
}
check_out() {
    local name="$1" want="$2"; shift 2
    local got; got="$("$@" 2>"$T/out.log")"; local rc=$?
    if [ "$rc" -eq 0 ] && [ "$got" = "$want" ]; then
        ok "$name"
    else
        bad "$name (expected '$want', got '$got', rc=$rc)"
    fi
}

echo "== 1. unsigned artifact allow-list =="
mkdir -p "$T/artifacts"
touch "$T/artifacts/daikin-altherma-esp32.elf.xz" \
      "$T/artifacts/daikin-altherma-esp32.elf.sha256" \
      "$T/artifacts/daikin-altherma-esp32-size.json" \
      "$T/artifacts/daikin-altherma-esp32-size.md"
check_rc "diagnostics-only directory passes" 0 ./scripts/check-nonflashable-artifacts.sh "$T/artifacts"

for forbidden in daikin-altherma-esp32.bin daikin-altherma-esp32-merged.bin \
                 daikin-altherma-esp32-web-bootloader.bin manifest.json changelog.json; do
    touch "$T/artifacts/$forbidden"
    check_rc "$forbidden is refused" 1 ./scripts/check-nonflashable-artifacts.sh "$T/artifacts"
    rm -f "$T/artifacts/$forbidden"
done
mkdir -p "$T/empty"
check_rc "empty artifact directory is refused" 1 ./scripts/check-nonflashable-artifacts.sh "$T/empty"

echo "== 2. publishing packager fails before build without a key =="
mkdir -p "$T/pack/scripts"
cp scripts/ci-build-all.sh scripts/check-nonflashable-artifacts.sh "$T/pack/scripts/"
chmod +x "$T/pack/scripts/"*.sh
printf '1.0.0\n' > "$T/pack/version.txt"
printf 'lock\n' > "$T/pack/dependencies.lock"
SOURCE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
check_rc "publishing mode requires explicit source SHA" 2 \
    env OTA_SIGNING_KEY_FILE="$T/no-such-key.pem" "$T/pack/scripts/ci-build-all.sh" 1.0.0
check_rc "default mode refuses missing key" 1 \
    env OTA_SIGNING_KEY_FILE="$T/no-such-key.pem" "$T/pack/scripts/ci-build-all.sh" \
        --source-sha "$SOURCE_SHA" 1.0.0
if [ ! -e "$T/pack/dist/manifest.json" ] && ! compgen -G "$T/pack/dist/*.bin" >/dev/null; then
    ok "missing-key failure leaves no flashable artifact"
else
    bad "missing-key failure left a flashable artifact"
fi

echo "== 3. strict SemVer and explicit resume version =="
mkdir -p "$T/version/scripts"
cp scripts/next-version.sh "$T/version/scripts/"
chmod +x "$T/version/scripts/next-version.sh"
printf '1.0.0\n' > "$T/version/version.txt"
git -C "$T/version" init -q
git -C "$T/version" config user.email t@t
git -C "$T/version" config user.name t
git -C "$T/version" config commit.gpgsign false
printf 'seed\n' > "$T/version/README"
git -C "$T/version" add -A
git -C "$T/version" commit -qm seed
check_out "no tags uses the floor" 1.0.0 "$T/version/scripts/next-version.sh"
git -C "$T/version" tag v1.2.9
git -C "$T/version" tag v1.10.0
check_out "highest valid tag bumps numerically" 1.10.1 "$T/version/scripts/next-version.sh"
check_out "minor bump is strict" 1.11.0 "$T/version/scripts/next-version.sh" minor
check_out "exact release version is echoed" 2.3.4 "$T/version/scripts/next-version.sh" --exact 2.3.4
check_rc "pre-release exact version is refused" 1 "$T/version/scripts/next-version.sh" --exact 2.3.4-rc.1
check_rc "leading-zero exact version is refused" 1 "$T/version/scripts/next-version.sh" --exact 02.3.4
git -C "$T/version" tag v1.2.latest
check_rc "malformed v-tag fails closed" 1 "$T/version/scripts/next-version.sh"
git -C "$T/version" tag -d v1.2.latest >/dev/null
printf '1.2\n' > "$T/version/version.txt"
check_rc "malformed version floor fails closed" 1 "$T/version/scripts/next-version.sh"
printf '1. 2.3\n' > "$T/version/version.txt"
check_rc "whitespace is not normalized into SemVer" 1 "$T/version/scripts/next-version.sh"

echo "== 4. workflow trust and release ordering =="
check_rc "manifest provenance validator self-test passes" 0 \
    python3 scripts/check-manifest-provenance.py --self-test
check_rc "OTA changelog generator self-test passes" 0 \
    python3 scripts/generate-ota-changelog.py --self-test
python3 - "$REPO/.github/workflows/build.yml" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
workflow_dir = Path(sys.argv[1]).parent
policy_text = (workflow_dir / "pr-policy.yml").read_text(encoding="utf-8")
matches = list(re.finditer(r"(?m)^  ([a-z][a-z0-9_]*):\n", text))
jobs = {}
for index, match in enumerate(matches):
    end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
    jobs[match.group(1)] = text[match.start():end]

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)

for name in ("build", "trusted_build", "publish"):
    require(name in jobs, f"missing {name!r} job")

untrusted = jobs["build"]
require("contents: read" in untrusted, "untrusted build is not contents:read")
require("--compile-only" in untrusted, "untrusted build does not use --compile-only")
require('--source-sha "${{ github.event.pull_request.head.sha }}"' in untrusted,
        "untrusted build does not receive source SHA explicitly")
require("if: always() && github.event_name == 'pull_request'" in untrusted,
        "untrusted build is not restricted to ordinary pull_request")
require("needs: [mechanical_gates]" in untrusted and '"$MECHANICAL_RESULT" = success' in untrusted,
        "required build check does not propagate mechanical gate failure")
require("persist-credentials: false" in untrusted and "allow-unsafe-pr-checkout" not in untrusted,
        "untrusted build checkout is not using the safe pull_request boundary")
require("check-nonflashable-artifacts.sh" in untrusted, "untrusted build lacks artifact guard")
require("OTA_SIGNING_KEY" not in untrusted, "untrusted build can see the signing key")
require("secrets." not in untrusted and "github.token" not in untrusted,
        "untrusted build gained a secret or token expression")
require("contents: write" not in untrusted, "untrusted build has contents:write")
require("dist/*.bin" not in untrusted and "dist/manifest.json" not in untrusted,
        "untrusted upload includes flashable files")

trusted = jobs["trusted_build"]
require("github.ref == 'refs/heads/main'" in trusted, "signed build is not restricted to main")
require("environment:" not in trusted,
        "trusted build unexpectedly depends on an environment instead of the repository secret")
require("contents: read" in trusted and "contents: write" not in trusted,
        "signed build token is not read-only")
require("secrets.OTA_SIGNING_KEY" in trusted, "signed build lacks signing secret")
require("--compile-only" not in trusted, "signed build accidentally uses compile-only mode")
require('--source-sha "${{ github.sha }}"' in trusted,
        "signed build does not receive source SHA explicitly")
version_gate = trusted.find("Check the version moves its feed forward")
changelog = trusted.find("Generate public OTA changelog")
firmware_build = trusted.find("- name: Build firmware")
require(0 <= version_gate < changelog < firmware_build,
        "release identity/changelog gates do not precede firmware build")
early_gate = trusted[version_gate:firmware_build]
require("SOURCE_SHA: ${{ github.sha }}" in early_gate and
        'check-publish-version.sh --source-sha "$SOURCE_SHA"' in early_gate,
        "release resume is not checked against github.sha before the build")
require('"v${disp}^{commit}"' in trusted and '"$tag_sha" = "$GITHUB_SHA"' in trusted,
        "release resume does not bind an existing tag to this source commit")
require("generate-ota-changelog.py" in trusted and "--published-ref FETCH_HEAD" in trusted and
        "--changelog-file ota-changelog.json" in trusted and "dist/changelog.json" in trusted,
        "trusted build does not generate and retain the version-bound OTA changelog")

publish = jobs["publish"]
require("needs: [trusted_build]" in publish, "publisher does not depend on signed build")
require("contents: write" in publish and "actions: read" in publish,
        "publisher permissions are incomplete")
require("OTA_SIGNING_KEY" not in publish, "write-capable publisher can see signing key")
require("check-manifest-provenance.py" in publish,
        "publisher does not verify signed artifact provenance")
require('check-publish-version.sh --source-sha "$SOURCE_SHA"' in publish,
        "publisher does not recheck the feed against artifact source")
require("generate-ota-changelog.py --validate dist/changelog.json" in publish,
        "publisher does not validate the handed-off OTA changelog")
require("target_commitish: ${{ github.sha }}" in publish,
        "new release tag is not explicitly bound to github.sha")
for notice in ("_site/LICENSE.txt", "_site/THIRD_PARTY_NOTICES.md", "_site/Apache-2.0.txt"):
    require(notice in publish, f"GitHub Release omits {notice}")
provenance_check = publish.find("check-manifest-provenance.py")
source_recheck = publish.find("check-publish-version.sh --source-sha")
root_publish = publish.find("Publish site to gh-pages (root)")
release_create = publish.find("Create or resume release")
require(0 <= provenance_check < source_recheck < root_publish < release_create,
        "provenance/source checks, Pages and GitHub Release are ordered unsafely")

relevant = re.search(r"relevant='([^']+)'", text)
require(relevant is not None and "web-installer[.]mjs" in relevant.group(1),
        "docs/web-installer.mjs is missing from change trigger")
require(re.search(relevant.group(1), "scripts/production-ota-gate.py") is not None,
        "production OTA gate changes do not publish an exact-source dev artifact")
require("LICENSE$" in relevant.group(1) and "THIRD_PARTY_NOTICES[.]md$" in relevant.group(1),
        "redistribution notices are missing from the Pages build trigger")
require(re.search(relevant.group(1), "tools/web_asset/vendor/LICENSE") is not None,
        "the Apache license source is missing from the Pages build trigger")
require("release_version:" in text and "release-resume" in text,
        "explicit/idempotent release resume contract is missing")

require("  pull_request:\n" in text and "  pull_request_target:\n" not in text,
        "build workflow does not isolate PR execution under pull_request")
require("  pull_request_target:\n" in policy_text and "\n  gates:\n" in policy_text,
        "separate trusted policy workflow is missing")
require("working-directory: .trusted-policy" in policy_text and
        "ref: ${{ github.event.pull_request.base.sha }}" in policy_text,
        "policy workflow does not execute the protected-base verifier")
require("refs/pull/" not in policy_text and "allow-unsafe-pr-checkout" not in policy_text and
        "secrets." not in policy_text,
        "policy workflow can load PR code or secrets")
for workflow in workflow_dir.glob("*.y*ml"):
    workflow_text = workflow.read_text(encoding="utf-8")
    require("ubuntu-latest" not in workflow_text, f"floating runner remains in {workflow.name}")
    for runner in re.findall(r"(?m)^\s*runs-on:\s*(\S+)", workflow_text):
        require(runner == "ubuntu-24.04", f"unapproved runner {runner} in {workflow.name}")

idf_pins = re.findall(r"esp_idf_version:\s*(v[0-9.]+)", text)
require(idf_pins and len(set(idf_pins)) == 1, "ESP-IDF job pins disagree")
packager = (workflow_dir.parents[1] / "scripts" / "ci-build-all.sh").read_text(encoding="utf-8")
for field in ("source_sha", "idf_version", "dependencies_lock_sha256", "app_sha256"):
    require(f'"{field}"' in packager, f"packager omits provenance field {field}")
require("espsecure sign-data" in packager,
        "packager does not use the current espsecure signing command")
require("espsecure.py" not in packager and "sign_data" not in packager,
        "packager still uses a deprecated espsecure spelling")

page_builder = (workflow_dir.parents[1] / "scripts" / "build-pages.sh").read_text(encoding="utf-8")
require('cp LICENSE "$OUT/LICENSE.txt"' in page_builder,
        "Pages builder omits LICENSE.txt")
require('cp THIRD_PARTY_NOTICES.md "$OUT/THIRD_PARTY_NOTICES.md"' in page_builder,
        "Pages builder omits third-party notices")
require('cp tools/web_asset/vendor/LICENSE "$OUT/Apache-2.0.txt"' in page_builder,
        "Pages builder omits the Apache-2.0 license")
require('cp dist/changelog.json "$OUT/changelog.json"' in page_builder,
        "Pages builder omits the OTA changelog beside the selected feed")

repo = workflow_dir.parents[1]
apache_license = (repo / "tools" / "web_asset" / "vendor" / "LICENSE").read_text(encoding="utf-8")
require("Apache License" in apache_license and "Version 2.0, January 2004" in apache_license,
        "vendor license is not the expected Apache License 2.0 text")
third_party = (repo / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
require("Apache-2.0.txt" in third_party,
        "third-party notice does not name the distributed Apache license")

for workflow in workflow_dir.glob("*.y*ml"):
    for line in workflow.read_text(encoding="utf-8").splitlines():
        if "uses:" not in line:
            continue
        ref = line.split("uses:", 1)[1].split("#", 1)[0].strip()
        require(re.search(r"@[0-9a-f]{40}$", ref) is not None,
                f"Action is not SHA-pinned in {workflow.name}: {ref}")
print("workflow contract: trust split, artifact boundary and release ordering OK")
PY
if [ "$?" -eq 0 ]; then ok "workflow structure is fail-closed"; else bad "workflow structure contract failed"; fi

echo
if [ "$fail" -eq 0 ]; then
    echo "CI/release contracts: all $pass checks passed"
else
    echo "CI/release contracts: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
