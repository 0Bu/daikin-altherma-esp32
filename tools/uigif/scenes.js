// ── Demo harness for the dashboard GIF ────────────────────────────────────────────────────────
// Injected AHEAD of the real app.js (same <script>), so the app boots against a stubbed device.
// The values are the REAL catalog labels/pages of the 4-8 kW ERGA/EHV profile
// (main/def/altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw.hpp); the numbers are a plausible
// operating point per scene, not a recording.

const DEMO = (() => {
  const R = (label, value, unit, reg) => ({ label, value: value == null ? null : String(value), unit, reg });
  // HomeHub telemetry has its own array and addresses registers by their EKRHH data-model offset.
  // The DHW scene below reports mode 2 (Recommended on), which is what evcc's boost writes; every
  // other scene reports mode 0 so the permanent pill proves both its active and inactive colours.
  // The API exposes the raw Modbus constant plus structural enum metadata. The browser alone names
  // mode 2 as Recommended on; keeping the demo in this exact shape catches a regression back to
  // human-readable text on the public wire.
  const SG = (mode) => ({ label: "Smart-Grid operation mode", value: mode, unit: "",
                           off: 56, enum: "smart_grid_mode" });
  // The independently polled HomeHub outdoor-air register can continue changing while X10A's page
  // 0x20 is held over at rest. Its structural concept lets the standby scene exercise the real
  // fallback without claiming that a successful register read proves the measurement's age.
  const MB_OUT = (value) => ({ label: "Outdoor air temperature", value: String(value), unit: "°C",
                               off: 44, concept: "outdoor_air" });
  const MB_BSH = (on) => ({ label: "Booster heater run", value: on ? 1 : 0, unit: "",
                            off: 32, binary: true, concept: "bsh_state" });
  const MB_QUIET = (on) => ({ label: "Quiet mode operation", value: on ? 1 : 0, unit: "",
                              off: 9, binary: true, concept: "quiet_state" });
  const MB_POWER = (value) => ({ label: "Heat pump power consumption", value: String(value),
                                 unit: "kW", off: 51 });
  const histRows = [
    ["leaving_water", "Leaving water temp. before BUH (R1T)"],
    ["return_water", "Inlet water temp.(R4T)"],
    ["dhw_tank", "DHW tank temp. (R5T)"],
    ["outdoor_air", "R1T-Outdoor air temp."],
    ["flow", "Flow sensor (l/min)"],
    ["room_temp", "Indoor ambient temp. (R1T)"],
    ["defrost_state", "Defrost Operation"],
    ["quiet_state", "Silent Mode"],
    ["bsh_state", "BSH"],
    ["valve_dhw", "3way valve(On:DHW_Off:Space)"],
    ["buh_step1", "BUH Step1"],
    ["buh_step2", "BUH Step2"],
    ["smart_grid_mode", "Smart Grid operation mode"],
  ].map(([id, label]) => ({ id, label }));
  const mbHistRows = [
    ["leaving_water", "Leaving water temperature"],
    ["return_water", "Return water temperature"],
    ["dhw_tank", "Domestic Hot Water temperature"],
    ["outdoor_air", "Outdoor air temperature"],
    ["flow", "Flow rate"],
    ["room_temp", "Room temperature"],
    ["quiet_state", "Quiet mode operation"],
    ["bsh_state", "Booster heater run"],
    ["valve_dhw", "3-way valve"],
    ["smart_grid_mode", "Smart Grid operation mode"],
  ].map(([id, label]) => ({ id, label }));
  const histBase = {
    leaving_water: [381, 383, 384, 386, 385, 387, 388, 386, 384, 382, 381, 380],
    return_water:  [337, 338, 339, 340, 341, 342, 341, 340, 339, 338, 337, 336],
    dhw_tank:      [461, 459, 457, 455, 454, 456, 459, 461, 460, 458, 456, 453],
    outdoor_air:   [ 52,  51,  50, null, null,  49,  50,  52,  54,  55,  56,  57],
    flow:          [208, 211, 210, 214, 212, 209, 207, 205, 203, 202, 200, 198],
    room_temp:     [214, 214, 213, 213, 212, 212, 213, 213, 214, 214, 214, 214],
    defrost_state: [0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0],
    quiet_state:   [0, 10, 10, 10, 0, 0, 0, 10, 10, 0, 0, 0],
    // Binary state in tenths. The two ON buckets are sampled active windows, not exact runtime.
    bsh_state:     [0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0],
    valve_dhw:     [0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 0, 0],
    buh_step1:     [0, 0, 10, 10, 10, 10, 0, 0, 10, 10, 0, 0],
    buh_step2:     [0, 0, 0, 0, 10, 10, 0, 0, 0, 10, 0, 0],
    // Full Smart-Grid modes in tenths, like the real /history wire. All four manufacturer modes and
    // a missing raster are present so the inspector demo exercises every categorical phase.
    smart_grid_mode: [0, 0, 10, 10, 20, 20, 30, 30, null, 0, 20, 20],
  };
  const hist = (id, source) => {
    const x = histBase[id];
    if (!x) return null;
    // Keep both instruments recognisably close but not identical. Modbus continues through the
    // deliberate X10A outdoor-air gap, which makes the dual-source contract visible in an inspector.
    const state = id === "smart_grid_mode" || id === "bsh_state" || id === "defrost_state" ||
      id === "quiet_state" || id === "valve_dhw" || id.startsWith("buh_step");
    const v = state ? x : source === "modbus"
      ? x.map((n, i) => n == null ? 53 + i : n + (i % 3 === 0 ? 1 : 0))
      : x;
    const unit = state ? "" : id === "flow" ? "l/min" : "°C";
    return { id, source, label: id, dt: 300, unit, t0: 1768720920, b0: 5895736,
             v, held: source === "x10a" && id === "outdoor_air" ? [[3, 2]] : [] };
  };
  // A BIT-FLAG row exactly as the firmware serves it since #210: the value is the NUMBER 1/0, and
  // `binary: true` is the structural marker that lets the browser render it as ON/OFF without
  // treating every numeric 0/1 as a switch (http_status.cpp, conv_is_binary). Emitting the old
  // "ON"/"OFF" text here silently produced a plausible-looking but WRONG recording: `vOn` returned
  // false for every flag, so the 3-way valve pointed at the heating circuit during a hot-water
  // charge and no water-side flow animated at all.
  const B = (label, on, reg) => ({ label, value: on ? "1" : "0", unit: "", reg, binary: true });

  // Rows that never change between scenes (identity + the always-live hydronic bits).
  const base = (o) => [
    R("I/U operation mode", o.mode, "", 0x60),
    R("Error Code", "  ", "", 0x60),
    R("Error type", "Normal", "", 0x60),
    R("Operation Mode", o.ouMode, "", 0x10),

    // Outdoor unit — pages 0x20 / 0x21 / 0x30 (frozen while the compressor rests)
    R("R1T-Outdoor air temp.", o.out, "°C", 0x20),
    R("INV frequency (rps)", o.rps, "", 0x30),
    R("Discharge pipe temp.", o.disch, "°C", 0x20),
    R("High Pressure", o.hp, "bar", 0x20),
    R("Low Pressure", o.lp, "bar", 0x20),
    R("Expansion valve 1 (pls)", o.eev, "", 0x21),
    R("INV primary current (A)", o.inv, "A", 0x21),
    R("Fan 1 (step)", o.fan, "", 0x21),

    // Hydronic side — pages 0x60 / 0x61 / 0x62 / 0x63 (always live)
    R("Leaving water temp. before BUH (R1T)", o.lwt, "°C", 0x61),
    R("Leaving water temp. after BUH (R2T)", o.lwt, "°C", 0x61),
    R("Inlet water temp.(R4T)", o.ret, "°C", 0x61),
    R("DHW tank temp. (R5T)", o.tank, "°C", 0x61),
    R("DHW setpoint", o.tankSet, "°C", 0x60),
    R("LW setpoint (main)", o.lwSet, "°C", 0x60),
    R("Indoor ambient temp. (R1T)", o.room, "°C", 0x61),
    R("RT setpoint", o.roomSet, "°C", 0x60),
    R("Flow sensor (l/min)", o.flow, "l/min", 0x62),
    R("Water pressure", o.wp, "bar", 0x62),
    R("Refrigerant pressure sensor", o.rp, "bar", 0x62),
    R("Water pump signal (0:max-100:stop)", o.pumpSig, "", 0x62),
    B("Water pump operation", o.pumpOn, 0x60),
    B("3way valve(On:DHW_Off:Space)", o.valveDhw, 0x60),
    B("Thermostat ON/OFF", o.thermo, 0x60),
    B("Space heating Operation ON/OFF", o.spaceOn, 0x62),
    B("BUH Step1", false, 0x60),
    B("BUH Step2", false, 0x60),
    // The DHW tank's immersion heater. One scene switches it on to exercise the permanent orange
    // pill; the other scenes keep the same row explicitly OFF so the light-grey state is visible.
    // COP is deliberately blocked while it runs because its separate electrical heat has no power
    // measurement that can be paired with the PHE boundaries.
    B("BSH", !!o.bshOn, 0x60),
    B("Defrost Operation", o.defrost, 0x10),
    B("Silent Mode", o.quiet, 0x60),
    R("Current measured by CT sensor of L1", o.ct, "A", 0x63),
    R("Current measured by CT sensor of L2", "0.0", "A", 0x63),
    R("Current measured by CT sensor of L3", "0.0", "A", 0x63),
  ];

  // ── Operating-state atlas ───────────────────────────────────────────────────────────────────
  // This covers every normal plantState() result plus every published hydronic mode: standby,
  // heating, defrost, circulation, DHW/BSH, both combined modes, cooling and cooling residual-heat
  // circulation. Fault/warning/link states are diagnostics rather than operating states.
  //
  // The numbers are invented, but they are READ as measurements, so they have to hold together:
  //   heat      pth = flow/60 × 4.186 × ΔT      and    pel = ΣCT × 230 V    →    COP = pth/pel
  //   high side R32 saturation must sit ABOVE the water being made — condensing runs 3-5 K over
  //             the leaving water (20 °C ≈ 14.7 bar, 40 °C ≈ 24.8, 50 °C ≈ 31.4, 55 °C ≈ 35.1;
  //             the same curve app.js cites for the at-rest ~14 bar). The first cut had 28.4 bar
  //             beside 54.8 °C water — a condensing temperature BELOW the water it was heating,
  //             which is not a rounding error but a direction of heat flow that cannot happen.
  //   low side  evaporating ~10 K under the outdoor air
  //   standby   rp 14.2 bar = the equalised circuit near room temperature, not a fault
  const scenes = [
    { name: "Standby", caption: "Bereitschaft · Standby", mbOut: "6.8", mbPower: "0.1", sgMode: 0,
      v: base({ mode: "Stop", ouMode: "Heating", out: "19.0", rps: "0", disch: "24.5", hp: "0.0",
                lp: "0.0", eev: "0", inv: "0.0", fan: "0", lwt: "28.4", ret: "28.0", tank: "48.2",
                tankSet: "50.0", lwSet: "35.0", room: "21.4", roomSet: "21.0", flow: "0.0",
                wp: "1.8", rp: "14.2", pumpSig: "100", pumpOn: false, valveDhw: false,
                thermo: false, spaceOn: false, defrost: false, quiet: true, ct: "0.1" }) },

    { name: "Heating", caption: "Heizen · Heating", mbOut: "5.4", mbPower: "1.4", sgMode: 0,
      v: base({ mode: "Heating", ouMode: "Heating", out: "5.2", rps: "45", disch: "68.1", hp: "26.2",
                lp: "6.4", eev: "280", inv: "6.1", fan: "4", lwt: "38.4", ret: "33.9", tank: "49.5",
                tankSet: "50.0", lwSet: "38.0", room: "21.4", roomSet: "21.5", flow: "21.0",
                wp: "1.8", rp: "26.2", pumpSig: "12", pumpOn: true, valveDhw: false,
                thermo: true, spaceOn: true, defrost: false, quiet: false, ct: "6.0" }) },

    { name: "Defrost", caption: "Abtauen · Defrost", mbOut: "0.8", mbPower: "2.0", sgMode: 0,
      v: base({ mode: "Heating", ouMode: "Heating", out: "0.6", rps: "70", disch: "31.0", hp: "29.4",
                lp: "7.8", eev: "410", inv: "8.8", fan: "0", lwt: "26.0", ret: "31.0", tank: "48.7",
                tankSet: "50.0", lwSet: "38.0", room: "21.2", roomSet: "21.5", flow: "22.0",
                wp: "1.8", rp: "29.4", pumpSig: "10", pumpOn: true, valveDhw: false,
                thermo: true, spaceOn: true, defrost: true, quiet: false, ct: "8.7" }) },

    { name: "Circulation", caption: "Nachlauf · Circulation", mbOut: "4.8", mbPower: "0.2", sgMode: 0,
      v: base({ mode: "Heating", ouMode: "Heating", out: "5.2", rps: "0", disch: "58.0", hp: "0.0",
                lp: "0.0", eev: "0", inv: "0.0", fan: "0", lwt: "32.1", ret: "31.9", tank: "48.5",
                tankSet: "50.0", lwSet: "38.0", room: "21.3", roomSet: "21.5", flow: "12.0",
                wp: "1.8", rp: "15.0", pumpSig: "38", pumpOn: true, valveDhw: false,
                thermo: false, spaceOn: false, defrost: false, quiet: true, ct: "0.8" }) },

    { name: "DHW + BSH", caption: "Warmwasser + Heizstab · DHW + immersion heater",
      mbOut: "8.8", mbPower: "4.2", sgMode: 2, mbBsh: true,
      v: base({ mode: "DHW", ouMode: "Heating", out: "8.5", rps: "62", disch: "78.4", hp: "36.8",
                lp: "7.1", eev: "320", inv: "7.9", fan: "6", lwt: "54.8", ret: "49.8", tank: "44.0",
                tankSet: "50.0", lwSet: "35.0", room: "21.2", roomSet: "21.0", flow: "14.0",
                wp: "1.8", rp: "36.8", pumpSig: "22", pumpOn: true, valveDhw: true,
                thermo: false, spaceOn: false, bshOn: true, defrost: false, quiet: false, ct: "8.0" }) },

    { name: "Heating + DHW", caption: "Heizen + Warmwasser · Heating + hot water",
      mbOut: "5.2", mbPower: "1.7", sgMode: 0,
      v: base({ mode: "Heating + DHW", ouMode: "Heating", out: "5.0", rps: "58", disch: "74.6",
                hp: "34.6", lp: "6.8", eev: "305", inv: "7.4", fan: "5", lwt: "51.6", ret: "46.9",
                tank: "46.8", tankSet: "50.0", lwSet: "38.0", room: "21.1", roomSet: "21.5",
                flow: "15.5", wp: "1.8", rp: "34.6", pumpSig: "18", pumpOn: true, valveDhw: true,
                thermo: true, spaceOn: true, defrost: false, quiet: false, ct: "7.4" }) },

    { name: "Cooling + DHW", caption: "Kühlen + Warmwasser · Cooling + hot water",
      mbOut: "29.6", mbPower: "1.8", sgMode: 0,
      v: base({ mode: "Cooling + DHW", ouMode: "Heating", out: "29.4", rps: "60", disch: "76.0",
                hp: "35.2", lp: "7.6", eev: "330", inv: "7.8", fan: "6", lwt: "52.0", ret: "47.2",
                tank: "45.8", tankSet: "50.0", lwSet: "18.0", room: "24.0", roomSet: "23.0",
                flow: "15.0", wp: "1.8", rp: "35.2", pumpSig: "18", pumpOn: true, valveDhw: true,
                thermo: true, spaceOn: true, defrost: false, quiet: false, ct: "7.7" }) },

    { name: "Cooling", caption: "Kühlen · Cooling", mbOut: "30.2", mbPower: "1.2", sgMode: 0,
      v: base({ mode: "Cooling", ouMode: "Cooling", out: "30.0", rps: "44", disch: "69.0", hp: "28.2",
                lp: "7.4", eev: "295", inv: "5.4", fan: "5", lwt: "12.0", ret: "16.0", tank: "48.0",
                tankSet: "50.0", lwSet: "18.0", room: "24.2", roomSet: "23.0", flow: "21.0",
                wp: "1.8", rp: "28.2", pumpSig: "14", pumpOn: true, valveDhw: false,
                thermo: false, spaceOn: true, defrost: false, quiet: false, ct: "5.3" }) },

    { name: "Cooling residual", caption: "Restwärme-Nachlauf · Cooling residual circulation",
      mbOut: "27.0", mbPower: "0.2", sgMode: 0,
      v: base({ mode: "Cooling", ouMode: "Cooling", out: "30.0", rps: "0", disch: "64.0", hp: "0.0",
                lp: "0.0", eev: "0", inv: "0.0", fan: "0", lwt: "42.0", ret: "38.0", tank: "48.0",
                tankSet: "50.0", lwSet: "18.0", room: "24.0", roomSet: "23.0", flow: "14.0",
                wp: "1.8", rp: "17.0", pumpSig: "34", pumpOn: true, valveDhw: false,
                thermo: false, spaceOn: true, defrost: false, quiet: true, ct: "0.8" }) },
  ];

  const status = (i) => ({
    version: "1.0.14", platform: "esp32s3", uptime_s: 48213 + i * 5,
    app_elf_sha256: "9f2c1ab4de77c0315b8e6a41d2f905c7",
    pins_avail: [1, 2, 4, 5, 6, 7, 8, 9, 38, 43, 44],
    board: { led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true,
             user_set: true, preset_id: "m5stack_atoms3_lite", preset_name: "M5Stack AtomS3 Lite",
             vendor: "m5stack", pins_local: [1, 2, 4, 5, 6, 7, 8, 9, 38, 39, 40, 41, 42, 43, 44],
             presets: [
               { id: "m5stack_atoms3_lite", name: "M5Stack AtomS3 Lite", vendor: "m5stack",
                 led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true },
               { id: "seeed_xiao_esp32s3", name: "Seeed XIAO ESP32-S3", vendor: "seeed",
                 led_gpio: 21, led_type: 0, led_inverted: true, btn_gpio: -1, btn_active_low: true },
             ] },
    env3: { supported: true, enabled: true, connected: true, fresh: true, error: "",
            sda: 2, scl: 1, temperature_c: 20.25, humidity_pct: 45.5, pressure_hpa: 1008.75,
            pins_avail: [1, 2, 4, 5, 6, 7, 8, 9, 38, 43, 44],
            presets: [{ name: "M5Stack AtomS3 Lite · Grove", sda: 2, scl: 1 }] },
    wifi: { ssid: "Example1", ip: "203.0.113.170", rssi: -58, connected: true,
            bssid: "02:00:00:00:00:02", mac: "02:00:00:00:00:01", std: "Wi-Fi 5", rolled_back: false },
    mqtt: { configured: true, connected: true, tls: false, has_creds: true,
            broker: "mqtt://203.0.113.26:1883", error: "" },
    syslog: { configured: false, resolved: false, reachable: false, host: "", port: 514, error: "" },
    ota: { channel: "release" },
    ntp: { server: "pool.ntp.org", synced: true, time: "2026-01-18T07:42:11Z" },
    hp: { proto: "S", rx: 1, tx: 2, connected: true, last_ok_s: 0, registers: 12,
          values: scenes[i].v.length, crc_err: 0, timeout_err: 0 },
    modbus: { enabled: true, connected: true },
    profile: { id: "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw" },
    sys: { free_heap: 118432, min_free_heap: 96120, max_alloc: 61440,
           reset_reason: "power_on", safe_mode: false },
    last_crash: null,
    history: { dt: 300, rows: histRows, modbus_rows: mbHistRows },
    detect: { proto: "S", valid: true, capacity_kw: 6.0, capacity_kw_iu: 8.0, ou_eeprom: "1A2B3C",
              candidates: ["altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"],
              families: ["Altherma 3 R"], ambiguous: false,
              model: { name: "EHVH/EHVX 04-08 kW", family: "Altherma 3 R", marketing: "Altherma 3 R W" } },
  });

  return { scenes, status, smartGrid: SG, outdoorAir: MB_OUT, tankHeater: MB_BSH, quietMode: MB_QUIET,
           electricalInput: MB_POWER, history: hist };
})();

