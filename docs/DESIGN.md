# UI design specification

This document owns the observable behavior, information structure and visual truth of the device
UI and browser installer. It describes the current implementation, not a backlog. Source files are
[main/www/](../main/www/) and [docs/index.html](index.html). HTTP payloads belong in
[API.md](API.md), diagnosis rules and evidence in [DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md),
and internal lifecycle/resource constraints in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Principles

- The dashboard answers what the plant is doing and what its readings mean. Settings holds
  configuration and board health, one tap behind the gear.
- Provision WiFi first, then run. Model and protocol detection are automatic; there is no model
  picker, value checklist or poll-interval control.
- Preserve source identity and uncertainty. Missing, stale, held, invalid and current readings
  are different facts. A plausible cached number must not become a current measurement.
- Use short labels, tabular values and explanations on demand. State an important limit next to
  the result it bounds; detailed evidence stays reachable through the relevant reference.
- Configuration changes are explicit, fallible and confirmed by the server. The firmware observes
  the heat pump; no UI action writes a plant setting over X10A or HomeHub.

The device UI supports en/de/es/fr/it/pl/cs/uk/zh/ja/nb/sv/fi. Browser language is the default;
`no` maps to Norwegian Bokmål and `zh` to Simplified Chinese. A saved Language selection overrides
that default for every client until reset to Browser. It applies live without reload. English is
embedded in the startup page; other catalogs load from signed-image assets on the device. There are
no remote localization services. API prose and X10A register labels remain English; UI controls,
inspectors, HomeHub names, errors and value/model explanations are localized. The Pages installer
is English-only, and the captive provisioning page is separate from the main UI script.

## 2. Brand & colour tokens

[style.css](../main/www/style.css) owns exact token values. These are the semantic roles:

| Token | Role |
|---|---|
| `--brand`, `--brand-strong`, `--brand-sky` | Identity, navigation, primary actions, focus and highlights |
| `--brand-navy` | Reserved accent, currently unused |
| `--brand-tint` | Provisioning hero and explanation panels |
| `--bg`, `--card`, `--fg`, `--muted`, `--line` | Page, surfaces, text, labels and dividers |
| `--ok`, `--warn`, `--err` | Connected/running, attention and fault states |
| `--flow-hot`, `--flow-cold` | Thermal supply/return direction, independent of health |

Brand colours identify actions; semantic colours identify states. Warm/cold pipe colours never
claim a healthy or faulty plant. Theme follows `prefers-color-scheme`; light and dark are both
supported. Text meets AA contrast on its actual surface, with visible keyboard focus.

## 3. Layout tokens

Use the system font stack, 15 px/1.5 mobile base and tabular numbers. The spacing scale is
4/8/12/16/24/32 px; controls, cards and pills use their shared radius tokens. Cards use a border
and subtle shadow. The centred container is at most 720 px on mobile, 820 px from 600 px upward,
where the whole type ramp scales together by approximately 1.15. Cards remain one column at every
width. The header is sticky with the brand rule.

## 4. Information architecture (the state machine)

| Place | Entry | Content and exit |
|---|---|---|
| Provisioning | Open setup SoftAP | WiFi credentials; accepted Save reboots into the LAN |
| Dashboard | `/` | Schematic, model, diagnostics and values; gear opens Settings |
| Settings | `/#settings` | Flat stack of configuration/health cards; chevron or Escape returns |
| Settings dialog | `/#settings/<popup>` | Addressable editor/report dialog; Save, Cancel, backdrop, Escape or Back returns |
| OTA decision | Fresh completed update check | Transient confirmation; never restored from a bookmark |

Hash routes create no additional firmware resource. Opening Settings or a dialog adds browser
history; Back/Forward and visible close actions traverse the same hierarchy. A shared/reloaded
Settings URL fills its dialog through the normal lifecycle. A first status response can hydrate
that form but cannot overwrite a draft the user has started.

The browser polls values every 2 seconds and status every 8 seconds on one recursive timeout chain.
It never stacks requests behind a slow response. Each fetch is bounded at 6 seconds; failures back
off to at most 30 seconds. Hidden tabs suspend polling and becoming visible retries immediately.
The plant's poll engine has its separate cadence. There is no WebSocket/push transport.

Only the latest requested status can update the screen; value replies also belong to that source
lifetime. Failed reads retire live measurements and stop unsupported motion until a fresh frame
arrives; Settings labels retained status as a snapshot and suppresses current sensor claims.
A changed application-image identity reloads the page before using the new image's data
or positional locale catalogs.

The dashboard stays readable while configuration or updates run. Every asynchronous state has an
explicit result. An answered 503 is busy/retryable, not an unreachable device. Losing HTTP contact
and losing only X10A are rendered separately.

## 5. View specs

### 5.0 Provision (captive portal, `setup.html`)

A faint brand hero and one card contain typed SSID, password and Save & reboot. No scan, picker or
background fetch is needed; hidden SSIDs work as ordinary text. The server accepts SSIDs of 1–32
bytes and passwords that are empty or 8–63 bytes. The client's length check counts JavaScript code
units, so multibyte input can pass it and still be rejected by the server.
Announce Saved/rebooting only after acceptance.
Rejection keeps the form and displays the server reason; busy 503 has neutral retry wording.
Network-derived strings use DOM text/value properties and are never interpreted as markup.

### 5.1 WiFi / MQTT / Syslog / NTP edit  (modal, from the Connections tile)

Connections rows open centred dialogs over the dimmed Settings view. Cancel, backdrop and Escape
write nothing. Save disables its button during the request, reads the response, and enters reboot/
reconnect only when accepted and a reboot is required. A no-change result closes without waiting
for a reboot. While Save is pending, dismissal and navigation wait for its result; rejection leaves
the user's draft intact. Setup feedback and ordinary save toasts are announced to assistive tools.

| Editor | Required behavior |
|---|---|
| WiFi | Prefill SSID only; never expose the password. Explain automatic one-shot rollback to the previous network when new credentials fail. The later outcome belongs in the rollback banner. |
| MQTT | Prefill broker/base-topic facts, never credentials. Blank credential fields keep stored credentials; explicit Remove stored credentials clears them. Typing credentials selects encrypted transport. Clearing stored credentials preserves the chosen TLS scheme. Broker save preflights DNS/TCP/authentication before persistence; an empty broker disables it. |
| Syslog | Host and port 1–65535, default 514; empty host disables. DNS/reachability appear after reboot on the connection row. A silent ping alone does not mean forwarding stopped. |
| NTP | Server hostname/IP, no port; an empty value resets to the compiled default. There is no disabled SNTP state. |

