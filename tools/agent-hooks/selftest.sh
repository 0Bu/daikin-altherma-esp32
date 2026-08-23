#!/usr/bin/env bash
# Positive and negative mutation tests for canonical hook payloads and the consolidated PR gate.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
hook="$root/tools/agent-hooks/agent_hook.py"
pr_gate="$root/tools/agent-hooks/require-pr-gates.sh"
tmp="$(mktemp -d)" || exit 2
tmp_physical="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0

payload() {
    local payload_cwd="${AGENT_TEST_PAYLOAD_CWD:-$root}"
    python3 - "$1" "$2" "$3" "$payload_cwd" <<'PY'
import json, sys
tool, key, value, cwd = sys.argv[1:]
print(json.dumps({"hook_event_name": "PreToolUse", "cwd": cwd,
                  "tool_name": tool, "tool_input": {key: value}}))
PY
}

payload_with_workdir() {
    python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, sys
tool, command, cwd, workdir = sys.argv[1:]
print(json.dumps({"hook_event_name": "PreToolUse", "cwd": cwd,
                  "tool_name": tool, "tool_input": {"cmd": command, "workdir": workdir}}))
PY
}

decision() {
    python3 -c 'import json,sys
s=sys.stdin.read().strip()
if not s: print("")
else: print(json.loads(s)["hookSpecificOutput"]["permissionDecision"])' 2>/dev/null
}

guard_case() {
    local name="$1" input="$2" expected="$3" out got rc
    out="$(printf '%s' "$input" | python3 "$hook" pre-tool-guards 2>&1)"; rc=$?
    got="$(printf '%s' "$out" | decision)"
    if [ "$rc" -eq 0 ] && [ "$got" = "$expected" ]; then
        echo "PASS  $name"; pass=$((pass + 1))
    else
        echo "FAIL  $name (rc=$rc decision=$got output=$out)" >&2; fail=$((fail + 1))
    fi
}

guard_case "Canonical safe documentation read" \
    "$(payload Read file_path "$root/docs/SECURITY.md")" ""
guard_case "Canonical private PEM read denied" \
    "$(payload Read file_path "$root/ota_signing_key.pem")" deny
guard_case "Canonical multiline key shell access denied" \
    "$(payload Bash command $'echo safe\ncat ota_signing_key.pem')" deny
guard_case "Canonical exact espsecure signer allowed" \
    "$(payload Bash command 'espsecure.py sign_data --keyfile /offline/ota_signing_key.pem --output signed.bin app.bin')" ""
guard_case "Canonical exact espsecure signer environment path allowed" \
    "$(payload Bash command 'espsecure.py sign_data --keyfile "$OTA_SIGNING_KEY_FILE" --output signed.bin app.bin')" ""
guard_case "espsecure cannot reuse the key as payload or PEM output" \
    "$(payload Bash command 'espsecure.py sign_data --version 2 --keyfile /offline/ota_signing_key.pem --output leaked.pem /offline/ota_signing_key.pem')" deny
guard_case "Codex sensitive apply_patch target denied" \
    "$(payload apply_patch command $'*** Begin Patch\n*** Add File: secrets.env\n+TOKEN=x\n*** End Patch')" deny
guard_case "Codex safe patch that documents PEM allowed" \
    "$(payload apply_patch command $'*** Begin Patch\n*** Update File: docs/SECURITY.md\n@@\n-Old\n+Never read ota_signing_key.pem\n*** End Patch')" ""
guard_case "Codex process-environment dump denied" \
    "$(payload exec_command command 'printenv')" deny
guard_case "exec argv alias cannot hide environment dump" \
    "$(payload exec_command command 'exec -a harmless printenv')" deny
guard_case "timeout wrapper cannot hide environment dump" \
    "$(payload exec_command command 'timeout 1 printenv')" deny
guard_case "xargs cannot invoke environment dump" \
    "$(payload exec_command command "printf 'GH_TOKEN' | xargs printenv")" deny
guard_case "find exec cannot invoke environment dump" \
    "$(payload exec_command command "find . -maxdepth 0 -exec printenv GH_TOKEN ';'")" deny
guard_case "wrapped terminal env dump is denied" \
    "$(payload exec_command command 'setsid env')" deny
guard_case "dynamic printenv executable is denied" \
    "$(payload exec_command command 'p=printenv; "$p"')" deny
guard_case "dynamic env executable is denied" \
    "$(payload exec_command command 'p=env; "$p"')" deny
guard_case "dynamic set builtin is denied" \
    "$(payload exec_command command 'p=set; "$p"')" deny
guard_case "dynamic export builtin is denied" \
    "$(payload exec_command command 'p=export; "$p" -p')" deny
guard_case "dynamic declare builtin is denied" \
    "$(payload exec_command command 'p=declare; "$p" -p')" deny
guard_case "Python process environment dump is denied" \
    "$(payload exec_command command "python3 -c 'import os; print(os.environ)'")" deny
guard_case "Node process environment dump is denied" \
    "$(payload exec_command command "node -e 'console.log(process.env)'")" deny
guard_case "Linux proc environment dump is denied" \
    "$(payload exec_command command 'cat /proc/self/environ')" deny
guard_case "Linux thread-self environment dump is denied" \
    "$(payload exec_command command 'cat /proc/thread-self/environ')" deny
guard_case "Linux task environment dump is denied" \
    "$(payload exec_command command 'cat /proc/123/task/456/environ')" deny
guard_case "Linux repeated-slash environment dump is denied" \
    "$(payload exec_command command 'cat /proc//thread-self/environ')" deny
guard_case "Linux dot-component environment dump is denied" \
    "$(payload exec_command command 'cat /proc/./thread-self/environ')" deny
guard_case "Linux parent-component environment dump is denied" \
    "$(payload exec_command command 'cat /proc/self/../thread-self/environ')" deny
guard_case "BSD ps environment dump is denied" \
    "$(payload exec_command command 'ps eww -p $$')" deny
guard_case "Darwin ps environment flag is denied" \
    "$(payload exec_command command 'ps -E -p $$')" deny
guard_case "combined BSD ps environment flags are denied" \
    "$(payload exec_command command 'ps auxeww')" deny
guard_case "ordinary process listing without environment is allowed" \
    "$(payload exec_command command 'ps -ef')" ""
guard_case "Codex multiline process-environment dump denied" \
    "$(payload exec_command command $'echo safe\nprintenv')" deny
guard_case "direct GitHub token expansion is denied" \
    "$(payload exec_command command 'printf "%s\\n" "$GH_TOKEN"')" deny
guard_case "OTA signer path variable cannot be read" \
    "$(payload exec_command command 'cat "$OTA_SIGNING_KEY_FILE"')" deny
guard_case "env with assignments but no command is an environment dump" \
    "$(payload exec_command command 'env SELFTEST_VALUE=safe')" deny
guard_case "env wrapping an ordinary command is allowed" \
    "$(payload exec_command command 'env LC_ALL=C ls docs')" ""
guard_case "naked export environment dump is denied" \
    "$(payload exec_command command 'export')" deny
guard_case "option-only export environment dump is denied" \
    "$(payload exec_command command 'export -n')" deny
guard_case "GitHub auth token output is denied" \
    "$(payload exec_command command 'gh auth token')" deny
guard_case "brace-expanded GitHub auth token output is denied" \
    "$(payload exec_command command 'g{h..h} auth token')" deny
guard_case "GitHub auth status short token flag is denied" \
    "$(payload exec_command command 'env gh auth status -t')" deny
guard_case "dynamic GitHub auth status token flag is denied" \
    "$(payload exec_command command 'g=gh; "$g" auth status -t')" deny
guard_case "GitHub auth status token assignment is denied" \
    "$(payload exec_command command 'gh auth status --show-token=true')" deny
guard_case "dynamic GitHub auth status token assignment is denied" \
    "$(payload exec_command command 'g=gh; "$g" auth status --show-token=true')" deny
guard_case "direct GitHub API formatter cannot expose its environment" \
    "$(payload exec_command command "gh api user --jq 'env.GH_TOKEN'")" deny
guard_case "direct GitHub non-API formatter cannot expose its environment" \
    "$(payload exec_command command "gh pr view 5 --json number --jq 'env.GH_TOKEN'")" deny
guard_case "dynamic GitHub formatter cannot expose its environment" \
    "$(payload exec_command command "g=gh; \"\$g\" api user --jq 'env.GH_TOKEN'")" deny
guard_case "substituted GitHub formatter cannot expose its environment" \
    "$(payload exec_command command "\"\$(printf gh)\" api user --template '{{env \"GH_TOKEN\"}}'")" deny
guard_case "brace-expanded GitHub formatter cannot expose its environment" \
    "$(payload exec_command command "g{h..h} api user --jq 'env.GH_TOKEN'")" deny
guard_case "globbed GitHub formatter cannot expose its environment" \
    "$(payload exec_command command "/usr/bin/g[h] api user --jq 'env.GH_TOKEN'")" deny
guard_case "credential wrapper cannot print a GitHub token" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh auth token")" deny
guard_case "credential wrapper ordinary GitHub command is allowed" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr view 5 --json number")" ""
guard_case "credential wrapper exact noninteractive PR creation is allowed" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title 'Selftest PR' --body-file $tmp_physical/selftest-pr.md")" ""
guard_case "literal gh cannot create a PR outside the credential wrapper" \
    "$(payload exec_command command "gh --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title selftest --body selftest")" deny
guard_case "foreign absolute gh cannot create a PR outside the credential wrapper" \
    "$(payload exec_command command "/tmp/gh --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title selftest --body selftest")" deny
guard_case "PATH-selected gh cannot create a PR outside the credential wrapper" \
    "$(payload exec_command command "PATH=/tmp gh --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title selftest --body selftest")" deny
guard_case "dynamic direct gh PR action is denied" \
    "$(payload exec_command command 'action=create; gh pr "$action" --title selftest --body selftest')" deny
guard_case "substituted direct gh PR action is denied" \
    "$(payload exec_command command 'gh pr "$(printf create)" --title selftest --body selftest')" deny
guard_case "dynamic gh executable and PR action are denied together" \
    "$(payload exec_command command 'c=gh; a=edit; "$c" pr "$a" 5 --title selftest')" deny
guard_case "dynamic gh executable cannot perform API writes" \
    "$(payload exec_command command 'c=gh; "$c" api --method POST repos/0Bu/daikin-altherma-esp32/issues -f title=selftest')" deny
guard_case "credential wrapper cannot create a revert PR" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr revert 5")" deny
guard_case "credential wrapper cannot transfer an issue to another host" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh issue transfer 5 ghe.example/owner/repo")" deny
pr_create_command="scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title selftest --body-file $tmp_physical/selftest-pr.md"
AGENT_TEST_PAYLOAD_CWD="$tmp" guard_case "relative PR-create wrapper is denied from a foreign payload cwd" \
    "$(AGENT_TEST_PAYLOAD_CWD="$tmp" payload exec_command command "$pr_create_command")" deny
guard_case "relative PR-create wrapper is denied by a foreign tool workdir" \
    "$(payload_with_workdir exec_command "$pr_create_command" "$root" "$tmp")" deny
relative_wrapper_command="scripts/gh-with-git-credentials.sh pr view 5 --json number"
AGENT_TEST_PAYLOAD_CWD="$tmp" guard_case "relative credential wrapper is denied from a foreign payload cwd" \
    "$(AGENT_TEST_PAYLOAD_CWD="$tmp" payload exec_command command "$relative_wrapper_command")" deny
guard_case "relative credential wrapper is denied by a foreign tool workdir" \
    "$(payload_with_workdir exec_command "$relative_wrapper_command" "$root" "$tmp")" deny
pr_create_out="$(printf '%s' "$(AGENT_TEST_PAYLOAD_CWD="$tmp" payload exec_command command "$pr_create_command")" \
    | "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$pr_create_out" | grep -qF 'PR creation transport could not be bound safely'; then
    echo "PASS  aggregate gate binds relative PR-create wrapper to payload cwd"; pass=$((pass + 1))
else
    echo "FAIL  aggregate gate accepted foreign-cwd PR creation (rc=$rc output=$pr_create_out)" >&2
    fail=$((fail + 1))
fi
pr_create_out="$(printf '%s' "$(payload_with_workdir exec_command "$pr_create_command" "$root" "$tmp")" \
    | "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$pr_create_out" | grep -qF 'PR creation transport could not be bound safely'; then
    echo "PASS  aggregate gate binds relative PR-create wrapper to tool workdir"; pass=$((pass + 1))
else
    echo "FAIL  aggregate gate accepted foreign-workdir PR creation (rc=$rc output=$pr_create_out)" >&2
    fail=$((fail + 1))
fi
guard_case "credential wrapper read-only REST API request is allowed" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api --method GET repos/0Bu/daikin-altherma-esp32/git/ref/heads/main")" ""
guard_case "credential wrapper repository API path is not mistaken for a foreign repo" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api --method GET repos/0Bu/daikin-altherma-esp32")" ""
guard_case "credential wrapper workflow path is not mistaken for a foreign repo" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh workflow view .github/workflows/build.yml")" ""
guard_case "static read-only GraphQL query is allowed" \
    "$(payload exec_command command "gh api graphql -f 'query=query { viewer { login } }'")" ""
guard_case "canonical credential-wrapper merge reaches the aggregate gate" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/5/merge -f sha=abcdef1234567890abcdef1234567890abcdef12 -f merge_method=squash")" ""
guard_case "literal gh cannot impersonate the canonical merge transport" \
    "$(payload exec_command command "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/5/merge -f sha=abcdef1234567890abcdef1234567890abcdef12 -f merge_method=squash")" deny
guard_case "credential wrapper rejects an arbitrary REST write" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api --method PATCH repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -f sha=abcdef1234567890abcdef1234567890abcdef12")" deny
guard_case "literal gh rejects an implicit REST write" \
    "$(payload exec_command command "gh api repos/0Bu/daikin-altherma-esp32/issues -f title=selftest")" deny
guard_case "curl rejects an explicit GitHub REST write" \
    "$(payload exec_command command "curl -X PATCH https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -d '{\"sha\":\"abcdef\"}'")" deny
guard_case "curl rejects an implicit GitHub REST write" \
    "$(payload exec_command command "curl https://api.github.com/repos/0Bu/daikin-altherma-esp32/pulls -d '{\"title\":\"selftest\"}'")" deny
guard_case "direct curl GitHub GET is rejected" \
    "$(payload exec_command command "curl -sS https://api.github.com/repos/0Bu/daikin-altherma-esp32")" deny
guard_case "curl URL option cannot hide a GitHub REST write" \
    "$(payload exec_command command "curl --url=https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -X PATCH -d sha=abcdef")" deny
guard_case "curl config input cannot hide a GitHub REST write" \
    "$(payload exec_command command "curl --config /tmp/curl-selftest.conf")" deny
guard_case "non-GitHub curl remains allowed" \
    "$(payload exec_command command "curl -sS https://example.com/health")" ""
guard_case "direct production OTA POST is denied" \
    "$(payload exec_command command "curl -fsS -X POST http://production.invalid/ota/update")" deny
guard_case "direct test-board OTA POST is denied too" \
    "$(payload exec_command command "curl -fsS --request POST http://bench.invalid/ota/update")" deny
guard_case "HTTPie direct test-board OTA POST is denied" \
    "$(payload exec_command command "http POST http://bench.invalid/ota/update")" deny
guard_case "xh direct test-board OTA POST is denied" \
    "$(payload exec_command command "xh post http://bench.invalid/ota/update")" deny
guard_case "absolute curl implicit-data OTA POST is denied" \
    "$(payload exec_command command "/usr/bin/curl -d x http://bench.invalid/ota/update")" deny
guard_case "curl JSON OTA POST is denied" \
    "$(payload exec_command command "curl --json '{}' http://bench.invalid/ota/update")" deny
guard_case "curl multipart OTA POST is denied" \
    "$(payload exec_command command "curl -F x=y http://bench.invalid/ota/update")" deny
guard_case "curl data-urlencode OTA POST is denied" \
    "$(payload exec_command command "curl --data-urlencode x=y http://bench.invalid/ota/update")" deny
for curl_data_option in data-raw data-binary data-ascii form-string; do
    guard_case "curl equals-form $curl_data_option OTA POST is denied" \
        "$(payload exec_command command "curl --$curl_data_option={} http://bench.invalid/ota/update")" deny
done
guard_case "curl URL-glob OTA POST is denied" \
    "$(payload exec_command command "curl -X POST 'http://bench.invalid/{ota,ignored}/update'")" deny
guard_case "HTTPie implicit-data OTA POST is denied" \
    "$(payload exec_command command "http http://bench.invalid/ota/update after=7")" deny
guard_case "xh implicit-data OTA POST is denied" \
    "$(payload exec_command command "xh http://bench.invalid/ota/update after=7")" deny
guard_case "HTTPie POST after global options is denied" \
    "$(payload exec_command command "http --verify=no --timeout=5 POST http://bench.invalid/ota/update")" deny
ota_lease_url="http://bench.invalid/ota/update?after=7&channel=dev&version=1.2.3-dev.4&sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ota_lease_path="/ota/update?after=7&channel=dev&version=1.2.3-dev.4&sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
guard_case "HTTPie raw-body inferred OTA POST is denied" \
    "$(payload exec_command command "http --raw={} http://bench.invalid/ota/update")" deny
guard_case "xh equals-form raw-body inferred OTA POST is denied" \
    "$(payload exec_command command "xh --raw={} http://bench.invalid/ota/update")" deny
guard_case "HTTPie redirected-stdin inferred OTA POST is denied" \
    "$(payload exec_command command "http http://bench.invalid/ota/update Content-Type:application/json < /tmp/body.json")" deny
guard_case "HTTPie exact-query redirected-stdin inferred OTA POST is denied" \
    "$(payload exec_command command "http \"$ota_lease_url\" Content-Type:application/json < /tmp/body.json")" deny
guard_case "HTTPie piped-stdin inferred OTA POST is denied" \
    "$(payload exec_command command "printf '{}' | http http://bench.invalid/ota/update Content-Type:application/json")" deny
