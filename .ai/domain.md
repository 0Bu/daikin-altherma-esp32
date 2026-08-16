# Domain Knowledge & Business Logic

This document details the Daikin Altherma heat pump domain concepts, communication protocols, register semantics, physical correctness invariants, and telemetry boundaries.

---

## 1. Daikin Altherma Heat Pump & X10A Protocol

### X10A Service Port Communication
- **UART Parameters:** 9600 baud, 8 data bits, Even parity, 1 stop bit (`9600 8E1`).
- **Communication Topology:** Half-duplex polling over dedicated hardware UART pins.
- **Register Pages:** The heat pump exposes telemetry through discrete memory pages:
  - `0x10`: Primary operational sensors and setpoints (temperatures, flow rates).
  - `0x20`: Secondary electrical and inverter measurements (power, frequency, currents).
  - `0x30`: Actuation states and component operating statuses (pumps, 3-way valves, compressor state).
  - `0x60`: Configuration parameters, timers, and historical runtime meters.
- **Protection Words:** Page `0x10` contains protection words mapped in `main/def/overlay.hpp`.

### Auto-Detection & Fingerprinting
- **Dynamic Detection:** The heat pump model, firmware revision, and supported register map are auto-detected at boot through active probing (`hp_detect.cpp`).
- **RAM-Only Detection State:** Detected model identity (`profile`) is never persisted to NVS; only the physical UART link pins and protocol flavor are cached. This ensures swapping a board to another heat pump automatically re-identifies the new unit.
- **Candidate Matching:** Detection compares probed register responses against fingerprint signatures in `main/def/signatures.hpp`.

---

## 2. Physical Domain Correctness vs. Software Test Correctness

A central engineering principle of this project is:
> **"Passing the tests is not the same as being RIGHT."**

Software unit tests verify that code decodes bytes according to the specification handed to it; tests cannot know whether the decoded number represents physical reality on a refrigeration cycle or heating circuit.

### Physical Correctness Invariants
- **Refrigerant vs. Water Pressure (0-bar rule):**
  - Atmospheric pressure in a drained domestic hot water or space heating loop can legitimately read `0.0 bar`.
  - In a sealed refrigerant circuit, a reading of `0.0 bar` under normal ambient conditions indicates a sensor fault, disconnected transducer, or catastrophic refrigerant loss.
  - Plausibility checking (`logic/convert.hpp`, `hp_convert.cpp`) distinguishes refrigerant vs water pressures structurally (via page and converter ID), never by matching localized UI text labels.
- **Converter IDs (`convid`):**
  - Each value in `docs/REGISTERS.md` is bound to a specific converter ID.
  - The converter ID strictly dictates signedness, bit width, endianness, scaling factor (e.g. `* 0.1` vs `* 0.01`), and physical unit (`°C`, `bar`, `l/min`, `Hz`, `kW`, `kWh`).
  - Never reuse a refrigerant-temperature converter for room/water sensors without verifying scale and offset contracts.
- **Absence & Availability Rules (`logic/availability.hpp`):**
  - Sensors can be optional or conditionally present depending on indoor/outdoor unit configuration (e.g. cooling capability, secondary heating zones, solar kits, backup heaters).
  - `PAGE_ABSENCE_RULES` codifies when a zero or out-of-range value signifies that a physical sensor is not installed (`ZeroMeansAbsent`, `ZeroAbsentAboveSaturation`, `AboveRangeIsAbsent`).

---

## 3. Daikin HomeHub (EKRHH) Modbus TCP Integration

- **Secondary Read-Only Source:** The optional Modbus TCP connection to a Daikin HomeHub (EKRHH) provides supplementary plant telemetry.
- **Strictly Read-Only Invariant:** No write frames or register modification logic exist in the codebase (`hp_modbus.cpp`, verified by `test_heating_curve_diagnosis_contract.mjs`).
- **Plant Gate (Input Register 53):** Modbus telemetry passes through input register 53. If `known=false`, it must never be interpreted as an inactive or offline plant.

---

## 4. 24-Hour Plant Checkup & Diagnostics

The firmware runs continuous health analytics (`checkup.cpp`) to diagnose heat pump performance and efficiency issues:

- **Short-Cycling Detection:** Evaluates compressor start frequency and run durations against minimum operating runtimes. Short cycles accelerate compressor wear and degrade seasonal COP.
- **Defrost Cycle Tracking:** Measures duration and frequency of outdoor coil reverse-cycle defrosts.
- **Dwell Time Tracking (`state_dwell.cpp`):** Tracks exactly how long operating states, active errors, or valve positions have persisted in `.noinit` DRAM without drifting over restarts.
- **External Circulation Witness (`dhw_loss`):** Monitors secondary circulation pumps via external MQTT power witnesses to identify unwanted thermal siphoning or tank heat loss.
- **Heating Curve Diagnosis:** Correlates outdoor temperatures (from X10A, ENV III, or Open-Meteo) with leaving water target temperatures (LWT) and reference room temperatures.

---

## 5. History Rings & Catalog Fingerprints

- **Ring Storage in `.noinit` DRAM:** 24-hour historical telemetry is stored in uninitialized DRAM sections to survive warm restarts without wearing flash storage.
- **Trend Addressing:** Trend rings are indexed by tuple `(register, offset, unit)`, **never by localized label strings**.
- **Catalog Fingerprinting (`history_persist.hpp`):** History restoration across reboots is sealed with a catalog fingerprint. If a firmware update alters the register layout or order, stale DRAM rings are discarded to prevent assigning one sensor's historical data to another sensor.

---

## 6. Privacy, Redaction & Consent Boundaries

- **Bug Report Redaction (`logic/redact.hpp`):**
  - Diagnostics (`/status?redact=1`, `/diag?redact=1`) automatically mask SSIDs, passwords, MQTT credentials, broker IPs, and serial numbers with `<redacted>`.
  - Empty or unset fields remain omitted to prevent manufacturing synthetic readings.
- **Weather Forecast Location Consent:**
  - Latitude and longitude coordinates stored for Open-Meteo forecast represent explicit user consent to transmit coordinates to the external API.
  - Clearing the location immediately disables the client and requests retraction of retained MQTT forecast topics.