Dialogs use the dynamic visible viewport (`100dvh` with fallback). Long content scrolls inside
the card, overscroll is contained and both document scrollers are locked while any dialog is open.
The final close restores background scrolling. Actions remain reachable on a phone with browser
chrome or the keyboard open.

### 5.2 Heat pump — no settings screen (fully automatic)

X10A identifies its protocol and model at each boot. The physical RX/TX link may persist; the model
is not a saved selection. Protocol and link status are read-only. Connected RX/TX pins are plain
values; offline pins become selectors constrained by the actual board's exposed, unreserved GPIOs.
Custom uses the generic chip-safe list and retains off-list configured pins. Named boards suggest
a distinct permitted pair if the cached pair is unavailable. Opening the view does not save these
suggestions; changing a pin submits the displayed pair and reruns detection with that pair and its swap.

HomeHub is an independent optional read-only instrument, with its own cache, liveness and
configuration. Fresh firmware performs one bounded search on its first networked boot and persists
the result, including a miss. Later manual Search fills the form without saving. Saving an empty
address disables future automatic search and the Modbus task. To edit both connections,
update X10A and HomeHub in separate requests; a mixed-domain request is rejected before persistence.
Neither connection controls the heat pump.

### 5.3 Dashboard — the operating screen  (default after setup)

The header has a static 48 px three-blade product mark, the full `daikin-altherma-esp32` name and
Settings gear. The mark does not animate or imply plant activity. Below the name, IP and firmware
version share a muted monospaced line; only IP may ellipsize. The version is an update-check button
with inline progress. The Settings footer's repeated version is plain text.

Dashboard order is recovery/rollback/crash banners, system schematic, then the selectable card
panel described in §6. There is no separate status hero, telemetry strip or dashboard configuration form.

**Banners**

| Banner | Meaning and lifecycle |
|---|---|
| Recovery mode | Polling/publication are paused after bounded recovery escalation. It reflects live state, offers no dismiss and clears after recovery. Copy distinguishes the available cause rather than assuming every recovery was a crash. |
| WiFi rollback | New credentials failed and the device restored the named previous network. Sticky until the next WiFi change; no dismiss. |
| Crash | Current fault (panic, watchdog or power fault) uses Device restarted after a fault; otherwise show Earlier report waiting. Separate current reset/build metadata from optional stored task, PC, call stack and ELF identity. Download only while an image is reportable. |

Crash deletion asks for a second tap inside the banner and names the dump only when present.
The confirmation is tied to the same crash signature, so a new crash cannot inherit an old decision.
Required erase failure retains the report; proven foreign residue is preserved but suppressed and
cannot pin a separate current-fault banner. Banner state lives outside the poll-rebuilt grid.
Stored incident age and relationship to this reset remain unknown, even with matching ELF identity.
Copy diagnostics uses the cached build/crash summary plus redacted `/diag`, preserving read failures
and distinguishing stored ELF from the running build. Raw dumps are private evidence.

**Current state and provenance**

The SVG's top-left status block names operating mode, then activity: running, defrosting,
circulating with compressor off, standby, fault, waiting or unreachable. A live bus alone does not
prove operation. The headline may retain the last reported mode while the activity line clearly
says standby. The dot is green for running, red for fault and muted for standby/no data; words
separate those last two. Append poll age when no leaving-water reading provides freshness context.
An active BSH may explain electrical tank heating while compressor/pump/flow are stopped.

| Input state | Drawing, values and inspector |
|---|---|
| Current X10A | Use the qualified reading and its exact register identity |
| X10A unavailable/held, structurally paired live HomeHub | Show the independent HomeHub reading in petrol; inspector names its Modbus row |
| Neither instrument can supply a current valid reading | Show `—`; explain the specific reason without substituting zero |
| Stopped outdoor unit | Withhold held X10A outdoor-page readings; independently polled HomeHub may continue |
| Outdoor page, compressor speed unread (`held_unknown`) | The HomeHub's compressor flag settles it where it answers: ON is current, OFF is a stopped unit. Otherwise a structurally paired live HomeHub stands in; else keep the number, with the inspector and value table saying it may be old, and derive no electrical estimate from it. A value the firmware dropped shows `—` |
| HTTP unreachable | Stop unsupported motion, identify lost device contact and keep retrying |

A successful Modbus read proves transport freshness. With no source timestamp, the underlying
measurement age remains unknown. It cannot repair the provenance of a held X10A sample.

**Schematic topology and sensor placement**

The SVG is a simplified split-system hydraulic/refrigerant diagram, not a model-specific piping
plan. Inspector copy explains differing monobloc, ground-source, hybrid or thermal-store layouts
when relevant. The outdoor unit contains fan/compressor and EEV. Upper/lower connections to the
plate heat exchanger are gas/liquid; the lower line is not a suction line.

| Water-side order or location | Contract |
|---|---|
| PHE → R1T → BUH → circulation pump → R2T → 3-way valve | Pump is on supply. R1T is before electric backup heat; R2T is after heater/pump. BUH/pump occupy a balanced flush sequence. |
| R1T and R2T pills | Same value/name baselines, with ties to their separate measuring runs |
| 3-way valve → tank or space circuit | Parallel loads side by side on one level, not consecutive stages: tank left on the valve's straight drop, space circuit right on the L-shaped run |
| Tank | Tank temperature and setpoint inside; permanent BSH/E-heater state belongs here |
| Space circuit | Named room reading and target inside; space heating/cooling operation on the riser outside |
| Common return after branch junction → R4T → PHE | Return temperature belongs to the shared run, never the heating-only leg |
| Return pills | Two left-aligned columns, each one pill width: water pressure above R4T, binary flow-switch state above flow |
| PHE | Signed ΔT, estimated capacity and COP/EER are drawn on the plate |
| Outdoor unit | Estimated electrical input is drawn where electrical power enters |

The space-operation flag is not thermostat demand and may be ON in Cooling with compressor OFF.
R1T/R4T are internal exchanger sensors; they do not establish emitter temperatures or building load.
BUH stage, BSH, Quiet, Defrost and BOOST stay on the component/subject they describe.

