# Home Assistant

The firmware creates MQTT-discovered entities under one **Daikin Altherma** device. No YAML is
needed for ordinary X10A readings or board diagnostics. HomeHub values remain a separate MQTT
stream with no per-value Home Assistant discovery. The integration is read-only: there are no
command topics or writable heat-pump entities.

## Enabling

1. Complete [SETUP.md](SETUP.md). For heat-pump entities, also confirm valid X10A readings.
2. Enable Home Assistant's MQTT integration and connect it to your broker.
3. Open the device's **Settings → Connections → MQTT**.
4. Enter the broker and, if required, its username/password. With credentials, use an explicit
   **`mqtts://broker:8883`** URL and a certificate trusted by the firmware. Anonymous
   `broker:1883` means plaintext MQTT. A rejected broker test leaves the saved configuration unchanged.
5. Set a distinct **Base topic** for this installation, then save. Accepted changes reboot the board.
6. In Home Assistant, open the MQTT integration's device list and find **Daikin Altherma**. Check a
   readable water temperature and operating flag against the device dashboard.

Board diagnostics and independent accessories can appear as soon as the broker connects. X10A
readings require the first valid reply; a later 15-second X10A outage makes those entities
unavailable while board diagnostics continue. Recovery seeds current readings again. An OTA pause
withdraws broker availability when connected; a reconnecting client refreshes markers only on its
next connection. Check actual source freshness when retained data looks current, and follow the
[availability migration](MQTT.md#migrations) for older discovery configurations.

Empty credential fields keep stored credentials. To switch to anonymous access, select **Remove
stored credentials**. Clearing the broker disables MQTT. Disabling MQTT does not stop the X10A or
HomeHub readings visible locally.

## Device identity

Choose the base topic **before commissioning**. It identifies the installation in both MQTT and
Home Assistant. Keep it unchanged when replacing the ESP32 to retain the existing HA device,
entities and statistics. Give each installation or test board a different base. Distinct accepted
bases now produce distinct discovery identities, including punctuation differences.

The default is `daikin-altherma-esp32`; a suitable second base is
`daikin-altherma-esp32-bench`. Changing a running installation's base creates a new HA identity and
splits any metrics series whose labels contain that topic. It does not migrate history or clear the
old retained topics. See [MQTT identity and migrations](MQTT.md#identity-and-discovery) before making
that change.

Do not leave two boards publishing under one base during a replacement. They can overwrite retained
values and interleave uptime, even though each individual reading looks plausible. The MQTT client
id is board-specific, so the broker can accept both connections without exposing the identity error.

<a id="three-env-iii-entities-when-that-sensor-is-fitted"></a>
## What appears in Home Assistant

| Entity group | What it represents |
|---|---|
| X10A sensors | Publishable temperatures, flow, pressure, current, setpoints, modes and fault text from the detected profile. |
| X10A binary sensors | Numeric bit flags such as pump operation, thermostat state and valve output. |
| Fault companions | Group-specific **Error Active** and **Warning Active**, suitable for numeric alerts. |
| Diagnostics | Board memory, reset/uptime, WiFi and MQTT/X10A counters; categorized as diagnostic entities. |
| Crash report | A pending fault/dump indication and summary, never the raw memory dump. |
| ENV III, when supported and enabled | Separate temperature, humidity and pressure sensors for the accessory. |

There are **no HA value entities for HomeHub, weather forecasts or heating-curve evidence**. They
remain available to direct MQTT/metrics consumers. Installing a HomeHub does not add an HA control
path through this firmware.

Entity count varies by model, physically fitted hardware and available converters. A row used only
for detection is not polled or announced as a measurement. A profile in the catalog does not prove
that every optional sensor exists on a particular unit.

### Names, state keys and entity ids

The payload key is the label's lowercase slug inside its register group. The discovery identity also
includes that group to keep repeated labels distinct. For example, outdoor and hydronic **Error
Code** are separate entities. HA may choose or retain its own `entity_id`; inspect it in your
installation instead of constructing it from a sample name.

The globally qualified names include Outdoor State/Hydronic **Error Code**, **Error Type** and
**Thermostat ON/OFF**; Hybrid/Mixing **Mixed Water Temp.**; Outdoor Sensors/Hydronic State **Pressure
Sensor(T)**; and Outdoor State/Water Hx **Target Discharge Temp.** Which pairs exist depends on the
profile. Qualified names remain stable even when only one member exists on that model.

<a id="binary-values-are-numbers-not-onoff"></a>
### Binary values

Pump and valve flags use `binary_sensor` with MQTT numeric `1`/`0`. The device UI adds descriptive
labels where the signal's meaning is established. A two-way-valve output being OFF does not prove
Cooling; it is separate from configured/current operating mode. Read the whole label and row
explanation before using a flag as an operating-mode witness.

## Unknown, unavailable and held readings

<a id="values-the-firmware-refuses-to-publish"></a>

| What you see | Interpretation |
|---|---|
| X10A entities unavailable | Check the broker connection and X10A link; board diagnostics can remain available while X10A is offline. |
| One value unknown | Its state key may be absent because the input is unreadable, unimplemented, implausible or not fitted. |
| Outdoor readings absent while resting | The outdoor unit may answer with values held from its last run. The firmware withholds those MQTT readings; **Outdoor Data Held Over** explains that boundary. |
| Only ENV III unavailable | Its corresponding fresh reading keys are missing; an accessory fault does not make other plant entities unavailable. |
| A zero | A real decoded zero, where that row permits it. It is not a substitute for missing evidence. |

The firmware applies refusal rules per row/model. A genuine temperature crossing 0 °C remains a
measurement; an identified unpopulated register returning zero does not. Optional second-outdoor-unit
rows are withheld when the unit's descriptor and empty sensor page establish that hardware is absent.
Current discovery templates explicitly make an omitted key or group **unknown** for numeric,
binary and text entities. This can leave gaps in long-term statistics and suspends `numeric_state`
conditions until a readable value returns. See [register evidence](REGISTERS.md) for refusal rules
and [MQTT migrations](MQTT.md#migrations) for older templates that retained a previous state.

<a id="a-fields-json-type-never-changes"></a>
<a id="error_active--warning_active--a-numeric-fault-state"></a>
A field's JSON type remains stable across operating states: a stopped numeric fan publishes `0`,
not the string `OFF`. Fault classes/codes remain text; numeric **Error Active** is 1 for Error and
**Warning Active** is 1 for Warning/Caution. An unreadable class publishes neither companion,
which must not be interpreted as “no fault”.

For templates and derived sensors, use an availability check for every required input. Avoid
`float(0)` on unavailable temperatures, flow or energy: it manufactures a plausible value and can
silently corrupt a heat integral.

## Troubleshooting

| Symptom | Check |
|---|---|
| No HA device | MQTT integration/broker connection, base/prefix agreement and broker permissions. |
| No X10A entities | First valid X10A reply and detected profile; check the availability migration above if old configs remain. |
| Broker save rejected | Exact URI/port, DNS/reachability, TLS certificate chain and credentials. The error is shown before saving. |
| Duplicate device or `…_2` entities after upgrade | Read the migration note below; keep HA connected for discovery deletions. |
| Values alternate or uptime repeatedly jumps | Ensure one active board per base/node identity before concluding the board is rebooting. |
| A retained number looks old | Retained means stored by the broker. Check installation availability and the source-specific freshness rule. |
| An impossible value | Compare full labels, candidate-established model identity and an independent reference; collect a [device report](REPORTING.md). The selected register table is not proof of the exact unit model. |
| Restart indicated | Read reset reason, crash fault and **Heap Watchdog Restarts**; preserve the report before dismissing it. |

`mqtt_skipped` counts cycles interrupted by allocation failure or a flat Modbus payload exceeding
4 KiB; some earlier topics may already have published. `mqtt_quiesced` counts deliberate TLS
hold-offs, and `poll_skipped` sweeps not performed. These increasing counters distinguish interrupted
work from normal update pauses. **Heap Watchdog Restarts** is instead a measurement of consecutive
watchdog resets inherited by this boot, not a lifetime counter. Per-task stack minima are MQTT/API
fields for maintainers; null means the task has not been sampled.

WiFi MAC/BSSID diagnostic entities identify the board and access point. MQTT is operational telemetry,
not the redacted bug-report format; consider that before sharing a broker export.

<a id="two-diagnostic-entities-are-retired"></a>
## Upgrading an existing integration

Keep Home Assistant connected to the broker during discovery migrations so it sees retained-config
deletions before replacements. Preserve the base topic when upgrading or replacing a board.

- Before the first upgrade with split availability, confirm that X10A is answering so current
  discovery can replace old single-marker configurations. If it is not, pause consumers that rely
  on the old marker and migrate only the confirmed old configurations before trusting availability.
- Default and bench entity IDs remain stable. Custom bases get unambiguous entity IDs, and old
  short-MAC aliases are no longer advertised. Export relevant entity customizations and references before this
  migration; existing merged HA devices, old aliases and custom unique IDs need owner reconciliation.
- Current-namespace ungrouped and renamed discovery is deleted before replacements. Old broker,
  old-base and ambiguous MAC-era configurations need the targeted cleanup in the migration guide.
- A historical `sensor` → `binary_sensor` change requires automation/template references to use the
  new domain; its old recorder history does not carry to that domain automatically.
- Current-namespace retired HomeHub/weather discovery and the redundant **Device Time**, **WiFi Quality** and **Last
  Reset Reason** diagnostics are removed. Update any consumers of their old fields/topics.

If HA was offline during a deletion, old entries can remain and replacements can gain `…_2`.
[MQTT.md → Migrations](MQTT.md#migrations) gives the exact namespaces and safe cleanup scopes.
Do not sweep the current node's discovery tree to delete only stale entries: old and current
configs can share that node.

<a id="topics"></a>
## MQTT and derived measurements

Use [MQTT.md](MQTT.md) for exact topics, payload shapes, freshness and discovery identity. Direct
MQTT access is useful when an analysis needs HomeHub or forecast evidence that HA discovery omits.

<a id="protection-retries--drop-control-new-entities"></a>
Protection counters and flags are experimental leads, not fault verdicts. Counters are 3-bit values
from 0–7; clamp/wrap behavior is undocumented, so decreases cannot be counted as resets or retries
without independent evidence. The [diagnostics guide](DIAGNOSTICS.md#protection-limit-counter-changes)
explains the bounded check.

<a id="derived-power-energy--cop--scop--jaz"></a>
<a id="1-instantaneous-thermal-power-virtual-heat-meter"></a>
<a id="2-instantaneous-cop-live-gauge"></a>
<a id="both-sides-must-describe-the-same-system"></a>
<a id="3-integrate-to-energy--scop--jaz"></a>
<a id="accuracy--what-matters-and-what-doesnt"></a>
<a id="why-not-the-obvious-shortcuts"></a>

To calculate thermal power, COP or period efficiency, follow [RECIPES.md](RECIPES.md). It preserves
signed heat output, requires real electrical-meter inputs and explains model/measurement boundaries.
The result is an estimate from plant sensors, not a certified heat meter or seasonal rating.