guard_case "timeout-wrapped HTTPie OTA POST is denied" \
    "$(payload exec_command command "timeout 5 http POST \"$ota_lease_url\"")" deny
guard_case "setsid-wrapped HTTPie OTA POST is denied" \
    "$(payload exec_command command "setsid http POST \"$ota_lease_url\"")" deny
guard_case "stdbuf-wrapped HTTPie OTA POST is denied" \
    "$(payload exec_command command "stdbuf -oL http POST \"$ota_lease_url\"")" deny
guard_case "xargs-wrapped HTTPie OTA POST is denied" \
    "$(payload exec_command command "printf x | xargs http POST \"$ota_lease_url\"")" deny
guard_case "find-exec HTTPie OTA POST is denied" \
    "$(payload exec_command command "find /tmp -maxdepth 0 -exec http POST \"$ota_lease_url\" {} +")" deny
guard_case "raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "printf 'POST /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "quote-split raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "printf 'PO''ST /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
ansi_raw_ota_command="printf \$'\\x50OST /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80"
guard_case "ANSI-C raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "$ansi_raw_ota_command")" deny
brace_raw_ota_command="printf P{OST,UT}' /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80"
guard_case "brace-expanded raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "$brace_raw_ota_command")" deny
guard_case "default-expansion raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "printf \${x:-POST}' /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "split-variable raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "a=PO; b=ST; printf \$a\$b' /ota/update?after=7 HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
assigned_raw_ota_command="req='POST $ota_lease_path HTTP/1.1\\r\\n\\r\\n'; printf %b \"\$req\" | nc bench.invalid 80"
guard_case "assigned raw netcat HTTP OTA POST is denied" \
    "$(payload exec_command command "$assigned_raw_ota_command")" deny
brace_format_raw_ota_command="printf '%s $ota_lease_path HTTP/1.1\\r\\n\\r\\n' P{OST,UT} | nc bench.invalid 80"
guard_case "brace argument can build a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "$brace_format_raw_ota_command")" deny
guard_case "default-expansion argument can build a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "printf '%s $ota_lease_path HTTP/1.1\\r\\n\\r\\n' \${x:-POST} | nc bench.invalid 80")" deny
guard_case "printf fields can assemble a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "printf '%s%s $ota_lease_path HTTP/1.1\\r\\nHost: bench.invalid\\r\\nContent-Length: 0\\r\\n\\r\\n' PO ST | nc bench.invalid 80")" deny
guard_case "printf hex escape can assemble a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "printf '\\x50OST $ota_lease_path HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "printf percent-b hex escape can assemble a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "printf '%b' '\\x50OST $ota_lease_path HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "printf octal escape can assemble a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "printf '\\120OST $ota_lease_path HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "echo escape can assemble a raw netcat HTTP OTA POST" \
    "$(payload exec_command command "echo -e '\\x50OST $ota_lease_path HTTP/1.1\\r\\n\\r\\n' | nc bench.invalid 80")" deny
guard_case "arbitrary raw OTA request over netcat is fail-closed" \
    "$(payload exec_command command "awk 'BEGIN { print \"GET $ota_lease_path HTTP/1.1\\r\\n\\r\\n\" }' | nc bench.invalid 80")" deny
dev_tcp_raw_ota_command="bash -c 'printf \"POST $ota_lease_path HTTP/1.1\\r\\nHost: bench.invalid\\r\\n\\r\\n\" > /dev/tcp/bench.invalid/80'"
guard_case "Bash dev-tcp raw HTTP OTA POST is denied" \
    "$(payload exec_command command "$dev_tcp_raw_ota_command")" deny
guard_case "printf fields cannot assemble a dev-tcp HTTP OTA POST" \
    "$(payload exec_command command "bash -c 'printf \"%s%s $ota_lease_path HTTP/1.1\\r\\nHost: bench.invalid\\r\\nContent-Length: 0\\r\\n\\r\\n\" PO ST > /dev/tcp/bench.invalid/80'")" deny
guard_case "printf raw HTTP OTA POST over telnet is denied" \
    "$(payload exec_command command "(printf 'POST $ota_lease_path HTTP/1.1\\r\\nContent-Length: 1\\r\\n\\r\\n'; printf x) | telnet bench.invalid 80")" deny
guard_case "generic requests direct OTA POST is denied" \
    "$(payload exec_command command "python3 -c 'import requests; requests.request(\"POST\", \"http://bench.invalid/ota/update\")'")" deny
guard_case "urllib inferred direct OTA POST is denied" \
    "$(payload exec_command command "python3 -c 'import urllib.request as u; u.urlopen(u.Request(\"http://bench.invalid/ota/update\",data=b\"x\"))'")" deny
guard_case "urllib direct-url inferred OTA POST is denied" \
    "$(payload exec_command command "python3 -c 'import urllib.request as u; u.urlopen(\"http://bench.invalid/ota/update\", data=b\"x\")'")" deny
guard_case "urllib direct-url positional OTA POST is denied" \
    "$(payload exec_command command "python3 -c 'import urllib.request as u; u.urlopen(\"http://bench.invalid/ota/update\", b\"x\")'")" deny
guard_case "urllib positional-Request inferred OTA POST is denied" \
    "$(payload exec_command command "python3 -c 'import urllib.request as u; u.urlopen(u.Request(\"http://bench.invalid/ota/update\", b\"x\"))'")" deny
guard_case "PowerShell direct OTA POST is denied" \
    "$(payload exec_command command "pwsh -Command 'Invoke-WebRequest http://bench.invalid/ota/update -Method POST'")" deny
guard_case "wget direct OTA POST is denied" \
    "$(payload exec_command command "wget --post-data=x http://bench.invalid/ota/update")" deny
guard_case "percent-encoded direct OTA POST is denied" \
    "$(payload exec_command command "curl -X POST http://bench.invalid/ota%2Fupdate")" deny
guard_case "dynamic-variable direct OTA POST is denied" \
    "$(payload exec_command command 'part=/ota; curl -X POST http://bench.invalid${part}/update')" deny
guard_case "dynamic-substitution direct OTA POST is denied" \
    "$(payload exec_command command 'curl -X POST http://bench.invalid/$(printf ota)/update')" deny
guard_case "split-variable direct OTA POST is denied" \
    "$(payload exec_command command 'a=ot; b=a; curl -X POST http://bench.invalid/$a$b/update')" deny
guard_case "default-expansion direct OTA POST is denied" \
    "$(payload exec_command command 'curl -X POST http://bench.invalid/o${x:-ta}/update')" deny
guard_case "split-variable curl OTA method is denied" \
    "$(payload exec_command command 'a=PO; b=ST; curl -X $a$b http://bench.invalid/ota/update')" deny
guard_case "default-expansion curl OTA method is denied" \
    "$(payload exec_command command 'curl -X P${x:-OST} http://bench.invalid/ota/update')" deny
guard_case "clustered curl XPOST OTA method is denied" \
    "$(payload exec_command command "curl -sXPOST \"$ota_lease_url\"")" deny
guard_case "clustered curl X with following POST is denied" \
    "$(payload exec_command command "curl -sX POST \"$ota_lease_url\"")" deny
guard_case "long clustered curl XPOST OTA method is denied" \
    "$(payload exec_command command "curl -fsSXPOST \"$ota_lease_url\"")" deny
guard_case "clustered curl data OTA POST is denied" \
    "$(payload exec_command command "curl -sd '{}' -H Content-Type:application/json \"$ota_lease_url\"")" deny
guard_case "clustered curl form OTA POST is denied" \
    "$(payload exec_command command "curl -sF x=y -H Content-Type:application/json \"$ota_lease_url\"")" deny
guard_case "curl GET flag cannot mask split-variable OTA method" \
    "$(payload exec_command command "a=PO; b=ST; curl -G -X \$a\$b \"$ota_lease_url\"")" deny
guard_case "curl GET flag cannot mask default-expansion OTA method" \
    "$(payload exec_command command "curl -G -X P\${x:-OST} \"$ota_lease_url\"")" deny
guard_case "curl long GET flag cannot mask split-variable OTA method" \
    "$(payload exec_command command "a=PO; b=ST; curl --get --request=\$a\$b \"$ota_lease_url\"")" deny
guard_case "curl GET flag cannot mask substituted OTA method" \
    "$(payload exec_command command "curl -G -X \"\$(printf P%sT OS)\" \"$ota_lease_url\"")" deny
guard_case "curl long GET flag cannot mask substituted OTA method" \
    "$(payload exec_command command "curl --get --request=\"\$(printf P%sT OS)\" \"$ota_lease_url\"")" deny
guard_case "curl next transfer cannot mask an earlier dynamic OTA POST" \
    "$(payload exec_command command "a=PO; b=ST; curl -X \$a\$b \"$ota_lease_url\" --next -X GET http://example.invalid/health")" deny
guard_case "curl next HEAD transfer cannot mask an earlier default OTA POST" \
    "$(payload exec_command command "curl -X P\${x:-OST} \"$ota_lease_url\" --next -X HEAD http://example.invalid/health")" deny
guard_case "curl short next transfer cannot mask an earlier dynamic OTA POST" \
    "$(payload exec_command command "a=PO; b=ST; curl -X \$a\$b \"$ota_lease_url\" -: -X GET http://example.invalid/health")" deny
guard_case "clustered curl short next cannot mask an earlier dynamic OTA POST" \
    "$(payload exec_command command "a=PO; b=ST; curl -X \$a\$b \"$ota_lease_url\" -s: -X HEAD http://example.invalid/health")" deny
guard_case "split-variable HTTPie OTA method is denied" \
    "$(payload exec_command command 'a=PO; b=ST; http $a$b http://bench.invalid/ota/update')" deny
guard_case "split-variable wget OTA method is denied" \
    "$(payload exec_command command 'a=PO; b=ST; wget --method=$a$b http://bench.invalid/ota/update')" deny
guard_case "earlier wget GET cannot mask later dynamic OTA method" \
    "$(payload exec_command command "a=PO; b=ST; wget --method=GET --method=\$a\$b \"$ota_lease_url\"")" deny
guard_case "separated wget GET cannot mask later substituted OTA method" \
    "$(payload exec_command command "wget --method GET --method=\"\$(printf P%sT OS)\" \"$ota_lease_url\"")" deny
guard_case "wget execute post-file OTA POST is denied" \
    "$(payload exec_command command "wget --execute='post_file=/tmp/app.bin' \"$ota_lease_url\"")" deny
guard_case "wget short execute post-file OTA POST is denied" \
    "$(payload exec_command command "wget -e 'post_file=/tmp/app.bin' \"$ota_lease_url\"")" deny
guard_case "wget clustered execute post-file OTA POST is denied" \
    "$(payload exec_command command "wget -qe 'post_file=/tmp/app.bin' \"$ota_lease_url\"")" deny
guard_case "wget attached clustered execute OTA POST is denied" \
    "$(payload exec_command command "wget -qepost_file=/tmp/app.bin \"$ota_lease_url\"")" deny
guard_case "wget page-requisites cluster cannot mask execute OTA POST" \
    "$(payload exec_command command "wget -pe 'post_file=/tmp/app.bin' \"$ota_lease_url\"")" deny
guard_case "wget attached page-requisites cluster cannot mask execute OTA POST" \
    "$(payload exec_command command "wget -pepost_file=/tmp/app.bin \"$ota_lease_url\"")" deny
guard_case "wget abbreviated execute OTA POST is denied" \
    "$(payload exec_command command "wget --exec=post_file=/tmp/app.bin \"$ota_lease_url\"")" deny
guard_case "wget abbreviated post-file OTA POST is denied" \
    "$(payload exec_command command "wget --post-f=/tmp/app.bin \"$ota_lease_url\"")" deny
guard_case "wget abbreviated post-data OTA POST is denied" \
    "$(payload exec_command command "wget --post-d=x \"$ota_lease_url\"")" deny
guard_case "wget abbreviated method OTA POST is denied" \
    "$(payload exec_command command "wget --meth=POST \"$ota_lease_url\"")" deny
guard_case "explicit WGETRC cannot synthesize an OTA POST" \
    "$(payload exec_command command "WGETRC=/tmp/ota-wgetrc wget \"$ota_lease_url\"")" deny
guard_case "wget config file cannot synthesize an OTA POST" \
    "$(payload exec_command command "wget --config=/tmp/ota-wgetrc \"$ota_lease_url\"")" deny
guard_case "wget separated config file cannot synthesize an OTA POST" \
    "$(payload exec_command command "wget --config /tmp/ota-wgetrc \"$ota_lease_url\"")" deny
guard_case "wget abbreviated config file cannot synthesize an OTA POST" \
    "$(payload exec_command command "wget --conf=/tmp/ota-wgetrc \"$ota_lease_url\"")" deny
guard_case "brace-expanded curl OTA method is denied" \
    "$(payload exec_command command 'curl -X P{OST,UT} http://bench.invalid/ota/update')" deny
guard_case "equals brace-expanded curl OTA method is denied" \
    "$(payload exec_command command 'curl --request=P{UT,OST} http://bench.invalid/ota/update')" deny
guard_case "read-only OTA update GET remains allowed" \
    "$(payload exec_command command "curl -fsS http://bench.invalid/ota/update")" ""
guard_case "read-only OTA GET with metadata query remains allowed" \
    "$(payload exec_command command "curl -fsS http://bench.invalid/ota/update?metadata=x")" ""
guard_case "read-only OTA GET with json query remains allowed" \
    "$(payload exec_command command "curl -fsS http://bench.invalid/ota/update?json=x")" ""
guard_case "curl GET override with data remains allowed" \
    "$(payload exec_command command "curl -G --data after=7 http://bench.invalid/ota/update")" ""
guard_case "clustered curl GET with data remains allowed" \
    "$(payload exec_command command "curl -sGd after=7 http://bench.invalid/ota/update")" ""
guard_case "curl explicit GET with data remains allowed" \
    "$(payload exec_command command "curl --request GET --data after=7 http://bench.invalid/ota/update")" ""
guard_case "curl explicit GET with dynamic header remains allowed" \
    "$(payload exec_command command 'curl --request GET -H "X-Test: $value" http://bench.invalid/ota/update')" ""
guard_case "HTTPie explicit GET with dynamic header remains allowed" \
    "$(payload exec_command command 'http GET http://bench.invalid/ota/update "X-Test:$value"')" ""
guard_case "later literal wget GET overrides an earlier dynamic method" \
    "$(payload exec_command command 'a=PO; b=ST; wget --method=$a$b --method=GET http://bench.invalid/ota/update')" ""
guard_case "wget domains option value containing e remains a GET" \
    "$(payload exec_command command "wget -Dbench.invalid --method=GET \"$ota_lease_url\"")" ""
guard_case "wget reject extension value containing e remains a GET" \
    "$(payload exec_command command "wget -Rexe --method=GET \"$ota_lease_url\"")" ""
guard_case "curl HEAD with data remains a read-only method" \
    "$(payload exec_command command "curl -X HEAD --data x http://bench.invalid/ota/update")" ""
guard_case "curl GET query containing post remains allowed" \
    "$(payload exec_command command "curl -fsS 'http://bench.invalid/ota/update?status=post'")" ""
guard_case "read-only source search for raw OTA POST remains allowed" \
    "$(payload exec_command command "rg -n 'POST /ota/update' main/http_ota.cpp")" ""
guard_case "unrelated literal update write with another dynamic token remains allowed" \
    "$(payload exec_command command 'token=$X curl -X POST http://example.invalid/update -d quota=1')" ""
guard_case "read-only source search may mention the OTA route" \
    "$(payload exec_command command "rg -n '/ota/update' main/http_ota.cpp")" ""
guard_case "read-only source inspection may name the production gate" \
    "$(payload exec_command command "sed -n '1,80p' scripts/production-ota-gate.py")" ""
guard_case "quote-split production OTA path is denied" \
    "$(payload exec_command command "python3 -c 'import requests; requests.post(\"http://production.invalid/ota/\" + \"update\")'")" deny
guard_case "foreign production gate copy is denied" \
    "$(payload exec_command command "/tmp/production-ota-gate.py --execute")" deny
canonical_ota_gate="$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-current-version 1.2.3 --confirm-production production --execute"
guard_case "canonical argument-bound production OTA gate is allowed" \
    "$(payload exec_command command "$canonical_ota_gate")" ""
canonical_bench_ota_gate="$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-current-version 1.2.3-dev.3 --confirm-bench bench --install-bench"
guard_case "canonical argument-bound bench-only OTA gate is allowed" \
    "$(payload exec_command command "$canonical_bench_ota_gate")" ""
guard_case "canonical bench gate cannot be chained into a watcher" \
    "$(payload exec_command command "$canonical_bench_ota_gate; curl -sS http://bench.invalid/status")" deny
guard_case "bench gate cannot name the production confirmation too" \
    "$(payload exec_command command "$canonical_bench_ota_gate --confirm-production production")" deny
guard_case "bench gate requires the exact private-inventory role name" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-current-version 1.2.3-dev.3 --confirm-bench production --install-bench")" deny
guard_case "bench gate rejects a duplicate action" \
    "$(payload exec_command command "$canonical_bench_ota_gate --install-bench")" deny
guard_case "bench gate rejects an arbitrary host override" \
    "$(payload exec_command command "$canonical_bench_ota_gate --host bench.invalid")" deny
guard_case "bench gate rejects a test bypass" \
    "$(payload exec_command command "$canonical_bench_ota_gate --skip-tests")" deny
guard_case "bench gate rejects production execution" \
    "$(payload exec_command command "$canonical_bench_ota_gate --execute")" deny
guard_case "bench gate rejects a redundant current-version lease" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-current-version 1.2.3-dev.4 --confirm-bench bench --install-bench")" deny
guard_case "bench gate rejects an interpreter wrapper" \
    "$(payload exec_command command "python3 $canonical_bench_ota_gate")" deny
guard_case "bench gate rejects an env split-string wrapper" \
    "$(payload exec_command command "env -S '$canonical_bench_ota_gate'")" deny
