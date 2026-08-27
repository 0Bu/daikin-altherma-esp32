#!/usr/bin/env bash
# Publish one declarative slice of an already-bootstrapped gh-pages branch through GitHub's
# createCommitOnBranch GraphQL mutation. Unlike a local `git commit && git push` by
# github-actions[bot], commits created by this mutation are automatically signed by GitHub and can
# therefore satisfy a require-signed-commits rule without exposing any maintainer signing key.
#
# The first gh-pages commit is intentionally out of scope: migration bootstraps one local,
# GPG-signed orphan commit containing both root and dev/. Every later publish comes through here.
# Root owns everything except dev/; --dev owns only dev/. expectedHeadOid plus a bounded retry keeps
# concurrent release/dev publishers from overwriting one another.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-root}"
PUSH_ATTEMPTS=5
MAX_FILES_PER_SLICE=100
MAX_GRAPHQL_PAYLOAD_BYTES=$((8 * 1024 * 1024))

case "$mode" in
    --dev) [ "$#" -eq 1 ] || { echo "publish: --dev takes no value" >&2; exit 1; }
           owner=dev; msg="pages: publish dev channel" ;;
    root)  [ "$#" -le 1 ] || { echo "publish: root takes no value" >&2; exit 1; }
           owner=root; msg="pages: publish root" ;;
    *)     echo "publish: unknown mode '$mode' (expected no argument, or --dev)" >&2; exit 1 ;;
esac

[ -d _site ] || { echo "publish: no _site/; run scripts/build-pages.sh first" >&2; exit 1; }
[ -n "${GITHUB_REPOSITORY:-}" ] || {
    echo "publish: GITHUB_REPOSITORY is required (owner/repo)" >&2; exit 1;
}
command -v gh >/dev/null || { echo "publish: gh is required" >&2; exit 1; }
command -v node >/dev/null || { echo "publish: node is required" >&2; exit 1; }

# createCommitOnBranch appends to an existing branch. Requiring the signed bootstrap explicitly is
# safer than quietly creating an unsigned orphan when a fetch is missing or the branch was deleted.
if [ -z "$(git ls-remote --heads origin refs/heads/gh-pages)" ]; then
    echo "publish: gh-pages does not exist; push the reviewed signed orphan bootstrap first" >&2
    exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

record_published_oid() {
    local oid="$1"
    [[ "$oid" =~ ^[0-9a-f]{40}$ ]] || {
        echo "publish: API returned an invalid commit id" >&2
        return 1
    }
    if [ -n "${PUBLISH_OID_FILE:-}" ]; then
        umask 077
        printf '%s\n' "$oid" > "$PUBLISH_OID_FILE"
    fi
}

remote_head() {
    local line
    line="$(git ls-remote --heads origin refs/heads/gh-pages)"
    [ -n "$line" ] || { echo "publish: gh-pages disappeared" >&2; return 1; }
    printf '%s\n' "${line%%[[:space:]]*}"
}

attempt=1
while [ "$attempt" -le "$PUSH_ATTEMPTS" ]; do
    # Fetch just this branch: current blob ids let the payload omit unchanged multi-megabyte files.
    git fetch --quiet --no-tags --force origin \
        refs/heads/gh-pages:refs/remotes/origin/gh-pages
    expected="$(git rev-parse refs/remotes/origin/gh-pages)"
    git ls-tree -r "$expected" > "$tmp/current-tree"

    stats="$(node scripts/pages-commit-payload.mjs prepare \
        "$owner" _site "$tmp/current-tree" "$expected" "$GITHUB_REPOSITORY" "$msg" \
        "$tmp/payload.json" "$tmp/meta.json")"
    read -r changes additions deletions desired_files decoded_bytes payload_bytes <<< "$stats"

    [ "$desired_files" -le "$MAX_FILES_PER_SLICE" ] || {
        echo "publish: $desired_files files exceed the $MAX_FILES_PER_SLICE-file slice budget" >&2
        exit 1
    }
    [ "$payload_bytes" -le "$MAX_GRAPHQL_PAYLOAD_BYTES" ] || {
        echo "publish: GraphQL payload $payload_bytes exceeds the $MAX_GRAPHQL_PAYLOAD_BYTES-byte budget" >&2
        exit 1
    }

    if [ "$changes" -eq 0 ]; then
        # A lost HTTP response can land the commit but make the caller retry. Accept the resulting
        # no-op only after GitHub itself confirms that the current tip is Verified.
        gh api "repos/$GITHUB_REPOSITORY/commits/$expected" > "$tmp/existing.json"
        node scripts/pages-commit-payload.mjs verify-rest "$tmp/existing.json" "$expected" >/dev/null
        record_published_oid "$expected"
        echo "gh-pages: $msg (unchanged, verified $expected)"
        exit 0
    fi

    set +e
    gh api graphql --input "$tmp/payload.json" > "$tmp/response.json" 2> "$tmp/error.log"
    api_rc=$?
    verify_rc=10
    new_oid=""
    if [ "$api_rc" -eq 0 ]; then
        new_oid="$(node scripts/pages-commit-payload.mjs verify \
            "$tmp/response.json" "$expected" 2> "$tmp/verify.log")"
        verify_rc=$?
    fi
    set -e

    if [ "$api_rc" -eq 0 ] && [ "$verify_rc" -eq 0 ]; then
        record_published_oid "$new_oid"
        echo "gh-pages: $msg ($additions additions, $deletions deletions, verified $new_oid)"
        exit 0
    fi
    if [ "$verify_rc" -eq 11 ]; then
        cat "$tmp/verify.log" >&2
        exit 1
    fi

    latest="$(remote_head)"
    if [ "$latest" = "$expected" ]; then
        [ "$api_rc" -eq 0 ] || cat "$tmp/error.log" >&2
        [ "$api_rc" -ne 0 ] || cat "$tmp/verify.log" >&2
        echo "publish: GraphQL mutation failed without a concurrent branch move" >&2
        exit 1
    fi
    if [ "$attempt" -ge "$PUSH_ATTEMPTS" ]; then
        echo "publish: gh-pages still contested after $PUSH_ATTEMPTS attempts" >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    echo "publish: gh-pages moved under us; rebuilding against $latest (attempt $attempt/$PUSH_ATTEMPTS)" >&2
    sleep "$((attempt - 1))"
done
