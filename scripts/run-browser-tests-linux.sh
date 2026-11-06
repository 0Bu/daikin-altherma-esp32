#!/usr/bin/env bash
# Both engines run off-line in the same pinned Linux image on macOS and CI.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
command -v docker >/dev/null || { echo 'browser gate requires Docker' >&2; exit 2; }
work="$(mktemp -d "${TMPDIR:-/tmp}/daikin-browser-container.XXXXXX")"
work="$(cd "$work" && pwd -P)"
client=""
launch_attempted=0
cleanup() {
  local status=$? attempt
  trap - EXIT INT TERM
  if [[ -n "$client" ]]; then
    kill "$client" >/dev/null 2>&1 || true
    for ((attempt = 0; attempt < 60; attempt++)); do
      kill -0 "$client" >/dev/null 2>&1 || break
      sleep 0.05
    done
    if kill -0 "$client" >/dev/null 2>&1; then kill -KILL "$client" 2>/dev/null || true; fi
    wait "$client" >/dev/null 2>&1 || true
  fi
  if [[ "$launch_attempted" == "1" ]]; then
    if ! python3 "$root/tools/browser/docker_cleanup.py" \
      --ownership "$work/ownership.json" --cid-file "$work/cid"; then
      echo "browser gate: container removal unverified; retained ownership record at $work/ownership.json" >&2
      exit 2
    fi
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 "$root/tools/browser/stage_source.py" "$root" "$work/source"
docker build --quiet --file "$work/source/tools/browser/Dockerfile" "$work/source" >"$work/image" &
client=$!
if wait "$client"; then build_status=0; else build_status=$?; fi
client=""
if [[ "$build_status" -ne 0 ]]; then
  echo 'browser gate: pinned Docker image build failed' >&2
  exit 2
fi
image="$(cat "$work/image")"
if ! [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'browser gate: Docker did not return one image identity' >&2
  exit 2
fi
ownership="$(python3 - "$work/ownership.json" <<'PY'
import json
import secrets
import sys

name = "daikin-browser-" + secrets.token_hex(16)
token = secrets.token_hex(32)
with open(sys.argv[1], "x", encoding="utf-8") as output:
    json.dump({"schema_version": 1, "name": name, "token": token}, output)
print(name, token)
PY
)"
read -r container_name container_token <<< "$ownership"
# Reserve ownership before asking the daemon to create anything: its reply/CID can be lost.
launch_attempted=1
docker run --rm --init --cidfile "$work/cid" --name "$container_name" \
  --label "io.daikin-altherma-esp32.browser-owner=$container_token" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 512 --shm-size 512m --tmpfs /tmp:rw,exec,nosuid,nodev,size=1g \
  --user 1000:1000 \
  --workdir /project \
  -e DAIKIN_BROWSER_TIMEOUT_MS="${DAIKIN_BROWSER_TIMEOUT_MS:-600000}" \
  -e DAIKIN_BROWSER_PARALLEL="${DAIKIN_BROWSER_PARALLEL:-1}" \
  "$image" bash scripts/run-browser-render-tests.sh "$@" &
client=$!
if wait "$client"; then status=0; else status=$?; fi
client=""
if [[ "$status" -ge 125 && "$status" -le 127 ]]; then status=2; fi
exit "$status"
