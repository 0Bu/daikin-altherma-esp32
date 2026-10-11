# Documentation

Choose the guide for the task you want to complete. **daikin-altherma-esp32 observes the heat pump;
it does not control it.** X10A, HomeHub and ENV III remain separate sources. A missing measurement
is not zero, and a quiet diagnostics card does not certify that an installation is fault-free.

## Install and use

Start with [Setup](SETUP.md). It takes you from board selection and wiring through installation,
WiFi, pin selection and the first working readings.

| Task | Guide |
|---|---|
| Choose hardware or fit an accessory | [Boards and capabilities](BOARDS.md) |
| Connect the X10A service port safely | [Wiring](WIRING.md) |
| See readings in Home Assistant | [Home Assistant](HOME_ASSISTANT.md) |
| Calculate heat output, energy or COP | [Recipes](RECIPES.md) |
| Enable optional observations | [Plant features](PLANT.md) |
| Understand a plant-diagnostics result | [Diagnostics](DIAGNOSTICS.md) |
| Report wrong values, connection problems or a restart | [Reporting](REPORTING.md) |
| Connect a read-only MCP client | [MCP](MCP.md) |

The dashboard's own row explanations describe the current reading. The guides explain prerequisites,
interpretation and the limits that matter beyond that moment. User documentation is in English;
the UI supports localized navigation and explanations while heat-pump catalog labels remain English.

## Develop and maintain

[Contributing](../CONTRIBUTING.md) gives the local development and review sequence. Use the
[test guide](../test/README.md) to select the checks for a change and understand what they prove.
[Maintenance](MAINTENANCE.md) covers signed builds, device updates and publication; installation,
CI success and physical heat-pump acceptance are separate evidence.

| Subject | Reference |
|---|---|
| Data flow, responsibilities and persistence | [Architecture](ARCHITECTURE.md) |
| Implemented platform capabilities | [Features](FEATURES.md) |
| ESP-IDF components and evaluated alternatives | [ESP-IDF matrix](ESP_IDF_MATRIX.md) |
| Dashboard layout, interaction and visual states | [UI design](DESIGN.md) |
| Agent policy, review records and migration | [Agent tooling](AGENT_MIGRATION.md) |

## Look up a contract

| Contract | Reference |
|---|---|
| HTTP routes, request fields, responses and errors | [HTTP API](API.md) |
| MQTT topics, discovery, identity and freshness | [MQTT](MQTT.md) |
| X10A framing and automatic detection | [X10A protocol](X10A_PROTOCOL.md) |
| Register map, converters and model evidence | [Registers](REGISTERS.md) |
| Independent read-only HomeHub source | [Modbus protocol](MODBUS_PROTOCOL.md) |
| Diagnosis sources, exact rules and claim boundaries | [Diagnostic evidence](DIAGNOSTIC_EVIDENCE.md) |
| Trust boundaries, signing and report redaction | [Security](SECURITY.md) |

Each contract has one primary reference. Link to that page when documenting a feature rather than
copying its complete field list or safety procedure.