guard_case "bench gate rejects an attached env split-string wrapper" \
    "$(payload exec_command command "env -S'$canonical_bench_ota_gate'")" deny
guard_case "bench gate rejects an equals env split-string wrapper" \
    "$(payload exec_command command "env --split-string='$canonical_bench_ota_gate'")" deny
guard_case "git shell alias cannot wrap the bench gate" \
    "$(payload exec_command command "git -c alias.ota='!$canonical_bench_ota_gate' ota")" deny
glob_bench_args="${canonical_bench_ota_gate#*production-ota-gate.py }"
guard_case "shell question-glob cannot execute the canonical bench gate" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.?y $glob_bench_args")" deny
guard_case "shell bracket-glob cannot execute the canonical bench gate" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.p[y] $glob_bench_args")" deny
guard_case "copy-then-execute cannot create a renamed gate alias" \
    "$(payload exec_command command "cp $root/scripts/production-ota-gate.?y $tmp/run-ota-new; $tmp/run-ota-new $glob_bench_args")" deny
guard_case "split-variable canonical gate executable is denied" \
    "$(payload exec_command command "a=production-ota-; b=gate.py; scripts/\$a\$b $glob_bench_args")" deny
guard_case "default-expansion canonical gate executable is denied" \
    "$(payload exec_command command "scripts/production-ota-\${x:-gate.py} $glob_bench_args")" deny
guard_case "split-variable canonical scripts path is denied" \
    "$(payload exec_command command "a=scripts/production-; b=ota-gate.py; ./\$a\$b $glob_bench_args")" deny
guard_case "split-variable canonical basename is denied" \
    "$(payload exec_command command "a=./scripts/prod; b=uction-ota-gate.py; \$a\$b $glob_bench_args")" deny
ln -s "$root/scripts/production-ota-gate.py" "$tmp/production-ota-gate.py"
guard_case "bench gate rejects a symlink alias" \
    "$(payload exec_command command "$tmp/production-ota-gate.py ${canonical_bench_ota_gate#*production-ota-gate.py }")" deny
ln -s "$root/scripts/production-ota-gate.py" "$tmp/run-ota"
guard_case "bench gate rejects a differently named symlink alias" \
    "$(payload exec_command command "$tmp/run-ota ${canonical_bench_ota_gate#*production-ota-gate.py }")" deny
guard_case "env split-string cannot wrap a differently named symlink alias" \
    "$(payload exec_command command "env -S '$tmp/run-ota ${canonical_bench_ota_gate#*production-ota-gate.py }'")" deny
guard_case "attached env split-string cannot wrap a differently named symlink alias" \
    "$(payload exec_command command "env -S'$tmp/run-ota ${canonical_bench_ota_gate#*production-ota-gate.py }'")" deny
guard_case "equals env split-string cannot wrap a differently named symlink alias" \
    "$(payload exec_command command "env --split-string='$tmp/run-ota ${canonical_bench_ota_gate#*production-ota-gate.py }'")" deny
guard_case "xargs cannot wrap a differently named symlink alias" \
    "$(payload exec_command command "printf x | xargs $tmp/run-ota")" deny
cp "$root/scripts/production-ota-gate.py" "$tmp/copied-ota"
guard_case "bench gate rejects a differently named exact copy" \
    "$(payload exec_command command "$tmp/copied-ota ${canonical_bench_ota_gate#*production-ota-gate.py }")" deny
guard_case "git pager cannot execute a differently named gate alias" \
    "$(payload exec_command command "git grep --open-files-in-pager='sh -c \"$tmp/run-ota $glob_bench_args\"' daikin -- AGENTS.md")" deny
guard_case "Git external diff cannot execute a differently named gate alias" \
    "$(payload exec_command command "GIT_EXTERNAL_DIFF='sh -c \"$tmp/run-ota $glob_bench_args\" ignored' git diff --no-index /dev/null AGENTS.md")" deny
guard_case "canonical production gate cannot be chained into a watcher" \
    "$(payload exec_command command "$canonical_ota_gate; curl -X POST http://production.invalid/ota/update")" deny
guard_case "production staging without execution is not an admitted agent shape" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")" deny
guard_case "production gate requires explicit current version" \
    "$(payload exec_command command "$root/scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha abcdef1234567890abcdef1234567890abcdef12 --expected-version 1.2.3-dev.4 --expected-app-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --confirm-production production --execute")" deny
guard_case "dynamic curl executable cannot perform a GitHub REST write" \
    "$(payload exec_command command "c=curl; \"\$c\" --request DELETE https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/x")" deny
guard_case "dynamic curl executable cannot hide a GitHub target in --url" \
    "$(payload exec_command command "c=curl; \"\$c\" --url=https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/x --request DELETE")" deny
guard_case "dynamic curl executable cannot import a config file" \
    "$(payload exec_command command "c=curl; \"\$c\" --config /tmp/curl-selftest.conf")" deny
guard_case "substituted curl executable cannot perform a GitHub REST write" \
    "$(payload exec_command command "\"\$(printf curl)\" -X POST https://api.github.com/repos/0Bu/daikin-altherma-esp32/issues -d title=x")" deny
guard_case "credential wrapper rejects every GraphQL mutation" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api graphql -f 'query=mutation { createRef(input:{name:\"refs/heads/x\"}) { clientMutationId } }'")" deny
guard_case "REST option value cannot impersonate the GraphQL endpoint" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api --method POST --preview graphql repos/0Bu/daikin-altherma-esp32/git/refs -f ref=refs/heads/x -f sha=abcdef1234567890abcdef1234567890abcdef12")" deny
guard_case "credential wrapper jq environment output is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api user --jq 'env.GH_TOKEN'")" deny
guard_case "credential wrapper clustered jq output is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api user -iqenv.GH_TOKEN")" deny
guard_case "credential wrapper template output is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api user --template '{{.}}'")" deny
guard_case "credential wrapper verbose assignment is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api user --verbose=true")" deny
guard_case "credential wrapper short browser flag is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr view 5 -w")" deny
guard_case "credential wrapper short editor flag is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh issue create -e")" deny
guard_case "credential wrapper mixed-case absolute URL is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh api HtTpS://ghe.example/user")" deny
guard_case "credential wrapper short body-file input is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr edit 5 -F /tmp/body.md")" deny
guard_case "credential wrapper positional foreign repository is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh repo view ghe.example/owner/repo")" deny
guard_case "credential wrapper SSH-style foreign repository is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh repo view git@ghe.example:owner/repo")" deny
guard_case "credential wrapper built-in checkout alias is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr co 5")" deny
guard_case "credential wrapper branch-deleting close is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr close 5 --delete-branch")" deny
guard_case "credential wrapper release asset verification is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh release verify-asset artifact.bin")" deny
guard_case "credential wrapper raw terminal escape output is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh repo read-file owner/repo:path --allow-escape-sequences")" deny
guard_case "credential wrapper release download is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh release download v1.2.3")" deny
guard_case "credential wrapper run download is denied" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh run download 123")" deny
guard_case "credential wrapper rejects Git config injection" \
    "$(payload exec_command command "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=/tmp/selftest-helper $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects quoted loader injection" \
    "$(payload exec_command command "env 'LD_PRELOAD=/tmp/selftest-preload.so' $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects split-string loader injection" \
    "$(payload exec_command command "env -S'LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credentials.sh pr view 5'")" deny
guard_case "credential wrapper rejects a dynamically named loader assignment" \
    "$(payload exec_command command "n=LD_PRELOAD; env \"\$n=/tmp/selftest-preload.so\" $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects a substituted loader name" \
    "$(payload exec_command command "env \"\$(printf LD_PRELOAD)=/tmp/selftest-preload.so\" $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects chained execution context" \
    "$(payload exec_command command "$root/scripts/gh-with-git-credentials.sh pr view 5; echo done")" deny
guard_case "credential wrapper rejects quote-split executable injection" \
    "$(payload exec_command command "LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credential''s.sh pr view 5")" deny
guard_case "credential wrapper rejects globbed executable injection" \
    "$(payload exec_command command "LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credential?.sh pr view 5")" deny
line_continued_wrapper="LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credential"$'\\\n'"s.sh pr view 5"
guard_case "credential wrapper rejects line-continued executable injection" \
    "$(payload exec_command command "$line_continued_wrapper")" deny
guard_case "credential wrapper rejects nested Bash loader injection" \
    "$(payload exec_command command "bash -c 'LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credentials.sh pr view 5'")" deny
guard_case "credential wrapper rejects nested globbed loader injection" \
    "$(payload exec_command command "bash -c 'LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/g[h]-with-git-credential?.sh pr view 5'")" deny
guard_case "credential wrapper rejects eval loader injection" \
    "$(payload exec_command command "eval 'LD_PRELOAD=/tmp/selftest-preload.so $root/scripts/gh-with-git-credentials.sh pr view 5'")" deny
guard_case "credential wrapper rejects dynamic-loader injection" \
    "$(payload exec_command command "LD_AUDIT=/tmp/selftest-audit.so $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects proxy injection" \
    "$(payload exec_command command "HTTPS_PROXY=http://127.0.0.1:9 $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "credential wrapper rejects TLS-root injection" \
    "$(payload exec_command command "SSL_CERT_FILE=/tmp/selftest-ca.pem $root/scripts/gh-with-git-credentials.sh pr view 5")" deny
guard_case "dynamic GitHub executable cannot dump a token" \
    "$(payload exec_command command 'g=gh; "$g" auth token')" deny
guard_case "shell-wrapped GitHub auth token output is denied" \
    "$(payload exec_command command 'bash -c "gh auth token"')" deny
guard_case "backtick-wrapped GitHub auth token output is denied" \
    "$(payload exec_command command 'echo `gh auth token`')" deny
guard_case "multiline GitHub auth token output is denied" \
    "$(payload exec_command command $'echo safe\ngh auth token')" deny
guard_case "Git credential fill output is denied" \
    "$(payload exec_command command 'git credential fill')" deny
guard_case "dynamic Git credential fill output is denied" \
    "$(payload exec_command command 'g=git; "$g" credential fill')" deny
guard_case "AWS secret getter output is denied" \
    "$(payload exec_command command 'aws configure get aws_secret_access_key')" deny
guard_case "environment declarations are denied" \
    "$(payload exec_command command 'declare -px')" deny
guard_case "typeset environment declarations are denied" \
    "$(payload exec_command command 'typeset -p')" deny
guard_case "plus-flag environment declarations are denied" \
    "$(payload exec_command command 'declare +x')" deny
guard_case "named sensitive environment declaration is denied" \
    "$(payload exec_command command 'declare GH_TOKEN')" deny
guard_case "readonly environment listing is denied" \
    "$(payload exec_command command 'readonly -p')" deny
guard_case "combined shell flags cannot hide a token dump" \
    "$(payload exec_command command "bash -lc 'gh auth token'")" deny
guard_case "quoted command substitution cannot hide a token dump" \
    "$(payload exec_command command 'echo "$(gh auth token)"')" deny
guard_case "ordinary wrappers cannot hide a token dump" \
    "$(payload exec_command command 'time gh auth token')" deny
guard_case "stdin-executed shell is denied" \
    "$(payload exec_command command "printf '%s' 'gh auth token' | bash")" deny
guard_case "stdin shell flags are denied" \
    "$(payload exec_command command "printf '%s' 'gh auth token' | bash -s")" deny
guard_case "stdin shell wrapper is denied" \
    "$(payload exec_command command "printf '%s' 'gh auth token' | env bash")" deny
guard_case "credentials JSON shell path is denied" \
    "$(payload exec_command command 'cat credentials.json')" deny
guard_case "private SSH shell path is denied" \
    "$(payload exec_command command 'cat ~/.ssh/id_ed25519_sk')" deny
guard_case "private SSH Read target outside dot-ssh is denied" \
    "$(payload Read file_path '/tmp/id_ed25519_sk')" deny
guard_case "generic private-key Write target is denied" \
    "$(payload Write file_path '/tmp/private_key')" deny
guard_case "credential YAML Read target is denied" \
    "$(payload Read file_path '/tmp/credentials.yml')" deny
guard_case "quote-split private key shell path is denied" \
    "$(payload exec_command command "cat ota_signing_key.p''em")" deny
guard_case "private key glob shell path is denied" \
    "$(payload exec_command command 'cat ota_signing_key.p?m')" deny
guard_case "credential glob shell path is denied" \
    "$(payload exec_command command 'cat .git-cred*')" deny
guard_case "Git credential helper output is denied" \
    "$(payload exec_command command 'git credential-osxkeychain get')" deny
guard_case "Git credential executable output is denied" \
    "$(payload exec_command command 'git-credential-osxkeychain get')" deny
guard_case "dynamic Git credential executable output is denied" \
    "$(payload exec_command command 'g=git-credential-osxkeychain; "$g" get')" deny
guard_case "macOS keychain stderr credential output is denied" \
    "$(payload exec_command command 'security find-generic-password -g -s selftest')" deny
guard_case "qualified AWS credential getter is denied" \
    "$(payload exec_command command 'aws --profile prod configure get profile.prod.aws_secret_access_key')" deny
guard_case "global gcloud option cannot hide token output" \
    "$(payload exec_command command 'gcloud --project demo auth print-access-token')" deny
guard_case "global kubectl option cannot hide raw credentials" \
    "$(payload exec_command command 'kubectl --context harmless config view --raw')" deny
guard_case "kubectl raw assignment cannot expose credentials" \
    "$(payload exec_command command 'kubectl config view --raw=true')" deny
guard_case "Docker credential helper output is denied" \
    "$(payload exec_command command 'docker-credential-osxkeychain get')" deny
guard_case "dynamic Docker credential helper output is denied" \
    "$(payload exec_command command 'g=docker-credential-osxkeychain; "$g" get')" deny
guard_case "macOS identity export is denied" \
    "$(payload exec_command command 'security export -t identities -f pemseq')" deny
guard_case "dynamic macOS keychain credential output is denied" \
    "$(payload exec_command command 's=security; "$s" find-generic-password -w -s selftest')" deny
guard_case "private key brace expansion is denied" \
    "$(payload exec_command command 'cat ota_signing_key.{pem,bak}')" deny
guard_case "ANSI-C quoted private key suffix is denied" \
    "$(payload exec_command command "cat ota_signing_key.\$'pem'")" deny
guard_case "private key brace range is denied" \
    "$(payload exec_command command 'cat ota_signing_key.p{e..e}m')" deny
guard_case "locale-quoted private key suffix is denied" \
    "$(payload exec_command command 'cat ota_signing_key.p$"em"')" deny
guard_case "line-continued private key suffix is denied" \
    "$(payload exec_command command $'cat ota_signing_key.\\\npem')" deny
guard_case "deep static credential braces fail closed" \
    "$(payload exec_command command 'cat cred{e,e}{n,n}{t,t}{i,i}{a,a}{l,l}{s,s}.json')" deny
guard_case "combinatorial brace expansion fails closed without full expansion" \
    "$(payload exec_command command 'echo {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}')" deny
guard_case "Bash extglob is conservatively denied" \
    "$(payload exec_command command "bash -O extglob -c 'cat ota_signing_key.p@(em)'")" deny
guard_case "Malformed secret payload fails closed" "{" deny
guard_case "missing tool name fails closed" '{}' deny
guard_case "non-string tool name fails closed" \
    '{"tool_name":123,"tool_input":{"cmd":"cat ota_signing_key.pem"}}' deny
guard_case "unknown matched tool suffix fails closed" \
    '{"tool_name":"exec_command_v2","tool_input":{"cmd":"cat ota_signing_key.pem"}}' deny
guard_case "conflicting shell input aliases fail closed" \
    '{"cwd":"/tmp","tool_name":"exec_command","tool_input":{"command":"echo safe","cmd":"cat ota_signing_key.pem"}}' deny

guard_case "Canonical Edit partitions denies" \
    "$(payload Edit file_path "$root/partitions.csv")" deny
guard_case "Codex apply_patch partitions denies" \
    "$(payload apply_patch command $'*** Begin Patch\n*** Update File: partitions.csv\n@@\n-old\n+new\n*** End Patch')" deny
guard_case "Codex sed -i partitions denies" \
    "$(payload exec_command command "sed -i '' 's/a/b/' partitions.csv")" deny
guard_case "Codex sed --in-place partitions denies" \
    "$(payload exec_command command 'sed --in-place s/a/b/ partitions.csv')" deny
guard_case "Codex sed glob partitions denies" \
    "$(payload exec_command command "sed -i '' 's/a/b/' *.csv")" deny
guard_case "Codex Python glob partitions writer denies" \
    "$(payload exec_command command 'python3 -c '\''from pathlib import Path; [p.write_text("x") for p in Path(".").glob("*.csv")]'\''')" deny
guard_case "Codex partitions brace expansion denies" \
    "$(payload exec_command command 'rm partitions.{csv,bak}')" deny
guard_case "Codex split-name brace expansion denies" \
    "$(payload exec_command command 'rm partit{ions.csv,ions.bak}')" deny
guard_case "Codex partitions brace range denies" \
    "$(payload exec_command command 'rm partitions.c{s..s}v')" deny
guard_case "Codex locale-quoted partitions suffix denies" \
    "$(payload exec_command command 'rm partitions.c$"sv"')" deny
guard_case "Codex line-continued partitions name denies" \
    "$(payload exec_command command $'rm parti\\\ntions.csv')" deny
deep_partitions_command="sed -i '' 's/a/b/' part{it,it}{io,io}{ns,ns}{.,.}{cs,cs}{v,v}"
guard_case "Codex deep static partitions braces deny" \
    "$(payload exec_command command "$deep_partitions_command")" deny
guard_case "Codex partitions extglob is conservatively denied" \
    "$(payload exec_command command "bash -O extglob -c 'rm partitions.c@(sv)'")" deny
guard_case "Canonical tee partitions denies" \
    "$(payload Bash command 'printf x | tee partitions.csv')" deny
guard_case "Codex redirect partitions denies" \
    "$(payload exec_command command 'printf x > partitions.csv')" deny
guard_case "Codex cp destination partitions denies" \
    "$(payload exec_command command 'cp /tmp/new.csv ./partitions.csv')" deny
guard_case "Codex mv destination partitions denies" \
    "$(payload exec_command command 'mv /tmp/new.csv partitions.csv')" deny
guard_case "Codex unknown Python partitions writer denies" \
    "$(payload exec_command command 'python3 -c '\''open("partitions.csv", "w").write("changed")'\''')" deny
guard_case "Codex computed Python partitions writer denies" \
    "$(payload exec_command command 'python3 -c '\''open("partitions"+".csv", "w").write("changed")'\''')" deny
guard_case "Codex command-substituted partitions redirect denies" \
    "$(payload exec_command command 'printf x > "$(printf partitions).csv"')" deny
guard_case "Codex variable-built partitions redirect denies" \
    "$(payload exec_command command 'p=partitions; printf x > "$p.csv"')" deny
guard_case "Codex multiline partitions writer denies" \
    "$(payload exec_command command $'cat partitions.csv\npython3 -c '\''open("partitions.csv", "w").write("changed")'\''')" deny
guard_case "Codex read tool redirected onto partitions denies" \
    "$(payload exec_command command 'cat /tmp/new.csv > partitions.csv')" deny
guard_case "Codex quote-split partitions redirect denies" \
    "$(payload exec_command command "printf x > partition''s.csv")" deny
guard_case "Codex sed write-command partitions denies" \
    "$(payload exec_command command "sed -n 'w partitions.csv' /tmp/new.csv")" deny
guard_case "Codex git output option partitions denies" \
    "$(payload exec_command command 'git show --output partitions.csv HEAD')" deny
guard_case "Codex less output option partitions denies" \
    "$(payload exec_command command 'less -o partitions.csv /tmp/new.csv')" deny
guard_case "Codex narrow partitions read allowed" \
    "$(payload exec_command command 'head -n 10 partitions.csv')" ""
guard_case "Codex cat partitions read allowed" \
    "$(payload exec_command command 'cat partitions.csv')" ""
guard_case "Canonical partitions diff allowed" \
    "$(payload Bash command 'git diff -- partitions.csv')" ""

# Exercise the local GitHub wrapper without touching a real credential store. The fake
# credential-store command emits a harmless token through Git's line protocol; fake gh observes it
# only in its minimal environment and records argv without ever printing the token.
wrapper_bin="$tmp/wrapper-bin"
wrapper_args="$tmp/wrapper-args.txt"
wrapper_marker="$tmp/wrapper-git-called"
wrapper_child_marker="$tmp/wrapper-git-child-called"
wrapper_fail_toggle="$tmp/wrapper-git-fail"
wrapper_config_path="$tmp/wrapper-config-path.txt"
wrapper_remote_mismatch_toggle="$tmp/wrapper-remote-mismatch"
wrapper_created_mismatch_toggle="$tmp/wrapper-created-mismatch"
wrapper_created_lookup_fail_toggle="$tmp/wrapper-created-lookup-fail"
wrapper_ready_fail_toggle="$tmp/wrapper-ready-fail"
wrapper_published_lookup_fail_toggle="$tmp/wrapper-published-lookup-fail"
wrapper_published_mismatch_toggle="$tmp/wrapper-published-mismatch"
wrapper_closed_marker="$tmp/wrapper-pr-closed"
wrapper_ready_marker="$tmp/wrapper-pr-ready"
wrapper_replace_toggle="$tmp/wrapper-replace-ref"
wrapper_credential_file="$tmp/wrapper-credentials"
wrapper_hostile_config="$tmp/wrapper-hostile-config"
wrapper_injected_marker="$tmp/wrapper-injected-helper"
wrapper_injected_helper="$tmp/wrapper-injected-helper.sh"
mkdir -p "$wrapper_bin"
wrapper_fixture_root="$tmp_physical/wrapper-root"
cat >"$wrapper_bin/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = -c ] && [ "${2:-}" = core.fsmonitor=false ] \
    && [ "${3:-}" = -C ] && [ -n "${4:-}" ]; then
    [ "${4:-}" = __WRAPPER_PROJECT_ROOT__ ] || exit 91
    [ "${GIT_NO_REPLACE_OBJECTS:-}" = 1 ] || exit 92
    case "${5:-} ${6:-} ${7:-} ${8:-}" in
        "rev-parse --show-toplevel  ")
            printf '%s\n' "${4:-}"
            exit 0
            ;;
        "ls-files --error-unmatch -- scripts/gh-with-git-credentials.sh")
            printf '%s\n' scripts/gh-with-git-credentials.sh
            exit 0
            ;;
        "for-each-ref --format=%(refname) refs/replace ")
            if [ -e __WRAPPER_REPLACE_REF__ ]; then
                printf '%s\n' refs/replace/selftest
            fi
            exit 0
            ;;
        "symbolic-ref --quiet --short HEAD")
            printf '%s\n' agent/selftest-pr
            exit 0
            ;;
        "rev-parse --verify HEAD^{commit} ")
            printf '%s\n' abcdef1234567890abcdef1234567890abcdef12
            exit 0
            ;;
        "rev-parse --verify refs/remotes/origin/agent/selftest-pr^{commit} ")
            printf '%s\n' abcdef1234567890abcdef1234567890abcdef12
            exit 0
            ;;
        "status --porcelain=v1 --untracked-files=normal ")
            exit 0
            ;;
    esac
    exit 93
