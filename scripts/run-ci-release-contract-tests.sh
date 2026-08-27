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
                 daikin-altherma-esp32-web-bootloader.bin manifest.json artifacts.json \
                 changelog.json; do
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
check_out "no-tag dev build counts the whole reachable history" 1.0.0-dev.1 \
    "$T/version/scripts/next-version.sh" --dev
git -C "$T/version" tag v1.2.9
git -C "$T/version" tag v1.10.0
check_out "highest reachable valid tag bumps numerically" 1.10.1 "$T/version/scripts/next-version.sh"
check_out "minor bump is strict" 1.11.0 "$T/version/scripts/next-version.sh" minor
check_out "exact release version is echoed" 2.3.4 "$T/version/scripts/next-version.sh" --exact 2.3.4
check_rc "pre-release exact version is refused" 1 "$T/version/scripts/next-version.sh" --exact 2.3.4-rc.1
check_rc "leading-zero exact version is refused" 1 "$T/version/scripts/next-version.sh" --exact 02.3.4
printf 'next\n' >> "$T/version/README"
git -C "$T/version" add README
git -C "$T/version" commit -qm next
check_out "dev counter starts after the highest reachable tag" 1.10.1-dev.1 \
    "$T/version/scripts/next-version.sh" --dev

# High and malformed tags on a disconnected history are local debris, not release history for HEAD.
orphan="$(printf 'orphan\n' | git -C "$T/version" commit-tree "$(git -C "$T/version" rev-parse HEAD^{tree})")"
git -C "$T/version" tag v99.0.0 "$orphan"
git -C "$T/version" tag v99.latest "$orphan"
check_rc "divergent fixture is unreachable" 1 \
    git -C "$T/version" merge-base --is-ancestor "$orphan" HEAD
check_out "unreachable high tag is ignored" 1.10.1 "$T/version/scripts/next-version.sh"
check_out "unreachable malformed tag is ignored by dev versioning" 1.10.1-dev.1 \
    "$T/version/scripts/next-version.sh" --dev
git -C "$T/version" tag v1.2.latest
check_rc "reachable malformed v-tag fails closed" 1 "$T/version/scripts/next-version.sh"
git -C "$T/version" tag -d v1.2.latest >/dev/null
printf '1.2\n' > "$T/version/version.txt"
check_rc "malformed version floor fails closed" 1 "$T/version/scripts/next-version.sh"
printf '1. 2.3\n' > "$T/version/version.txt"
check_rc "whitespace is not normalized into SemVer" 1 "$T/version/scripts/next-version.sh"

echo "== 4. workflow trust and release ordering =="
check_rc "manifest provenance validator self-test passes" 0 \
    python3 scripts/check-manifest-provenance.py --self-test
check_rc "signing-key continuity self-test passes" 0 \
    python3 scripts/check-signing-key-continuity.py --self-test
check_rc "stack-budget self-test passes" 0 \
    python3 scripts/check-stack-budget.py --self-test
check_rc "reproducible-build self-test passes" 0 \
    python3 scripts/check-reproducible-build.py --self-test
check_rc "published readback self-test passes" 0 \
    python3 scripts/verify-published-artifacts.py --self-test
check_rc "production/HIL OTA gate self-test passes" 0 \
    python3 scripts/production-ota-gate.py --self-test
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

build_all = (workflow_dir.parents[1] / "scripts/ci-build-all.sh").read_text(encoding="utf-8")
build_pages = (workflow_dir.parents[1] / "scripts/build-pages.sh").read_text(encoding="utf-8")
manifest_check = (
    workflow_dir.parents[1] / "scripts/check-manifest-provenance.py"
).read_text(encoding="utf-8")
production_gate = (
    workflow_dir.parents[1] / "scripts/production-ota-gate.py"
).read_text(encoding="utf-8")

