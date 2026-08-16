---
name: absence-review
description: Review what the firmware and the web UI do when a third-party system is unconfigured, deleted, or unreachable — the MQTT broker, the HomeHub, ENV III, the MQTT room source, the circulation witness, Open-Meteo, the X10A bus, and safe mode. Runs the deterministic absence matrix and then judges what it cannot. Use after changes that add, remove, or read an optional source. Report findings by default; apply fixes only when explicitly requested.
model: opus
---

# absence-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope.

Every source this firmware reads except the board itself is **optional**, and each can be absent
independently of the others: the MQTT broker, the MQTT room source, the MQTT circulation witness, the
HomeHub Modbus link, the ENV III accessory, the Open-Meteo location, and the X10A bus itself. Safe
mode removes all of them at once. Absence is not one state — it is a **cross product**, and it is
where this project's gates are structurally blind.

That blindness is measured, not assumed. Every finding below was made while the firmware built, the
host logic tests passed, the domain audit confirmed every value physically true, the description
audit found copy for each, the schematic audit found the drawing correct, and the UI use-case suite
drove every modal:

* The board's own **memory trends stopped recording** when the X10A bus did not answer. They were
  folded inside the heat pump's poll cycle, which only runs once a profile is resolved — so on
  exactly the board someone was debugging, the two heap curves that answer "is the heap drifting"
  were absent from `/status.history.rows` entirely. An unrelated feature disappeared because a
  *different* subsystem was unreachable.
* The heating-curve card told a reader to **"set up a room source"** while their configured room
  source sat one row below it, because `off` is the evaluator's word for both "nothing is mapped"
  and "the sampler never ran".
* The circulation row answered a **cleared broker** with "waiting for a message", forever, with no
  colour and no cause, while the room source one row up named the same cause outright.
* An **unconfigured** circulation witness was still offered a 24-hour chart, so its tongue read "no
  readings yet" under a row reading "not configured".
* `?redact=1` **invented identifiers**: a device with no room source, no witness, no HomeHub and no
  syslog collector produced a bug report indistinguishable from one that had all four and hid them.

None of these is visible in a value, a converter, a payload schema or a pixel. They are visible in
one place: the pair (what is configured, what is answering).

**This review is CONDITIONAL**, like `/feature-docs` and `/schematic-review` and unlike
`/domain-review`. The canonical filter lives behind
[`tools/agent-hooks/require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh); read it
rather than trusting a copied list, and grow it if an optional source moves.
`.claude/hooks/require-absence-review.sh` is only a compatibility adapter. Report findings; apply
fixes only when the user explicitly requests them.

## 1. Run the deterministic half

```bash
scripts/run-contract-tests.sh      # includes test_source_absence_contract.mjs (firmware invariants)
scripts/run-ui-use-case-tests.sh   # includes test_ui_absence_matrix.mjs      (browser behaviour)
tools/absence/selftest.sh          # prove the matrix still catches the defects it was built for
```

The selftest is not optional when you have touched either test file. Both halves are assertions
about **text and rendered markup**, and a regex that stops matching the code it describes goes
**green**, not red — a broken check and a correct one look identical. `tools/absence/selftest.sh`
re-seeds each shipped defect into a throwaway tree and fails if any survives; it has already caught
one of its own checks written so that it could never fire.

## 2. Judge what the matrix cannot

The matrix walks the states it knows. It cannot tell you whether a NEW source is in it, whether an
absence is *honest*, or whether the German and English say the same thing. Work through these.

### 2.1 Is every optional source in the matrix?

List what the diff touches, then check `test/test_ui_absence_matrix.mjs`'s `REMOVE` table. A source
added without an entry there is a source whose absence nobody has walked. The entry must be written
in the shape `http_status.cpp` **actually emits** for that removal — a fixture that guesses is a test
of the guess.

### 2.2 Does removing one source remove only ITS derived artefacts?

This is the question the board-trend defect answers wrongly, and the one to ask hardest. For the
source in the diff, enumerate what is DERIVED from it and confirm each is retired **with** it and
nothing else is:

| Derived from a source | Retired by | Must survive |
|---|---|---|
| 24-hour trend ring | its own reset (`history_*_reset`) or a reboot | every other source's ring |
| `/status.history.*rows` entry | the source's `enabled`/`configured` gate | the board's own trends |
| retained MQTT topic | an explicit empty retained publish | every other topic |
| HA discovery config | an explicit retraction before any replacement | other entities |
| a checkup verdict's evidence | `checkup_dhw_reset()` and friends | the other checks |
| the heating-curve sample memory | disarming | the sequence contract |

Two directions fail here, and both have shipped: a derived artefact that **outlives** its source
(a stale ring spliced onto a new one, a retained topic nobody deletes) and an **unrelated** artefact
that dies with it (the board trends).

### 2.3 Is the absence stated as absence?

`logic/history.hpp`'s rule and `feature_gate.hpp`'s DISABLE-NEVER-DEGRADE are the same rule seen
twice: an absent feature is stated **by its absence**, never by an empty chart, a zero, a blank pill
that looks like a reading, or a substituted second-best value. Check:

* an unoffered trend renders **nothing**, not "no readings yet";
* a value that cannot be measured is `—` with a REASON in the inspector, not a stale number;
* a derived figure whose inputs are gone is withheld, not computed from a substitute;
* an absent array is **omitted**, not emitted empty (only absence says "no current reading").

### 2.4 Does the copy name the real blocker?

The rule the room-source row already follows: a row that cannot produce a value must say **which**
thing to go and fix, and must not name a thing that is already done. Read every state string the diff
can reach, in **both** languages, and ask of each: is this true when the user has configured
everything except the one thing this names?

Watch for the shape that produced two of the five findings — **one word covering two states**.
"Disabled", "waiting", "not available" each read as a single condition and are routinely reached from
two very different ones, only one of which the reader can act on.

### 2.5 Can a task that never STARTED make a configured source read as absent?

`/status` is built on the httpd task and must be truthful even when the task that owns a source was
never created — no broker (`mqtt_ha.cpp` returns before `xTaskCreate`), or safe mode (`main.cpp`
skips every optional consumer). So `configured` must come from the **config**, never from a
task-maintained status struct, and any field that IS task-maintained must not contradict it. The
armed-but-disabled payload is exactly this failure.

### 2.6 Is safe mode visible where it is the cause?

Safe mode removes every optional consumer at once. A card that reports its source's absence without
naming safe mode sends the reader to re-configure something that is already correct. The global
banner helps but does not excuse a per-card lie.

## 3. Apply authorized fixes

When the user requested fixes, fix in the firmware where the answer is a fact about the device, in
the browser where it is a fact about presentation, and in `main/logic/` where it is a rule — with a
`CHECK` in `test/test_logic.cpp`
for the rule, an entry in the matrix for the state, and a seed in `tools/absence/selftest.sh` for any
check you add. Then re-run all three commands in §1 plus `scripts/run-mock-tests.sh`.

## 4. Record the gate

```
- [x] `/absence-review` clean — merge gate @ <short-sha>
```

Stamped with the PR head, like every other gate here; any later commit re-stales it.