fi
if [ "$#" -eq 1 ] && [ "${1:-}" = selftest-child-probe ]; then
    for name in GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN; do
        [ -z "${!name+x}" ] || exit 79
    done
    case "${PATH:-}" in /tmp/daikin-gh-config.*/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin) ;; *) exit 78 ;; esac
    printf 'called\n' >__WRAPPER_CHILD_MARKER__
    exit 0
fi
[ "$#" -eq 4 ] || exit 80
[ "${1:-}" = credential-store ] && [ "${2:-}" = --file ] \
    && [ "${3:-}" = __WRAPPER_CREDENTIAL_FILE__ ] && [ "${4:-}" = get ] || exit 81
[ "$(cat)" = $'protocol=https\nhost=github.com' ] || exit 82
[ "${HOME:-}" = "${XDG_CONFIG_HOME:-}" ] || exit 83
case "${HOME:-}" in /tmp/daikin-gh-config.*) ;; *) exit 84 ;; esac
[ "$(pwd -P)" = "$(cd "$HOME" && pwd -P)" ] || exit 85
[ "${GIT_CONFIG_NOSYSTEM:-}" = 1 ] \
    && [ "${GIT_CONFIG_GLOBAL:-}" = /dev/null ] \
    && [ "${GIT_CONFIG_SYSTEM:-}" = /dev/null ] \
    && [ "${GIT_CEILING_DIRECTORIES:-}" = "$HOME" ] || exit 86
[ "${GIT_TERMINAL_PROMPT:-}" = 0 ] || exit 87
[ "${PATH:-}" = /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ] || exit 88
if [ "${GIT_CONFIG_COUNT:-}" = 1 ] && [ -x "${GIT_CONFIG_VALUE_0:-}" ]; then
    "${GIT_CONFIG_VALUE_0}"
fi
for name in GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_DIR GIT_EXEC_PATH \
    LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH \
    HTTP_PROXY HTTPS_PROXY ALL_PROXY SSL_CERT_FILE SSL_CERT_DIR token; do
    [ -z "${!name+x}" ] || exit 89
done
printf 'called\n' >>__WRAPPER_MARKER__
printf '%s\n' 'protocol=https' 'host=github.com' 'username=selftest' \
    'password=selftest-wrapper-token'
[ ! -e __WRAPPER_FAIL_TOGGLE__ ] || exit 42
EOF
cat >"$wrapper_bin/gh" <<'EOF'
#!/usr/bin/env bash
[ "${GH_HOST:-}" = github.com ] || exit 90
[ "${GH_TOKEN:-}" = selftest-wrapper-token ] || exit 91
[ "${GH_PROMPT_DISABLED:-}" = 1 ] || exit 92
[ "${GH_PAGER:-}" = cat ] && [ "${PAGER:-}" = cat ] \
    && [ "${GIT_PAGER:-}" = cat ] || exit 93
[ "${GH_TELEMETRY:-}" = 0 ] && [ "${GH_NO_UPDATE_NOTIFIER:-}" = 1 ] \
    && [ "${GH_NO_EXTENSION_UPDATE_NOTIFIER:-}" = 1 ] || exit 105
[ "${GH_BROWSER:-}" = /usr/bin/false ] && [ "${BROWSER:-}" = /usr/bin/false ] || exit 94
[ "${GH_EDITOR:-}" = /usr/bin/false ] && [ "${EDITOR:-}" = /usr/bin/false ] \
    && [ "${VISUAL:-}" = /usr/bin/false ] && [ "${GIT_EDITOR:-}" = /usr/bin/false ] || exit 95
[ -n "${GH_CONFIG_DIR:-}" ] && [ -d "$GH_CONFIG_DIR" ] || exit 96
[ "${HOME:-}" = "$GH_CONFIG_DIR" ] && [ "${XDG_CONFIG_HOME:-}" = "$GH_CONFIG_DIR" ] \
    && [ "${TMPDIR:-}" = "$GH_CONFIG_DIR" ] || exit 97
[ "$(pwd -P)" = "$(cd "$GH_CONFIG_DIR" && pwd -P)" ] || exit 102
[ ! -e "$GH_CONFIG_DIR/config.yml" ] || exit 98
[ "${GH_CONFIG_DIR:-}" != __WRAPPER_HOSTILE_CONFIG__ ] || exit 99
case "${PATH:-}" in /tmp/daikin-gh-config.*/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin) ;; *) exit 100 ;; esac
for name in GITHUB_TOKEN GH_ENTERPRISE_TOKEN GIT_SSH_COMMAND GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 \
    GIT_CONFIG_VALUE_0 GIT_DIR GIT_EXEC_PATH LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH \
    DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH HTTP_PROXY HTTPS_PROXY ALL_PROXY \
    SSL_CERT_FILE SSL_CERT_DIR token; do
    [ -z "${!name+x}" ] || exit 101
done
if /usr/bin/env | /usr/bin/grep -Eq '^(BAD-NAME|9BAD|BASH_FUNC_evil%%)='; then exit 103; fi
if [ "$*" = "api --hostname github.com --method GET repos/0Bu/daikin-altherma-esp32/git/ref/heads/agent/selftest-pr --jq .object.sha" ]; then
    if [ -e __WRAPPER_REMOTE_MISMATCH__ ]; then
        printf '%s\n' 0000000000000000000000000000000000000000
    else
        printf '%s\n' abcdef1234567890abcdef1234567890abcdef12
    fi
    exit 0
fi
if [ "${1:-} ${2:-} ${3:-} ${4:-}" = "--repo github.com/0Bu/daikin-altherma-esp32 pr create" ]; then
    [ "${!#}" = --draft ] || exit 106
    printf '%s\n' "$*" >__WRAPPER_ARGS__
    printf '%s\n' 'https://github.com/0Bu/daikin-altherma-esp32/pull/123'
    exit 0
fi
if [ "$*" = "pr view 123 --repo github.com/0Bu/daikin-altherma-esp32 --json headRefOid --jq .headRefOid" ]; then
    if [ -e __WRAPPER_CREATED_LOOKUP_FAIL__ ] && [ ! -e __WRAPPER_READY__ ]; then
        exit 107
    elif [ -e __WRAPPER_PUBLISHED_LOOKUP_FAIL__ ] && [ -e __WRAPPER_READY__ ]; then
        exit 108
    elif [ -e __WRAPPER_CREATED_MISMATCH__ ] && [ ! -e __WRAPPER_READY__ ]; then
        printf '%s\n' 0000000000000000000000000000000000000000
    elif [ -e __WRAPPER_PUBLISHED_MISMATCH__ ] && [ -e __WRAPPER_READY__ ]; then
        printf '%s\n' 0000000000000000000000000000000000000000
    else
        printf '%s\n' abcdef1234567890abcdef1234567890abcdef12
    fi
    exit 0
fi
if [ "$*" = "pr close 123 --repo github.com/0Bu/daikin-altherma-esp32" ]; then
    printf '%s\n' closed >__WRAPPER_CLOSED__
    exit 0
fi
if [ "$*" = "pr ready 123 --repo github.com/0Bu/daikin-altherma-esp32" ]; then
    [ ! -e __WRAPPER_READY_FAIL__ ] || exit 109
    printf '%s\n' ready >__WRAPPER_READY__
    exit 0
fi
git selftest-child-probe || exit 104
printf '%s\n' "$*" >__WRAPPER_ARGS__
printf '%s\n' "$GH_CONFIG_DIR" >__WRAPPER_CONFIG_PATH__
EOF
cat >"$wrapper_injected_helper" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' >__WRAPPER_INJECTED_MARKER__
exit 99
EOF
sed \
    -e "s#__WRAPPER_CREDENTIAL_FILE__#$wrapper_credential_file#g" \
    -e "s#__WRAPPER_MARKER__#$wrapper_marker#g" \
    -e "s#__WRAPPER_CHILD_MARKER__#$wrapper_child_marker#g" \
    -e "s#__WRAPPER_FAIL_TOGGLE__#$wrapper_fail_toggle#g" \
    -e "s#__WRAPPER_REPLACE_REF__#$wrapper_replace_toggle#g" \
    -e "s#__WRAPPER_PROJECT_ROOT__#$wrapper_fixture_root#g" \
    "$wrapper_bin/git" >"$wrapper_bin/git.rendered"
mv "$wrapper_bin/git.rendered" "$wrapper_bin/git"
sed \
    -e "s#__WRAPPER_HOSTILE_CONFIG__#$wrapper_hostile_config#g" \
    -e "s#__WRAPPER_ARGS__#$wrapper_args#g" \
    -e "s#__WRAPPER_CONFIG_PATH__#$wrapper_config_path#g" \
    -e "s#__WRAPPER_REMOTE_MISMATCH__#$wrapper_remote_mismatch_toggle#g" \
    -e "s#__WRAPPER_CREATED_MISMATCH__#$wrapper_created_mismatch_toggle#g" \
    -e "s#__WRAPPER_CREATED_LOOKUP_FAIL__#$wrapper_created_lookup_fail_toggle#g" \
    -e "s#__WRAPPER_READY_FAIL__#$wrapper_ready_fail_toggle#g" \
    -e "s#__WRAPPER_PUBLISHED_LOOKUP_FAIL__#$wrapper_published_lookup_fail_toggle#g" \
    -e "s#__WRAPPER_PUBLISHED_MISMATCH__#$wrapper_published_mismatch_toggle#g" \
    -e "s#__WRAPPER_CLOSED__#$wrapper_closed_marker#g" \
    -e "s#__WRAPPER_READY__#$wrapper_ready_marker#g" \
    -e "s#__WRAPPER_REPLACE_REF__#$wrapper_replace_toggle#g" \
    "$wrapper_bin/gh" >"$wrapper_bin/gh.rendered"
mv "$wrapper_bin/gh.rendered" "$wrapper_bin/gh"
sed -e "s#__WRAPPER_INJECTED_MARKER__#$wrapper_injected_marker#g" \
    "$wrapper_injected_helper" >"$wrapper_injected_helper.rendered"
mv "$wrapper_injected_helper.rendered" "$wrapper_injected_helper"
chmod +x "$wrapper_bin/git" "$wrapper_bin/gh" "$wrapper_injected_helper"
: >"$wrapper_credential_file"
mkdir -p "$wrapper_fixture_root/scripts" "$wrapper_fixture_root/tools/agent-hooks" \
    "$wrapper_fixture_root/tools/agent-policy"
cp "$root/tools/agent-hooks/pr-gate-lib.sh" "$wrapper_fixture_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/require-pr-gates.sh" "$wrapper_fixture_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/merge_payload.py" "$wrapper_fixture_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/run_with_timeout.py" "$wrapper_fixture_root/tools/agent-hooks/"
cp "$root/tools/agent-policy/extract_changed_files.py" "$wrapper_fixture_root/tools/agent-policy/"
chmod +x "$wrapper_fixture_root/tools/agent-hooks/require-pr-gates.sh"
wrapper_under_test="$wrapper_fixture_root/scripts/gh-with-git-credentials.sh"
wrapper_python="$(command -v python3)"
sed \
    -e "s#^GH_BINARY_CANDIDATES=.*#GH_BINARY_CANDIDATES='$wrapper_bin/gh'#" \
    -e "s#^GIT_BINARY_CANDIDATES=.*#GIT_BINARY_CANDIDATES='$wrapper_bin/git'#" \
    -e "s#^PYTHON_BINARY_CANDIDATES=.*#PYTHON_BINARY_CANDIDATES='$wrapper_python'#" \
    -e "s#^    credential_file=.*#    credential_file='$wrapper_credential_file'#" \
    "$root/scripts/gh-with-git-credentials.sh" >"$wrapper_under_test"
chmod +x "$wrapper_under_test"
mkdir -p "$wrapper_hostile_config"
printf '%s\n' 'http_unix_socket: /tmp/untrusted.sock' >"$wrapper_hostile_config/config.yml"
rm -f "$wrapper_child_marker"
wrapper_out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
    GH_CONFIG_DIR="$wrapper_hostile_config" XDG_CONFIG_HOME="$wrapper_hostile_config" \
    GH_ENTERPRISE_TOKEN=selftest-enterprise-token \
    GH_PAGER=/tmp/untrusted-pager GH_BROWSER=/tmp/untrusted-browser \
    GH_EDITOR=/tmp/untrusted-editor GIT_SSH_COMMAND=/tmp/untrusted-ssh \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper \
    GIT_CONFIG_VALUE_0="$wrapper_injected_helper" GIT_DIR=/tmp/untrusted-git-dir \
    GIT_EXEC_PATH=/tmp/untrusted-git-exec GIT_CONFIG_NOSYSTEM=0 \
    GIT_CONFIG_GLOBAL=/tmp/untrusted-global-config \
    GIT_CONFIG_SYSTEM=/tmp/untrusted-system-config \
    GIT_CEILING_DIRECTORIES=/tmp/untrusted-ceiling HTTPS_PROXY=http://127.0.0.1:9 \
    HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=socks5://127.0.0.1:9 \
    SSL_CERT_FILE=/tmp/untrusted-ca.pem SSL_CERT_DIR=/tmp/untrusted-ca-dir \
    LD_AUDIT=/tmp/untrusted-audit.so \
    token=selftest-ambient-token \
    'BAD-NAME=selftest-invalid' '9BAD=selftest-invalid' \
    'BASH_FUNC_evil%%=() { printf injected; }' \
    "$wrapper_under_test" \
    pr view 5 --json number 2>&1)"; rc=$?
