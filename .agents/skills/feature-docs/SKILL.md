---
name: feature-docs
description: Keep docs/FEATURES.md (this firmware's technical-feature catalog) in sync when a new platform feature lands — a new ESP-IDF component, an sdkconfig capability, an HTTP/OTA/security/network/diagnostic mechanism, a new logic/ header, or a stub becoming real. Use after implementing or changing a technical feature, before opening the PR.
---

# feature-docs

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

[`docs/FEATURES.md`](../../../docs/FEATURES.md) is the cross-cutting catalog of **what this firmware
does** at the platform level (Secure Boot v2 signing, OTA + health gate, the polled live UI, the ESP-IDF
component inventory, diagnostics, WiFi resilience). It is a project-specific record — not a how-to for
other projects. It rots silently: a new component gets linked, a `CONFIG_*` gets flipped, a `🔭` stub
becomes real — and the catalog still describes the old world. This skill closes that gap. It is the
feature-level companion to [`project-review`](../project-review/SKILL.md) (broad pre-merge drift) and
[`doc_drift_checker`](../../../.codex/agents/doc-drift-checker.toml) (AGENTS.md ↔ deep-dive docs).

**FEATURES.md must never overstate the firmware.** Every `✅`/`🧪` claim points at code that backs
it; anything not fully wired is `🟡`/`🔭` with the TODO named. When in doubt, downgrade the label.

## When to run

After a change whose diff shows any of these — each is a signal a catalog entry must be added,
promoted, or corrected:

| Signal (grep the diff) | Catalog impact |
|------------------------|----------------|
| new entry in `main/CMakeLists.txt` `REQUIRES` or `main/idf_component.yml` | add a row to the **ESP-IDF component inventory** (§11) + a feature section |
| a `CONFIG_*` added/flipped in `sdkconfig.defaults` | new capability (§ relevant) or a footprint-trim row (§10) |
| new `main/logic/*.hpp` header or new `CHECK`s in `test/test_logic.cpp` | update the logic-core list + the CHECK count (§8) — derive it with `grep -o 'CHECK(' test/test_logic.cpp \| wc -l` minus 1 for the `#define CHECK` line (`-o` not `-c`: `-c` counts lines and would undercount two `CHECK`s on one line) |
| new `http_register(...)` route | HTTP feature (§4) + the matrix |
| a `TODO`/stub in `ota_update.cpp` / `mcp_server.cpp` becoming real | promote the status label `🔭`/`🟡` → `✅` (§2, §11, matrix) |
| new `partitions.csv` layout, signing/OTA/rollback change | §1/§2 + cross-check [`SECURITY.md`](../../../docs/SECURITY.md) |
| new MQTT topic / HA entity, heartbeat/crash field | §5/§6 + the entity counts — read them off `HEARTBEAT_SENSOR_COUNT` (`main/logic/heartbeat.hpp`) and `CRASH_SENSOR_COUNT` (`main/logic/crashinfo.hpp`), each a `sizeof` over its sensor table |
| new WiFi/mDNS/DHCP/watchdog behaviour | §3 |

If the diff touches none of these, FEATURES.md probably needs nothing — say so and stop.

## Steps

1. **Diff the surface.** `git diff main...HEAD -- main/ sdkconfig.defaults partitions.csv scripts/ .github/` and
   scan for the signals above. Read the *actual* new code — do not infer a feature from a commit message.
2. **Locate the catalog entry.** Find the matching section **and** the feature-matrix row at the top
   of FEATURES.md. Most features appear in both — update both, plus the ESP-IDF inventory (§11) if a
   component was added.
3. **Write the entry code-verified — and SHORT.** State what the feature does in **one line** in the
   matrix and **at most two or three** in its section, point at the file with a repo-relative
   markdown link (targets are relative to `docs/`, e.g. `../main/wifi.cpp`), and label the status
   honestly (`✅` shipping / `🧪` host-tested logic / `🟡` partial / `🔭` planned). Copy exact numbers
   from the source — sensor counts, `CHECK` count, partition sizes, `CONFIG_*` names — never round or
   guess, and prefer omitting a volatile count to restating one that will drift.

   **What does NOT go in the entry** — this is the failure mode this file actually has, not a
   hypothetical one: the catalog once reached 1510 lines, a third of it inside "the short version"
   matrix, because each new feature appended its full rationale to a table cell. Keep out the bug
   that motivated the feature (→ the issue), the measurement that settled it (→ the issue or
   `ARCHITECTURE.md`), the field-by-field API listing (→ `docs/ARCHITECTURE.md`), and the
   per-header reasoning (→ the header's own comment). A reader comes here to learn *that* a mechanism
   exists and *where* it lives; every line past that belongs somewhere it can be found on purpose.
   If an entry needs more room, the deep-dive doc is the room.
4. **Promote, don't just append, when a stub goes real.** If `ota_update.cpp`'s download or
   `mcp_server.cpp` graduates from TODO, change the label everywhere it appears (matrix + section +
   inventory) and delete the "planned" wording.
5. **Keep the deep-dive docs authoritative.** FEATURES.md links to [`ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md),
   [`SECURITY.md`](../../../docs/SECURITY.md), etc.; it summarizes, it does not fork their detail. If the
   feature also needs a deep-dive edit, do that there and link — don't duplicate the prose.
6. **Verify.**
   - Links resolve — every `](../…)` target exists (they're relative to `docs/`).
   - `scripts/run-mock-tests.sh` still passes if a `logic/` count changed.
   - No `✅`/`🧪` claim is unbacked; no shipped feature left as `🔭`.
7. **Keep the framing hooks current.** FEATURES.md opens with a status legend and closes with a
   pointer back to this skill — leave both intact.

## Guardrails

- **Verified, not aspirational.** The catalog's value is that a reader can trust it. A `✅` you can't
  point at is worse than an omitted feature.
- **A catalog, not a tutorial.** It records what *this* firmware does and where — it is not a
  copy/paste guide for reusing a feature in another project. Keep entries descriptive, not how-to.
- **A catalog, not an archive.** An index earns its keep by being readable end to end; a feature
  stated in one line is worth more than the same feature stated in twenty. When editing an existing
  entry, leave it **no longer than you found it** — the growth here has always been incremental, one
  defensible paragraph at a time. Prune while you are in there.
- **Ids are stable keys.** Never renumber or reuse a matrix id; a gap means a retired feature.
- **Don't rename the file or restructure sections** without reason — other docs, the README and
  [`AGENTS.md`](../../../AGENTS.md) may link to `docs/FEATURES.md` and its anchors.
- **The project convention holds:** always write the full name `daikin-altherma-esp32`, and don't name
  other projects in the catalog (the README credit is the sole exception).

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) gates the
documented host-, repository-, PR- and head-bound CLI merge path; CI independently enforces the same
current-head evidence. Its feature-docs check, the sibling of the `$project-review` gate, is
**conditional**:
it fires only when the PR changes technical-feature surface (`main/`, `test/`, `sdkconfig.defaults`,
`partitions.csv`, or the CI build workflow). A docs-only / script-only / chore PR is not gated.

When it applies, record the pass — after running this skill and confirming `docs/FEATURES.md` matches
the code — by TICKING and SHA-STAMPING the PR's `$feature-docs` box with the reviewed commit:

```
- [x] `$feature-docs` synced — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

The gate allows the merge only while that box is checked AND its stamp still matches the PR head, so
any later commit re-stales it and forces a fresh run. Edit the PR body with
`scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr edit <pr> --body-file <file>`.
If the skill
concludes no catalog change was needed (§*When to run* → "nothing"), the docs are already in sync —
still tick + stamp the box to record that you checked. Don't tick it if FEATURES.md is out of date —
fix it first. The gate fails **closed**: if GitHub can't be read, the merge is blocked with guidance.