// The README recording is English by default, while `?lang=de` gives UI reviews a deterministic
// German render. The real app still chooses through navigator.language (DESIGN.md §2).
try {
  const demoLang = /(?:^|[?&])lang=de(?:&|$)/.test(location.search) ? "de-DE" : "en-GB";
  Object.defineProperty(navigator, "language", { value: demoLang, configurable: true });
  Object.defineProperty(navigator, "languages", {
    value: demoLang === "de-DE" ? ["de-DE", "de"] : ["en-GB", "en"], configurable: true,
  });
} catch { /* leave the browser's own language */ }

// ── Stub the device: no fetch, no board ──────────────────────────────────────────────────────
// There is no WebSocket stub any more: the app has no push transport, it polls /status and /values
// (app.js "Live data: POLLING"), so the fetch stub below is the whole device. __scene() therefore
// drives the app through its OWN refresh functions instead of synthesising a socket message —
// the recorder feeds the app the way a real browser is fed, which is the point of a stub.
(() => {
  // ?scene=N pins one scene, so a headless screenshot run can address them one URL at a time.
  const q = parseInt((location.search.match(/scene=(\d+)/) || [])[1], 10);
  let idx = Number.isFinite(q) ? Math.min(Math.max(q, 0), DEMO.scenes.length - 1) : 0;

  const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  window.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("/status")) return json(DEMO.status(idx));
    if (u.startsWith("/values")) return json({
      values: DEMO.scenes[idx].v,
      modbus: [DEMO.smartGrid(DEMO.scenes[idx].sgMode || 0), DEMO.outdoorAir(DEMO.scenes[idx].mbOut),
               DEMO.tankHeater(!!DEMO.scenes[idx].mbBsh),
               DEMO.quietMode(DEMO.scenes[idx].v.some((r) =>
                 r.label === "Silent Mode" && String(r.value).trim() === "1")),
               DEMO.electricalInput(DEMO.scenes[idx].mbPower)],
    });
    if (u.startsWith("/history")) {
      const p = new URL(u, location.origin).searchParams;
      const h = DEMO.history(p.get("row"), p.get("source") === "modbus" ? "modbus" : "x10a");
      return h ? json(h) : { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
    if (u.startsWith("/diag")) return { ok: true, status: 200, text: async () => "[uptime 48213] demo", json: async () => ({}) };
    return json({});
  };

  // Pull the scene through the app's own two fetches. Returns a promise — the screenshot driver
  // awaits __scene() before posing, since a render that lands after the capture is a frame of the
  // PREVIOUS scene, which no test could tell from a correct one.
  const push = () => Promise.all([
    window.refreshStatus ? window.refreshStatus() : null,
    window.refreshValues ? window.refreshValues() : null,
  ]);

  // Driver hooks for the screenshot loop.
  window.__scene = async (i) => { idx = i; await push(); return DEMO.scenes[i].name; };
  window.__sceneCount = DEMO.scenes.length;
  window.__sceneName = (i) => DEMO.scenes[i].name;

  // ── Pose every CSS animation at a deterministic instant ─────────────────────────────────────
  // The flow dashes (1.1 s), the fan (2.6 s) and the pump (1.6 s) are what make the drawing read
  // as a running plant, so the GIF has to sample them, not freeze them. Each frame is its own
  // headless page load, so the phase cannot come from wall-clock time — it is SET here.
  //
  // Each animation is given a WHOLE number of cycles across the GIF's total length T, so the last
  // frame hands over to the first without a jump. Their real periods do not share a practical
  // common multiple (1.1 / 1.6 / 2.6 s → 228.8 s), so a shared clock would tear the loop on two of
  // the three. With the recorder's 10 fps / 135-frame timing, rounding stays within 6 % of every
  // live period and advances the pump only 21.3° per frame — below half its 45° vane spacing, so
  // the GIF cannot reverse its apparent direction through the wagon-wheel effect.
  window.__pose = (tMs, totalMs) => {
    document.getAnimations().forEach((a) => {
      const dur = a.effect && a.effect.getTiming().duration;      // ms, or "auto"
      a.pause();
      if (typeof dur !== "number" || !dur) return;
      const iter = a.effect.getTiming().iterations;
      if (iter !== Infinity) { a.currentTime = dur; return; }     // one-shot (view fade): end state
      const cycles = Math.max(1, Math.round(totalMs / dur));
      a.currentTime = (((tMs / totalMs) * cycles) % 1) * dur;
    });
    return document.getAnimations().length;
  };

  // Frame capture: ?scene=N&t=MS&T=TOTAL poses the page for one headless screenshot.
  //
  // The poll chain is STOPPED first. Chrome runs these frames under --virtual-time-budget=2500, so
  // virtual time reaches the 2 s poll tick before the screenshot is taken; a render landing after
  // the pose could hand a rebuilt element a fresh, unpaused animation and put that one frame at a
  // random phase. The data is already on screen by then — boot()'s first poll is synchronous
  // against the stub above — so nothing is lost by freezing here.
  const p = new URLSearchParams(location.search);
  if (p.has("t")) {
    const t = parseFloat(p.get("t")), T = parseFloat(p.get("T")) || 8800;
    addEventListener("load", () => setTimeout(() => {
      if (window.pollStop) window.pollStop();
      window.__pose(t, T);
    }, 150));
  }
})();