for name in ("build", "trusted_build", "release_hil", "publish"):
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
require("dist/*.bin" not in untrusted and "dist/manifest.json" not in untrusted and
        "dist/artifacts.json" not in untrusted,
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
require("dist/artifacts.json" in trusted,
        "trusted build does not retain the manifest-bound artifact index")
require("--verify-reproducible" in trusted and "steps.mode.outputs.mode == 'release'" in trusted,
        "release build does not require a clean reproducibility rebuild")

hil = jobs["release_hil"]
require("needs: [trusted_build]" in hil and
        "if: needs.trusted_build.outputs.mode == 'release'" in hil,
        "release HIL is not restricted to an exact successful release candidate")
require("runs-on: [self-hosted, daikin-release-lab]" in hil and "environment: release-hil" in hil,
        "release HIL is not pinned to the protected isolated lab runner")
require("contents: read" in hil and "contents: write" not in hil,
        "release HIL repository token is not read-only")
require("secrets.OTA_SIGNING_KEY" not in hil and "RELEASE_HIL_POWER_TOKEN" in hil and
        "RELEASE_HIL_FEED_TOKEN" in hil,
        "release HIL secret boundary is wrong")
require("production-ota-gate.py" in hil and "--release-hil" in hil and
        "--confirm-release-hil release-hil" in hil and "--execute" in hil,
        "release HIL does not use the direct role-confirmed canonical OTA gate")
require("--confirm-production" not in hil and "production-ota.json" not in hil,
        "release HIL can reach the production role")
for evidence in ("check-manifest-provenance.py", "check-signing-key-continuity.py",
                 "expected-source-sha", "expected-version", "expected-app-sha256"):
    require(evidence in hil, f"release HIL omits exact candidate evidence {evidence}")

ota_gate = (workflow_dir.parents[1] / "scripts" / "production-ota-gate.py").read_text(
    encoding="utf-8"
)
http_ota = (workflow_dir.parents[1] / "main" / "http_ota.cpp").read_text(encoding="utf-8")
ota_hil_feed = (workflow_dir.parents[1] / "main" / "logic" / "ota_hil_feed.hpp").read_text(
    encoding="utf-8"
)

def source_section(source: str, start: str, end: str) -> str:
    first = source.find(start)
    last = source.find(end, first + len(start))
    require(first >= 0 and last > first, f"missing source section {start}")
    return source[first:last]

def has_weather_refresh_call(source: str) -> bool:
    return re.search(
        r"request_weather_refresh\(\s*pinned_endpoint\s*,\s*host\s*,\s*started\s*,?\s*\)",
        source,
    ) is not None

# Formatting is not behavior: pin the semantic call shape and prove that an automatic formatter may
# wrap its arguments and retain a trailing comma without making this contract report a defect.
require(has_weather_refresh_call("request_weather_refresh(pinned_endpoint, host, started)"),
        "weather-refresh contract rejected its compact fixture")
require(has_weather_refresh_call("""request_weather_refresh(
    pinned_endpoint,
    host,
    started,
)"""), "weather-refresh contract rejected its wrapped fixture")

require('if channel != "release"' in ota_gate and
        '"hp.rx", "hp.tx", "profile.id", "ota.channel", "mqtt.base", "mqtt.base_custom"' in ota_gate and
        'release-hil-canary-' in ota_gate and 'persistence_canaries' in ota_gate,
        "release HIL does not pin release-channel configuration persistence evidence")
require('for flag in ("require_x10a", "require_weather")' in ota_gate and
        'lab.get(flag) is not True' in ota_gate,
        "release HIL does not require physical X10A and weather coverage")
require(re.search(r'require_exact_release_hil_feed\([\s\S]{0,180}?lab\["manifest_url"\][\s\S]{0,120}?lab\["firmware_base_url"\]', ota_gate) is not None and
        'lab["feed_controller_id"]' in ota_gate and 'lab["power_controller_id"]' in ota_gate and
        'FEED_LEASE_TTL_S' in ota_gate and 'POWER_OFF_LEASE_S' in ota_gate,
        "release HIL does not read the private HTTPS feed back byte-for-byte")
require('release-HIL root policy must be schema_version 3' in ota_gate and
        'release-HIL inventory must be a schema_version 3 object' in ota_gate and
        'RELEASE_HIL_POLICY_PATH' in ota_gate and
        'feed_controller_ids' in ota_gate and 'strict_json' in ota_gate,
        "release HIL does not bind strict schema-3 inventory to its protected root policy")
require('old_version != lab["bootstrap_version"]' in ota_gate and
        'old_elf != lab["bootstrap_elf"]' in ota_gate,
        "release HIL does not bind the board to its independently pinned bootstrap identity")

# Strict bounded framing comes before HTTP error classification, so a malformed 503 can never count
# as an expected busy witness.
transport = source_section(
    ota_gate, "def read_bounded_http_response(", "\ndef verify_http_range_support("
)
for boundary in (
    "HTTP_HEADER_MAX_BYTES", "HTTP_CHUNK_LINE_MAX_BYTES",
    'transfer_encodings[0] != b"chunked"',
    're.fullmatch(rb"[0-9A-Fa-f]+", size_text)',
    "chunk_size > max_body_bytes - len(body)",
    "chunked HTTP response has trailers or bytes after its terminator",
):
    require(boundary in transport, f"bounded HTTP framing omits {boundary}")
http_error = transport.find("if status < 200 or status >= 300:")
framing_end = transport.find("chunked HTTP response has trailers or bytes after its terminator")
require(http_error > framing_end >= 0 and "raise HTTPError" in transport[http_error:],
        "HTTP errors are classified before strict response framing is complete")

# All pressure requests share the identity-pinned endpoint and preserve parser failures across the
# worker boundary.
stress = source_section(ota_gate, "def stress_board(", "\ndef verify_retained_x10a(")
require("pinned_endpoint = resolve_http_endpoint(host)" in stress and
        "request_status_deadline(pinned_endpoint" in stress and
        "request_values_deadline(pinned_endpoint" in stress and
        "request_diag_deadline(pinned_endpoint" in stress,
        "combined stress does not keep every board request on one resolved endpoint")
require(has_weather_refresh_call(stress) and
        "weather did not become idle before its HIL refresh" in stress and
        'extra_headers=hil_headers' in stress and
        "manifest_url=hil_manifest_url" in stress and
        "firmware_base_url=hil_firmware_base_url" in stress,
        "combined stress does not bind deterministic weather plus the exact effective HIL feed")
full_download = source_section(
    ota_gate, "def exercise_bench_full_download(", "\ndef require_ota_transfer_evidence("
)
for helper in ("request_status_deadline", "request_values_deadline", "request_diag_deadline"):
    require(f"{helper}(status_endpoint" in full_download,
            f"bench binary pressure is not pinned through {helper}")
require("except BaseException as error:" in full_download and
        "record_bench_pressure_failure(kind, error, counts, unexpected, lock)" in full_download and
        "worker.is_alive()" in full_download and "if unexpected:" in full_download,
        "bench pressure can lose GateError or a live worker")
pressure_failure = source_section(
    ota_gate, "def record_bench_pressure_failure(", "\ndef exercise_bench_full_download("
)
require("error.code == 503" in pressure_failure and
        "(CompactTransportError, OSError, TimeoutError)" in pressure_failure and
        "unexpected.append" in pressure_failure,
        "bench pressure does not classify only expected 503/transport gaps")

offer = source_section(ota_gate, "def ota_offer_ready(", "\ndef post_update_once(")
for identity in (
    'generation != expected_generation',
    'status.get("available_sha256") != expected_app_sha256',
    'status.get("available_channel") != expected_channel',
    'status.get("effective_manifest_url") != expected_manifest_url',
    'status.get("effective_firmware_base_url") != expected_firmware_base_url',
    'extra_headers=hil_headers',
):
    require(identity in offer, f"OTA offer lease omits {identity}")

# The only allowed board-side source override is one complete, bounded header pair on /ota/check;
# firmware retains it with generation+artifact identity and exposes the exact effective URLs.
headers = source_section(
    ota_gate, "def release_hil_request_headers(", "\ndef load_release_hil_policy("
)
require("HIL_MANIFEST_HEADER: manifest_url" in headers and
        "HIL_FIRMWARE_BASE_HEADER: firmware_base_url" in headers,
        "release HIL does not construct both transient feed headers")
bounded_request = source_section(
    ota_gate, "def request_bytes_deadline(", "\ndef request_json_deadline("
)
require("set(extra_headers) != HIL_FEED_HEADERS" in bounded_request and
        'method != "GET"' in bounded_request and
        'not path.startswith("/ota/check?")' in bounded_request and
        "HIL_FEED_URL_MAX_BYTES" in bounded_request,
        "pinned transport accepts unscoped or unbounded extra headers")
require("X-Daikin-HIL-Manifest-URL" in http_ota and
        "X-Daikin-HIL-Firmware-Base-URL" in http_ota and
        "OtaHilFeedHeaderResult::PartialPair" in http_ota and
        "OtaHilFeedHeaderResult::InvalidUrl" in http_ota and
        "ota_check_async(ms, override_feed)" in http_ota and
        "effective_manifest_url" in http_ota and
        "effective_firmware_base_url" in http_ota and
        "image_state" in http_ota and "rollback_pending" in http_ota,
        "firmware HIL header pair or effective-feed status evidence is incomplete")
for binding in (
    "binding.generation != generation", "bound_channel != channel",
    "bound_version != version", "std::memcmp(binding.app_sha256", "out = binding.feed",
):
    require(binding in ota_hil_feed, f"firmware offer binding omits {binding}")
feed_lease = source_section(ota_gate, "def validate_feed_lease(", "\n@contextmanager\ndef leased_release_hil_feed(")
require('result.get("manifest_url") != manifest_url' in feed_lease and
        'result.get("firmware_base_url") != firmware_base_url' in feed_lease,
        "release-HIL feed controller acknowledgement is not bound to the exact leased URLs")

# Controller URLs cannot normalize to a different origin/path, and one absolute deadline covers DNS,
# TCP, TLS handshake, send and strictly framed response read.
canonical = source_section(ota_gate, "def canonical_https_url(", "\ndef load_release_hil_policy(")
for guard in (
    "parsed.port is not None", '"%" in parsed.path', '"//" in parsed.path',
    'any(segment in (".", "..") for segment in parsed.path.split("/"))',
    "parsed.query", "parsed.fragment", "not parsed.path.startswith(base.path)",
):
    require(guard in canonical, f"canonical controller URL validation omits {guard}")
controller = source_section(ota_gate, "def control_json(", "\ndef validate_feed_lease(")
for deadline_boundary in (
    "deadline = time.monotonic() + HTTP_TIMEOUT_S", "resolution_done.wait(remaining())",
    "candidate.settimeout(remaining())", "do_handshake_on_connect=False",
    "tls_socket.do_handshake()", "read_bounded_http_response(", "allow_chunked=True",
):
    require(deadline_boundary in controller,
            f"controller whole-operation deadline omits {deadline_boundary}")

# All three candidate boots are protected by independent controller-owned expiry cycles. The first
# proves bootstrap-writer rollback, the second remains armed through commit and proves a true cold
# boot, and the third proves that the committed candidate's own OTA writer can install the pinned
# bootstrap before a hard cycle rolls back to the already-VALID candidate.
hil_run = source_section(ota_gate, "def run_release_hil(", "\ndef self_test(")
require(hil_run.count("with pending_image_power_watchdog(") == 3,
        "release HIL does not arm a pending-image watchdog around all three candidate boots")
first_watchdog = hil_run.find("with pending_image_power_watchdog(")
first_install = hil_run.find("release_hil_install_once(", first_watchdog)
rollback_cycle = hil_run.find("trigger_watchdog_cycle()", first_install)
second_watchdog = hil_run.find("with pending_image_power_watchdog(", first_watchdog + 1)
second_install = hil_run.find("release_hil_install_once(", second_watchdog)
health_window = hil_run.find("wait_for_bench_health_window(", second_install)
valid_image = hil_run.find("wait_for_ota_image_state(committed_endpoint, rollback_pending=False)", health_window)
cold_cycle = hil_run.find("release_hil_power_cycle(lab, power_token)", valid_image)
third_watchdog = hil_run.find("with pending_image_power_watchdog(", second_watchdog + 1)
third_install = hil_run.find("release_hil_install_once(", third_watchdog)
writer_rollback_cycle = hil_run.find("trigger_writer_watchdog_cycle()", third_install)
writer_rollback = hil_run.find("wait_for_identity(host, mac, version, elf)", writer_rollback_cycle)
writer_valid = hil_run.find("wait_for_ota_image_state(\n            writer_endpoint, rollback_pending=False", writer_rollback)
require(0 <= first_watchdog < first_install < rollback_cycle < second_watchdog < second_install <
        health_window < valid_image < cold_cycle < third_watchdog < third_install <
        writer_rollback_cycle < writer_rollback < writer_valid,
        "release HIL watchdog/install/rollback/commit/cold/candidate-writer order is unsafe")
third_install_call = hil_run[third_install:hil_run.find("\n            )", third_install) + len("\n            )")]
for binding in (
    "current_version=version", "current_elf=elf",
    'version=lab["bootstrap_version"]', 'app_sha256=lab["bootstrap_app_sha256"]',
    'elf=lab["bootstrap_elf"]', 'manifest_url=lab["bootstrap_manifest_url"]',
    'firmware_base_url=lab["bootstrap_firmware_base_url"]', "allow_downgrade=True",
):
    require(binding in third_install_call,
            f"release HIL candidate-writer install omits exact binding {binding}")
require('get("persist") != "power_cycle"' in hil_run and
        "wait_for_ota_image_state(endpoint, rollback_pending=True)" in ota_gate and
        "wait_for_ota_image_state(committed_endpoint, rollback_pending=False)" in hil_run and
        "wait_for_ota_image_state(cold_endpoint, rollback_pending=False)" in hil_run and
        "writer_endpoint, rollback_pending=False" in hil_run and
        "hil_manifest_url=manifest_url" in ota_gate and
        "hil_firmware_base_url=firmware_base_url" in ota_gate,
        "release HIL omits rollback-state or physical power-cycle evidence")
require(has_weather_refresh_call(ota_gate) and
        '"refresh": True' in ota_gate and 'weather_successes_before' in ota_gate,
        "release HIL does not schedule a deterministic non-persistent weather TLS witness")
require('def post_update_once(\n    endpoint: ResolvedHttpEndpoint' in ota_gate and
        'f"/ota/update?{query}", method="POST"' in ota_gate and
        'pinned_before = request_status_deadline(endpoint' in ota_gate and
        'validate_identity(\n        pinned_before' in ota_gate,
        "OTA update write is not bound to its prevalidated resolved endpoint")

publish = jobs["publish"]
require("needs: [trusted_build, release_hil]" in publish and
        "needs.release_hil.result == 'success'" in publish and "always()" in publish,
        "publisher does not require HIL success for releases while allowing skipped dev HIL")
require("contents: write" in publish and "actions: read" in publish,
        "publisher permissions are incomplete")
require("OTA_SIGNING_KEY" not in publish, "write-capable publisher can see signing key")
require("check-manifest-provenance.py" in publish,
        "publisher does not verify signed artifact provenance")
require("check-signing-key-continuity.py" in publish,
        "publisher does not reverify signing-key continuity")
require('check-publish-version.sh --source-sha "$SOURCE_SHA"' in publish,
        "publisher does not recheck the feed against artifact source")
dev_resume_guard = re.compile(
    r'elif \[ "\$MODE" = dev \] && \[ "\$RUN_ATTEMPT" -gt 1 \]; then\s+'
    r'check_mode=dev-resume'
)
for name, block in (("trusted build", trusted), ("publisher", publish)):
    require('RUN_ATTEMPT: ${{ github.run_attempt }}' in block and
            dev_resume_guard.search(block) is not None,
            f"{name} does not keep first-attempt dev publishes strictly forward-only")
require("generate-ota-changelog.py --validate dist/changelog.json" in publish,
        "publisher does not validate the handed-off OTA changelog")
require(publish.count("dist/artifacts.json") >= 3,
        "publisher does not validate, publish and read back artifacts.json")
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
public_readback = publish.find("Verify public feed readback")
release_readback = publish.find("Verify GitHub Release asset readback")
require(root_publish < public_readback < release_create < release_readback,
        "public Pages or GitHub Release bytes are not read back in safe order")
require("verify-published-artifacts.py" in publish and "gh release download" in publish and
        '--pages-commit "$pages_commit"' in publish and '--pages-prefix "$PAGES_PREFIX"' in publish and
        "--attempts 30" in publish and
        'cmp -- "$expected_names" "$actual_names"' in publish and
        'cmp -- "$expected" "$readback/$name"' in publish,
        "published artifact readback does not compare exact public bytes")
require("Rebind release tag immediately before release mutation" in publish and
        "Rebind release tag after asset readback" in publish and
        publish.count('git rev-parse "v$VERSION^{commit}"') >= 2,
        "release tag is not rebound immediately before and after release mutation")

relevant = re.search(r"relevant='([^']+)'", text)
require(relevant is not None and "web-installer[.]mjs" in relevant.group(1),
        "docs/web-installer.mjs is missing from change trigger")
require(re.search(relevant.group(1), "scripts/production-ota-gate.py") is not None,
        "production OTA gate changes do not publish an exact-source dev artifact")
for release_input in (
    "scripts/check-signing-key-continuity.py", "scripts/check-stack-budget.py",
    "scripts/check-reproducible-build.py", "scripts/verify-published-artifacts.py",
    "tools/release/ota_signing_key_digest.txt", "tools/stack/budgets.json",
):
    require(re.search(relevant.group(1), release_input) is not None,
            f"release input {release_input} is missing from change trigger")
require("LICENSE$" in relevant.group(1) and "THIRD_PARTY_NOTICES[.]md$" in relevant.group(1),
        "redistribution notices are missing from the Pages build trigger")
require(re.search(relevant.group(1), "tools/web_asset/vendor/LICENSE") is not None,
        "the Apache license source is missing from the Pages build trigger")
require("release_version:" in text and "release-resume" in text and "dev-resume" in text,
        "explicit/idempotent feed resume contract is missing")

publish_limit = re.search(
    r"LEGACY_RESTORE_MANIFEST_MAX_BYTES\s*=\s*([0-9]+)", manifest_check,
)
gate_limit = re.search(
    r"LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES\s*=\s*([0-9]+)", production_gate,
)
require(publish_limit is not None and gate_limit is not None and
        publish_limit.group(1) == gate_limit.group(1) == "1024",
        "publish and production gates do not share the supported 1024-byte restore ceiling")
require('cat > "$DIST/artifacts.json"' in build_all and
        '"manifest_sha256": "$manifest_sha256"' in build_all and
        '"artifacts": [$artifacts_json]' not in build_all.split(
            'cat > "$DIST/manifest.json"', 1,
        )[1].split("EOF", 1)[0] and
        'cp dist/artifacts.json "$OUT/artifacts.json"' in build_pages,
        "artifact inventory is not split from the firmware manifest and retained on Pages")
main_body = production_gate[production_gate.index("def main("):]
limited_manifest_fetch = main_body.find("manifest_bytes = request_limited_bytes(")
restore_preflight = main_body.find("require_legacy_bench_restore_manifest(manifest_bytes, manifest)")
inventory_load = main_body.find("inventory = load_inventory()")
bench_exercise = main_body.find("exercise_bench_full_download(")
bench_contact = main_body.find('request_json(bench["host"], "/status")')
release_source_binding = main_body.find(
    "verify_release_source_binding(release_version, release_source_sha, release_sha256)"
)
require(0 <= limited_manifest_fetch < restore_preflight < inventory_load < bench_exercise,
        "legacy restore compatibility is not checked before any board path")
require(0 <= inventory_load < release_source_binding < bench_contact < bench_exercise,
        "release source binding, bench contact or downgrade is ordered unsafely")
for exact_release_identity in (
    'LEGACY_RELEASE_VERSION = "1.0.2"',
    'LEGACY_RELEASE_SOURCE_SHA = "cc29e8c6e593570140e6446b07520216251939ed"',
    'LEGACY_RELEASE_APP_SHA256 = "c8437cb546175fa9591dcce9e137c35ec6ea3028c64678b08e029392cb9ea4ce"',
):
    require(exact_release_identity in production_gate,
            "historical restore release adjudication is not exact")

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
    for runner in re.findall(r"(?m)^\s*runs-on:\s*(.+?)\s*$", workflow_text):
        require(runner in ("ubuntu-24.04", "[self-hosted, daikin-release-lab]"),
                f"unapproved runner {runner} in {workflow.name}")
require(text.count("runs-on: [self-hosted, daikin-release-lab]") == 1,
        "isolated release-lab runner label is missing or reused")

idf_pins = re.findall(r"esp_idf_version:\s*(v[0-9.]+)", text)
require(idf_pins and len(set(idf_pins)) == 1, "ESP-IDF job pins disagree")
packager = (workflow_dir.parents[1] / "scripts" / "ci-build-all.sh").read_text(encoding="utf-8")
for field in ("source_sha", "idf_version", "dependencies_lock_sha256", "app_sha256",
              "signing_key_sha256"):
    require(f'"{field}"' in packager, f"packager omits provenance field {field}")
require("espsecure sign-data" in packager,
        "packager does not use the current espsecure signing command")
require("espsecure.py" not in packager and "sign_data" not in packager,
        "packager still uses a deprecated espsecure spelling")
require("check-stack-budget.py" in packager and "check-signing-key-continuity.py" in packager,
        "packager omits stack or signing-key continuity gates")

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