wrapper_seen_config="$(cat "$wrapper_config_path" 2>/dev/null || true)"
if [ "$rc" -eq 0 ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "pr view 5 --json number" ] \
    && [ -n "$wrapper_seen_config" ] && [ "$wrapper_seen_config" != "$wrapper_hostile_config" ] \
    && [ ! -e "$wrapper_seen_config" ] && [ -e "$wrapper_marker" ] && [ -e "$wrapper_child_marker" ] \
    && [ ! -e "$wrapper_injected_marker" ] \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  credential-store and gh ignore hostile Git, loader, proxy, and TLS state"; pass=$((pass + 1))
else
    echo "FAIL  GitHub credential wrapper isolation failed (rc=$rc output=$wrapper_out config=$wrapper_seen_config)" >&2
    fail=$((fail + 1))
fi

rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" pr view 5 --json number 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$wrapper_marker" ] && [ -z "$wrapper_out" ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "pr view 5 --json number" ]; then
    echo "PASS  pre-authenticated CI token bypasses Git credential lookup"; pass=$((pass + 1))
else
    echo "FAIL  pre-authenticated wrapper path touched Git credentials (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

tmp_physical="$(cd "$tmp" && pwd -P)"
wrapper_body_file="$tmp_physical/wrapper-body.md"
printf '%s\n' 'review body canary' >"$wrapper_body_file"
rm -f "$wrapper_args" "$wrapper_marker"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" pr edit 5 --body-file "$wrapper_body_file" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$wrapper_marker" ] && [ -z "$wrapper_out" ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "pr edit 5 --body review body canary" ]; then
    echo "PASS  PR body files are read before credential forwarding"; pass=$((pass + 1))
else
    echo "FAIL  safe PR body file was not converted before credential forwarding (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

rm -f "$wrapper_args" "$wrapper_marker"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title 'Selftest PR' \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$wrapper_marker" ] && [ -e "$wrapper_ready_marker" ] \
    && [ ! -e "$wrapper_closed_marker" ] \
    && [ "$wrapper_out" = 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "--repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title Selftest PR --body review body canary --draft" ]; then
    echo "PASS  exact noninteractive PR creation reaches gh without repository discovery"; pass=$((pass + 1))
else
    echo "FAIL  exact PR creation form was not preserved (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

rm -f "$wrapper_args"
: >"$wrapper_fail_toggle"
wrapper_out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
    "$wrapper_under_test" pr view 5 2>&1)"; rc=$?
rm -f "$wrapper_fail_toggle"
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'Git credential lookup failed'; then
    echo "PASS  failed Git credential lookup cannot forward a partial password"; pass=$((pass + 1))
else
    echo "FAIL  partial failed Git credential lookup reached gh (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

rm -f "$wrapper_args"
wrapper_out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
    /bin/bash -x \
    "$wrapper_under_test" pr view 5 --json number 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'invoke this executable directly' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  shell-wrapped tracing is rejected before credential resolution"; pass=$((pass + 1))
else
    echo "FAIL  shell tracing exposed or broke the GitHub credential wrapper (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

wrapper_untrusted_bin="$tmp/wrapper-untrusted-bin"
wrapper_bootstrap="$tmp/wrapper-bootstrap.sh"
wrapper_bootstrap_marker="$tmp/wrapper-bootstrap-called"
mkdir -p "$wrapper_untrusted_bin"
cat >"$wrapper_untrusted_bin/gh" <<'EOF'
#!/bin/bash
printf 'path-token=%s\n' "${GH_TOKEN:-}"
exit 99
EOF
cat >"$wrapper_bootstrap" <<'EOF'
printf 'bootstrap-token=%s\n' "${GH_TOKEN:-}" >"$SELFTEST_BOOTSTRAP_MARKER"
EOF
chmod +x "$wrapper_untrusted_bin/gh"
rm -f "$wrapper_args" "$wrapper_bootstrap_marker"
wrapper_out="$(env GH_TOKEN=selftest-wrapper-token \
    SELFTEST_BOOTSTRAP_MARKER="$wrapper_bootstrap_marker" /bin/bash -c '
        gh() { printf "function-token=%s\\n" "${GH_TOKEN:-}"; exit 98; }
        export -f gh
        BASH_ENV="$2" PATH="$3:/bin:/usr/bin" exec "$1" pr view 5 --json number
    ' _ "$wrapper_under_test" "$wrapper_bootstrap" "$wrapper_untrusted_bin" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$wrapper_bootstrap_marker" ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "pr view 5 --json number" ] \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  privileged wrapper ignores BASH_ENV, exported functions, and caller PATH"; pass=$((pass + 1))
else
    echo "FAIL  shell bootstrap or PATH injection reached the credential (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

wrapper_block_case() {
    local name="$1" needle="$2" out rc
    shift 2
    rm -f "$wrapper_marker" "$wrapper_args"
    out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
        "$wrapper_under_test" "$@" 2>&1)"; rc=$?
    if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] \
        && [ ! -e "$wrapper_args" ] \
        && printf '%s' "$out" | grep -qF -- "$needle" \
        && ! printf '%s' "$out" | grep -qF 'selftest-wrapper-token'; then
        echo "PASS  $name"; pass=$((pass + 1))
    else
        echo "FAIL  $name (rc=$rc output=$out credential-read=$([ -e "$wrapper_marker" ] && echo yes || echo no))" >&2
        fail=$((fail + 1))
    fi
}
wrapper_link="$tmp/wrapper-entry-link"
ln -s "$wrapper_under_test" "$wrapper_link"
rm -f "$wrapper_marker" "$wrapper_args"
wrapper_out="$(env GH_TOKEN=selftest-wrapper-token "$wrapper_link" pr view 5 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'must not be invoked through a symlink'; then
    echo "PASS  credential wrapper rejects a symlinked entry point"; pass=$((pass + 1))
else
    echo "FAIL  credential wrapper accepted a symlinked entry point (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
wrapper_foreign_dir="$tmp_physical/foreign-wrapper/scripts"
mkdir -p "$wrapper_foreign_dir"
cp "$wrapper_under_test" "$wrapper_foreign_dir/gh-with-git-credentials.sh"
chmod +x "$wrapper_foreign_dir/gh-with-git-credentials.sh"
wrapper_out="$(env GH_TOKEN=selftest-wrapper-token \
    "$wrapper_foreign_dir/gh-with-git-credentials.sh" pr view 5 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$wrapper_out" | grep -qF 'not inside a Git worktree'; then
    echo "PASS  credential wrapper rejects a copied foreign entry point"; pass=$((pass + 1))
else
    echo "FAIL  credential wrapper accepted a copied foreign entry point (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_marker" "$wrapper_args"
: >"$wrapper_replace_toggle"
wrapper_out="$(env GH_TOKEN=selftest-wrapper-token "$wrapper_under_test" pr view 5 2>&1)"; rc=$?
rm -f "$wrapper_replace_toggle"
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'replacement refs are forbidden'; then
    echo "PASS  credential wrapper rejects Git replacement refs"; pass=$((pass + 1))
else
    echo "FAIL  credential wrapper accepted Git replacement refs (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
wrapper_block_case "credential wrapper rejects a foreign hostname before lookup" \
    "only github.com is allowed" api --hostname ghe.example user
wrapper_block_case "credential wrapper rejects a foreign host-qualified repo before lookup" \
    "--repo must name github.com/OWNER/REPO" --repo ghe.example/owner/repo pr view 5
wrapper_block_case "credential wrapper rejects aliases before lookup" \
    "aliases and extensions are not allowed" alias list
wrapper_block_case "credential wrapper rejects extensions before lookup" \
    "aliases and extensions are not allowed" extension list
wrapper_block_case "credential wrapper rejects token-output commands before lookup" \
    "authentication commands are not allowed" auth token
wrapper_block_case "credential wrapper rejects absolute API targets before lookup" \
    "absolute API URLs are not allowed" api https://ghe.example/user
wrapper_block_case "credential wrapper rejects mixed-case absolute API targets before lookup" \
    "absolute API URLs are not allowed" api HtTpS://ghe.example/user
wrapper_block_case "credential wrapper rejects verbose request output before lookup" \
    "verbose request output is not allowed" api --verbose user
wrapper_block_case "credential wrapper rejects verbose assignments before lookup" \
    "verbose request output is not allowed" api user --verbose=true
wrapper_block_case "credential wrapper rejects jq environment output before lookup" \
    "jq and template formatting are not allowed" api user --jq 'env.GH_TOKEN'
wrapper_block_case "credential wrapper rejects combined jq output before lookup" \
    "jq and template formatting are not allowed" api user -qenv.GH_TOKEN
wrapper_block_case "credential wrapper rejects clustered jq output before lookup" \
    "combined short options are not allowed" api user -iqenv.GH_TOKEN
wrapper_block_case "credential wrapper rejects template output before lookup" \
    "jq and template formatting are not allowed" api user --template '{{.}}'
wrapper_block_case "credential wrapper rejects browser execution before lookup" \
    "browser and editor execution is not allowed" pr view 5 --web
wrapper_block_case "credential wrapper rejects browser assignments before lookup" \
    "browser and editor execution is not allowed" pr view 5 --web=true
wrapper_block_case "credential wrapper rejects short browser execution before lookup" \
    "browser and editor execution is not allowed" pr view 5 -w
wrapper_block_case "credential wrapper rejects editor execution before lookup" \
    "browser and editor execution is not allowed" issue create --editor
wrapper_block_case "credential wrapper rejects editor assignments before lookup" \
    "browser and editor execution is not allowed" issue create --editor=true
wrapper_block_case "credential wrapper rejects short editor execution before lookup" \
    "browser and editor execution is not allowed" issue create -e
wrapper_block_case "credential wrapper rejects process environment files before lookup" \
    "process pseudo-files are not allowed" pr comment 5 --body-file /proc/thread-self/environ
wrapper_body_link="$tmp/wrapper-body-link.md"
ln -s "$wrapper_body_file" "$wrapper_body_link"
wrapper_block_case "credential wrapper rejects symlinked body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_body_link"
wrapper_body_parent_link="$tmp/wrapper-body-parent-link"
ln -s "$tmp" "$wrapper_body_parent_link"
wrapper_block_case "credential wrapper rejects symlinked body parent directories before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_body_parent_link/wrapper-body.md"
wrapper_secret_body="$tmp_physical/.git-credentials"
printf '%s\n' 'harmless-secret-path-canary' >"$wrapper_secret_body"
wrapper_block_case "credential wrapper rejects credential-named body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_secret_body"
wrapper_env_body="$tmp_physical/.env.production"
printf '%s\n' 'harmless-env-path-canary' >"$wrapper_env_body"
wrapper_block_case "credential wrapper rejects environment body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_env_body"
wrapper_package_body="$tmp_physical/.npmrc"
printf '%s\n' 'harmless-package-path-canary' >"$wrapper_package_body"
wrapper_block_case "credential wrapper rejects package credential body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_package_body"
wrapper_yaml_body="$tmp_physical/credentials.yml"
printf '%s\n' 'harmless-yaml-path-canary' >"$wrapper_yaml_body"
wrapper_block_case "credential wrapper rejects credential YAML body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_yaml_body"
wrapper_docker_dir="$tmp_physical/.docker"
mkdir -p "$wrapper_docker_dir"
wrapper_docker_body="$wrapper_docker_dir/config.json"
printf '%s\n' 'harmless-docker-path-canary' >"$wrapper_docker_body"
wrapper_block_case "credential wrapper rejects Docker credential body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_docker_body"
wrapper_key_body="$tmp_physical/selftest-private.pem"
printf '%s\n' 'harmless-key-path-canary' >"$wrapper_key_body"
wrapper_block_case "credential wrapper rejects private-key body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_key_body"
wrapper_hardlink_body="$tmp_physical/wrapper-body-hardlink.md"
ln "$wrapper_body_file" "$wrapper_hardlink_body"
wrapper_block_case "credential wrapper rejects hardlinked body files before lookup" \
    "cannot read the requested PR body file safely" pr edit 5 --body-file "$wrapper_hardlink_body"
rm -f "$wrapper_hardlink_body"
wrapper_block_case "credential wrapper rejects process pseudo-file arguments before lookup" \
    "process pseudo-files are not allowed" api /proc/thread-self/environ
wrapper_block_case "credential wrapper rejects API file input before lookup" \
    "local file input is not allowed" api --input /tmp/request.json repos/0Bu/daikin-altherma-esp32/pulls/5
wrapper_block_case "credential wrapper rejects typed file fields before lookup" \
    "local file input is not allowed" api -F body=@/tmp/body.txt repos/0Bu/daikin-altherma-esp32/pulls/5
wrapper_block_case "credential wrapper rejects short body-file input before lookup" \
    "local file input is not allowed" pr edit 5 -F "$wrapper_body_link"
wrapper_block_case "credential wrapper rejects relative body files before lookup" \
    "physical absolute path" pr edit 5 --body-file wrapper-body.md
wrapper_block_case "credential wrapper rejects checkout subprocesses before lookup" \
    "Git-spawning PR and repository commands are not allowed" pr checkout 5
wrapper_block_case "credential wrapper rejects checkout aliases before lookup" \
    "Git-spawning PR and repository commands are not allowed" pr co 5
wrapper_block_case "credential wrapper rejects incomplete PR creation before lookup" \
    "exact reviewed noninteractive repository form" pr create
wrapper_block_case "credential wrapper rejects PR creation commit-fill before lookup" \
    "exact reviewed noninteractive repository form" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --fill --title selftest --body selftest
wrapper_block_case "credential wrapper rejects PR creation against another base before lookup" \
    "exact reviewed noninteractive repository form" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base develop --title selftest --body selftest
wrapper_block_case "credential wrapper rejects direct PR body text before lookup" \
    "exact reviewed noninteractive repository form" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest --body selftest

rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_remote_mismatch_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_remote_mismatch_toggle"
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ ! -e "$wrapper_args" ] \
    && [ ! -e "$wrapper_closed_marker" ] && [ ! -e "$wrapper_ready_marker" ]; then
    echo "PASS  PR creation rejects a live GitHub head that differs from local HEAD"; pass=$((pass + 1))
