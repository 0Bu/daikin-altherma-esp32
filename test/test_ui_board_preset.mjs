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
  envSensor: element(),
  envSda: element(),
  envScl: element(),
};

const presets = [
  {
    id: "m5stack_atoms3_lite",
    name: "M5Stack AtomS3 Lite",
    led_gpio: 35,
    led_type: 1,
    led_inverted: false,
    btn_gpio: 41,
    btn_active_low: true,
  },
  {
    id: "seeed_xiao_esp32s3",
    name: "Seeed XIAO ESP32-S3",
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
   this.__syncPresetSelection = syncPresetSelection;
   this.__fillEnv3 = fillEnv3;
   this.__syncEnv3Fields = syncEnv3Fields;`,
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

// The preset remains a working fill shortcut, and edits made while the modal is open still keep the
// label honest.
elements.bdPreset.value = "m5stack_atoms3_lite";
sandbox.__applyPreset();
assert.equal(elements.bdLedType.value, "1");
assert.equal(elements.bdLedPin.value, "35");
assert.equal(elements.bdBtnPin.value, "41");

elements.bdLedPin.value = "21";
sandbox.__syncPresetSelection();
assert.equal(elements.bdPreset.value, "custom", "a hand edit must return the selection to Custom");

elements.bdLedPin.value = "35";
sandbox.__syncPresetSelection();
assert.equal(elements.bdPreset.value, "m5stack_atoms3_lite",
  "an exact in-modal preset match may name that preset");

// Reopening uses the explicitly persisted id, not a fresh comparison of pins. This is the core
// contract needed by ENV III: Atom remains visibly and semantically selected across refresh/reboot.
context.S.status.board.preset_id = "m5stack_atoms3_lite";
context.S.status.board.preset_name = "M5Stack AtomS3 Lite";
context.S.status.board.user_set = true;
context.S.status.board.led_gpio = 35;
context.S.status.board.led_type = 1;
context.S.status.board.led_inverted = false;
context.S.status.board.btn_gpio = 41;
sandbox.__fillBoard();
assert.equal(elements.bdPreset.value, "m5stack_atoms3_lite",
  "the stored AtomS3 Lite id must reopen as AtomS3 Lite without pin inference");

// I2C addresses identify devices only after a bus pair has been selected. When X10A reserves the
// Atom's Grove GPIO1/2, the modal must not resurrect those unavailable persisted defaults; it picks
// the first two distinct safe header pins instead.
sandbox.__fillEnv3();
assert.equal(elements.envSda.value, "5");
assert.equal(elements.envScl.value, "6");
assert.doesNotMatch(elements.envSda.innerHTML, /value="[12]"/);
assert.doesNotMatch(elements.envScl.innerHTML, /value="[12]"/);
assert.equal(elements.envSensor.value, "", "an unconfigured sensor is represented by the select, not a checkbox");
assert.equal(elements.envSda.disabled, true);
assert.equal(elements.envScl.disabled, true);

elements.envSensor.value = "env_iii";
sandbox.__syncEnv3Fields();
assert.equal(elements.envSda.disabled, false);
assert.equal(elements.envScl.disabled, false);

// If Grove is free, the same stored defaults intentionally resolve to the official AtomS3 Lite
// ENV III mapping directly in the GPIO selectors.
context.S.status.env3.pins_avail = [1, 2, 5, 6, 7];
context.S.status.env3.enabled = true;
sandbox.__fillEnv3();
assert.equal(elements.envSda.value, "2");
assert.equal(elements.envScl.value, "1");
assert.equal(elements.envSensor.value, "env_iii");
assert.equal(elements.envSda.disabled, false);
assert.equal(elements.envScl.disabled, false);
