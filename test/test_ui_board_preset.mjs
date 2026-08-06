// Regression tests for Board Hardware and ENV III wiring defaults. Runs the real production
// functions from the assembled production UI in a tiny DOM-free VM harness.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const settingsSource = readAppFragments(["settings.js"]);

function element(value = "") {
  return {
    value,
    checked: false,
    disabled: false,
    hidden: false,
    innerHTML: "",
  };
}

const elements = {
  bdPresetRow: element(),
  bdPreset: element(),
  bdLedType: element(),
  bdLedPinRow: element(),
  bdLedPin: element(),
  bdLedInvRow: element(),
  bdLedInv: element(),
  bdBtnPin: element(),
  bdBtnInvRow: element(),
  bdBtnInv: element(),
  bdError: element(),
  bdEnvSection: element(),
  envSensor: element(),
  envPinFields: element(),
  envSda: element(),
  envScl: element(),
};

const presets = [
  {
    id: "m5stack_atoms3_lite",
    name: "M5Stack AtomS3 Lite",
    vendor: "m5stack",
    led_gpio: 35,
    led_type: 1,
    led_inverted: false,
    btn_gpio: 41,
    btn_active_low: true,
    // Server-side filtering has already removed live X10A GPIO1/2. GPIO39 is intentionally absent:
    // the firmware must not offer an ENV III combination that fails on the physical board.
    i2c_pins: [5, 6, 7, 8, 38],
  },
  {
    id: "seeed_xiao_esp32s3",
    name: "Seeed XIAO ESP32-S3",
    vendor: "seeed",
    led_gpio: 21,
    led_type: 0,
    led_inverted: true,
    btn_gpio: -1,
    btn_active_low: true,
  },
];