The room reading accepts the catalog's `Indoor ambient temp…` and exact `RT Temp.` labels in
both the drawing and inspector. Hybrid supplies the latter by default; other profiles supply it
only when the row is published. Missing readings remain absent, and live X10A/HomeHub priority
is unchanged.

Each pill has one reading and one target; a second value is permitted only for the same quantity's
setpoint. Repeat-unit readings normally need a quantity name. The documented exception is the refrigerant
pressure-above/temperature-below convention: high/low pressure and discharge temperature are
attributed by their separate runs. Water pressure remains named. Dropping that convention requires
removing its adjudication in `tools/schematic/audit_exceptions.txt`. Sensor sublabels use R1T/R2T/R4T. Contained tank/room/outdoor readings need no additional
frame. Names attribute measurements; prose, assumptions and source qualifications belong in the
inspector. Estimated power readings retain `≈` even when the inspector is closed.

**Derived working points**

ΔT is R1T−R4T and needs moving water. Capacity also needs a running compressor, known mode and
useful transfer direction: positive ΔT for heating/DHW, negative for cooling, displayed as positive
cooling capacity. COP/EER additionally requires compatible thermal/electrical boundaries. Missing
inputs, opposite-sign transfer and pump-only residual-temperature equalization leave these supported
pills visible as `—`. A reported Cooling mode with hot residual circulation uses neutral pipes and
Space circuit wording. During confirmed defrost, circulating water can give up heat to the
refrigerant across the plate heat exchanger. The estimate retains its sign. Negative thermal power
and cooler supply than return indicate heat leaving the water. The pipes stay neutral when current
readings cannot establish the direction.

Thermal power uses flow/60 × ΔT × ρ·cp, approximately 4.186 kJ/(l·K) for water with
ρ≈1 kg/l; glycol mixtures have different density and heat capacity. Electrical power is estimated
from current and assumed 230 V. CT clamps describe whole-unit input, while inverter current describes the compressor-side
boundary and is withheld when held at rest. A current profile lacking an input and an existing input
held from the previous run get different explanations. Live COP scope accounts for heater
boundaries; the inspector names the scope and any refusal. No label implies measured live power or
seasonal efficiency.

**State and motion**

The 3-way valve selects the animated hydraulic branch. Water flow has mode-aware warm/cold colours;
pump-only circulation is neutral. Cooling/defrost reverse refrigerant motion. Active BUH uses the
warning tint; active BSH turns the tank's perimeter dashes a fixed orange, distinct from the
red/blue hydronic charge.
Rotors stay centred on their hubs and carry no rotating flow-direction arrow (direction belongs
to pipe dashes): the outdoor fan turns when the compressor runs outside defrost, while the
circulation pump rotor turns strictly on reported pump ON/OFF (`d.pumpOn === true`)
independently of measured water flow, and water pipes animate solely from qualified flow
(`waterMoving`). Raw X10A pump signals outside `[0, 100]` stay unknown (`null`, never clamped to
`0 %`/`100 %`), and `0`/`100` (max/stop command) neither proves RPM, rotation, head nor flow.

Quiet/Defrost pills remain grey while inactive/unknown and blue while active. E-heater stays grey
or orange; its accessible name and inspector state ON/OFF/unknown. Native Altherma 4 holding 9
reports Off/Automatic/Manual quiet selection, not activity: Quiet stays unknown without independent
X10A activity evidence and has no native activity timeline. The permanent BOOST face says
only BOOST: Recommended on is petrol, other/unknown states grey. Its four-state timeline retains
Free running, Forced off, Recommended on and Forced on. Only Recommended on contributes to Boost
time. HomeHub's live network request outranks physical X10A SG contacts for this subject; the
inspector/timeline names whichever instrument supplies it. A request does not prove tank charging.

Static SVG nodes update in place so polls do not restart animation. The schematic remains present
when a source fails. Model-absent branches are omitted; a temporary source loss blanks readings
rather than hiding installed parts. Reduced motion stops nonessential motion while active paths
remain visually identifiable.
Full histories and an open inspector or value disclosure must preserve this continuity during live
polling: unchanged plots remain mounted and input remains responsive. Collapsed disclosures build
no history SVG; a static screenshot or posed recording cannot establish this temporal behavior.

A pipe's flow overlay, hit target and measurement attribution end at the same junction. Each branch
owns both legs; the common run owns only shared pipe. Every drawn pipe is inspectable. Enlarged tap
areas stop at fitting edges, accounting for round stroke caps: a fitting owns taps within its shape,
with no dead strip between component and pipe. A correct number on the wrong side of a junction is
a false drawing.

**Inspector**

Pointer/Enter/Space activates each labelled `role="button"` target. Hover/focus outlines it; source
and target use the same selected accent. The labelled SVG is a group, not an accessibility-hidden
tree. Opening preserves scroll position; tapping the same target, close or Escape closes the panel.

The inspector is an attached, inset explanation tongue using the shared clipped 220 ms pull-out
transition. It is inert while collapsed. The usual order is title/headline/exact source identity,
explanation, optional history, then owned supplementary values (if any). Assemblies and pipe runs
with no single measurement have no headline, numeric chart, or duplicated pill rows; they explain
the part and its live state in prose. A target omits its own duplicated headline row and never
duplicates readings owned by another schematic card; it keeps a current HomeHub twin of the same
quantity with its comparison and any un-pilled sub-readings owned solely by that component (tank
setpoint/disinfection, pump signal, BUH stage 2/capacity, operating-mode thermostat/fault code, room
setpoint, and electrical CT/inverter currents).

**Flow rate** follows that order. Its trend comes after the explanation and Normal note. The
HomeHub comparison follows the trend when paired, and the heating observation comes last. Violet
fill marks recorded five-minute windows wherever they overlap the visible, dated curve of the
reporting source. Gaps stay clear. Select an area or open the legend to read its time and heating
conditions directly below the plot. Adjacent five-minute windows share a readout.
The legend closes the readout on the second activation and reopens it at the next recorded window,
including windows inside curve gaps. The usual cursor reads the trend samples.

Explain what the quantity is, its bounded normal context, then current state or absence. Held data
cannot reappear in a headline, members or state sentence. A fallback pressure row must own headline,
source line and history together. Only rerender changed content so polling does not destroy a text
selection. Inspectors generally share descriptions with the value table. Flow rate has its own short
help. Native Altherma 4
flow/pressure and any Modbus Input 49 row marked `flow_scale_unverified` (`Probing`, `Fallback`, or
`Altherma4` sweeps) have unverified conversion limits: unverified flow displays provisionally on
the pill and unified 24-hour chart with its caveat without driving `waterMoving`, ΔT, thermal power,
or numeric agreement/difference. Source-qualified native or scaling limits take precedence over
generic compact inspector copy in every locale, including a stand-in or paired X10A row.
Definition-metadata and `flow_scale_unverified` changes invalidate the comparison even when its
numeric values do not change.

