# X10A coverage of the active profile

As of 2026-08-16, this inventory compares the complete representative field list in
[`REGISTERS.md`](REGISTERS.md) with the actually published view of the currently selected
`altherma_ebla_edla_d_series_4_8kw_monobloc` profile, including both hand-written overlay blocks.
It applies the exact `row_publishable()` decision used by the poller, MQTT/HA and the web UI.

The result is profile-specific; it does not claim that this plant physically supports every field
listed below. In particular, `0x64` contains hybrid/boiler fields and `0x65` hydrosplit/bizone
accessory fields. Resolve a different profile and this comparison must be run again.

## Summary

- **129 fields** are decoded, cached and displayed.
- **66 additional fields** live on a page that is already queried. Their bytes are therefore read
  from the bus, but they are not decoded, stored or displayed as individual fields.
- **26 fields** live on pages that are not currently polled cyclically: `0x11` (6), `0x64` (15) and
  `0x65` (5). Page `0x64` remains in this profile solely as a `no_publish` detection signature; the
  poller intentionally skips a page whose rows are all unpublishable.
- In total, **92 fields described by the reference table are not queried and displayed as
  measurements**.

“Not displayed” and “not read” are deliberately separate: X10A always reads a complete page. An
additional row on an already active page causes no extra bus query, but it does expand the cache,
MQTT, HA and UI contracts.

## Diagnostic observability supplement

The active profile now publishes 27 additional rows from pages it already queried. They are split
by evidence strength, not by whether they are visible:

| Class | Rows | Firmware state age | Long-term use |
|---|---|---|---|
| P1 control/safety | System OFF; Main/Add. RT Heat/Cool; power-limit bits 1–4; BUH Q1L protector and output capacity; detailed error code; Startup, Restart standby, Oil Return and Pressure equalising; 4-way valve; crankcase heater; PHE heater | compact Dwell for the 17 binary rows; numeric rows have no state age | MQTT → VictoriaMetrics/Grafana |
| P2 observational | Outdoor thermostat, Demand Signal, Low noise; Hot-gas/LP-bypass/Y3S; Solar input; floor-loop shut-off | neutral raw-bit Dwell for all eight; duration does not establish polarity/meaning | MQTT → VictoriaMetrics/Grafana, neutral ON/OFF only |

No additional 24-hour history rings are allocated: the fixed ring budget is full, and these series
belong in VictoriaMetrics. `HP Forced FG` is deliberately still absent. It aliases bit 7 of the
existing one-byte CT-L3 current field at `0x63/16`; the intrinsic full-byte converter would add a
fictitious 64 A. The availability ledger now withholds CT-L3 while bit 7 is asserted. The flag and a
simultaneous current remain unavailable until raw-data or documented mask evidence exists.

## Complete list

### Page `0x00` — page read; 12 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 152 | Sensor Data Qty |
| 1 | 1 | 152 | INV compressor Qty |
| 2 | 1 | 152 | STD compressor Qty |
| 3 | 1 | 152 | Fan Data Qty |
| 4 | 1 | 152 | Expansion Valve Data Qty |
| 5 | 1 | 152 | 4 Way Valve Data Qty |
| 6 | 1 | 152 | Crank Case Heater Qty |
| 7 | 1 | 152 | Solenoid valve Qty |
| 8 | 1 | 152 | Max. connectable indoor units |
| 9 | 1 | 152 | Connected Indoor Unit Qty |
| 10 | 1 | 152 | O/U MPU ID (xx) |
| 11 | 1 | 152 | O/U MPU ID (yy) |

### Page `0x10` — page read; 1 field not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 12 | 1 | 311 | Not in use |

The seven control fields at offset 1 and the eleven protection/retry fields at offsets 10–12 are
supplied by `def/overlay.hpp` and are therefore not part of this gap.

### Page `0x11` — page not polled cyclically; 6 fields not displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 215 | O/U EEPROM (1st digit) |
| 1 | 1 | 215 | O/U EEPROM (3rd 4th digit) |
| 2 | 1 | 215 | O/U EEPROM (5th 6th digit) |
| 3 | 1 | 215 | O/U EEPROM (7th 8th digit) |
| 4 | 1 | 215 | O/U EEPROM (10th digit) |
| 5 | 1 | 214 | O/U EEPROM (11th digit) |

### Page `0x30` — page read; complete for the reference field list

The five actuator fields at offsets 11–13 are supplied by the profile-specific overlay.

### Page `0x60` — page read; 6 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 304 | Data Enable/Disable |
| 1 | 1 | 152 | Indoor Unit Address |
| 13 | 1 | 152 | Indoor Option Code |
| 15 | 1 | 215 | I/U Software ID (xx) |
| 14 | 1 | 215 | I/U Software ID (yy) |
| 16 | 1 | 152 | I/U EEPROM Ver. |

### Page `0x61` — page read; 2 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 307 | Data Enable/Disable |
| 1 | 1 | 152 | Indoor Unit Address |

