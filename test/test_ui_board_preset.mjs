// Regression test for the Board Hardware preset default. Runs the real production functions from
// the assembled production UI in a tiny DOM-free VM harness: first-boot hardware values equal the
// Seeed XIAO preset, but values are not a physical board identity, so the modal must open on Custom.
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
};

const presets = [
  {
    name: "M5Stack AtomS3 Lite",
    led_gpio: 35,
    led_type: 1,
    led_inverted: false,
    btn_gpio: 41,
    btn_active_low: true,
  },
  {
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
        presets,
        pins_local: [1, 2, 21, 35, 41],
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
   this.__syncPresetSelection = syncPresetSelection;`,
  sandbox,
  { filename: "main/www/app.sources" },
);

sandbox.__fillBoard();
assert.equal(elements.bdPreset.value, "-1",
  "first-boot values must open as Custom, not inferred Seeed XIAO");
assert.equal(elements.bdLedType.value, "0");
assert.equal(elements.bdLedPin.value, "21");
assert.equal(elements.bdLedInv.checked, true);
assert.equal(elements.bdBtnPin.value, "-1");

// The preset remains a working fill shortcut, and edits made while the modal is open still keep the
// label honest.
elements.bdPreset.value = "0";
sandbox.__applyPreset();
assert.equal(elements.bdLedType.value, "1");
assert.equal(elements.bdLedPin.value, "35");
assert.equal(elements.bdBtnPin.value, "41");

elements.bdLedPin.value = "21";
sandbox.__syncPresetSelection();
assert.equal(elements.bdPreset.value, "-1", "a hand edit must return the selection to Custom");

elements.bdLedPin.value = "35";
sandbox.__syncPresetSelection();
assert.equal(elements.bdPreset.value, "0", "an exact in-modal preset match may name that preset");