**History**

A trended reading has a 24-hour sparkline in its inspector and value expander, with no separate
history card or range picker. Numeric charts (88 px plot height) share a light area/darker line
grammar with faint dotted horizontal Y-scale reference lines and a right-aligned unit-bearing Y-axis
column to the left of the plot (multi-scale outdoor climate follows the first visible series in its
own colour, and water pressure suppresses ticks colliding with its severity thresholds); gaps break
both curve and fill, and a lone sample is a dot. Paired X10A and Modbus series share one chart, axis
and cursor, with blue/petrol source legends; paired Modbus starts active when available and toggles
in the legend. Room-temperature readings from X10A and HomeHub retain their own values and
attribution across source replacement.

Computed readings chart their own units and expressions, not an input relabelled as output.
Heat output retains signed balance across heating, cooling and defrost; the live pill also applies
current mode and useful-direction gates. Measured no flow records zero. Moving water needs a running
compressor speed or HomeHub `compressor_state` (`modbus` source), so a profile without a
compressor witness omits heat-output curves and stopped-compressor pump overrun leaves a gap. Raw
current-transformer phases and inverter current retain their own histories, while HomeHub keeps
independent 24-hour rings across its 35 buffered registers — including `modbus_power` (`51`),
`compressor_state` (`31`, including contiguous active-phase count across the 24-hour five-minute
raster), `modbus_defrost_state` (`35`), setpoints/offsets/power limits, and mode, abnormality and
binary timelines ([MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md)) — without splicing into X10A series;
`pump_state` (`30`) and `modbus_space_state` (`53`) pair onto the same state chart as X10A
`x10a_pump_state` and `x10a_space_state` when offered. Because a five-minute
bucket can combine raw rings from different sweeps, X10A electrical input (`pel`) and heating/DHW
COP (`cop`) are evaluated per sweep into dedicated firmware rings: partial CT sweeps leave a gap,
all-zero CTs fall back to witnessed inverter current (held-over at `0 rps`), and `cop` is held-over
at `0 rps` while leaving a gap during defrost, non-heating tasks, `≤ 5 rps`, `≤ 0.5 L/min`,
`≤ 0.2 kW`, non-positive ΔT or unmatched heater boundaries. When X10A `pel` is offered, HomeHub
`modbus_power` (`51`) pairs onto the same electrical-input chart as an independent toggleable
Modbus series; cooling EER omits COP history. In browser-derived curves, missing inputs leave a
gap, marked held-over in internal X10A slot metadata only when every missing input was held. A successful empty series shows “No readings recorded yet.” An unavailable series reports
an error, with its source named if the other series can still draw. Chart titles name the stable
concept.

Categorical histories share one compact plot with distinct state colours, hatching only for missing
samples, X10A active when available and paired Modbus active by default and toggleable in the legend; the bubble states
the phase range and state while the selected instant appears on the lower time scale. Valve, Quiet,
Thermostat, Pump, Space/DHW-operation, enable/reheat and multi-state operation-mode (`ou_op_mode`,
`iu_op_mode`, `modbus_current_op_mode`, `modbus_op_mode`) timelines use latest sampled state, hiding
unused optional enum levels; BSH, BUH stages, Defrost, Hot-start, DHW powerful/booster and
Disinfection retain any observed activation in their open five-minute bucket, and HomeHub
`modbus_abnormality_state` (`21`) folds by severity (Fault > Warning > Normal). Smart Grid retains all
four states. Disinfection and X10A Tank preheat remain different facts. Totals are sampled raster
time; events between sweeps may be missed.
The tank-temperature chart distinguishes the Smart Grid “Recommended on” request from observed
booster-heater operation. Phase bands, sampled-duration legend swatches, and readouts appear only
for active intervals, identify X10A and Modbus separately, and follow visible source selection when
paired.

Rings use five-minute slots on an elapsed or rolling-day axis showing the domain bounds without gap or
idle counters. A newly resolved row or changed source
identity leaves earlier gaps. Flash restoration waits for a synchronized clock and can be partial.
Compatible RAM histories can survive a warm restart before clock sync. Independent recorders book
their warm-reset gaps separately. Open buckets and incompatible records can be lost, including the
recent unsaved tail. Current uptime describes this boot.

Browser storage is not measured history. Source/reboot epochs retire cached rings, index pins,
mounted plots and in-flight history requests, including A → B → A between polls.
Replies carry sample epoch and boot identity. Visible charts refresh while live polling continues.
Closing a chart ends its active gesture.
A failed refresh keeps compatible readings within the most recent day. A distinct marker identifies
each retained series' last received sample. Categorical timelines keep their separate live cap.
ENV III charts show the accessory's measured temperature, humidity and pressure.

Hover previews a sample. Tap pins it, and another tap on the same sample or Escape clears it.
A boot-relative pin can appear in both views of a row when both show the selected instrument.
A peer's reading cannot keep a pinned measurement visible after its original source rolls out.
A pin tracks the original boot-relative bucket when available, including before clock sync.
Live-state pins require the same visible instruments and current states. Refreshing completed
history alone leaves a live-state pin in place.
The two views freeze while either is scrubbed. A recorded pin without a boot-relative bucket
expires when the plotted series or its alignment changes.
Closing the inspector preserves a pin for an open
value row. Collapsing the value panel clears it. Bubbles float directly above the plot without
reserving vertical space when idle — overlaying header/legend content above — with one measurement
per line, omitting series without a sample at the selected instant and hiding the bubble when no
visible series was measured there. The moving bubble paints opaque over the frosted near-opaque
pinned bubble when they overlap. Both selected times share the single time axis directly below every
plot, gliding over domain bounds with a surface-matched backdrop so uncovered bounds stay visible
and moving over the pinned time. Comparisons do not add height or move the plot or pinned time.
Phase intervals remain in categorical readouts.
Source legends toggle numeric or paired-state series by source and retain at least one visible series. Choices
survive polling within the page and apply to both views of the same chart.
Pointer-loss and a watchdog always release suspended rendering.