### Page `0x62` — page read; 8 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 307 | Data Enable/Disable |
| 1 | 1 | 152 | Indoor Unit Address |
| 2 | 1 | 301 | Not in use |
| 8 | 1 | 307 | None |
| 8 | 1 | 306 | Not in use |
| 8 | 1 | 305 | Not in use |
| 13 | 1 | 152 | [Future] 3 way Valve Mixing 1 |
| 14 | 1 | 152 | [Future] 3 way Valve Mixing 2 |

`0x62/8`, converter `303` (**Tank preheat ON/OFF**) is already queried and displayed, so it is not
in this list. It now also has its own timeline. This field is not equated with the HomeHub's actual
disinfection operation.

### Page `0x63` — page read; 14 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 307 | Data Enable/Disable |
| 1 | 1 | 152 | Indoor Unit Address |
| 2 | 1 | 215 | I/U EEPROM (3rd digit) |
| 3 | 1 | 215 | I/U EEPROM (4th 5th digit) |
| 4 | 1 | 215 | I/U EEPROM (6th 7th digit) |
| 5 | 1 | 215 | I/U EEPROM (8th 9th digit) |
| 6 | 1 | 215 | I/U EEPROM (11th digit) |
| 7 | 1 | 215 | I/U EEPROM (12th digit)(rev.) |
| 8 | 1 | 215 | Not in use |
| 9 | 1 | 215 | Not in use |
| 10 | 1 | 215 | Not in use |
| 11 | 1 | 215 | Not in use |
| 12 | 1 | 215 | Not in use |
| 16 | 1 | 307 | HP Forced FG |

### Page `0x64` — page not polled cyclically; 15 fields not displayed

For the active non-hybrid profile, this hybrid/boiler page is entirely `no_publish` and serves only
as a detection signature.

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 307 | Data Enable/Disable |
| 1 | 1 | 152 | Indoor Unit Address |
| 2 | 1 | 316 | Hybrid Op. Mode |
| 2 | 1 | 303 | Boiler Operation Demand |
| 2 | 1 | 302 | Boiler DHW Demand |
| 2 | 1 | 301 | Bypass Valve Output |
| 3 | 2 | 105 | BE_COP |
| 5 | 2 | 105 | Hybrid Heating Target Temp. |
| 7 | 2 | 105 | Boiler Heating Target Temp. |
| 9 | 1 | 302 | Add pump |
| 9 | 1 | 301 | Main pump |
| 10 | 2 | 118 | Mixed water temp. |
| 12 | 2 | 105 | 2nd Domestic hot water temperature |
| 14 | 1 | 152 | Target delta T heating |
| 15 | 1 | 152 | Target delta T cooling |

### Page `0x65` — page not polled cyclically; 5 fields not displayed

The reference table assigns these fields to hydrosplit/bizone accessories; they are not part of the
active monobloc profile.

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 0 | 1 | 307 | Data Enable/Disable |
| 1 | 2 | 152 | Indoor Unit Address |
| 0 | 2 | 105 | Outlet water heat exchanger temp (hydro split model) DLWB2 |
| 0 | 2 | 105 | [EKMIK] Bizone kit mixed leaving water temperature R1T |
| 0 | 1 | 101 | [EKMIK] Bizone kit mix valve position M1S |

### Page `0xA0` — page read; 14 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 10 | 1 | 152 | O/U MPU ID |
| 11 | 1 | 152 | O/U MPU ID |
| 12 | 1 | 307 | HPS operation |
| 12 | 1 | 306 | Safeguard operation |
| 12 | 1 | 305 | Crank case heater |
| 12 | 1 | 304 | Solenoid Valve 3 |
| 12 | 1 | 303 | Solenoid Valve 2 |
| 12 | 1 | 302 | Solenoid Valve 1 |
| 12 | 1 | 301 | 4 way valve (Y1S) |
| 12 | 1 | 300 | 52C Output |
| 13 | 1 | 303 | Discharge Temp. Drop |
| 13 | 1 | 302 | During emergency operation |
| 13 | 1 | 301 | Indoor unit blowout 50 ° C flag |
| 13 | 1 | 300 | Powerful bit (MT setting bit) |

### Page `0xA1` — page read; 9 fields not decoded/displayed

| Off | Len | Conv | Field |
|---:|---:|---:|---|
| 4 | 1 | 302 | Liquid INJ solenoid valve (Y4S) |
| 4 | 1 | 301 | Bottom Plate Heater |
| 4 | 1 | 300 | PHE Heater |
| 9 | 1 | 305 | Monobloc setting |
| 9 | 1 | 304 | Minichiller setting |
| 9 | 1 | 303 | MT setting |
| 9 | 1 | 302 | GSHP setting |
| 9 | 1 | 301 | Hydro split setting |
| 9 | 1 | 300 | Alterma LT setting |

## Disinfection-related signals

| Source | Structure | Meaning | Timeline |
|---|---|---|---|
| HomeHub / Modbus | Input offset `33`, FC04 PDU address `32` | Actual disinfection operation `0/1` | independent event-preserving 24-hour timeline |
| X10A | Page `0x62`, offset `8`, converter `303` | **Tank preheat ON/OFF** only; not direct evidence of disinfection | independent event-preserving 24-hour timeline |

Neither the X10A catalog nor the curated HomeHub map exposes the configured disinfection weekday,
start time or temperature. These two runtime signals therefore cannot establish that disinfection
is scheduled.
