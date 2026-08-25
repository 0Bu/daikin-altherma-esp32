---
name: pr-hygiene-review
description: Check a commit range and the PR title/description for personal information and non-English prose that the mechanical gate cannot see by shape alone — a real name in running text, a described address, a screenshot or pasted log that only reads as personal once a human recognizes it, mixed-language phrasing too short to trip the heuristic. Use before opening a PR and again before merge. Review is read-only unless the user explicitly asks for a rewrite — a finding already pushed lives in the commit object, not just the PR description.
---

# pr-hygiene-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

`scripts/run-pr-hygiene-audit.sh` (`tools/pr_hygiene/`) mechanically catches what has a reliable
SHAPE in a commit message or the PR title/description: an email outside GitHub's own
noreply/example patterns, a phone number, a GPS coordinate pair, a pasted private key or
credential-shaped token, and high-confidence German prose (reusing the same German-detection
predicate `tools/user_docs/english_docs.mjs` applies to maintained documentation). It cannot
reliably see other languages, a real name in running text, a street address spelled out in words,
a WiFi SSID/password pasted as plain text
instead of through this project's own redacted report flow, or a phrase too short or too mixed to
trip the language heuristic. This skill is that second pass — for the same reason `$user-docs-review`
exists beside its own mechanical English check.

## Review the change

1. Read the commit range (`git log <base>..<head>`) and the PR title/description as GitHub will
   render them, not only the working tree — a rebase or squash can carry prose the tree never held.
2. Look specifically for what the mechanical gate cannot key on: a contributor's real name, employer
   or household member named in prose; a street address, apartment or unit number spelled out in
   words; a filename or link that names a person or place; a WiFi SSID or password copied as plain
   text rather than through this project's documented redacted report flow
   (`main/logic/redact.hpp`, `docs/REPORTING.md`) — a report pasted by hand instead of through that
   flow is the recurring way this happens.
   Also read every prose line for English: French, Spanish, Italian and other non-English text is a
   human-review finding even when it does not match the deliberately narrow German signature.
3. Distinguish a git-trailer email (`Co-authored-by:`, `Signed-off-by:`) from one in running prose.
   Trailers are expected attribution and the mechanical gate already excludes them; do not re-flag
   one here.
4. Read the actual diff too, not just the messages describing it — a fixture, test constant, or code
   comment can carry the same categories (a real hostname, a personal API key) that this gate's
   mechanical half deliberately does not scan for (see `tools/pr_hygiene/personal_info.mjs` for why:
   this codebase's MACs, register bytes and bench IPs would drown a value-shaped heuristic run over a
   diff the way `tools/redact/` had to solve by identifier name instead).
5. If a finding is already pushed, it lives in the commit object itself, not just the PR description
   — editing the description does not remove it. Say so explicitly and let the user decide: rewrite
   history on a branch they own (never on a branch you do not own, per `AGENTS.md`), or accept it if
   it turns out not to be sensitive (a maintained public contact, a placeholder value).

## Run the gate

Run the mechanical check first — it is fast and clears the shape-detectable cases before the slower
human read:

```bash
scripts/run-pr-hygiene-audit.sh
```

Locally, with no PR open yet, it checks the commit range only and says so; in CI, under the
`pull_request` event, it also checks the live PR title/description.

If a finding is a false positive (a version string the phone-number heuristic misread, a technical
term the German heuristic misread), the failure output names a SHA-256 fingerprint of the exact
flagged line. Add it to `tools/pr_hygiene/audit_exceptions.txt` with a one-line reason — never by
quoting the flagged text itself; the ledger holds fingerprints, not the personal data this gate exists
to keep out of the repository. Do not adjudicate a finding that is actually sensitive: fix the text,
and if it already landed in a pushed commit, rewrite that commit instead.

Do not weaken the email allowlist, the phone/coordinate confidence thresholds, or the English-only
requirement to clear a finding. A gate that has been loosened to pass stops meaning anything the next
time it is green.

## Record the merge review

After both the mechanical audit and the human pass are clean at the exact PR head, record the result
in the PR's maintainer-gates section as `$pr-hygiene-review` with the bare current head SHA. A later
commit invalidates the record; rerun both halves and update the stamp. Never stamp only the
mechanical result: the required record exists specifically for the personal information, diff
content and non-English prose the shape checks cannot recognize.