const context = {
  S: {
    status: {
      board: {
        ...presets[1], // the shipped first-boot values, not an asserted board identity
        preset_id: "",
        preset_name: "",
        user_set: false,
        presets,
        pins_local: [1, 2, 21, 35, 41],
      },
      env3: {
        enabled: false,
        sda: 2,
        scl: 1,
        pins_avail: [5, 6, 7], // GPIO1/2 are occupied by X10A
      },
    },
  },
  $: (id) => elements[id],
  esc: String,
  t: (key) => key,
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${settingsSource}
   this.__fillBoard = fillBoard;
   this.__applyPreset = applyPreset;
   this.__syncBoardFields = syncBoardFields;
   this.__fillEnv3 = fillEnv3;
   this.__syncBoardEnv3Visibility = syncBoardEnv3Visibility;
   this.__syncEnv3Fields = syncEnv3Fields;
   this.__env3FormPayload = env3FormPayload;`,
  sandbox,
  { filename: "main/www/app.sources" },
);

sandbox.__fillBoard();
assert.equal(elements.bdPreset.value, "custom",
  "first-boot values must open as Custom, not inferred Seeed XIAO");
assert.equal(elements.bdLedType.value, "0");
assert.equal(elements.bdLedPin.value, "21");
assert.equal(elements.bdLedInv.checked, true);
assert.equal(elements.bdBtnPin.value, "-1");

// The preset remains a working fill shortcut and its explicit identity remains selected while the
// configurable onboard peripherals are disabled.
elements.bdPreset.value = "m5stack_atoms3_lite";
sandbox.__applyPreset();
assert.equal(elements.bdLedType.value, "1");
assert.equal(elements.bdLedPin.value, "35");
assert.equal(elements.bdBtnPin.value, "41");
assert.equal(elements.bdLedPin.disabled, false);
assert.equal(elements.bdLedInv.disabled, true, "WS2812 has no active-low GPIO control");
assert.equal(elements.bdBtnInv.disabled, false);
assert.equal(elements.bdEnvSection.hidden, false, "Atom selection must reveal its accessory settings");
assert.equal(elements.envSensor.disabled, false);

elements.bdLedType.value = "-1";
elements.bdBtnPin.value = "-1";
sandbox.__syncBoardFields();
assert.equal(elements.bdPreset.value, "m5stack_atoms3_lite",
  "disabling Atom LED and reset button must keep the explicit Atom identity");
assert.equal(elements.bdLedPin.disabled, true, "a hidden LED pin must also be disabled");
assert.equal(elements.bdBtnInv.disabled, true, "a hidden reset polarity must also be disabled");

elements.bdPreset.value = "custom";
sandbox.__applyPreset();
assert.equal(elements.bdEnvSection.hidden, true, "Custom must hide the M5Stack accessory section");
assert.equal(elements.envSensor.disabled, true);
assert.equal(elements.envSda.disabled, true);
assert.equal(elements.envScl.disabled, true);

// Reopening uses the explicitly persisted id, not a fresh comparison of pins. This is the core
// contract needed by ENV III: Atom remains visibly and semantically selected across refresh/reboot.
context.S.status.board.preset_id = "m5stack_atoms3_lite";
context.S.status.board.preset_name = "M5Stack AtomS3 Lite";
context.S.status.board.user_set = true;
context.S.status.board.led_gpio = -1;
context.S.status.board.led_type = 0;
context.S.status.board.led_inverted = false;
context.S.status.board.btn_gpio = -1;
sandbox.__fillBoard();
assert.equal(elements.bdPreset.value, "m5stack_atoms3_lite",
  "the stored AtomS3 Lite id must reopen as AtomS3 Lite despite disabled peripherals");

// I2C addresses identify devices only after a bus pair has been selected. When X10A reserves the
// Atom's Grove GPIO1/2, the modal must not resurrect those unavailable persisted defaults; it picks
// the first two distinct safe header pins instead.
sandbox.__fillEnv3();
assert.equal(elements.envSda.value, "5");
assert.equal(elements.envScl.value, "6");
assert.doesNotMatch(elements.envSda.innerHTML, /value="[12]"/);
assert.doesNotMatch(elements.envScl.innerHTML, /value="[12]"/);
assert.doesNotMatch(elements.envSda.innerHTML, /value="39">GPIO 39<\/option>/,
  "AtomS3 Lite GPIO39 must not be selectable as ENV III SDA");
assert.doesNotMatch(elements.envScl.innerHTML, /value="39">GPIO 39<\/option>/,
  "AtomS3 Lite GPIO39 must not be selectable as ENV III SCL");
assert.doesNotMatch(elements.envSda.innerHTML, /value="(?:9|10|33|34|36|37|47|48)"/,
  "chip-safe pads absent from the AtomS3 Lite headers must not be listed");
assert.equal(elements.envSensor.value, "", "an unconfigured sensor is represented by the select, not a checkbox");
assert.equal(elements.bdEnvSection.hidden, false);
assert.equal(elements.envPinFields.hidden, true);
assert.equal(elements.envSda.disabled, true);
assert.equal(elements.envScl.disabled, true);
assert.equal(JSON.stringify(sandbox.__env3FormPayload()), '{"enabled":false}',
  "no sensor must submit an explicit disable and no stale GPIO values");

elements.envSensor.value = "env_iii";
sandbox.__syncEnv3Fields();
assert.equal(elements.envPinFields.hidden, false);
assert.equal(elements.envSda.disabled, false);
assert.equal(elements.envScl.disabled, false);
assert.equal(JSON.stringify(sandbox.__env3FormPayload()), '{"enabled":true,"sda":5,"scl":6}');

// If Grove is free, the same stored defaults intentionally resolve to the official AtomS3 Lite
// ENV III mapping directly in the GPIO selectors.
presets[0].i2c_pins = [1, 2, 5, 6, 7, 8, 38];
context.S.status.env3.pins_avail = [1, 2, 5, 6, 7]; // legacy fallback must not override preset metadata
context.S.status.env3.enabled = true;
sandbox.__fillEnv3();
assert.equal(elements.envSda.value, "2");
assert.equal(elements.envScl.value, "1");
assert.equal(elements.envSensor.value, "env_iii");
assert.equal(elements.envPinFields.hidden, false);
assert.equal(elements.envSda.disabled, false);
assert.equal(elements.envScl.disabled, false);