**Model, diagnoses and values**

The Model card names only what current detection supports and is hidden while X10A is offline.
Outdoor and indoor capacity are distinct, explicitly labelled quantities.
Model fields are populated only when the candidate set establishes them, otherwise null. When one
family remains without an established model/marketing name, the heading names that family.
Ambiguous families and outdoor-unit ID explain an unresolved name without claiming detection failed
or inventing an EEPROM-to-model mapping. Candidate choice can change decoded rows; ambiguity does
not establish identical readings. Translated Model rows have stable explanation keys.

The optional 24-hour Plant diagnostics rows appear only after Firmware opt-in and while the active
source (`X10A` or `Modbus`) is live or has retained/confirmed window state. Firmware supplies verdict, evidence class, coverage and limits; the browser adds no thresholds.
Rows cover fault, tank loss, starts, defrost, heater runtime and retry changes. The observation-only
flow result appears in the **Flow rate** inspector. The [water pressure finding](DIAGNOSTICS.md#water-pressure)
follows any second-source pressure reading in its inspector. With the X10A assessment available and
its trend visible, selecting a chart position opens the explanation below the time axis.
A red triangle after the pressure label marks a confirmed critical
finding. The amber signal for an unconfirmed critical reading follows the settings button's upper-right
placement.

Collapsed rows show the primary
measured value when available, or a status such as checking, no window, measured, tentative or N/A.
The collapsed `fault` row retains an accessible label and stays quiet when no active or retained
fault exists. It otherwise shows `<code> · <duration>` or `<code> · Unknown` when stale, with status
text if no code is available.
Expanders usually show the reading and its time, an interpretation, and expected conditions or
assessment limits. The fault expander shows a hero summary of the latest episode, a second-resolution
24-hour categorical pill bar (`min-width: 3px`, fault-free grey, unmeasured hatch, distinct colors
per fault code), filter chips and bar tap (`±20 px`) revealing a newest-first episode table on
demand, and one description paragraph below without a generic Normal target. The compressor-start expander gives the observed start count and completed runs
by purpose, one short assessment of average heating-run duration, and the 24-hour chart (showing
faint dotted horizontal gridlines with a left integer Y-axis column on the cumulative timeline when
starts are observed). Keep the observed start count available when classification inputs are
unsupported. Distinguish unsupported inputs from temporarily insufficient readings. Label elapsed
time as the observation window and reserve event timestamps for recorded events.

The tank-cooling expander shows **Largest hourly drop at the tank sensor** in °C per hour when the
aggregate has a rate. It shows the time and recorded circumstances of the most recent exact hour
with that rate when available. Open **24-hour history** to see the chart. Position each bar by its
endpoints, keep zero-rate bars visible and hatch the gaps between completed timed records.
Fixed-size markers occupy separate pump and draw-like lanes. Selecting a bar shows the interval,
rate, readable time and circumstances. **Data details** and **Calculation example** start
collapsed when present.
Preserve selection and disclosure state during same-scope polling. Select the newest retained
window if the selected one expires. Clear the chart when an accepted diagnosis response changes
scope or has no valid timeline.
Show the unavailable state for missing detail and the historical notice for stale tank-cooling
inputs. See the [API contract](API.md#dhw-cooling-timeline) for retention and scope and
[tank-cooling guidance](DIAGNOSTICS.md#domestic-hot-water-tank-cooling) for interpretation.

Observation-only/experimental results cannot become OK or manufacture a health certificate.
`available`, `assessable` and `evaluated` count different facts; only completed bounded judgments
belong in the evaluated headline.

Evidence clocks are per signal. The elapsed horizon can include gaps in readable coverage.
See [plant persistence](PLANT.md#reboot-and-persistence) for restore admission and status.
Initial opt-in starts fresh; pausing (`Off`) preserves collected 24-hour histories while stopping new recording. X10A re-detection/profile/pin changes reset only X10A; HomeHub host/port/unit changes reset only Modbus.
A pending identity reset hides
old evidence and discards an in-flight sample. Missing capabilities stay unknown/unavailable.
Pressure distinguishes an immediate low sample from sustained confirmation. BSH and BUH have
separate clocks, and sub-minute activity remains visible. Source limitations and
all rule details are maintained in [DIAGNOSTICS.md](DIAGNOSTICS.md) and its evidence reference.

A separate neutral **Refrigerant (heating)** row uses passive fresh-sweep observation.
Its collection needs no 24-hour opt-in and contributes no badge/count/verdict. The whole diagnosis
card is hidden when Plant diagnostics is off, and this X10A row is hidden when `Modbus` is the
active display source. When `X10A` is displayed with opt-in, the row uses the current HTTP status
after signal coverage is evaluated this boot. A failed status fetch or an OTA snapshot hides it.
A current status can report waiting or interrupted with limits, including loss of X10A. Older
firmware omits the row. Copy says ordinary polling cannot command full load, prove
settling/charge, establish a universal range or confirm mechanical EEV motion. EEV pulses describe
a command, not measured valve position.

A separate neutral **Performance factor** (`Arbeitszahl` in German) observation row presents rolling
24-hour heating/DHW energy and optional break-even gas comparison when `working_figure` is
emitted (Plant diagnostics on, active display source either `X10A` with valid boot profile
fingerprint or a configured `Modbus` target; omitted on older firmware). Like
**Refrigerant (heating)**, it contributes no badge count or `/status.health` verdict. Collapsed rows
leave the value blank while `Collecting` (retaining `Performance factor: Collecting` in `aria-label`
for screen readers), show dimmed `Standby` or `Not supported` (including native Altherma 4 or
unconfirmed `Probing`/`Fallback` Modbus sweeps) without a figure, or show the computed working
figure (`~` prefix for estimates, with `prov.`/`lim.` tags, `ok`/`warn` tones, and a words-only
`aria-label`). Expanded panels
are grouped into three concise zones without repeating the active card bus or collecting time:
1. Primary KPI tiles (`Performance factor`, `Heat pump`, `Gas · 88%`, `Delta`, the horizontal
   `±20%` Break-Even scale bar, and `0`/`2`-decimal currency formatting
   when tariffs are configured; or deduplicated `Performance factor` + `24 h heat` with `Set
   tariffs` when unconfigured; or a single status line with a 2-hour progress bar during `Collecting`).
2. Conditional warning banners (`stale` source, `limited`/`unpaired` BUH, excluded `BSH`, `CT 0 A`
   unwired) followed by structured `.wf-facts` key/value pairs showing only applicable items (`Period`
   when a metric is present, X10A `Power` sensor omitted on `Modbus` because the card title already
   names Modbus, `Outdoor` avg/min when available, and non-zero `Defrost`, `Backup heater`
   `included` when safe, and excluded `Cooling`).
3. One short basis footer (`24 h heating & hot water · pure water · estimate.`, adding `gas 88%
   condensing boiler, no fixed fees` when tariffs are configured) and `Edit tariffs`.

Value groups show the exact supported profile rows, units and qualified values. Binary metadata
renders flags as ON/OFF, known selector bits as Space heating/DHW and Smart Grid as its four-state
name; ordinary numeric 0/1 stays numeric. HomeHub enums use manufacturer meanings and visible unknown
fallbacks. Error rows show only the reported code and short meaning. Display-only shortening removes
trailing value legends; exact catalog identity remains unchanged. Duplicate X10A labels are qualified
by register group, including separate expander state.

Recognized rows use one shared button/chevron/expander builder. State-age prose preserves the device's
three claims: elapsed time, witnessed transition and unobserved time. An unwitnessed age uses `≥`
and floors duration; missing/blanked readings have no age rather than 0 seconds. Open state survives
polls. Ordinary descriptions use first-match label patterns; native Altherma 4 first uses
profile/offset-qualified `descFor(label, row)` with its flow/pump/pressure limits. Native stand-ins
retain that help under X10A rows. Timed pointer-hold and scrub guards prevent rebuilds from losing a click or gesture and cannot
leave the UI frozen indefinitely.

### 5.4 Firmware / OTA  (tap the version — either place it is printed)

The dashboard version and Settings Version row run the same check on the current screen. Inline
progress follows that version; terminal failure is a persistent wrappable alert below the active
header, dismissible only by its named close button. Repaint/navigation does not discard it.
Settings can refresh the firmware and board cards and repaint the version's progress indicator.
Its persistent live region announces a change in progress text independently of those cards.

| Phase | UI obligation |
|---|---|
| Check accepted | Follow the returned generation through the initial busy lead; do not mistake the previous idle result for completion |
| Valid offer | Fetch optional generation-bound notes; show current/available version, channel and literal change list |
| Confirmation | Explain signed installation, reboot and rollback; Cancel/backdrop/Escape sends no install request |
| Install accepted | Bind generation/channel/version/application SHA and follow the immediate successor operation |
| Download | Show real percentage by the version and announce changed progress politely |
| Busy/replaced offer | State retryable busy/check-again; preserve a complete terminal reason |
| Completion | Wait boundedly for reboot and reload the page to obtain the new HTML/CSS/JavaScript |

A check failure is never Up to date. Only a valid parsed selected manifest can establish that result.
Missing notes use localized fallback and do not invalidate a valid signed offer. Notes are inserted
as text, with no HTML/Markdown interpretation. Late check completion cannot replace a configuration
modal or its draft. Route changes cancel a transient decision; focus returns to the version control.
There are no native alert/confirm dialogs.

Release comes from release dispatch; Development comes from firmware-relevant main publication.
The saved channel controls the next check, not the provenance of the running image. Changing it saves live and checks immediately without navigation. A backward switch explicitly
states that the installed version will be older; the one-operation downgrade permission relaxes
ordering only, not signature/artifact checks.

Reload detection accepts version change, decreasing uptime or observed down/up. Same-version install
and rollback still require the new page. After the bounded wait, an answering device reloads; if it
never answers, preserve the installed/reload instruction rather than replace it with a browser error.
Sequence guards prevent old result timers from clearing a newer operation.

On page load or a busy full-status response, compact OTA status can adopt an in-flight download
even if large status/values requests are refused. A same-tab, at-most-15-minute snapshot is usable only when its version matches current
OTA status. Label it Last received state and lock Settings writes. A later full pair supersedes it.
Without a valid cache, show only current OTA/Firmware facts. Successful compact OTA status proves
reachability and must not be overwritten by a generic unreachable message. Clear snapshots on idle
startup/check completion or terminal failure. Idle after an observed download retains the snapshot
and write lock during the bounded reboot wait; snapshots never become plant history.

### 5.5 Installer landing page (`docs/index.html`, GitHub Pages)

The installer uses the shared brand and card language in an English-only shell: one card with the
mark, product name and offered version with its channel, then the device and firmware button groups,
which wrap when the card is narrow and each take a full row below 520 px, without viewport overflow.
The serial log hangs below the card as a dark tongue; an After flashing card follows. The tongue
slides out once a port is chosen and back in on Disconnect or unplug; a warning or error slides it
out without a connection, so none is hidden. A closed tongue is inert.

Connect invokes the native port chooser, then probes the chip, requires at least 8 MB of flash and
reads, without writing, the installed partition table, both `otadata` sectors and the boot app header.
Disconnect takes Connect's place and, where the browser can, also forgets the port's permission;
unplugging only disconnects.
With exactly one port already granted, the page connects to it on load and on replug.

Flash keeps NVS, coredump and history; Clean flash erases all flash first. Flash is offered only when
the installed app is this project and its NVS partition has the offered label, offset and size, which
includes the former 4 MB layout. Otherwise Flash is hidden and refused, and Clean flash takes the
primary look. An unreadable device keeps both, because an unneeded erase loses configuration while an
in-place update can still be followed by Clean flash; once the table is read, NVS elsewhere still
rules out Flash even if the app header cannot be read. Progress fills the pressed button.

Everything the page reports goes to the log as time-stamped lines between the device's own output:
the probe, the installed firmware, refusals, failures and the 115200-baud boot after Connect, Reset
and an install. The log has a fixed, window-dependent height, shows no horizontal scrollbar and
follows new lines only while scrolled to its end. Version and flashed parts come from the same verified manifest; failure cannot
enable a stale version. Release versus Development comes from the page path. `?trace` adds the
esptool-js packet trace. The After flashing steps separate first/erased setup from ordinary updates
and preserve breaker-off wiring instructions. See [SETUP.md](SETUP.md) for the owner task sequence.

### 5.6 Settings — the screen behind the gear

Settings is a flat single-column stack: Connections, ESP32, Protocol, Firmware and, while enabled,
Plant diagnostics. Gear/back/Escape follow the hierarchy in §4.

| Card | Rows and behavior |
|---|---|
| Connections | WiFi, MQTT, Syslog, NTP and HomeHub; endpoint/name is the primary value, pencil opens editor |
| ESP32 | Hardware editor, Uptime, Free memory and Largest free block; the two memory rows have recorded trends |
| Protocol | X10A link, detected protocol, RX/TX and connection-gated Protocol diagnostics |
| Firmware | Version/update check, channel, Language and default-off Plant diagnostics selector |
| Plant diagnostics | Split rows and modals for **DHW circulation pump** (`Test`/`Save`/`Delete`) and **Gas comparison** (`Save`/`Clear`) under the master opt-in |

Connections use green for connected, amber for transient attention and red for failure. Disabled
optional links are neutral. Each colour-only face has an accessible state in words. A configured
MQTT broker or HomeHub keeps its endpoint during failure, with localized subtle cause underneath;
unknown future causes remain escaped visible API text. MQTT may receive inputs while X10A is
unavailable; that connection does not prove ordinary publication. Syslog ping is advisory, NTP
becomes synced after an actual reply, and HomeHub has its independent state.

The Hardware modal records board identity independently of pins. Choosing a preset fills recommended
peripherals; disabling LED/reset does not change the preset. ENV III is editable only for a pending
M5Stack selection and hidden/disabled for Custom/Seeed. Safe distinct SDA/SCL options reflect exposed
pins. Enabling the sensor requires a live SHT30/QMP6988 probe. Keeping an active pin pair requires
a fresh connected sample. The board and sensor settings save together. A preflight refusal preserves
the draft. On Save, if the current status shows a different boot or
configuration, the browser closes the editor and asks the owner to reopen it. A device refusal with
`board_draft_stale` gives the same instruction. Pin and ENV III conflicts preserve the draft and
explain the required correction. The Hardware explanation lists saved configuration, complete
indicator phases with static colour points and available ENV III live/history readings. Uptime uses
at most two coarse units; per-task stack headroom remains diagnostic API evidence, not an invented
chart.

Protocol diagnostics is available only while X10A connects, starts closed on each page load and sends
no automatic query. Lazy Register options contain exact selected-profile labels or explicitly labelled
generic examples. Selecting a row fills page/offset/width/converter; editing a tuple field restores
Manual input. Converter starts with automatic evaluation followed by implemented width-compatible
IDs and concise meaning. Query disables for the complete round trip; show status, full/partial frame,
valid payload, selected bytes and grouped converter results. There is no duplicate JSON preview.

Firmware opt-in applies live (`Off` / `X10A` / `Modbus`). First opt-in starts a fresh generation;
switching to `Off` pauses the checkup and circulation collection. Existing X10A, Modbus and
circulation histories continue aging out. Switching between `X10A` and `Modbus` selects which
24-hour checkup store the dashboard card
displays while both keep recording. Normal X10A/HomeHub bridging and passive refrigerant observation
keep their separate lifecycle.

Under **Plant diagnostics**, split Settings rows (`DHW circulation pump` and `Gas comparison`) open
dedicated modals. **Gas comparison** opens **Gas tariffs** to configure electricity/gas unit prices
and a curated 12-currency dropdown (`EUR`, `CHF`, `GBP`, `USD`, `PLN`, `CZK`, `SEK`, `NOK`, `DKK`,
`UAH`, `JPY`, `CNY`) with **Save** and **Clear** actions that recalculate existing 24 h buckets
immediately without clearing energy history. When unconfigured, `defaultTariffCurrency()` pre-selects
a currency from the browser locale/region (`navigator.language`) when UI language is `auto`, and from
the manual UI language (`ui.lang` when not `auto`) while still honoring matching regional pairs
(`de`/`fr`/`it` + `CH`/`LI` → `CHF`, `en` + `GB`/`UK` → `GBP`, `en` + `US` → `USD`). No efficiency
input is exposed; the UI explains the fixed `88%` ($H_s$) modern condensing gas boiler baseline
alongside pure water (`4.186 kJ/(L·K)`), Heating + DHW, excluding cooling and fixed utility fees.

Report a bug is a quiet footer action opening the device's two-step report modal. It is not a board
fact or an automatic submission. Product/version text remains plain. The gear's red attention dot
counts failed configured connections, including independent X10A/HomeHub/ENV III failures; disabled
links and transient first collection do not count. Its accessible name states the count. Rebuilds
must preserve focus in every select and any active pointer/scrub/OTA operation.

## 6. Dashboard value grouping & order

Below the schematic, card names select one detail card: Diagnostics first, then Model and the value
groups below, followed by Modbus when available. Diagnostics is selected initially when enabled;
when disabled, its name and card are absent and Model is the default. If the selected card is absent,
select the first available card. Selection stays local to the open page and survives
polling, language changes and Settings visits. At widths of at least 650 px, a 202 px sidebar shows
each name with its icon. The selected name uses cyan text on the
detail card's surface, with a rounded outline opening into the card: to the right on desktop and
downward on mobile. Both joins curve into the card with its 17 px corner radius. On smaller screens,
names stay in one horizontally scrollable row above the panel without icons. Swipe the row to reveal another name,
then tap it to select its card. The short Outdoor unit name opens the complete
Refrigerant/outdoor card. Only available cards appear in the selection.

Read groups in this order: Operation, Domestic hot water, Water circuit, Refrigerant/outdoor,
Protection, Electrical, then remaining Device/general values. Setpoints belong beside their measured
quantity. Units/type come from converter metadata; nameplate capacity is not an electrical reading.
No group duplicates the dedicated connection/firmware cards.

Match precedence is a separate rule: specific Protection drop/retry labels win before broad current/
discharge keywords. Active drop flags add the written Limiting now state and warning colour;
cumulative retry counters do not. Normal freeze-protection ON is not a limiting flag. Empty groups
are hidden; missing readings in supported groups remain `—`. Exact matching/order is maintained in
[dashboard.js](../main/www/js/dashboard.js).

## 7. Components

Use shared components rather than near-identical render paths:

- Primary brand, secondary bordered and quiet text buttons; inline field errors and disabled
  in-flight actions.
- Full-width label/value rows with tabular readings. Expanders are real buttons with chevron and
  `aria-expanded`; their inset tint panel emerges beneath the divider with bottom-only corners,
  top shadow and synchronized 220 ms height/slide motion.
- The schematic inspector uses that same attached tongue treatment. Collapsed panels are inert.
- Toasts carry ordinary save outcomes. OTA progress is inline, terminal OTA errors persistent
  alerts, and crash deletion uses the in-banner danger action.
- Pill-to-pipe leader ties end before the pipe centre and inherit selection tint. Contained readings
  use the owning component's outline. Semantic state and source identity remain separate channels.

## 8. States & feedback

| Result | Feedback and retained state |
|---|---|
| Accepted rebooting save | Reboot/reconnect feedback, then return to the same Settings context |
| Accepted live save | Applied result; stay on view and refresh relevant facts |
| No change | Close with No changes; no phantom reboot |
| Input validation refusal | Inline reason where attributable; modal/draft remain |
| Board draft stale (409) | Close the editor, refresh board status and ask the owner to reopen |
| Persistence failure 500 | Explicit unsaved error; preserve draft, never claim reboot |
| Busy 503 | Retryable device-busy wording; blame no field |
| Transport failure | Unreachable/retrying; distinguish it from an answered refusal |

Read status and error body before any saved/rebooting feedback. Firmware validation remains the
trust boundary even when client validation passed. Reconnection does not prove the rejected save
succeeded. Long-running failure reasons wrap and remain available until acknowledged.

## 9. Responsive & accessibility

The schematic and Settings cards remain a centred single column; dashboard details use §6's
selectable panel. The page never scrolls horizontally; the mobile card selector and wide schematic/table
content scroll within their own containers. Keep value plus unit together. Stack ordinary rows
when label and value no longer fit. Plant diagnosis headers keep the label and compact value
on one line and put the full observation in the disclosure. Inspector headings wrap by content
and value labels keep their defined share. Split Settings actions own their padding and cannot
overlap when stacked. Measure every shipped locale at 320 px.

The rolling cycling disclosure omits the separate `Normal:` footer and can append a `< 5 min` count
to completed heating runs when timed short runs are present. Its timeline uses a step for each directly
observed start and one row of hourly blocks showing start counts and observed modes. Both the timed
chart and hourly fallback use `.34`-opacity full-plot-height vertical fills stacked bottom-to-top
proportionally across active and unassigned/gap duration in the hour, with counts below. The timed chart keeps
its opaque step line in front. Heating is orange, DHW blue. Unassigned runtime and missing readings
share one gray Unknown category. Readable off-time contributes no color, so a fully observed
off-only hour has no fill. The timed chart orders mixed categories chronologically using bottom-to-top linear stops (`linear-gradient(to top, ...)`), while the hourly fallback lacks intra-hour timestamps and stacks heating, DHW, then unknown proportionally in canonical order (omitting missing/unknown time on restored or legacy slots whose elapsed duration is unavailable unless observed time is zero). Gaps still break the step line. Each
timed hour button's accessible name distinguishes missing readings from unassigned runtime.
Each block is selectable through the full plot height. The caption sits above the selection
highlight. Shift-clicking or dragging across any timed chart selects a contiguous multi-hour range.
On timed charts with at least one run matched to `run_contexts`, the latest contiguous episode of
short heating runs (or the latest hour with matched details when no episode exists) auto-selects
on open unless overridden. Selection replaces time labels with the selected span and renders a flat period summary plus a quiet 3-column
table (`Start`, `Duration`, `Why it stopped`) with borderless tap-to-expand start and stop telemetry
prose keyed by poll-invariant boot-relative or wall-clock run start so live polls keep open rows
expanded. Saved details are shown for earlier runs with matching observed start and stop edges.
A stopped run without details shows **No cause details**. Interrupted runs show **Stop unknown**.
Selections with matched and unmatched runs keep the period summary and mark individual missing
details in the stop column. A chart with no match uses `Start`, `Stop`, `Duration` and can note
missing details for older X10A runs. Run grouping and short-run counts bridge brief `<= 15 s`
intra-boot sampling gaps while keeping `> 15 s` gaps and reboot boundaries severed. During a timed-chart drag, the highlight and range follow the pointer and
commit the dragged range on release (hourly fallback previews the hovered hour readout on drag while preserving
the pinned hour on release).
If a readable diagnosis snapshot omits the trace, retain the chart while the diagnosis
source, boot ID, `history.epoch` and `cycling.hours_epoch` all match. Mark the time after the
last sample as missing until a new trace arrives. An unreadable snapshot shows **No data**.
A status transport failure can leave the graph visible from the last update. Mark an open run's
stop and duration unknown while its live evidence is stale. See the
[status contract](API.md#history-and-24-hour-checks).
Below each rolling block, show the number of retained timed starts (amber `.warn` on hours with
at least two timed short heating runs `< 10 min`). Leave it blank if there is
missing trace time and no timed start. Use the lower-bound prefix
for positive totals and accessible readouts. Update the chart in its own slot and defer it while
its card is hidden.

When neither a fresh nor a usable cached trace exists, use the available hourly totals for the
entire chart. Show **No history yet** if those totals are absent too. Leave leading padding and
expired slots empty. A just-opened hour
with zero elapsed time has no fill. Restored and legacy slots keep unknown elapsed duration in
their readouts. Label restored timestamps as saved time. The default readout uses one hourly
snapshot and omits runtime without readable compressor seconds.

Use logical keyboard order, visible focus, Enter/Space activation, Escape at the innermost layer,
modal focus return and scroll lock. Background controls are unavailable while a dialog is open.
Status is also stated in text or accessible name, including connection rows, permanent state pills
and gear attention. SVG targets have stable translated titles. Respect reduced motion for both
animations and transitions; active states remain legible. Browser tests check native accessibility
and rendering, and human review completes interaction/visual truth.

## 10. Firmware support required

[API.md](API.md) defines the authoritative input/output contract. UI-sensitive boundaries include
independent X10A/HomeHub configuration requests, automatic model/protocol detection, exact active
register feed, explicit persistence errors, generation-bound OTA offers and qualified source values.
Runtime uptime serves both the visible row and reboot detection. The UI presents API-provided
capability/evidence state rather than inventing it from labels or missing fields.

## 11. Build / delivery

The [firmware asset pipeline](ARCHITECTURE.md#http-and-browser-transport) embeds the page, including
the packed classic script from [app.sources](../main/www/app.sources). Provisioning and non-English
locales are separate embedded assets. The device UI loads all assets locally. Hash navigation
stays client-side.
See the [JavaScript ownership map](../main/www/js/README.md) and [test reference](../test/README.md)
for build-input and verification contracts.