else
    echo "FAIL  PR creation accepted a stale live GitHub head (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_created_mismatch_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_created_mismatch_toggle"
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ -e "$wrapper_closed_marker" ] \
    && [ ! -e "$wrapper_ready_marker" ] \
    && [ "$(cat "$wrapper_args" 2>/dev/null)" = "--repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr --base main --title selftest --body review body canary --draft" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' \
    && printf '%s' "$wrapper_out" | grep -qF 'PR head changed during creation; the PR above was closed' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  PR creation closes and reports a draft whose head moved after preflight"; pass=$((pass + 1))
else
    echo "FAIL  PR creation missed the created-PR head postcondition (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_created_lookup_fail_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_created_lookup_fail_toggle"
if [ "$rc" -eq 2 ] && [ -e "$wrapper_closed_marker" ] && [ ! -e "$wrapper_ready_marker" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' \
    && printf '%s' "$wrapper_out" | grep -qF 'created PR head lookup failed; the PR above was closed' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  PR creation closes and reports a draft after created-head lookup failure"; pass=$((pass + 1))
else
    echo "FAIL  created-head lookup failure left an unreported PR (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_ready_fail_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_ready_fail_toggle"
if [ "$rc" -eq 2 ] && [ -e "$wrapper_closed_marker" ] && [ ! -e "$wrapper_ready_marker" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' \
    && printf '%s' "$wrapper_out" | grep -qF 'marking the draft ready failed; the PR above was closed' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  PR creation closes and reports a draft after ready failure"; pass=$((pass + 1))
else
    echo "FAIL  ready failure left an unreported PR (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_published_lookup_fail_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_published_lookup_fail_toggle"
if [ "$rc" -eq 2 ] && [ -e "$wrapper_closed_marker" ] && [ -e "$wrapper_ready_marker" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' \
    && printf '%s' "$wrapper_out" | grep -qF 'published PR head lookup failed; the PR above was closed' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  PR creation closes and reports a ready PR after head lookup failure"; pass=$((pass + 1))
else
    echo "FAIL  published-head lookup failure left an unreported PR (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_args" "$wrapper_marker" "$wrapper_closed_marker" "$wrapper_ready_marker"
: >"$wrapper_published_mismatch_toggle"
wrapper_out="$(env PATH="$wrapper_bin:/usr/bin:/bin" GH_TOKEN=selftest-wrapper-token \
    "$wrapper_under_test" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/selftest-pr --base main --title selftest \
    --body-file "$wrapper_body_file" 2>&1)"; rc=$?
rm -f "$wrapper_published_mismatch_toggle"
if [ "$rc" -eq 2 ] && [ -e "$wrapper_closed_marker" ] && [ -e "$wrapper_ready_marker" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'https://github.com/0Bu/daikin-altherma-esp32/pull/123' \
    && printf '%s' "$wrapper_out" | grep -qF 'PR head changed while becoming ready; the PR above was closed' \
    && ! printf '%s' "$wrapper_out" | grep -qF 'selftest-wrapper-token'; then
    echo "PASS  PR creation closes and reports a ready PR whose head changed"; pass=$((pass + 1))
else
    echo "FAIL  published-head mismatch left an unreported PR (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
wrapper_block_case "credential wrapper rejects non-agent PR head before lookup" \
    "explicit already-pushed agent branch" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head main --base main --title selftest --body-file "$wrapper_body_file"
wrapper_block_case "credential wrapper rejects a PR head other than the checked-out branch" \
    "PR head must equal the checked-out branch" --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/other --base main --title selftest --body-file "$wrapper_body_file"
wrapper_block_case "credential wrapper rejects PR creation aliases before lookup" \
    "Git-spawning PR and repository commands are not allowed" pr new
wrapper_block_case "credential wrapper rejects PR revert creation before lookup" \
    "Git-spawning PR and repository commands are not allowed" pr revert 5
wrapper_block_case "credential wrapper rejects issue transfer before lookup" \
    "Git-spawning PR and repository commands are not allowed" issue transfer 5 ghe.example/owner/repo
wrapper_block_case "credential wrapper rejects branch-deleting PR close before lookup" \
    "Git-spawning PR and repository commands are not allowed" pr close 5 --delete-branch
wrapper_block_case "credential wrapper rejects issue branch creation before lookup" \
    "Git-spawning PR and repository commands are not allowed" issue develop 5 --checkout
wrapper_block_case "credential wrapper rejects repository forks before lookup" \
    "Git-spawning PR and repository commands are not allowed" repo fork 0Bu/example
wrapper_block_case "credential wrapper rejects repository creation before lookup" \
    "Git-spawning PR and repository commands are not allowed" repo create example
wrapper_block_case "credential wrapper rejects repository creation aliases before lookup" \
    "Git-spawning PR and repository commands are not allowed" repo new example
wrapper_block_case "credential wrapper rejects release creation aliases before lookup" \
    "local-file, upload, download, and interactive commands are not allowed" release new v1.2.3
wrapper_block_case "credential wrapper rejects release asset file reads before lookup" \
    "local-file, upload, download, and interactive commands are not allowed" release verify-asset artifact.bin
wrapper_block_case "credential wrapper rejects raw terminal escape output before lookup" \
    "raw terminal escape output is not allowed" repo read-file owner/repo:path --allow-escape-sequences
wrapper_block_case "credential wrapper rejects release downloads before lookup" \
    "local-file, upload, download, and interactive commands are not allowed" release download v1.2.3
wrapper_block_case "credential wrapper rejects run downloads before lookup" \
    "local-file, upload, download, and interactive commands are not allowed" run download 123
wrapper_block_case "credential wrapper rejects repository file reads before lookup" \
    "local-file, upload, download, and interactive commands are not allowed" repo read-file owner/repo:path
wrapper_block_case "credential wrapper rejects repository rename before lookup" \
    "Git-spawning PR and repository commands are not allowed" repo rename renamed
wrapper_block_case "credential wrapper rejects repository default changes before lookup" \
    "Git-spawning PR and repository commands are not allowed" repo set-default 0Bu/example
wrapper_block_case "credential wrapper rejects positional foreign repositories before lookup" \
    "--repo must name github.com/OWNER/REPO" repo view ghe.example/owner/repo
wrapper_block_case "credential wrapper rejects SSH-style foreign repositories before lookup" \
    "SSH-style repository targets are not allowed" repo view git@ghe.example:owner/repo
wrapper_block_case "credential wrapper runtime gate rejects an arbitrary REST write" \
    "aggregate GitHub action gate rejected" api --method PATCH \
    repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -f sha=abcdef1234567890abcdef1234567890abcdef12
wrapper_block_case "credential wrapper runtime gate rejects an implicit REST write" \
    "aggregate GitHub action gate rejected" api repos/0Bu/daikin-altherma-esp32/issues -f title=selftest
wrapper_block_case "credential wrapper runtime gate rejects an unknown GraphQL mutation" \
    "aggregate GitHub action gate rejected" api graphql -f \
    'query=mutation { createIssue(input:{repositoryId:"R_123",title:"x"}) { clientMutationId } }'
wrapper_block_case "credential wrapper runtime gate binds GraphQL to the endpoint position" \
    "aggregate GitHub action gate rejected" api --method POST --preview graphql \
    repos/0Bu/daikin-altherma-esp32/git/refs -f ref=refs/heads/x \
    -f sha=abcdef1234567890abcdef1234567890abcdef12
wrapper_block_case "credential wrapper runtime gate retires gh pr merge" \
    "aggregate GitHub action gate rejected" pr merge 5 --squash

rm -f "$wrapper_marker" "$wrapper_args"
wrapper_out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
    GH_REPO=0Bu/daikin-altherma-esp32 "$wrapper_under_test" \
    --repo github.com/0Bu/daikin-altherma-esp32 pr create --head agent/selftest-pr \
    --base main --title selftest --body-file "$wrapper_body_file" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'PR creation does not accept an ambient GH_REPO override'; then
    echo "PASS  credential wrapper rejects ambient PR repository selection"; pass=$((pass + 1))
else
    echo "FAIL  credential wrapper accepted ambient PR repository selection (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

opaque_wrapper_caller="$tmp/opaque-wrapper-caller.sh"
cat >"$opaque_wrapper_caller" <<'EOF'
#!/usr/bin/env bash
exec "$1" api --hostname github.com --method PUT \
    repos/0Bu/daikin-altherma-esp32/pulls/5/merge \
    -f sha=abcdef1234567890abcdef1234567890abcdef12 -f merge_method=squash
EOF
chmod +x "$opaque_wrapper_caller"
rm -f "$wrapper_marker" "$wrapper_args"
wrapper_out="$(cd "$tmp" && env GH_TOKEN=selftest-wrapper-token \
    "$opaque_wrapper_caller" "$wrapper_under_test" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] && [ ! -e "$wrapper_args" ] \
    && printf '%s' "$wrapper_out" | grep -qF 'merge execution directory is outside'; then
    echo "PASS  opaque child invocation cannot bypass the wrapper runtime merge gate"; pass=$((pass + 1))
else
    echo "FAIL  opaque child invocation bypassed the wrapper runtime merge gate (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi
rm -f "$wrapper_marker"
wrapper_out="$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$wrapper_bin:/usr/bin:/bin" \
    GH_REPO=ghe.example/owner/repo "$wrapper_under_test" \
    pr view 5 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -e "$wrapper_marker" ] \
    && printf '%s' "$wrapper_out" | grep -qF -- '--repo must name github.com/OWNER/REPO'; then
    echo "PASS  credential wrapper rejects an ambient foreign repo before lookup"; pass=$((pass + 1))
else
    echo "FAIL  credential wrapper accepted an ambient foreign repo (rc=$rc output=$wrapper_out)" >&2
    fail=$((fail + 1))
fi

prompt_out="$(printf '%s' '{"prompt":"Das Gerät ist offline nach einem reboot"}' \
    | python3 "$hook" prompt-context 2>&1)"
if printf '%s' "$prompt_out" | grep -qF '<crash-triage-reminder>' \
    && printf '%s' "$prompt_out" | grep -qF 'external syslog collector'; then
    echo "PASS  UserPromptSubmit crash report injects neutral triage context"; pass=$((pass + 1))
else
    echo "FAIL  UserPromptSubmit crash report missed triage context" >&2; fail=$((fail + 1))
fi
if printf '%s' "$prompt_out" | grep -Eq 'VictoriaLogs|mcp__victoria-logs|kubernetes\.container_name'; then
    echo "FAIL  UserPromptSubmit crash context leaked local observability assumptions" >&2; fail=$((fail + 1))
else
    echo "PASS  UserPromptSubmit crash context stays backend-neutral"; pass=$((pass + 1))
fi
prompt_out="$(printf '%s' '{"prompt":"Please update one documentation sentence"}' \
    | python3 "$hook" prompt-context 2>&1)"
if [ -z "$prompt_out" ]; then
    echo "PASS  ordinary UserPromptSubmit stays context-free"; pass=$((pass + 1))
else
    echo "FAIL  ordinary UserPromptSubmit injected context: $prompt_out" >&2; fail=$((fail + 1))
fi

lifecycle_root="$tmp/lifecycle-root"
mkdir -p "$lifecycle_root/tools/agent-hooks" "$lifecycle_root/scripts" \
    "$lifecycle_root/main/logic" "$lifecycle_root/test" "$tmp/lifecycle-bin"
cp "$hook" "$lifecycle_root/tools/agent-hooks/agent_hook.py"
cp "$root/tools/agent-hooks/merge_payload.py" "$lifecycle_root/tools/agent-hooks/merge_payload.py"
git -C "$lifecycle_root" init -q
cat >"$lifecycle_root/scripts/run-mock-tests.sh" <<'EOF'
#!/usr/bin/env bash
printf 'run\n' >>"$AGENT_STOP_LOG"
printf 'selftest host failure\n'
exit "${AGENT_STOP_TEST_RC:-0}"
EOF
cat >"$tmp/lifecycle-bin/cmake" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$lifecycle_root/scripts/run-mock-tests.sh" "$tmp/lifecycle-bin/cmake"
lifecycle_payload="$(python3 - "$lifecycle_root" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "stop_hook_active": False}))
PY
)"
stop_log="$tmp/stop.log"
stop_out="$(printf '%s' "$lifecycle_payload" | env PATH="$tmp/lifecycle-bin:$PATH" \
    AGENT_STOP_LOG="$stop_log" python3 "$lifecycle_root/tools/agent-hooks/agent_hook.py" stop-logic-tests 2>&1)"
if [ -z "$stop_out" ] && [ ! -e "$stop_log" ]; then
    echo "PASS  Stop hook skips a tree without main/test changes"; pass=$((pass + 1))
else
    echo "FAIL  Stop hook ran without main/test changes" >&2; fail=$((fail + 1))
fi
printf '%s\n' '// untracked lifecycle canary' >"$lifecycle_root/main/logic/untracked.hpp"
stop_out="$(printf '%s' "$lifecycle_payload" | env PATH="$tmp/lifecycle-bin:$PATH" \
    AGENT_STOP_LOG="$stop_log" python3 "$lifecycle_root/tools/agent-hooks/agent_hook.py" stop-logic-tests 2>&1)"
if [ -z "$stop_out" ] && [ "$(cat "$stop_log" 2>/dev/null)" = run ]; then
    echo "PASS  Stop hook tests an untracked main/logic file"; pass=$((pass + 1))
else
    echo "FAIL  Stop hook missed untracked main/logic change" >&2; fail=$((fail + 1))
fi
: >"$stop_log"
active_payload="$(python3 - "$lifecycle_root" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "stop_hook_active": True}))
PY
)"
stop_out="$(printf '%s' "$active_payload" | env PATH="$tmp/lifecycle-bin:$PATH" \
    AGENT_STOP_LOG="$stop_log" python3 "$lifecycle_root/tools/agent-hooks/agent_hook.py" stop-logic-tests 2>&1)"
if [ -z "$stop_out" ] && [ ! -s "$stop_log" ]; then
    echo "PASS  active Stop continuation does not loop"; pass=$((pass + 1))
else
    echo "FAIL  active Stop continuation reran tests" >&2; fail=$((fail + 1))
fi
stop_out="$(printf '%s' "$lifecycle_payload" | env PATH="$tmp/lifecycle-bin:$PATH" \
    AGENT_STOP_LOG="$stop_log" AGENT_STOP_TEST_RC=1 \
    python3 "$lifecycle_root/tools/agent-hooks/agent_hook.py" stop-logic-tests 2>&1)"
if printf '%s' "$stop_out" | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("decision") == "block" and "selftest host failure" in value.get("reason", "") else 1)'; then
    echo "PASS  failing Stop logic tests request continuation"; pass=$((pass + 1))
else
    echo "FAIL  failing Stop logic tests did not emit block JSON: $stop_out" >&2; fail=$((fail + 1))
fi

head_sha="abcdef1234567890abcdef1234567890abcdef12"
cat >"$tmp/all-gates.md" <<EOF
- [x] \$project-review clean — merge gate @ $head_sha
- [x] \$domain-review clean — merge gate @ $head_sha
- [x] \$heap-safety-review clean — merge gate @ $head_sha
- [x] \$feature-docs synced — merge gate @ $head_sha
- [x] \$schematic-review clean — merge gate @ $head_sha
- [x] \$ui-use-case-review clean — merge gate @ $head_sha
- [x] \$absence-review clean — merge gate @ $head_sha
- [x] \$ui-gif clean — merge gate @ $head_sha
EOF
printf '%s\n' 'main/www/js/dashboard.js' >"$tmp/all-files.txt"

pr_case() {
    local name="$1" expected_rc="$2" body="$3" files="$4" input="${5:-}" out rc
    out="$(printf '%s' "$input" | env AGENT_POLICY_CI=1 AGENT_PR_BODY_FILE="$body" \
        AGENT_PR_HEAD_SHA="$head_sha" AGENT_CHANGED_FILES_FILE="$files" \
        "$pr_gate" 2>&1)"; rc=$?
    if [ "$rc" -eq "$expected_rc" ]; then
        echo "PASS  $name"; pass=$((pass + 1))
    else
        echo "FAIL  $name (wanted rc=$expected_rc got rc=$rc output=$out)" >&2; fail=$((fail + 1))
    fi
}

pr_case "CI all applicable gates pass" 0 "$tmp/all-gates.md" "$tmp/all-files.txt"
cat >"$tmp/docs-gates.md" <<EOF
- [x] \$project-review clean — merge gate @ $head_sha
- [x] \$domain-review clean — merge gate @ $head_sha
EOF
printf '%s\n' 'docs/README.md' >"$tmp/docs-files.txt"
pr_case "CI docs-only skips conditional gates" 0 "$tmp/docs-gates.md" "$tmp/docs-files.txt"
printf '%s\n' 'main/mqtt_ha.cpp' >"$tmp/heap-files.txt"
grep -vF '$heap-safety-review' "$tmp/all-gates.md" >"$tmp/no-heap-review.md"
pr_case "CI heap-sensitive changes require independent heap review" 2 \
    "$tmp/no-heap-review.md" "$tmp/heap-files.txt"
pr_case "CI heap-sensitive changes accept current independent heap review" 0 \
    "$tmp/all-gates.md" "$tmp/heap-files.txt"
sed "s/$head_sha/deadbee/" "$tmp/all-gates.md" >"$tmp/stale.md"
pr_case "CI stale stamps fail closed" 2 "$tmp/stale.md" "$tmp/all-files.txt"
short_head_sha="${head_sha:0:12}"
sed "s/$head_sha/$short_head_sha/g" "$tmp/all-gates.md" >"$tmp/short-stamp.md"
pr_case "CI one bounded 12-hex current-head prefix satisfies a gate" 0 \
    "$tmp/short-stamp.md" "$tmp/all-files.txt"
sed "1s/merge gate @ $head_sha/foo@$short_head_sha merge gate/" \
    "$tmp/all-gates.md" >"$tmp/premature-stamp.md"
pr_case "CI SHA before the merge-gate phrase is not a stamp" 2 \
    "$tmp/premature-stamp.md" "$tmp/all-files.txt"
sed "1s/$head_sha/${short_head_sha}Z/" "$tmp/all-gates.md" >"$tmp/alphanumeric-stamp.md"
pr_case "CI alphanumeric continuation invalidates a SHA stamp" 2 \
    "$tmp/alphanumeric-stamp.md" "$tmp/all-files.txt"
sed "1s/$head_sha/${head_sha}a/" "$tmp/all-gates.md" >"$tmp/overlong-stamp.md"
pr_case "CI 41-hex stamp cannot satisfy a canonical gate" 2 \
    "$tmp/overlong-stamp.md" "$tmp/all-files.txt"
sed "1s/$/ @ $head_sha/" "$tmp/all-gates.md" >"$tmp/double-stamp.md"
pr_case "CI two SHA stamps make a canonical gate invalid" 2 \
    "$tmp/double-stamp.md" "$tmp/all-files.txt"

cat "$tmp/all-gates.md" >"$tmp/fenced-decoy.md"
cat >>"$tmp/fenced-decoy.md" <<'EOF'
```markdown
- [x] $project-review clean — merge gate @ deadbee
```
EOF
pr_case "CI fenced gate example cannot shadow the real record" 0 \
    "$tmp/fenced-decoy.md" "$tmp/all-files.txt"
cat "$tmp/all-gates.md" >"$tmp/long-fence-decoy.md"
cat >>"$tmp/long-fence-decoy.md" <<'EOF'
````markdown
```
- [ ] $project-review clean — merge gate @ deadbee
````
EOF
pr_case "CI shorter same-character fence cannot expose a fake gate" 0 \
    "$tmp/long-fence-decoy.md" "$tmp/all-files.txt"
cat "$tmp/all-gates.md" >"$tmp/fence-comment-order.md"
cat >>"$tmp/fence-comment-order.md" <<'EOF'
~~~ info <!--
-->
- [ ] $project-review clean — merge gate @ deadbee
~~~
EOF
pr_case "CI a fence opener takes precedence over comment text in its info string" 0 \
    "$tmp/fence-comment-order.md" "$tmp/all-files.txt"
cat "$tmp/all-gates.md" >"$tmp/nested-task-decoy.md"
printf '%s\n' '  - [ ] $project-review clean — merge gate @ deadbee' >>"$tmp/nested-task-decoy.md"
pr_case "CI nested two-space task cannot shadow a column-zero gate" 0 \
    "$tmp/nested-task-decoy.md" "$tmp/all-files.txt"
printf '%s\n' 'prose <!-- same-line comment closes here -->' >"$tmp/comment-decoy.md"
cat "$tmp/all-gates.md" >>"$tmp/comment-decoy.md"
cat >>"$tmp/comment-decoy.md" <<'EOF'
prose <!--
- [ ] $project-review clean — merge gate @ deadbee
-->
EOF
pr_case "CI HTML-comment gate examples stay invisible without leaking state" 0 \
    "$tmp/comment-decoy.md" "$tmp/all-files.txt"
cat >"$tmp/multi-comment-decoy.md" <<'EOF'
<!-- first --><!-- second
- [ ] $project-review clean — merge gate @ deadbee
-->
EOF
cat "$tmp/all-gates.md" >>"$tmp/multi-comment-decoy.md"
pr_case "CI multiple ordered HTML markers preserve the open-comment state" 0 \
    "$tmp/multi-comment-decoy.md" "$tmp/all-files.txt"
cat >"$tmp/raw-html-decoy.md" <<'EOF'
<pre>
- [ ] $project-review clean — merge gate @ deadbee
</pre><pre>
- [ ] $project-review clean — merge gate @ deadbee
</pre>
<pre>
</pre><!--
- [ ] $project-review clean — merge gate @ deadbee
-->
<?pi
- [ ] $project-review clean — merge gate @ deadbee
?>
<![CDATA[
- [ ] $project-review clean — merge gate @ deadbee
]]>
<span>
- [ ] $project-review clean — merge gate @ deadbee

</span>
- [ ] $project-review clean — merge gate @ deadbee

</div>
- [ ] $project-review clean — merge gate @ deadbee

<div
- [ ] $project-review clean — merge gate @ deadbee

EOF
cat "$tmp/all-gates.md" >>"$tmp/raw-html-decoy.md"
pr_case "CI raw HTML code blocks cannot shadow the real gate record" 0 \
    "$tmp/raw-html-decoy.md" "$tmp/all-files.txt"
cat "$tmp/all-gates.md" >"$tmp/duplicate-record.md"
printf '%s\n' '- [ ] $project-review clean — merge gate @ <short-sha>' >>"$tmp/duplicate-record.md"
pr_case "CI duplicate real gate records fail closed" 2 \
    "$tmp/duplicate-record.md" "$tmp/all-files.txt"

printf '%s\n' 'docs/media/dashboard.gif' >"$tmp/gif-files.txt"
pr_case "CI new dashboard recording accepts current UI-GIF review" 0 \
    "$tmp/all-gates.md" "$tmp/gif-files.txt"
grep -vF '$ui-gif' "$tmp/all-gates.md" >"$tmp/no-ui-gif.md"
pr_case "CI new dashboard recording requires UI-GIF review" 2 \
    "$tmp/no-ui-gif.md" "$tmp/gif-files.txt"

# Exercise the REST fallback without a gh binary. The fake curl accepts the credential only on
# stdin, rejects it in argv, and returns the two minimal GitHub API responses discovery requires.
fallback_bin="$tmp/fallback-bin"
fallback_root="$tmp/fallback-root"
mkdir -p "$fallback_bin" "$fallback_root/tools/agent-hooks" \
    "$fallback_root/tools/agent-policy"
cp "$root/tools/agent-hooks/pr-gate-lib.sh" "$fallback_root/tools/agent-hooks/"
cp "$root/tools/agent-policy/extract_changed_files.py" "$fallback_root/tools/agent-policy/"
for tool in bash cat dirname git grep python3 rm sed; do
    tool_path="$(command -v "$tool")" || fail "REST fallback fixture is missing $tool"
    ln -s "$tool_path" "$fallback_bin/$tool"
done
cat >"$fallback_bin/curl" <<'EOF'
#!/usr/bin/env bash
for argument in "$@"; do
    [ "$argument" != "$SELFTEST_EXPECTED_TOKEN" ] || exit 91
    case "$argument" in
        *"$SELFTEST_EXPECTED_TOKEN"*) exit 92 ;;
    esac
done
header="$(cat)"
[ "$header" = "Authorization: Bearer $SELFTEST_EXPECTED_TOKEN" ] || exit 93
url="${!#}"
case "$url" in
    */pulls/123)
        printf '%s\n' '{"number":123,"body":"review evidence","changed_files":1,"head":{"sha":"abcdef1234567890abcdef1234567890abcdef12"}}'
        ;;
    */pulls/123/files\?*)
        printf '%s\n' '[{"filename":"docs/README.md"}]'
        ;;
    *) exit 94 ;;
esac
EOF
chmod +x "$fallback_bin/curl"
curl_body="$tmp/curl-body.md"
curl_files="$tmp/curl-files.txt"
fake_token="selftest-token-not-a-real-credential"
out="$(env PATH="$fallback_bin" GH_TOKEN="$fake_token" \
    SELFTEST_EXPECTED_TOKEN="$fake_token" AGENT_REPO_SLUG="0Bu/daikin-altherma-esp32" \
    /bin/bash -c '. "$1"; agent_gate_discover_pr 123 "$2" "$3" "$4"' \
    _ "$fallback_root/tools/agent-hooks/pr-gate-lib.sh" "$root" "$curl_body" "$curl_files" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] \
    && [ "$(cat "$curl_body" 2>/dev/null)" = "review evidence" ] \
    && [ "$(cat "$curl_files" 2>/dev/null)" = "docs/README.md" ] \
    && [ ! -e "$curl_body.curl-headers" ]; then
    echo "PASS  REST fallback streams token only on curl stdin"; pass=$((pass + 1))
else
    echo "FAIL  REST fallback credential transport failed (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

out="$(printf '{' | "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ]; then
    echo "PASS  malformed hook JSON fails closed"; pass=$((pass + 1))
else
    echo "FAIL  malformed hook JSON bypassed (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

out="$(printf '' | "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'empty hook payload'; then
    echo "PASS  empty hook payload fails closed"; pass=$((pass + 1))
else
    echo "FAIL  empty hook payload bypassed policy (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

nonmerge="$(payload exec_command command 'git status --short')"
mkdir -p "$tmp/read-fail-bin"
cat >"$tmp/read-fail-bin/cat" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$tmp/read-fail-bin/cat"
printf '%s\n' "$nonmerge" >"$tmp/read-fail-payload.json"
out="$(env PATH="$tmp/read-fail-bin:$PATH" "$pr_gate" --payload-file "$tmp/read-fail-payload.json" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'could not read payload file'; then
    echo "PASS  failed payload-file read fails closed"; pass=$((pass + 1))
else
    echo "FAIL  failed payload-file read bypassed policy (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

out="$(env AGENT_POLICY_CI=1 AGENT_PR_BODY_FILE="$tmp/all-gates.md" \
    AGENT_PR_HEAD_SHA="$head_sha" AGENT_CHANGED_FILES_FILE="$tmp" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ]; then
    echo "PASS  unreadable/invalid changed-files input fails closed"; pass=$((pass + 1))
else
    echo "FAIL  invalid changed-files input bypassed (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

out="$(printf '%s' "$nonmerge" | "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then
    echo "PASS  non-merge hook payload is ignored"; pass=$((pass + 1))
else
    echo "FAIL  non-merge hook payload blocked (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

# A local merge keeps the historical last-mile UI and absence reruns, but uses the one already
# discovered body/head/file set. Stub only the external PR and suite boundaries; exercise the real
# aggregate parser, relevance filters, and failure propagation.
merge_root="$tmp_physical/merge-root"
mkdir -p "$merge_root/scripts" "$merge_root/tools/absence" \
    "$merge_root/tools/agent-hooks" "$merge_root/tools/agent-policy" "$tmp/bin"
cp "$root/tools/agent-hooks/pr-gate-lib.sh" "$merge_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/require-pr-gates.sh" "$merge_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/merge_payload.py" "$merge_root/tools/agent-hooks/"
cp "$root/tools/agent-hooks/run_with_timeout.py" "$merge_root/tools/agent-hooks/"
cp "$root/tools/agent-policy/extract_changed_files.py" "$merge_root/tools/agent-policy/"
sed -e "s#^GH_BINARY_CANDIDATES=.*#GH_BINARY_CANDIDATES='$tmp/bin/gh'#" \
    -e 's#^extra_child_env=()#extra_child_env=("AGENT_GH_REPORTED_FILES=${AGENT_GH_REPORTED_FILES:-1}" "AGENT_GH_RETURNED_FILES=${AGENT_GH_RETURNED_FILES:-1}" "AGENT_GH_RENAME=${AGENT_GH_RENAME:-0}")#' \
    "$root/scripts/gh-with-git-credentials.sh" >"$merge_root/scripts/gh-with-git-credentials.sh"
git -C "$merge_root" init -q
git -C "$merge_root" remote add origin https://github.com/0Bu/daikin-altherma-esp32.git
cat >"$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
[ "${GH_HOST:-}" = github.com ] || exit 95
[ "${GH_REPO:-}" = github.com/0Bu/daikin-altherma-esp32 ] || exit 96
case "${1:-} ${2:-}" in
    "repo view") printf '%s\n' '0Bu/daikin-altherma-esp32' ;;
    "pr view")
        python3 - <<'PY'
import json
head = "abcdef1234567890abcdef1234567890abcdef12"
body = "\n".join([
    f"- [x] $project-review clean — merge gate @ {head}",
    f"- [x] $domain-review clean — merge gate @ {head}",
    f"- [x] $feature-docs synced — merge gate @ {head}",
    f"- [x] $schematic-review clean — merge gate @ {head}",
    f"- [x] $ui-use-case-review clean — merge gate @ {head}",
    f"- [x] $absence-review clean — merge gate @ {head}",
])
print(json.dumps({"number": 123, "body": body, "headRefOid": head,
                  "changedFiles": int(__import__("os").environ.get("AGENT_GH_REPORTED_FILES", "1"))}))
PY
        ;;
    "api --hostname")
        [ "${3:-}" = github.com ] || exit 97
        returned="${AGENT_GH_RETURNED_FILES:-1}"
        python3 - "$returned" "${AGENT_GH_RENAME:-0}" <<'PY'
import json, sys
count = int(sys.argv[1])
if sys.argv[2] == "1":
    records = [{"filename": "docs/dashboard.old", "previous_filename": "main/www/js/dashboard.js"}]
else:
    records = [
        {"filename": "main/www/js/dashboard.js" if count == 1 else f"docs/file-{index:04d}.md"}
        for index in range(1, count + 1)
    ]
print(json.dumps([records[offset:offset + 100] for offset in range(0, len(records), 100)]))
PY
        ;;
    *) exit 1 ;;
esac
EOF
cat >"$merge_root/scripts/run-ui-use-case-tests.sh" <<'EOF'
#!/usr/bin/env bash
printf 'ui\n' >>"$AGENT_SUITE_LOG"
[ -z "${AGENT_UI_SUITE_SLEEP:-}" ] || sleep "$AGENT_UI_SUITE_SLEEP"
exit "${AGENT_UI_SUITE_RC:-0}"
EOF
cat >"$merge_root/scripts/run-ui-gif-audit.sh" <<'EOF'
#!/usr/bin/env bash
printf 'uigif\n' >>"$AGENT_SUITE_LOG"
exit "${AGENT_UI_GIF_AUDIT_RC:-0}"
EOF
cat >"$merge_root/tools/absence/selftest.sh" <<'EOF'
#!/usr/bin/env bash
printf 'absence\n' >>"$AGENT_SUITE_LOG"
exit "${AGENT_ABSENCE_SUITE_RC:-0}"
EOF
chmod +x "$tmp/bin/gh" "$merge_root/scripts/run-ui-use-case-tests.sh" \
    "$merge_root/scripts/run-ui-gif-audit.sh" "$merge_root/scripts/gh-with-git-credentials.sh" \
    "$merge_root/tools/absence/selftest.sh" "$merge_root/tools/agent-hooks/require-pr-gates.sh"
git -C "$merge_root" add -- scripts/gh-with-git-credentials.sh

AGENT_TEST_PAYLOAD_CWD="$merge_root"
export GH_TOKEN=agent-hook-selftest-token
pr_gate="$merge_root/tools/agent-hooks/require-pr-gates.sh"
canonical_merge_command="scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash"
merge_input="$(payload Bash command "$canonical_merge_command")"
suite_log="$tmp/suites.log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$suite_log" 2>/dev/null)" = $'uigif\nui\nabsence' ]; then
    echo "PASS  local merge reruns UI-GIF, UI, and absence suites"; pass=$((pass + 1))
else
    echo "FAIL  local merge suite parity failed (rc=$rc output=$out log=$(cat "$suite_log" 2>/dev/null))" >&2
    fail=$((fail + 1))
fi

git -C "$merge_root" remote set-url origin https://ghe.example/0Bu/daikin-altherma-esp32.git
: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -s "$suite_log" ] \
    && printf '%s' "$out" | grep -qF 'not the current project repository'; then
    echo "PASS  same-slug foreign-host origin cannot supply merge evidence"; pass=$((pass + 1))
else
    echo "FAIL  same-slug foreign-host origin supplied merge evidence (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi
git -C "$merge_root" remote set-url origin https://github.com/0Bu/daikin-altherma-esp32.git

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" \
    AGENT_GH_REPORTED_FILES=301 AGENT_GH_RETURNED_FILES=300 "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && [ ! -s "$suite_log" ] \
    && printf '%s' "$out" | grep -qF 'could not read the pull request'; then
    echo "PASS  incomplete paginated PR file discovery fails closed before suites"; pass=$((pass + 1))
else
    echo "FAIL  truncated PR file discovery skipped conditional suites (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" \
    AGENT_GH_RENAME=1 "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$suite_log" 2>/dev/null)" = $'uigif\nui\nabsence' ]; then
    echo "PASS  renamed relevant old path still triggers conditional suites"; pass=$((pass + 1))
else
    echo "FAIL  renamed relevant old path skipped conditional suites (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" GH_HOST=ghe.example \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$suite_log" 2>/dev/null)" = $'uigif\nui\nabsence' ]; then
    echo "PASS  explicit github.com host binding overrides ambient GH_HOST"; pass=$((pass + 1))
else
    echo "FAIL  ambient GH_HOST overrode explicit host binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" \
    AGENT_UI_SUITE_SLEEP=1 AGENT_GATE_SUITE_TIMEOUT=0.05 "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'UI use-case suite failed'; then
    echo "PASS  bounded local suite timeout fails closed before the outer hook timeout"; pass=$((pass + 1))
else
    echo "FAIL  local suite timeout did not fail closed (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

for guarded_command in \
    'command gh pr merge 123 --squash' \
    'false || gh pr merge 123 --squash' \
    'env -u GH_TOKEN gh pr merge 123 --squash' \
    'sudo gh pr merge 123 --squash' \
    'gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --squash' \
    "bash -lc 'gh pr merge 123 --squash'" \
    "sh -ec 'gh pr merge 123 --squash'" \
    "env -S 'gh pr merge 123 --squash'" \
    'echo "$(gh pr merge 123 --squash)"' \
    'time gh pr merge 123 --squash' \
    'if true; then gh pr merge 123 --squash; fi' \
    '{ gh pr merge 123 --squash; }' \
    '! gh pr merge 123 --squash' \
    'nice gh pr merge 123 --squash' \
    'nohup gh pr merge 123 --squash' \
    'echo `gh pr merge 123 --squash`' \
    $'printf done\ngh pr merge 123 --squash'; do
    : >"$suite_log"
    current_repo='github.com/0Bu/daikin-altherma-esp32'
    guarded_command="${guarded_command//gh pr merge/gh --repo $current_repo pr merge}"
    guarded_command="${guarded_command/--squash/--match-head-commit $head_sha --squash}"
    guarded_input="$(payload Bash command "$guarded_command")"
    out="$(printf '%s' "$guarded_input" | env PATH="$tmp/bin:$PATH" \
        AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
    if [ "$rc" -eq 2 ] && [ ! -s "$suite_log" ] \
        && printf '%s' "$out" | grep -qF 'may activate auto-merge or a merge queue'; then
        echo "PASS  wrapped queue-capable gh pr merge is retired: $guarded_command"; pass=$((pass + 1))
    else
        echo "FAIL  wrapped queue-capable gh pr merge remained supported: $guarded_command (rc=$rc output=$out)" >&2
        fail=$((fail + 1))
    fi
done

for blocked_command in \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --admin --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --auto --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --disable-auto --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --merge --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --rebase --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --squash --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha -s" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge https://github.com/0Bu/daikin-altherma-esp32/pull/123 --match-head-commit $head_sha --squash" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge feature/target --match-head-commit $head_sha --squash" \
    "gh --repo=github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --squash" \
    'gh --repo owner/other pr merge 123 --squash' \
    'GH_REPO=owner/other gh pr merge 123 --squash' \
    'GH_REPO=owner/other; gh pr merge 123 --squash' \
    'export GH_REPO=owner/other; gh pr merge 123 --squash' \
    'cd /tmp/other && gh pr merge 123 --squash' \
    'if cd /tmp/other; then gh pr merge 123 --squash; fi' \
    'env -C /tmp/other gh pr merge 123 --squash' \
    'env --chdir=/tmp/other gh pr merge 123 --squash' \
    'sudo -D /tmp/other gh pr merge 123 --squash' \
    'sudo --chdir=/tmp/other gh pr merge 123 --squash' \
    "printf '123' | xargs gh pr merge --squash" \
    "printf '123' | xargs -n1 gh pr merge --squash" \
    "bash -O extglob -c '/tmp/g@(h) pr merge 123 --squash'" \
    "bash -c 'cd /tmp/other; gh pr merge 123 --squash'" \
    "eval 'cd /tmp/other; gh pr merge 123 --squash'" \
    "bash -c 'git remote set-url origin https://github.com/owner/other.git; gh pr merge 123 --match-head-commit $head_sha --squash'" \
    "eval 'printf -v GH_REPO %s owner/other; export GH_REPO; gh pr merge 123 --match-head-commit $head_sha --squash'" \
    "printf -v GH_REPO '%s' owner/other; export GH_REPO; gh pr merge 123 --match-head-commit $head_sha --squash" \
    "read -r GH_REPO <<< owner/other; export GH_REPO; gh pr merge 123 --match-head-commit $head_sha --squash" \
    "git remote set-url origin https://github.com/owner/other.git; gh pr merge 123 --match-head-commit $head_sha --squash" \
    'unset x; gh ${x:-pr} merge 123' \
    'unset x; gh pr ${x:-merge} 123' \
    'p=pr; m=merge; gh "$p" "$m" 123' \
    'gh pr merge 123; gh -R owner/other pr merge 456' \
    "gh alias set pm 'pr merge'; gh pm 123" \
    'gh pm 123' \
    "cmd='gh pr merge 123'; eval \"\$cmd\"" \
    'c=gh; $c pr merge 123' \
    '$(command -v gh) pr merge 123' \
    'gh api --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge' \
    "scripts/gh-with-git-credentials.sh api --method PATCH repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -f sha=$head_sha" \
    "scripts/gh-with-git-credentials.sh api --method PUT repos/0Bu/daikin-altherma-esp32/contents/selftest.txt -f message=selftest -f content=eA==" \
    "scripts/gh-with-git-credentials.sh api repos/0Bu/daikin-altherma-esp32/issues -f title=selftest" \
    "scripts/gh-with-git-credentials.sh api graphql -f 'query=mutation { createIssue(input:{repositoryId:\"R_123\",title:\"x\"}) { clientMutationId } }'" \
    "gh api --method DELETE repos/0Bu/daikin-altherma-esp32/git/refs/heads/selftest" \
    "gh api --hostname github.com --method POST repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash" \
    "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=1234567 -f merge_method=squash" \
    "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=merge" \
    "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f sha=$head_sha -f merge_method=squash" \
    "$canonical_merge_command; gh api --hostname github.com --method POST repos/0Bu/daikin-altherma-esp32/merges -f base=main -f head=feature" \
    "$canonical_merge_command; gh pr view 123" \
    'gh api --method PUT "repos/0Bu/daikin-altherma-esp32/pulls/123/merge?merge_method=squash"' \
    'gh api --method PUT "HtTpS://API.GITHUB.COM//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge/"' \
    "gh api --hostname github.com --method PUT 'HtTpS://API.GITHUB.COM//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge/' -f sha=$head_sha -f merge_method=squash" \
    'gh api --method PUT "HtTpS://API.GITHUB.COM//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge-async/"' \
    "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge-async -f sha=$head_sha -f merge_method=squash" \
    'gh api --method POST "HtTpS://API.GITHUB.COM//repos/0Bu/daikin-altherma-esp32/%6derges/" -f base=main -f head=feature' \
    'gh api --method PUT "//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge"' \
    "gh api --hostname github.com --method PUT '//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge' -f sha=$head_sha -f merge_method=squash" \
    'gh api --method PUT "//repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge-async"' \
    'gh api --method POST "//repos/0Bu/daikin-altherma-esp32/%6derges" -f base=main -f head=feature' \
    "gh api --hostname github.com --method PUT 'repos/0Bu/daikin-altherma-esp32/pulls/123/merge?apiVersion=2022-11-28' -f sha=$head_sha -f merge_method=squash" \
    "gh api --hostname github.com --method PUT Repos/0Bu/daikin-altherma-esp32/Pulls/123/Merge -f sha=$head_sha -f merge_method=squash" \
    'gh pr merge "$PR_NUMBER" --squash' \
    'gh api --method PUT "repos/0Bu/daikin-altherma-esp32/pulls/$PR_NUMBER/merge"' \
    'action=merge; gh api --method PUT "repos/0Bu/daikin-altherma-esp32/pulls/123/$action"' \
    "part=merge; gh api graphql -f \"query=mutation { \${part}PullRequest(input:{pullRequestId:\\\"PR_kwDO123\\\"}) { pullRequest { merged } } }\"" \
    "gh api graphql -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"PR_kwDO123\"}) { pullRequest { merged } } }'" \
    "gh api 'HtTpS://API.GITHUB.COM/%67raphql/' -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"PR_kwDO123\"}) { pullRequest { merged } } }'" \
    "gh api graphql -f 'query=mutation { mergeBranch(input:{repositoryId:\"R_123\",base:\"main\",head:\"feature\"}) { mergeCommit { oid } } }'" \
    "gh api graphql -f 'query=mutation { enqueuePullRequest(input:{pullRequestId:\"PR_kwDO123\"}) { pullRequest { merged } } }'" \
    'gh api graphql -F query=@mutation.graphql' \
    'gh api graphql --input query.json' \
    'gh api "HtTpS://API.GITHUB.COM//%67raphql/" --input query.json' \
    "curl -d 'mutation { enablePullRequestAutoMerge(input:{pullRequestId:\"PR_kwDO123\"}) { pullRequest { merged } } }' https://api.github.com/graphql" \
    'curl -X PUT "HtTpS://API.GITHUB.COM/repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge/"' \
    'curl -X PUT "HtTpS://API.GITHUB.COM/repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge-async/"' \
    'curl -X POST "HtTpS://API.GITHUB.COM/repos/0Bu/daikin-altherma-esp32/%6derges/" -d base=main -d head=feature' \
    'curl --url=https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -X PATCH -d sha=abcdef' \
    'curl --config /tmp/curl-selftest.conf' \
    'c=curl; "$c" --url=https://api.github.com/repos/0Bu/daikin-altherma-esp32/git/refs/heads/main -X PATCH -d sha=abcdef' \
    'c=curl; "$c" --config /tmp/curl-selftest.conf' \
    'c'"''"'url -X PUT "HtTpS://API.GITHUB.COM/repos/0Bu/daikin-altherma-esp32/pulls/123/%6derge-async/"' \
    '/usr/bin/cur[l] -X POST "HtTpS://API.GITHUB.COM/repos/0Bu/daikin-altherma-esp32/%6derges/" -d base=main -d head=feature' \
    "curl -d 'mutation { mergePullRequest(input:{pullRequestId:\"PR_kwDO123\"}) { pullRequest { merged } } }' 'HtTpS://API.GITHUB.COM//%67raphql/'" \
    'curl -X POST https://api.github.com/graphql --data-binary @query.json' \
    'curl -X POST "HtTpS://API.GITHUB.COM//%67raphql/" --data-binary @query.json' \
    'c'"''"'url "HtTpS://API.GITHUB.COM//%67raphql/" -d@query.json' \
    'curl "HtTpS://API.GITHUB.COM//%67raphql/" --d'"''"'ata-binary @query.json' \
    "gh pr merge --match-head-commit $head_sha --squash" \
    "gh pr merge feature/target --match-head-commit $head_sha --squash" \
    "printf '%s' 'gh pr merge 123 --squash' | bash" \
    "printf '%s' 'gh pr merge 123 --squash' | bash -s" \
    "printf '%s' 'gh pr merge 123 --squash' | env bash" \
    "printf '%s' 'gh pr merge 123 --squash' | sudo bash" \
    "bash -s <<< 'gh pr merge 123 --squash'"; do
    : >"$suite_log"
    blocked_input="$(payload Bash command "$blocked_command")"
    out="$(printf '%s' "$blocked_input" | env PATH="$tmp/bin:$PATH" \
        AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
    if [ "$rc" -eq 2 ] && [ ! -s "$suite_log" ]; then
        echo "PASS  ambiguous/cross-repository merge is blocked: $blocked_command"; pass=$((pass + 1))
    else
        echo "FAIL  ambiguous/cross-repository merge was not blocked: $blocked_command (rc=$rc output=$out)" >&2
        fail=$((fail + 1))
    fi
done

: >"$suite_log"
read_only_api_input="$(payload Bash command "scripts/gh-with-git-credentials.sh api --method GET repos/0Bu/daikin-altherma-esp32/git/ref/heads/main")"
out="$(printf '%s' "$read_only_api_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -s "$suite_log" ]; then
    echo "PASS  provably read-only GitHub API request bypasses merge-only suites"; pass=$((pass + 1))
else
    echo "FAIL  read-only GitHub API request was treated as a merge/write action (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

merge_root_real="$(cd "$merge_root" && pwd -P)"
workdir_merge_input="$(python3 - "$merge_root" "$head_sha" "$merge_root_real" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "exec_command", "tool_input": {
    "command": f"{sys.argv[3]}/scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha={sys.argv[2]} -f merge_method=squash", "workdir": "/tmp"
}}))
PY
)"
out="$(printf '%s' "$workdir_merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'execution directory is outside'; then
    echo "PASS  tool workdir outside project is blocked"; pass=$((pass + 1))
else
    echo "FAIL  tool workdir outside project bypassed binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

conflicting_workdir_merge="$(python3 - "$merge_root" "$head_sha" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "shell", "tool_input": {
    "command": f"scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha={sys.argv[2]} -f merge_method=squash",
    "workdir": ".", "cwd": "/tmp/other"
}}))
PY
)"
out="$(printf '%s' "$conflicting_workdir_merge" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'conflicting workdir/cwd'; then
    echo "PASS  conflicting shell workdir aliases are blocked"; pass=$((pass + 1))
else
    echo "FAIL  conflicting shell workdir aliases bypassed binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

selector_override_input="$(payload Bash command "scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/456/merge -f sha=$head_sha -f merge_method=squash")"
out="$(printf '%s' "$selector_override_input" | env PATH="$tmp/bin:$PATH" AGENT_PR_SELECTOR=123 \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'selector conflicts'; then
    echo "PASS  explicit selector cannot override merge payload"; pass=$((pass + 1))
else
    echo "FAIL  explicit selector overrode merge payload (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

missing_cwd_merge="{\"tool_name\":\"exec_command\",\"tool_input\":{\"cmd\":\"scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash\"}}"
out="$(printf '%s' "$missing_cwd_merge" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'no execution cwd'; then
    echo "PASS  shell merge payload without cwd is blocked"; pass=$((pass + 1))
else
    echo "FAIL  shell merge payload without cwd bypassed binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

conflicting_command_merge="$(python3 - "$merge_root" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "exec_command", "tool_input": {
    "command": "echo safe", "cmd": "gh pr merge 123 --squash"
}}))
PY
)"
out="$(printf '%s' "$conflicting_command_merge" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'conflicting command/cmd'; then
    echo "PASS  conflicting shell command aliases are blocked"; pass=$((pass + 1))
else
    echo "FAIL  conflicting shell command aliases bypassed binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

implicit_repo_input="$(payload Bash command "gh api --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash")"
out="$(printf '%s' "$implicit_repo_input" | env PATH="$tmp/bin:$PATH" GH_REPO="owner/other" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'needs exactly --hostname github.com'; then
    echo "PASS  inherited GH_REPO cannot replace explicit command binding"; pass=$((pass + 1))
else
    echo "FAIL  inherited GH_REPO replaced explicit command binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

implicit_host_input="$(payload Bash command "gh api --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash")"
out="$(printf '%s' "$implicit_host_input" | env PATH="$tmp/bin:$PATH" GH_HOST=ghe.example \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'needs exactly --hostname github.com'; then
    echo "PASS  inherited GH_HOST cannot replace explicit command binding"; pass=$((pass + 1))
else
    echo "FAIL  inherited GH_HOST replaced explicit command binding (rc=$rc output=$out)" >&2
    fail=$((fail + 1))
fi

for conflicting_mcp_input in \
    '{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pullNumber":123,"pull_number":456,"repository_full_name":"0Bu/daikin-altherma-esp32"}}' \
    '{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pr_number":123,"repo":"daikin-altherma-esp32","owner":"0Bu","repository_full_name":"owner/other"}}' \
    '{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pr_number":123,"repo":{"owner":"0Bu"}}}' \
    '{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pr_number":123,"repo":{"owner":"0Bu","name":"daikin-altherma-esp32","repo":"other"}}}' \
    '{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pr_number":123}}'; do
    out="$(printf '%s' "$conflicting_mcp_input" | env PATH="$tmp/bin:$PATH" \
        AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
    if [ "$rc" -eq 2 ]; then
        echo "PASS  ambiguous MCP merge aliases/repository are blocked"; pass=$((pass + 1))
    else
        echo "FAIL  ambiguous MCP merge aliases/repository bypassed binding (rc=$rc output=$out)" >&2
        fail=$((fail + 1))
    fi
done

for blocked_mcp_input in \
    "{\"tool_name\":\"mcp__another_github__merge_pull_request\",\"tool_input\":{\"owner\":\"0Bu\",\"repo\":\"daikin-altherma-esp32\",\"hostname\":\"github.com\",\"pull_number\":123,\"expected_head_sha\":\"$head_sha\"}}" \
    "{\"tool_name\":\"mcp__codex_apps__github_merge_pull_request\",\"tool_input\":{\"pr_number\":123,\"repository_full_name\":\"0Bu/daikin-altherma-esp32\",\"expected_head_sha\":\"$head_sha\"}}" \
    '{"tool_name":"mcp__codex_apps__github_enable_auto_merge","tool_input":{"repository_full_name":"0Bu/daikin-altherma-esp32","pr_number":123}}' \
    '{"tool_name":"mcp__another__enable_pull_request_auto_merge","tool_input":{"pr_number":123}}' \
    '{"tool_name":"mcp__another__enqueue_pull_request","tool_input":{"pr_number":123}}'; do
    : >"$suite_log"
    out="$(printf '%s' "$blocked_mcp_input" | env PATH="$tmp/bin:$PATH" \
        AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" "$pr_gate" 2>&1)"; rc=$?
    if [ "$rc" -eq 2 ] && [ ! -s "$suite_log" ] \
        && printf '%s' "$out" | grep -qF 'MCP merge and auto-merge activation tools are unsupported'; then
        echo "PASS  MCP merge/auto-merge activation is blocked"; pass=$((pass + 1))
    else
        echo "FAIL  MCP merge/auto-merge activation bypassed REST-only policy (rc=$rc output=$out)" >&2
        fail=$((fail + 1))
    fi
done

parser_case() {
    local name="$1" command="$2" expected_action="$3" expected_selector="$4" expected_repo="$5" expected_host="$6" expected_error="$7"
    if printf '%s' "$(payload Bash command "$command")" \
        | python3 "$root/tools/agent-hooks/merge_payload.py" \
        | python3 -c 'import sys
fields = [part.decode() for part in sys.stdin.buffer.read().split(b"\0")[:-1]]
expected = sys.argv[1:]
actual = [fields[0], fields[1], fields[3], fields[4], fields[5]]
raise SystemExit(0 if actual == expected else 1)' \
            "$expected_action" "$expected_selector" "$expected_repo" "$expected_host" "$expected_error"; then
        echo "PASS  $name"; pass=$((pass + 1))
    else
        echo "FAIL  $name" >&2; fail=$((fail + 1))
    fi
}

noncanonical_merge_error="local merge actions must use this repository's reviewed credential wrapper"
parser_case "literal gh cannot impersonate the canonical merge transport" \
    "gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash" \
    'gh api merge' '123' '0Bu/daikin-altherma-esp32' 'github.com' "$noncanonical_merge_error"
parser_case "credential wrapper merge remains bound" \
    "$root/scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash" \
    'gh api merge' '123' '0Bu/daikin-altherma-esp32' 'github.com' ''
parser_case "foreign absolute gh cannot impersonate the canonical merge transport" \
    "/tmp/gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash" \
    'gh api merge' '123' '0Bu/daikin-altherma-esp32' 'github.com' "$noncanonical_merge_error"
parser_case "PATH-selected gh cannot impersonate the canonical merge transport" \
    "PATH=/tmp gh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/123/merge -f sha=$head_sha -f merge_method=squash" \
    'gh api merge' '123' '0Bu/daikin-altherma-esp32' 'github.com' "$noncanonical_merge_error"
parser_case "foreign same-name credential wrapper is not trusted" \
    "/tmp/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit $head_sha --squash" \
    'shell merge' '' '' '' 'literal merge operation is present but its executable or target is dynamic'
retired_pr_merge_error='gh pr merge may activate auto-merge or a merge queue; use the canonical synchronous REST merge path'
parser_case "branch merge selector is rejected" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge feature/target --match-head-commit $head_sha --squash" \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "subject option value is not a PR selector" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --subject x --match-head-commit $head_sha --squash" \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "body option value is not a PR selector" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --body x --match-head-commit $head_sha --squash" \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "match-head option value is not a PR selector" \
    'gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit 1234567 --squash' \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "author-email option value is not a PR selector" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --author-email maintainer@example.invalid --match-head-commit $head_sha --squash" \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "dynamic selector fails closed" \
    "gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge \"\$PR_NUMBER\" --match-head-commit $head_sha --squash" \
    'gh pr merge' '' '0Bu/daikin-altherma-esp32' 'github.com' "$retired_pr_merge_error"
parser_case "combined env split-string merge is recognized" \
    "env -S'gh pr merge 123 --squash'" 'gh pr merge' '123' '' '' "$retired_pr_merge_error"
parser_case "locale-quoted merge executable is recognized" \
    "bash -c 'g\$\"h\" pr merge 123 --squash'" 'gh pr merge' '123' '' '' "$retired_pr_merge_error"
parser_case "ANSI-C hex merge executable is recognized" \
    "g\$'\\x68' pr merge 123 --squash" 'gh pr merge' '123' '' '' "$retired_pr_merge_error"
parser_case "line-continued merge executable is recognized" \
    $'g\\\nh pr merge 123 --squash' 'gh pr merge' '123' '' '' "$retired_pr_merge_error"
parser_case "globbed merge executable is recognized" \
    '/tmp/g[h] pr merge 123 --squash' 'gh pr merge' '123' '' '' "$retired_pr_merge_error"
parser_case "brace-range merge executable is recognized" \
    'g{h..h} pr merge 123 --squash' 'gh pr merge' '123' '' '' "$retired_pr_merge_error"

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" AGENT_UI_GIF_AUDIT_RC=1 \
    "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'dashboard recording is stale'; then
    echo "PASS  failing mechanical UI-GIF audit blocks merge despite current reviews"; pass=$((pass + 1))
else
    echo "FAIL  failing mechanical UI-GIF audit did not block (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" AGENT_UI_SUITE_RC=1 \
    "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'UI use-case suite failed'; then
    echo "PASS  failing local UI suite blocks merge"; pass=$((pass + 1))
else
    echo "FAIL  failing local UI suite did not block (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

: >"$suite_log"
out="$(printf '%s' "$merge_input" | env PATH="$tmp/bin:$PATH" \
    AGENT_PROJECT_DIR="$merge_root" AGENT_SUITE_LOG="$suite_log" AGENT_ABSENCE_SUITE_RC=1 \
    "$pr_gate" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qF 'source-absence mutation suite failed'; then
    echo "PASS  failing local absence suite blocks merge"; pass=$((pass + 1))
else
    echo "FAIL  failing local absence suite did not block (rc=$rc output=$out)" >&2; fail=$((fail + 1))
fi

echo "agent hook selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
