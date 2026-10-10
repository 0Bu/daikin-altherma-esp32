# Prior source-absence failure examples

Read this when investigating a recurrence of a source-lifecycle defect. Current mandatory
checks remain in [the skill](../SKILL.md). These are historical examples, not current defects.

These historical findings were made while the firmware built, the
host logic tests passed, the domain audit reported no findings, the description
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

