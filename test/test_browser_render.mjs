import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../tools/browser/cdp_browser.mjs";
import { startFixtureServer } from "../tools/browser/fixture_server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageFile = process.env.DAIKIN_BROWSER_PAGE;
if (!pageFile || !fs.statSync(pageFile, { throwIfNoEntry: false })?.isFile())
  throw new Error("DAIKIN_BROWSER_PAGE must name the production-marker-assembled dashboard page");

const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
if (mutation && ![
  "root-overflow", "modal-focus-delay", "history-flood", "route-hashchange-manual",
  "route-isolation-bypass",
].includes(mutation))
  throw new Error(`unknown browser selftest mutation: ${mutation}`);

const layoutAudit = `(() => {
  const shown = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return !el.hidden && style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const rootOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
    document.documentElement.clientWidth;
  const outside = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el) || el.closest(".schem-scroll")) continue;
    const rect = el.getBoundingClientRect();
    // The mobile card picker intentionally clips offscreen names inside its own horizontal
    // scroller. Audit their visible intersection; the scroller and page still obey viewport bounds.
    const nav = el.closest("#cardNav");
    const clip = nav && nav !== el && ["auto", "scroll"].includes(getComputedStyle(nav).overflowX)
      ? nav.getBoundingClientRect() : null;
    const left = clip ? Math.max(rect.left, clip.left) : rect.left;
    const right = clip ? Math.min(rect.right, clip.right) : rect.right;
    if (right < left) continue;
    if (left < -1 || right > innerWidth + 1) outside.push(describe(el));
  }
  const clipped = [];
  const candidates = document.querySelectorAll(
    "button, [role=button], [role=dialog], .field-label, .field-help, .hint, .section-label, " +
    ".hdr-title, .hdr-name, .conn-label, .conn-value, .vrow-label, .vrow-val, .dashboard-card-label, .ota-alert-message, " +
    ".recovery-banner .crash-title, .recovery-banner .crash-meta, " +
    "#valueGroups .vitem.open .vdesc-inner, #valueGroups .vitem.open .vdesc-body, " +
    "#valueGroups .vitem.open .vdesc-p"
  );
  for (const el of candidates) {
    if (!shown(el)) continue;
    const style = getComputedStyle(el);
    const clipsX = ["hidden", "clip"].includes(style.overflowX);
    const clipsY = ["hidden", "clip"].includes(style.overflowY);
    if ((clipsX && el.scrollWidth > el.clientWidth + 1) ||
        (clipsY && el.scrollHeight > el.clientHeight + 1)) clipped.push(describe(el));
  }
  return { rootOverflow, outside: [...new Set(outside)].slice(0, 12),
    clipped: [...new Set(clipped)].slice(0, 12), width: innerWidth, lang: document.documentElement.lang };
})()`;

const accessibilityAudit = `(() => {
  const shown = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return !el.hidden && style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const text = (el) => String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  const name = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const refs = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean)
      .map((id) => text(document.getElementById(id))).filter(Boolean).join(" ");
    if (refs) return refs;
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && text(label)) return text(label);
    }
    const wrapper = el.closest("label");
    if (wrapper && text(wrapper)) return text(wrapper);
    if (text(el)) return text(el);
    return (el.getAttribute("title") || "").trim();
  };
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
    (el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "");
  const unnamed = [];
  const controls = document.querySelectorAll(
    'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="dialog"], [tabindex="0"]'
  );
  for (const el of controls) {
    if (!shown(el) || el.disabled || el.getAttribute("aria-hidden") === "true") continue;
    if (!name(el)) unnamed.push(describe(el));
  }
  const colorOnly = [];
  const dot = document.getElementById("settingsDot");
  if (dot && shown(dot) && name(document.getElementById("btnSettings")) === t("nav.settings"))
    colorOnly.push("settings connection dot has no textual alert");
  const stateDot = document.getElementById("svDot");
  if (stateDot && shown(stateDot) && !text(document.getElementById("svStatus")))
    colorOnly.push("schematic state dot has no textual status");
  for (const value of document.querySelectorAll(".conn-val.ok, .conn-val.warn, .conn-val.err")) {
    if (!shown(value)) continue;
    const row = value.closest(".conn-row");
    if (!row || !name(row)) colorOnly.push("connection state colour has no row name");
  }
  return { unnamed: [...new Set(unnamed)], colorOnly: [...new Set(colorOnly)] };
})()`;

function assertLayout(result, context) {
  assert.ok(result.rootOverflow <= 1,
    `${context}: horizontal viewport overflow ${result.rootOverflow}px at ${result.width}px`);
  assert.deepEqual(result.outside, [], `${context}: visible elements escape the viewport`);
  assert.deepEqual(result.clipped, [], `${context}: visible text is clipped`);
}

async function assertSymmetricBorder(page, selector, context) {
  const border = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = "var(--err)";
    document.body.appendChild(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      widths: [style.borderTopWidth, style.borderRightWidth,
        style.borderBottomWidth, style.borderLeftWidth],
      styles: [style.borderTopStyle, style.borderRightStyle,
        style.borderBottomStyle, style.borderLeftStyle],
      colors: [style.borderTopColor, style.borderRightColor,
        style.borderBottomColor, style.borderLeftColor],
      expectedColor,
    };
  })()`);
  assert.ok(border, `${context}: bordered alert must exist`);
  assert.deepEqual(border.widths, ["1px", "1px", "1px", "1px"],
    `${context}: red alert border must be equally thin on every side`);
  assert.equal(new Set(border.styles).size, 1,
    `${context}: alert border style must be symmetric`);
  assert.equal(new Set(border.colors).size, 1,
    `${context}: alert border colour must be symmetric`);
  assert.deepEqual(border.colors, Array(4).fill(border.expectedColor),
    `${context}: every alert border side must use the error colour`);
}

async function assertAccessibility(page, context, { nativeTree = false } = {}) {
  const result = await page.evaluate(accessibilityAudit);
  assert.deepEqual(result.unnamed, [], `${context}: visible controls require accessible names`);
  assert.deepEqual(result.colorOnly, [], `${context}: state must not be conveyed by colour alone`);

  if (!nativeTree) return;
  const tree = await page.accessibilityTree();
  const namedRoles = new Set(["button", "textbox", "combobox", "dialog", "link"]);
  const unnamedAx = tree.filter((node) => !node.ignored && namedRoles.has(node.role?.value) &&
    !(node.name?.value || "").trim()).map((node) => `${node.role.value}@${node.backendDOMNodeId || "?"}`);
  assert.deepEqual(unnamedAx, [], `${context}: browser accessibility tree contains unnamed controls`);
}

async function assertSetup(page, server, viewport) {
  await page.navigate(server.url + "setup.html");
  await page.viewport(viewport.width, viewport.height);
  const context = `${viewport.name}/setup`;
  assertLayout(await page.evaluate(layoutAudit), context);
  await assertAccessibility(page, context, { nativeTree: true });
  assert.equal(await page.evaluate(`(() => {
    const message = document.getElementById("msg");
    return message.getAttribute("role") === "status" &&
      message.getAttribute("aria-live") === "polite" &&
      message.getAttribute("aria-atomic") === "true" &&
      ["ssid", "pass"].every(id => document.getElementById(id).getAttribute("aria-describedby") === "msg");
  })()`), true, `${context}: feedback must be announced and associated with both fields`);
  const initialTree = await page.accessibilityTree();
  assert.ok(initialTree.some(node => node.role?.value === "status" &&
    node.properties?.some(property => property.name === "live" && property.value?.value === "polite")),
  `${context}: native browser tree must expose the live status region`);

  const submit = async (ssid, pass) => {
    await page.evaluate(`(() => {
      document.getElementById("ssid").value = ${JSON.stringify(ssid)};
      document.getElementById("pass").value = ${JSON.stringify(pass)};
      document.getElementById("btn").click();
      return true;
    })()`);
  };
  const start = server.setupRequests.length;
  await submit("fixture", "short");
  await page.waitFor("document.getElementById('msg').textContent.includes('Password must be empty')");
  assert.equal(server.setupRequests.length, start, `${context}: invalid input must not reach the device`);
  const ssid = " my wifi ";
  for (const [status, body, expected] of [
    [400, { error: "Rejected fixture credentials" }, "Rejected fixture credentials"],
    [500, { error: "Could not save settings" }, "Could not save settings"],
    [503, { error: "out of memory" }, "Device busy"],
  ]) {
    server.setSetupReply({ status, body });
    const before = server.setupRequests.length;
    await submit(ssid, "fixture-password");
    await page.waitFor(`document.getElementById('msg').textContent.includes(${JSON.stringify(expected)}) && !document.getElementById('btn').disabled`);
    assert.equal(server.setupRequests.length, before + 1, `${context}/${status}: one write attempt`);
    assert.deepEqual(server.setupRequests.at(-1), { ssid, pass: "fixture-password" },
      `${context}/${status}: exact opaque credentials reach the endpoint`);
    assert.equal(await page.evaluate("document.getElementById('ssid').value"), ssid,
      `${context}/${status}: rejection preserves the editable draft`);
    assertLayout(await page.evaluate(layoutAudit), `${context}/${status}`);
    await assertAccessibility(page, `${context}/${status}`, { nativeTree: true });
  }
  server.setSetupReply({ status: 200, body: { ok: true, reboot: true } });
  await submit(ssid, "");
  await page.waitFor("document.getElementById('msg').textContent.includes('Saved — rebooting')");
  assert.equal(await page.evaluate("document.getElementById('btn').disabled"), true,
    `${context}: an accepted save stays disabled while rebooting`);
  assert.deepEqual(server.setupRequests.at(-1), { ssid, pass: "" },
    `${context}: open-network credentials remain an explicit empty password`);
  assertLayout(await page.evaluate(layoutAudit), `${context}/accepted`);
  const unexpected = page.diagnostics.filter(message =>
    !/^page log: Failed to load resource: the server responded with a status of (400|500|503)\b/.test(message));
  assert.deepEqual(unexpected, [], `${context}: only the deliberately rejected HTTP resources may log errors`);
  page.clearDiagnostics();
  console.log(`browser setup checked: ${viewport.name}; exact gzip asset, rejected/accepted writes and native live feedback`);
}

async function assertFlowSwitchWords(page, context) {
  const fits = await page.evaluate(`(() => {
    const previous = S._values;
    try {
      S._values = previous.filter(row => !/water flow switch/i.test(row.label || ""));
      const row = { label: "Water flow switch", value: "1" };
      S._values.push(row);
      return ["1", "0"].map(value => {
        row.value = value; renderApp();
        const text = document.getElementById("svFlowSwitch").getBBox();
        const pill = document.querySelector("#gFlowSwitch rect").getBBox();
        return { text: document.getElementById("svFlowSwitch").textContent,
          left: text.x - pill.x, right: pill.x + pill.width - text.x - text.width };
      });
    } finally { S._values = previous; renderApp(); }
  })()`);
  for (const fit of fits) assert.ok(fit.left >= 4 && fit.right >= 4,
    `${context}: flow-switch word ${JSON.stringify(fit.text)} needs 4 px padding (${fit.left}/${fit.right})`);
}

async function assertModalKeyboard(page, modalId, context, { route = true } = {}) {
  assert.deepEqual(await page.evaluate(`(() => {
    const modal = document.getElementById(${JSON.stringify(modalId)});
    return {
      role: document.activeElement?.getAttribute("role") || "",
      modal: document.activeElement?.closest("#" + CSS.escape(modal.id)) !== null,
      locked: document.documentElement.classList.contains("modal-open"),
    };
  })()`), { role: "dialog", modal: true, locked: true },
  `${context}: opening a modal must focus and announce its dialog`);

  await page.key("Tab", { code: "Tab", keyCode: 9 });
  assert.equal(await page.evaluate(`document.activeElement?.closest(
    "#" + CSS.escape(${JSON.stringify(modalId)})) !== null`), true,
  `${context}: Tab must enter the open modal`);

  if (route) {
    await page.evaluate(`(() => {
      window.__browserPopstateSettled = false;
      window.__browserHashchangeSettled = false;
      window.__browserHashchangeCount = 0;
      const manualHashchange = ${mutation === "route-hashchange-manual"};
      window.addEventListener("popstate", () => {
        window.__browserPopstateSettled = true;
      }, { once: true });
      window.addEventListener("hashchange", () => {
        window.__browserHashchangeCount++;
        if (window.__browserHashchangeCount >= (manualHashchange ? 2 : 1))
          window.__browserHashchangeSettled = true;
      }, { once: !manualHashchange });
      return true;
    })()`);
  }
  await page.key("Escape", { code: "Escape", keyCode: 27 });
  const closeSettled = `document.getElementById(${JSON.stringify(modalId)}).hidden &&
    location.hash === "#settings" && ${route ? "window.__browserPopstateSettled === true && window.__browserHashchangeSettled === true" : "true"}`;
  if (route && mutation === "route-hashchange-manual") {
    await page.waitFor(`document.getElementById(${JSON.stringify(modalId)}).hidden &&
      location.hash === "#settings" && window.__browserPopstateSettled === true &&
      window.__browserHashchangeCount === 1 && window.__browserHashchangeSettled === false`);
    assert.equal(await page.evaluate(`Boolean(${closeSettled})`), false,
      "route close must remain unsettled until the final hashchange is observed");
    await page.evaluate("window.dispatchEvent(new HashChangeEvent('hashchange')); true");
  }
  await page.waitFor(closeSettled);
  assert.equal(await page.evaluate("document.documentElement.classList.contains('modal-open')"), false,
    `${context}: Escape must close the modal and release scroll lock`);
}

async function openModalWithKeyboard(page, modalId, selector, context, { route = true } = {}) {
  const trigger = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    el.focus();
    return { found: true, focused: document.activeElement === el, disabled: !!el.disabled,
      visible: !el.hidden && style.display !== "none" && style.visibility !== "hidden" &&
        rect.width > 0 && rect.height > 0 };
  })()`);
  assert.deepEqual(trigger, { found: true, focused: true, disabled: false, visible: true },
    `${context}: the visible Settings entry must be keyboard-focusable`);
  if (!route && mutation !== "route-isolation-bypass")
    await page.evaluate("_applyingRoute = true; true");
  try {
    await page.key("Enter", { code: "Enter", keyCode: 13 });
    await page.waitFor(`(() => {
      const modal = document.getElementById(${JSON.stringify(modalId)});
      const active = document.activeElement;
      return !modal.hidden && document.documentElement.classList.contains("modal-open") &&
        active?.getAttribute("role") === "dialog" && active.closest("#" + CSS.escape(modal.id));
    })()`);
    const routeState = await page.evaluate(`({
      actual: parseRoute(location.hash).hash,
      expected: routeHash("settings", ${JSON.stringify(modalId)}),
    })`);
    if (route) {
      assert.equal(routeState.actual, routeState.expected,
        `${context}: routed keyboard open must publish the exact popup hash`);
    } else {
      assert.equal(routeState.actual, "#settings",
        `${context}: route-isolated keyboard open must keep the Settings hash`);
    }
  } finally {
    if (!route) await page.evaluate("_applyingRoute = false; true");
  }
}

async function assertReducedMotion(page, context, { modal = false } = {}) {
  const result = await page.evaluate(`(() => {
    const probe = document.createElement("span");
    probe.className = "vdesc vrow-chev";
    document.body.appendChild(probe);
    const transition = getComputedStyle(probe).transitionDuration;
    probe.remove();
    const spinner = document.createElement("span");
    spinner.className = "otaspin";
    document.body.appendChild(spinner);
    const spinnerAnimation = getComputedStyle(spinner).animationName;
    spinner.remove();
    const visibleModal = Array.from(document.querySelectorAll(".modal:not([hidden])"))[0] || null;
    return {
      media: matchMedia("(prefers-reduced-motion: reduce)").matches,
      view: getComputedStyle(document.querySelector(".view.active")).animationName,
      spinner: spinnerAnimation,
      transition,
      modal: visibleModal ? getComputedStyle(visibleModal.querySelector(".modal-card")).animationName : null,
      backdrop: visibleModal ? getComputedStyle(visibleModal.querySelector(".modal-backdrop")).animationName : null,
    };
  })()`);
  assert.deepEqual(result, {
    media: true,
    view: "none",
    spinner: "none",
    transition: "0s",
    modal: modal ? "none" : null,
    backdrop: modal ? "none" : null,
  }, `${context}: reduced motion must disable view, modal, progress and disclosure motion`);
}

async function activateLocale(page, locale) {
  const result = await page.evaluate(`(async () => {
    const loaded = await setLang(${JSON.stringify(locale)});
    if (LANG !== ${JSON.stringify(locale)}) throw new Error("locale did not activate");
    renderApp();
    return { loaded, lang: document.documentElement.lang };
  })()`);
  assert.equal(result.lang, locale, `${locale}: html lang must follow the active catalog`);
  await page.frame();
}

async function assertStatusTruth(page, context) {
  await page.evaluate(`(() => {
    window.__statusTruthPrevious = { status: S.status, open: new Set(S.descOpen) };
    S.descOpen.delete("dynamic:outdoor"); S.descOpen.delete("dynamic:plant-outdoor");
    S.status = { ...S.status, sys: { ...S.status.sys, config_unreadable: true },
      reference_temperature: { configured: true, name: "Example room", topic: "room/state",
        has_value: true, temperature_c: 21.5, has_setpoint: true, setpoint_c: 22, age_s: 1,
        fresh: true, freshness_reason: "fresh", temperature_valid: true, control_eligible: true,
        reason: "eligible", room_error_k: -0.5 },
      env3: { ...S.status.env3, enabled: true, connected: true, fresh: true, temperature_c: 12.4 },
      heating_curve: { armed: true, state: "blocked", reason: "evaluation_stale", reason_code: 15,
        sample_eligible: false, current_room_error_k: null, outdoor_temperature_c: null,
        plant_outdoor_temperature_c: null, plant_outdoor_source: null, forecast_available: false,
        last_sample_room_error_k: -0.4, last_sample_unix_s: 1780000000,
        last_sample_outdoor_temperature_c: 12.3, last_sample_outdoor_source: "env3",
        last_sample_plant_outdoor_temperature_c: 8.9, last_sample_plant_outdoor_source: "homehub" } };
    renderApp();
    return true;
  })()`);
  try {
    for (const [stage, id] of [["dashboard", "configWarningDash"], ["settings", "configWarningSettings"]]) {
      await page.evaluate(`showStage(${JSON.stringify(stage)}); renderApp(); renderApp(); true`);
      await page.frame();
      assert.equal(await page.evaluate(`(() => {
        const note = document.getElementById(${JSON.stringify(id)});
        return !note.hidden && note.getAttribute("role") === "alert" &&
          note.innerText.includes(t("config.unreadable_title")) &&
          note.innerText.includes(t("config.unreadable_meta")) &&
          !note.querySelector("button, [role=button], input, a, [tabindex]");
      })()`), true, `${context}/${stage}: current unreadable settings warning persists without dismissal`);
      assertLayout(await page.evaluate(layoutAudit), `${context}/${stage}`);
      await assertAccessibility(page, `${context}/${stage}`, { nativeTree: true });
      await captureNativeEvidence(page, `${context}/${stage}`, id);
    }
    assert.deepEqual(await page.evaluate(`(() => {
      const state = document.getElementById("dynamic-state-detail").textContent;
      const room = document.getElementById("dynamic-room-sources-detail");
      return { stale: state.includes(t("dyn.state_help_stale")),
        inactive: state.includes(t("dyn.state_help_inactive")),
        freshRoom: roomSourceStatus(S.status.reference_temperature, S.status.mqtt).cls === "ok",
        roomCopy: room.textContent.includes(t("ref.status.measurement_valid")),
        historical: S.status.heating_curve.last_sample_room_error_k === -0.4 };
    })()`), { stale: true, inactive: false, freshRoom: true, roomCopy: true, historical: true },
    `${context}: stale check remains distinct from its independently fresh room source and past event`);
    for (const [id, sample, source] of [["outdoor", 12.3, "ENV III"], ["plant-outdoor", 8.9, "HomeHub"]]) {
      await clickDisclosure(page, `[data-desc="dynamic:${id}"]`);
      assert.equal(await page.evaluate(`(() => {
        const text = document.getElementById(${JSON.stringify(`dynamic-${id}-detail`)}).innerText;
        return text.includes(t("dyn.outdoor_status_idle", ${JSON.stringify(source)})) &&
          text.includes((${sample}).toLocaleString(LANG,
            { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
      })()`), true, `${context}/${id}: stale evaluation keeps the last sample without blaming the sensor`);
      assertLayout(await page.evaluate(layoutAudit), `${context}/${id}`);
      await assertAccessibility(page, `${context}/${id}`, { nativeTree: true });
    }
  } finally {
    await page.evaluate(`S.status = window.__statusTruthPrevious.status;
      S.descOpen = window.__statusTruthPrevious.open; delete window.__statusTruthPrevious;
      S.clickHold = false; showStage("dashboard"); renderApp(); true`);
  }
}

// Native A4 metadata belongs to each cached /values row. Use the actual Modbus card/accordions,
// including the exact numeric enums, rather than a second renderer or an X10A fallback fixture.
const nativeAltherma4Rows = Object.freeze([
  { off: 9, label: "Quiet mode selection", value: 1, unit: "", enum: "altherma4_quiet_selection",
    labelKey: "a4.quiet_selection", valueKey: "enum.automatic", helpKey: "a4.quiet_help" },
  { off: 38, label: "Current operation mode", value: 0, unit: "", enum: "altherma4_current_operation_mode",
    valueKey: "enum.none", helpKey: "a4.current_help" },
  { off: 49, label: "Flow rate", value: 2.6, unit: "L/min", helpKey: "a4.flow_help" },
  { off: 54, label: "Weather-dependent Main Heating offset", value: -3, unit: "K",
    labelKey: "a4.heating_offset", helpKey: "a4.heating_offset_help" },
  { off: 58, label: "Imposed power limit", value: 6, unit: "kW",
    labelKey: "a4.imposed_power_limit", helpKey: "a4.limit_help" },
  { off: 65, label: "Demand response mode", value: 2, unit: "", enum: "altherma4_demand_response",
    labelKey: "a4.demand_response", valueKey: "enum.forced_on", helpKey: "a4.demand_help" },
  { off: 68, label: "Circulation pump speed", value: 45, unit: "%", helpKey: "a4.pump_help" },
  { off: 74, label: "Leaving water temperature pre-PHE outdoor", value: 7.3, unit: "°C",
    labelKey: "a4.pre_phe_outdoor", helpKey: "a4.pre_phe_outdoor_help" },
  { off: 79, label: "Water pressure", value: 2, unit: "bar", helpKey: "a4.pressure_help" },
  { off: 80, label: "Space heating/cooling target Main zone", value: 28, unit: "°C",
    labelKey: "a4.main_target" },
  { off: 83, label: "Unit operation mode", value: 4, unit: "", enum: "altherma4_unit_operation_mode",
    labelKey: "a4.unit_operation", valueKey: "enum.actuator", helpKey: "a4.operation_help" },
]);

// Use native pointer events so delegated navigation, focus and hit testing all participate.
async function clickElement(page, selector) {
  // Native input must reach this owned fixture tab. Chrome may open an internal help/update tab
  // in a fresh profile; a background fixture also throttles the disclosure's bounded hold timer.
  await page.send("Page.bringToFront");
  await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) throw new Error("missing pointer target: " + ${JSON.stringify(selector)});
    button.scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  })()`);
  // A shorter selected card can clamp the document scroll position after the preceding click.
  // Flush that real layout before taking coordinates, as the inspector pointer fixtures do.
  await page.frame();
  const point = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("hidden pointer target: " + ${JSON.stringify(selector)});
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (document.elementFromPoint(point.x, point.y)?.closest("button") !== button)
      throw new Error("pointer target is obstructed: " + ${JSON.stringify(selector)});
    return point;
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await page.send("Input.dispatchMouseEvent",
    { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await page.send("Input.dispatchMouseEvent",
    { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function activateDashboardCardForSelector(page, selector) {
  const key = await page.evaluate(`document.querySelector(${JSON.stringify(selector)})
    ?.closest(".vgroup[data-dashboard-card]")?.dataset.dashboardCard || null`);
  if (!key) return;
  const navSelector = `#cardNav button[data-card=${JSON.stringify(key)}]`;
  if (await page.evaluate(`document.querySelector(${JSON.stringify(navSelector)})
    ?.getAttribute("aria-pressed") === "true"`)) return;
  await clickElement(page, navSelector);
  await page.waitFor(`document.querySelector(${JSON.stringify(navSelector)})
    ?.getAttribute("aria-pressed") === "true"`);
}

// Exercise the delegated pointer lifecycle, including the disclosure animation. Value fixtures may
// target any card; activate its actual navigation entry before measuring its pointer target.
async function clickDisclosure(page, selector) {
  await activateDashboardCardForSelector(page, selector);
  await clickElement(page, selector);
  await page.waitFor(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const item = button?.closest(".vitem");
    return button?.getAttribute("aria-expanded") === "true" && item.classList.contains("open") &&
      item.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running");
  })()`);
}

async function assertDashboardCardAppearance(page, context, viewport) {
  const appearance = await page.evaluate(`(() => {
    const browser = document.getElementById("cardBrowser");
    const nav = document.getElementById("cardNav");
    const shellStyle = getComputedStyle(browser), navStyle = getComputedStyle(nav);
    const buttons = Array.from(nav.querySelectorAll("button[data-card]"));
    const readButton = button => {
      const style = getComputedStyle(button);
      const icon = button.querySelector("svg.dashboard-card-icon");
      const label = button.querySelector("span.dashboard-card-label");
      const buttonRect = button.getBoundingClientRect(), labelRect = label?.getBoundingClientRect();
      const fillet = pseudo => {
        const decoration = getComputedStyle(button, pseudo);
        return { content: decoration.content, width: decoration.width, height: decoration.height,
          position: decoration.position, pointerEvents: decoration.pointerEvents,
          left: decoration.left, right: decoration.right, top: decoration.top, bottom: decoration.bottom,
          background: decoration.backgroundImage };
      };
      return { key: button.dataset.card, pressed: button.getAttribute("aria-pressed"),
        hovered: button.matches(":hover"),
        structure: !!icon && !!label &&
          button.querySelectorAll("svg.dashboard-card-icon").length === 1 &&
          button.querySelectorAll("span.dashboard-card-label").length === 1 &&
          label.textContent === button.textContent.trim(),
        noChevron: button.querySelectorAll(".dashboard-card-chevron").length === 0,
        decorative: !!icon && icon.getAttribute("aria-hidden") === "true" && icon.getAttribute("focusable") === "false",
        iconDisplay: icon ? getComputedStyle(icon).display : null,
        iconWidth: icon?.getBoundingClientRect().width,
        labelFits: !!label && label.scrollWidth <= label.clientWidth + 1 &&
          labelRect.left >= buttonRect.left + parseFloat(style.paddingLeft) - 1 &&
          labelRect.right <= buttonRect.right - parseFloat(style.paddingRight) + 1,
        labelWhiteSpace: label ? getComputedStyle(label).whiteSpace : null,
        shrink: style.flexShrink,
        color: style.color, background: style.backgroundColor, weight: style.fontWeight,
        fontSize: style.fontSize, lineHeight: style.lineHeight,
        radii: [style.borderTopLeftRadius, style.borderTopRightRadius,
          style.borderBottomRightRadius, style.borderBottomLeftRadius],
        minHeight: style.minHeight, gap: style.gap,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        borderColors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
        width: buttonRect.width, right: buttonRect.right, bottom: buttonRect.bottom,
        marginBottom: style.marginBottom, shadow: style.boxShadow,
        before: fillet("::before"), after: fillet("::after") };
    };
    return { dark: matchMedia("(prefers-color-scheme: dark)").matches,
      coarse: matchMedia("(pointer: coarse)").matches,
      desktop: matchMedia("(min-width: 650px)").matches,
      shell: { radius: shellStyle.borderRadius,
        widths: [shellStyle.borderTopWidth, shellStyle.borderRightWidth,
          shellStyle.borderBottomWidth, shellStyle.borderLeftWidth],
        colors: [shellStyle.borderTopColor, shellStyle.borderRightColor,
          shellStyle.borderBottomColor, shellStyle.borderLeftColor] },
      nav: { width: nav.getBoundingClientRect().width, background: navStyle.backgroundColor,
        gap: navStyle.gap, wrap: navStyle.flexWrap, overflowX: navStyle.overflowX,
        shadow: navStyle.boxShadow, scrollbar: navStyle.scrollbarWidth,
        padding: [navStyle.paddingTop, navStyle.paddingRight, navStyle.paddingBottom, navStyle.paddingLeft] },
      content: { left: document.getElementById("valueGroups").getBoundingClientRect().left,
        top: document.getElementById("valueGroups").getBoundingClientRect().top },
      buttons: buttons.map(readButton) };
  })()`);
  assert.equal(appearance.desktop, viewport.width >= 650, `${context}: prototype breakpoint is 650 px`);
  const colors = appearance.dark
    ? { nav: "rgb(29, 37, 45)", border: "rgb(57, 67, 77)", selected: "rgb(34, 43, 51)",
      activeText: "rgb(108, 201, 238)", normalText: "rgb(172, 182, 193)" }
    : { nav: "rgb(248, 250, 251)", border: "rgb(228, 232, 236)", selected: "rgb(255, 255, 255)",
      activeText: "rgb(19, 143, 186)", normalText: "rgb(108, 118, 129)" };
  assert.deepEqual(appearance.shell, { radius: "17px", widths: Array(4).fill("1px"),
    colors: Array(4).fill(colors.border) }, `${context}: prototype outer border is thin, complete and rounded`);
  assert.equal(appearance.nav.background, colors.nav, `${context}: prototype sidebar surface`);
  assert.equal(appearance.nav.gap, appearance.desktop ? "3px" : "5px", `${context}: prototype name spacing`);
  assert.deepEqual(appearance.nav.padding, appearance.desktop ? ["17px", "9px", "17px", "9px"]
    : ["10px", "17px", "0px", "17px"], `${context}: padding reserves the curved tab joins`);
  if (appearance.desktop) assert.equal(appearance.nav.width, 202, `${context}: desktop sidebar is 202 px wide`);
  assert.equal(appearance.nav.wrap, "nowrap", `${context}: names remain in one desktop column or mobile row`);
  assert.equal(appearance.nav.overflowX, appearance.desktop ? "visible" : "auto",
    `${context}: horizontal overflow belongs to the mobile name scroller`);
  if (appearance.desktop) assert.equal(appearance.nav.shadow, "none", `${context}: desktop uses its vertical seam`);
  else {
    assert.equal(appearance.nav.scrollbar, "none", `${context}: mobile scrollbar is hidden locally`);
    assert.match(appearance.nav.shadow, /inset/, `${context}: mobile seam is an inset bottom line`);
    assert.ok(appearance.nav.shadow.includes(colors.border), `${context}: mobile seam uses the frame colour`);
  }
  const normalWidth = appearance.buttons.find(button => button.pressed !== "true")?.width;
  for (const button of appearance.buttons) {
    const name = `${context}/${button.key}`;
    assert.equal(button.structure, true, `${name}: decorative icon and actual name are distinct elements`);
    assert.equal(button.noChevron, true, `${name}: card names have no trailing navigation chevron`);
    assert.equal(button.decorative, true, `${name}: the icon must stay decorative`);
    assert.equal(button.labelFits, true, `${name}: the complete name fits its own button`);
    assert.equal(button.labelWhiteSpace, appearance.desktop ? "normal" : "nowrap",
      `${name}: desktop labels may wrap while mobile names remain on one line`);
    assert.equal(button.shrink, "0", `${name}: card names do not shrink away`);
    assert.equal(button.fontSize, appearance.desktop ? "14px" : "12px", `${name}: prototype label size`);
    assert.equal(button.lineHeight, appearance.desktop ? "17.5px" : "15px", `${name}: prototype label line height`);
    assert.equal(button.minHeight, appearance.coarse ? "44px" : "40px", `${name}: readable pointer/touch target`);
    assert.equal(button.shadow, "none", `${name}: selected state uses the rounded fill without an inset side strip`);
    assert.equal(button.gap, appearance.desktop ? "10px" : "0px", `${name}: prototype icon/name spacing`);
    assert.deepEqual(button.padding, appearance.desktop ? ["10px", "12px", "10px", "12px"]
      : ["9px", "10px", button.pressed === "true" ? "20px" : "9px", "10px"],
    `${name}: selected mobile tab extends to the panel while its name keeps the baseline`);
    if (appearance.desktop) {
      assert.equal(button.iconDisplay, "block", `${name}: desktop shows its icon`);
      assert.equal(button.iconWidth, 17, `${name}: prototype icon width`);
    } else {
      assert.equal(button.iconDisplay, "none", `${name}: mobile names omit decorative icons`);
    }
    if (button.pressed === "true") {
      assert.equal(button.background, colors.selected, `${name}: selected tab shares the content surface`);
      assert.equal(button.color, colors.activeText, `${name}: prototype selected foreground`);
      assert.equal(button.weight, "650", `${name}: prototype selected weight`);
      const borders = appearance.desktop ? ["1px", "0px", "1px", "1px"] : ["1px", "1px", "0px", "1px"];
      assert.deepEqual(button.borders, borders, `${name}: the selected outline opens into the content panel`);
      assert.deepEqual(button.radii, appearance.desktop ? ["9px", "0px", "0px", "9px"]
        : ["9px", "9px", "0px", "0px"], `${name}: outside corners round while the joined edge stays open`);
      for (let index = 0; index < borders.length; index++) if (borders[index] !== "0px")
        assert.equal(button.borderColors[index], colors.border, `${name}: visible outline matches the frame`);
      assert.equal(button.marginBottom, "0px", `${name}: selected tab reaches the seam without a lower gap`);
      assert.ok(Math.abs((appearance.desktop ? button.right : button.bottom) -
        (appearance.desktop ? appearance.content.left : appearance.content.top)) <= 1,
      `${name}: open tab edge touches the content panel`);
      if (appearance.desktop) assert.ok(Math.abs(button.width - normalWidth - 10) <= 1,
        `${name}: selected desktop tab extends through the ten-pixel sidebar seam`);
      for (const decoration of [button.before, button.after]) {
        assert.deepEqual([decoration.content, decoration.position, decoration.pointerEvents,
          decoration.width, decoration.height], ['""', "absolute", "none", "17px", "17px"],
        `${name}: non-interactive seventeen-pixel fillets round the two inside corners`);
        assert.match(decoration.background, /radial-gradient/, `${name}: join fillets are inverse quarter circles`);
        assert.ok(decoration.background.includes("16px") && decoration.background.includes("17px") &&
          decoration.background.includes(colors.border) && decoration.background.includes(colors.selected),
        `${name}: fillet geometry shares the one-pixel outline and content surface`);
      }
      assert.deepEqual(appearance.desktop
        ? [button.before.right, button.before.top, button.after.right, button.after.bottom]
        : [button.before.left, button.before.bottom, button.after.right, button.after.bottom],
      appearance.desktop ? ["0px", "-17px", "0px", "-17px"] : ["-17px", "0px", "-17px", "0px"],
      `${name}: both fillets meet the open tab edge`);
    } else {
      assert.deepEqual(button.borders, Array(4).fill("1px"), `${name}: inactive border reserves stable name geometry`);
      assert.deepEqual(button.radii, Array(4).fill("9px"), `${name}: inactive names retain their rounded corners`);
      assert.equal(button.marginBottom, appearance.desktop ? "0px" : "10px", `${name}: inactive mobile names clear the panel seam`);
      assert.ok(["none", "normal"].includes(button.before.content) && ["none", "normal"].includes(button.after.content),
        `${name}: only the selected tab draws join fillets`);
      assert.equal(button.weight, "500", `${name}: prototype inactive weight`);
      if (!button.hovered) assert.equal(button.color, colors.normalText, `${name}: prototype inactive foreground`);
    }
  }
}

async function assertMobileCardScroller(page, context, current) {
  const first = '#cardNav button[data-card="diagnosis"]';
  const last = '#cardNav button[data-card="modbus"]';
  const visible = selector => `(() => {
    const nav = document.getElementById("cardNav").getBoundingClientRect();
    const button = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return button.left >= nav.left - 1 && button.right <= nav.right + 1;
  })()`;
  const touchState = async () => {
    try {
      return await page.evaluate(`({ hidden: document.hidden, visibility: document.visibilityState,
        scrollLeft: document.getElementById("cardNav")?.scrollLeft,
        max: (() => { const nav = document.getElementById("cardNav");
          return nav && nav.scrollWidth - nav.clientWidth; })(),
        lastBounds: (() => { const nav = document.getElementById("cardNav");
          const button = nav?.lastElementChild; if (!button) return null;
          const n = nav.getBoundingClientRect(), b = button.getBoundingClientRect();
          return { nav: [n.left, n.right], button: [b.left, b.right] }; })(),
        focused: document.activeElement?.dataset?.card, width: innerWidth })`);
    } catch (error) { return { unavailable: error.message }; }
  };
  const traceTouch = process.env.DAIKIN_BROWSER_TOUCH_TRACE === "1";
  const foregroundTouch = async stage => {
    if (traceTouch) console.log(`raw touch ${context}/${stage}/before`, JSON.stringify(await touchState()));
    // A fresh owned Chrome profile can open an internal help/update tab after the preceding full
    // UI case. Unlike mouse clicks, CDP raw touch can wait indefinitely on that background target.
    await page.send("Page.bringToFront");
    await page.waitFor('document.visibilityState === "visible" && !document.hidden', { timeoutMs: 2000 });
  };
  const touchGesture = async (stage, events) => {
    let started = false, ended = false, phase = "foreground";
    try {
      await foregroundTouch(stage);
      for (const [index, event] of events.entries()) {
        phase = `${event.type}-${index}`;
        if (event.type === "touchStart") started = true;
        await page.send("Input.dispatchTouchEvent", event);
        if (event.type === "touchEnd") ended = true;
      }
      if (traceTouch) console.log(`raw touch ${context}/${stage}/complete`, JSON.stringify(await touchState()));
    } catch (error) {
      throw new Error(`${context}/${stage}/${phase}: native touch delivery failed; ` +
        `${JSON.stringify(await touchState())}; ${error.message}`, { cause: error });
    } finally {
      if (started && !ended) {
        try {
          await page.send("Page.bringToFront");
          await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, 2000);
        } catch (error) { console.error(`${context}/${stage}: touchEnd cleanup failed: ${error.message}`); }
      }
    }
  };
  await page.evaluate(`(() => {
    document.querySelector(${JSON.stringify(first)}).focus();
    document.activeElement.blur();
    document.getElementById("cardNav").scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  })()`);
  await page.frame();
  const dimensions = await page.evaluate(`(() => {
    const nav = document.getElementById("cardNav");
    return { overflow: nav.scrollWidth - nav.clientWidth, width: nav.clientWidth,
      lines: new Set(Array.from(nav.querySelectorAll("button"),
        button => Math.round(button.getBoundingClientRect().top))).size };
  })()`);
  assert.equal(dimensions.lines, 1, `${context}: every mobile name stays in one horizontal row`);
  assert.ok(dimensions.overflow > dimensions.width,
    `${context}: fixture has enough names to prove real horizontal navigation`);
  assert.equal(await page.evaluate(visible(last)), false, `${context}: last Modbus starts offscreen`);

  const nativeScroll = async (stage, direction, gesture) => {
    await foregroundTouch(stage);
    const before = await page.evaluate(`(() => {
      const nav = document.getElementById("cardNav"), rect = nav.getBoundingClientRect();
      const state = { moved: false, ended: false, controller: new AbortController() };
      nav.__browserCardScroll = state;
      nav.addEventListener("scroll", () => { state.moved = true; state.ended = false; },
        { signal: state.controller.signal });
      nav.addEventListener("scrollend", () => { if (state.moved) state.ended = true; },
        { signal: state.controller.signal });
      return { x: nav.scrollLeft, max: nav.scrollWidth - nav.clientWidth,
        left: rect.left + 25, right: rect.right - 25, y: rect.top + rect.height / 2 };
    })()`);
    try {
      assert.ok((direction > 0 ? before.max - before.x : before.x) > 0,
        `${context}/${stage}: a native gesture requires remaining scroll room in its direction`);
      await gesture(before);
      // touchEnd acknowledges delivery, not the end of the compositor's inertial fling. Waiting
      // only for the first delta can race the next visibility check and start a swipe at max.
      // A real scrollend settles that gesture before another direction or endpoint is sampled.
      await page.waitFor(`(() => {
        const nav = document.getElementById("cardNav"), delta = nav.scrollLeft - ${before.x};
        return nav.__browserCardScroll?.moved && nav.__browserCardScroll.ended &&
          (delta * ${direction} > 10 || (delta * ${direction} > 0 &&
          (${direction} > 0 ? nav.scrollLeft >= nav.scrollWidth - nav.clientWidth - 1 : nav.scrollLeft <= 1)));
      })()`, { timeoutMs: 2000 });
      if (traceTouch) console.log(`native scroll ${context}/${stage}/settled`, JSON.stringify(await touchState()));
    } catch (error) {
      throw new Error(`${context}/${stage}: native scrolling failed from ${JSON.stringify(before)}; ` +
        `${JSON.stringify(await touchState())}; ${error.message}`, { cause: error });
    } finally {
      await page.evaluate(`(() => { const nav = document.getElementById("cardNav");
        nav.__browserCardScroll?.controller.abort(); delete nav.__browserCardScroll; return true; })()`);
    }
  };
  const swipe = async direction => nativeScroll(`swipe-${direction > 0 ? "right" : "left"}`, direction, async points => {
    const from = direction > 0 ? points.right : points.left;
    const to = direction > 0 ? points.left : points.right;
    const touch = x => ({ x, y: points.y, id: 1, radiusX: 1, radiusY: 1, force: 1 });
    await touchGesture(`swipe-${direction > 0 ? "right" : "left"}`, [
      { type: "touchStart", touchPoints: [touch(from)] },
      ...[0.25, 0.5, 0.75, 1].map(fraction => ({ type: "touchMove",
        touchPoints: [touch(from + (to - from) * fraction)] })),
      { type: "touchEnd", touchPoints: [] },
    ]);
  });
  const rejectEndpoint = async direction => {
    let dispatched = false;
    await assert.rejects(nativeScroll("endpoint-control", direction, async () => { dispatched = true; }),
      /requires remaining scroll room/, `${context}: a no-op endpoint cannot count as a native gesture`);
    assert.equal(dispatched, false, `${context}: endpoint guard rejects before dispatching native input`);
  };
  await rejectEndpoint(-1);
  let backgroundTarget;
  try {
    if (process.env.DAIKIN_BROWSER_TOUCH_BACKGROUND_CONTROL === "1") {
      ({ targetId: backgroundTarget } = await page.send("Target.createTarget", { url: "about:blank" }));
      await page.send("Target.activateTarget", { targetId: backgroundTarget });
      await page.waitFor("document.hidden", { timeoutMs: 2000 });
    }
    await swipe(1);
  } finally {
    if (backgroundTarget) await page.send("Target.closeTarget", { targetId: backgroundTarget });
  }
  await swipe(-1);
  assert.equal((await current()).key, "diagnosis", `${context}: swiping names does not select a different card`);
  const swipeBudget = Math.ceil(dimensions.overflow / Math.max(1, dimensions.width - 50)) + 2;
  for (let count = 0; count < swipeBudget && !await page.evaluate(visible(last)); count++) await swipe(1);
  await page.waitFor(visible(last));
  await page.evaluate('document.activeElement?.blur?.(); true');
  await captureNativeEvidence(page, `${context}/swiped-last`, "cardBrowser");

  // A native horizontal wheel/trackpad gesture must use the same contained scroller.
  await foregroundTouch("wheel");
  await page.evaluate(`document.querySelector(${JSON.stringify(first)}).focus(); document.activeElement.blur(); true`);
  await nativeScroll("wheel", 1, async points => {
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: (points.left + points.right) / 2,
      y: points.y, deltaY: 0, deltaX: points.max + dimensions.width });
  });
  await page.waitFor(visible(last));
  await rejectEndpoint(1);
  const tap = await page.evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(last)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: 1 };
  })()`);
  await touchGesture("tap-modbus", [
    { type: "touchStart", touchPoints: [tap] }, { type: "touchEnd", touchPoints: [] },
  ]);
  await page.waitFor('S.dashboardCard === "modbus"');
  assert.deepEqual(await current(), { key: "modbus", selected: ["modbus"], visible: ["modbus"], labelled: true },
    `${context}: native tap on the revealed last name selects its actual card`);
  const beforePoll = await page.evaluate('document.getElementById("cardNav").scrollLeft');
  const repaintedValue = await page.evaluate(`(() => {
    S.clickHold = false; S._values[0].value = "13"; renderApp();
    return document.querySelector('#valueGroups [data-dashboard-card="group:Operation"] .vrow-val')
      ?.childNodes[0]?.textContent.trim();
  })()`);
  assert.equal(repaintedValue, "13", `${context}: changed-value poll really installs a new values frame`);
  assert.equal((await current()).key, "modbus", `${context}: selected card survives a changed-value poll repaint`);
  const afterPoll = await page.evaluate('document.getElementById("cardNav").scrollLeft');
  assert.ok(Math.abs(afterPoll - beforePoll) <= 1, `${context}: poll repaint preserves horizontal position`);
  assertLayout(await page.evaluate(layoutAudit), `${context}/scrolled-last`);

  // Browser keyboard focus must reveal names without a test-side scrollIntoView call.
  await page.evaluate(`document.querySelector(${JSON.stringify(first)}).focus(); true`);
  const keys = await page.evaluate('Array.from(document.querySelectorAll("#cardNav button"), button => button.dataset.card)');
  for (const key of keys.slice(1)) {
    await page.key("Tab", { code: "Tab", keyCode: 9 });
    assert.equal(await page.evaluate('document.activeElement?.dataset.card'), key,
      `${context}: Tab reaches ${key} in reading order`);
  }
  await page.waitFor(visible(last), { timeoutMs: 2000 });
  assert.equal(await page.evaluate(visible(last)), true, `${context}: keyboard focus scrolls the last name into view`);
  const modbusLength = await page.evaluate('S._modbus.length');
  const readerPosition = await page.evaluate(`(() => {
    S.clickHold = false;
    S._modbus.push(...Array.from({ length: 40 }, (_, index) => ({ off: 1000 + index,
      label: "Fixture long-card reading " + index, value: index, unit: "°C", profile: "altherma4" })));
    renderApp();
    window.scrollTo(0, document.documentElement.scrollHeight - innerHeight);
    return { y: scrollY, navBottom: document.getElementById("cardNav").getBoundingClientRect().bottom };
  })()`);
  assert.ok(readerPosition.y > 100 && readerPosition.navBottom < 0,
    `${context}: fixture really places the reader down a long card while the nav keeps keyboard focus`);
  await page.evaluate(`(() => {
    window.__browserCardFocusBeforeMembership = document.activeElement;
    S.clickHold = false;
    S._values.push({ group: "Fixture additional source", label: "Fixture extra", value: "1" });
    renderApp(); return true;
  })()`);
  assert.equal(await page.evaluate(`!!document.querySelector(
    '#cardNav button[data-card="group:Fixture additional source"]')`), true,
    `${context}: added source actually rebuilds the installed navigation`);
  assert.equal(await page.evaluate('document.activeElement !== window.__browserCardFocusBeforeMembership'), true,
    `${context}: membership repaint replaces the previously focused button`);
  assert.equal(await page.evaluate('document.activeElement?.dataset.card'), "modbus",
    `${context}: membership rebuild restores focus to the same source`);
  await page.waitFor(visible(last), { timeoutMs: 2000 });
  assert.equal(await page.evaluate(visible(last)), true,
    `${context}: restored focus is visible after the horizontal navigation rebuild`);
  assert.ok(Math.abs(await page.evaluate("scrollY") - readerPosition.y) <= 1,
    `${context}: restoring nav focus does not move the reader vertically up the long card`);
  await page.evaluate('S.clickHold = false; S._values.pop(); renderApp(); delete window.__browserCardFocusBeforeMembership; true');
  assert.equal(await page.evaluate(`!!document.querySelector(
    '#cardNav button[data-card="group:Fixture additional source"]')`), false,
    `${context}: removed source really disappears from the installed navigation`);
  await page.waitFor(visible(last), { timeoutMs: 2000 });
  assert.equal(await page.evaluate(visible(last)), true, `${context}: removing the extra source keeps focused Modbus visible`);
  assert.ok(Math.abs(await page.evaluate("scrollY") - readerPosition.y) <= 1,
    `${context}: removing a source also preserves the reader's vertical position`);
  await page.evaluate(`S.clickHold = false; S._modbus.splice(${modbusLength}); renderApp(); true`);
  // Capture the settled selection after the native focus/rebuild checks, so a transient browser
  // tap highlight is not mistaken for the card's persistent selected styling.
  await page.evaluate('document.activeElement?.blur?.(); true');
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await page.frame();
  await captureNativeEvidence(page, `${context}/tapped-modbus`, "cardBrowser");
}

async function assertDashboardCardNavigation(page, context, viewport) {
  const customGroup = 'Installer "A&B" <view>';
  const groups = ["Operation", "Domestic hot water", "Water circuit", "Refrigerant / outdoor",
    "Protection", "Electrical", "Device", "Other values", customGroup];
  const expected = ["diagnosis", "model", ...groups.map(group => `group:${group}`), "modbus"];
  const mobile = viewport.width < 650;
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
  await page.evaluate(`(() => {
    window.__browserCardsOriginal = { ...S };
    window.__browserCardsFetch = window.fetch;
    window.__browserCardsRequests = [];
    window.fetch = (...args) => {
      window.__browserCardsRequests.push({ url: String(args[0]), method: args[1]?.method || "GET" });
      return window.__browserCardsFetch(...args);
    };
    S.status = structuredClone(S.status);
    S.status.hp.connected = true;
    S.status.diagnostics.enabled = true;
    S.status.health = { status: "ok", full_span: true, source_fresh: true, source_age_s: 1,
      span_s: 86400, checks: [{ id: "fault", verdict: "ok", evidence: "manufacturer", active: 0 }] };
    S.status.modbus = { ...S.status.modbus, host: "card.fixture.invalid", enabled: true, connected: true };
    S._values = ${JSON.stringify(groups)}.map((group, index) => ({
      group, label: "Fixture reading " + index, value: "12", unit: "°C", reg: 0x61, off: index,
    }));
    S._modbus = [{ off: 49, label: "Flow rate", value: 2.6, unit: "L/min", profile: "altherma4" }];
    S.dashboardCard = "diagnosis";
    S.descOpen = new Set(); S.scrub = null; S.clickHold = false;
    renderApp();
    return true;
  })()`);
  try {
    await page.frame();
    const entries = await page.evaluate(`Array.from(document.querySelectorAll("#cardNav button[data-card]"),
      button => ({ key: button.dataset.card, label: button.textContent.trim(),
        type: button.type, controls: button.getAttribute("aria-controls") }))`);
    assert.deepEqual(entries.map(entry => entry.key), expected,
      `${context}: navigation follows actual cards in their existing semantic order`);
    assert.ok(entries.every(entry => entry.label && entry.type === "button" && entry.controls === "valueGroups"),
      `${context}: every available card has a named native button controlling the content`);
    assert.equal(entries.find(entry => entry.key === `group:${customGroup}`).label, customGroup,
      `${context}: firmware custom group text survives escaped attributes and markup`);
    const current = async () => page.evaluate(`(() => {
      const selected = Array.from(document.querySelectorAll("#cardNav button[data-card]"))
        .filter(button => button.getAttribute("aria-pressed") === "true");
      const visible = Array.from(document.querySelectorAll("#valueGroups .vgroup[data-dashboard-card]"))
        .filter(card => !card.hidden && getComputedStyle(card).display !== "none");
      return { key: S.dashboardCard, selected: selected.map(button => button.dataset.card),
        visible: visible.map(card => card.dataset.dashboardCard),
        labelled: selected.length === 1 && document.getElementById("valueGroups")
          .getAttribute("aria-labelledby") === selected[0].id };
    })()`);
    assert.deepEqual(await current(), { key: "diagnosis", selected: ["diagnosis"],
      visible: ["diagnosis"], labelled: true }, `${context}: diagnosis opens by default`);
    await assertDashboardCardAppearance(page, context, viewport);
    await page.evaluate("document.activeElement?.blur?.(); true");
    await captureNativeEvidence(page, `${context}/diagnosis`, "cardBrowser");
    const placement = await page.evaluate(`(() => {
      const nav = document.getElementById("cardNav").getBoundingClientRect();
      const content = document.getElementById("valueGroups").getBoundingClientRect();
      return { left: nav.right <= content.left + 1, above: nav.bottom <= content.top + 1,
        lines: new Set(Array.from(document.querySelectorAll("#cardNav button"),
          button => Math.round(button.getBoundingClientRect().top))).size };
    })()`);
    assert.equal(viewport.name === "phone" ? placement.above : placement.left, true,
      `${context}: navigation is ${viewport.name === "phone" ? "above the card" : "left of the card"}`);
    if (mobile) {
      assert.equal(placement.lines, 1, `${context}: mobile names occupy exactly one horizontally scrollable row`);
      await assertMobileCardScroller(page, context, current);
    }

    for (const key of expected) {
      await clickElement(page, `#cardNav button[data-card=${JSON.stringify(key)}]`);
      assert.deepEqual(await current(), { key, selected: [key], visible: [key], labelled: true },
        `${context}/${key}: native click shows exactly the requested card`);
      assertLayout(await page.evaluate(layoutAudit), `${context}/${key}`);
    }
    await clickElement(page, '#cardNav button[data-card="group:Water circuit"]');
    await assertDashboardCardAppearance(page, `${context}/middle-water`, viewport);
    await page.evaluate("document.activeElement?.blur?.(); true");
    await captureNativeEvidence(page, `${context}/middle-water`, "cardBrowser");
    // A pending disclosure click or active trend must not make card navigation appear unresponsive.
    await page.evaluate('S.clickHold = true; S.scrub = "fixture-trend"; true');
    await clickElement(page, '#cardNav button[data-card="model"]');
    assert.deepEqual(await current(), { key: "model", selected: ["model"], visible: ["model"], labelled: true },
      `${context}: navigation remains immediate while row rendering is held`);
    await page.evaluate("S.clickHold = false; S.scrub = null; renderApp(); true");
    assert.equal((await current()).key, "model", `${context}: a poll repaint preserves the selected card`);

    await page.evaluate(`(() => {
      const button = document.querySelector('#cardNav button[data-card="diagnosis"]');
      button.scrollIntoView({ block: "center", behavior: "instant" }); button.focus();
      return true;
    })()`);
    await page.key("Enter", { code: "Enter", keyCode: 13 });
    assert.equal((await current()).key, "diagnosis", `${context}: Enter activates a focused card name`);
    await page.evaluate('document.querySelector(\'#cardNav button[data-card="model"]\').focus(); true');
    await page.key(" ", { code: "Space", keyCode: 32 });
    assert.equal((await current()).key, "model", `${context}: Space activates a focused card name`);
    await page.evaluate("showStage('settings'); showStage('dashboard'); renderApp(); true");
    assert.equal((await current()).key, "model", `${context}: Settings round trip preserves card choice`);

    // A passive service observation used to keep Diagnostics visible despite the master setting.
    // Keep that real payload and the health rows present while changing only the saved opt-in.
    await page.evaluate(`(() => {
      S.status.refrigerant_service = { kind: "observation", state: "waiting",
        continuous_s: 0, samples: 0, blocker: "compressor_not_running" };
      renderApp(); return true;
    })()`);
    await clickElement(page, '#cardNav button[data-card="diagnosis"]');
    await page.waitFor("!S.clickHold");
    await page.evaluate(`(() => {
      document.querySelector('#cardNav button[data-card="diagnosis"]').focus();
      S.status.diagnostics.enabled = false; renderApp(); return true;
    })()`);
    assert.equal(await page.evaluate(`!!document.querySelector(
      '#cardNav [data-card="diagnosis"], #valueGroups [data-dashboard-card="diagnosis"]')`), false,
      `${context}: disabled diagnostics removes its name and whole card, including passive observations`);
    assert.deepEqual(await current(), { key: "model", selected: ["model"], visible: ["model"], labelled: true },
      `${context}: disabling the selected diagnosis opens Model with correct accessible naming`);
    assert.equal(await page.evaluate('document.activeElement?.dataset.card'), "model",
      `${context}: removing the focused diagnosis restores focus to Model`);
    assertLayout(await page.evaluate(layoutAudit), `${context}/diagnostics-disabled`);
    await page.evaluate("document.activeElement?.blur?.(); true");
    await captureNativeEvidence(page, `${context}/diagnostics-disabled`, "cardBrowser");
    await clickElement(page, '#cardNav button[data-card="group:Water circuit"]');
    await page.waitFor("!S.clickHold");
    await page.evaluate("renderApp(); true");
    assert.equal((await current()).key, "group:Water circuit",
      `${context}: polling with diagnostics disabled preserves another selected card`);
    await page.evaluate("S.status.diagnostics.enabled = true; renderApp(); true");
    assert.equal((await current()).key, "group:Water circuit",
      `${context}: enabling diagnostics preserves a valid current selection`);
    assert.equal(await page.evaluate('!!document.querySelector(\'#cardNav [data-card="diagnosis"]\')'), true,
      `${context}: enabling diagnostics restores its navigation entry`);
    await page.evaluate('S.status.diagnostics.enabled = false; S.dashboardCard = "diagnosis"; renderApp(); true');
    assert.equal((await current()).key, "model", `${context}: a fresh disabled dashboard defaults to Model`);
    await assertAccessibility(page, context, { nativeTree: true });
    assert.deepEqual(await page.evaluate("window.__browserCardsRequests"), [],
      `${context}: switching cards performs no requests or configuration writes`);
    await page.evaluate("document.activeElement?.blur?.(); true");
    await captureNativeEvidence(page, `${context}/selected`, "cardBrowser");
  } finally {
    await page.evaluate(`(() => {
      Object.assign(S, window.__browserCardsOriginal);
      window.fetch = window.__browserCardsFetch;
      delete window.__browserCardsOriginal; delete window.__browserCardsFetch;
      delete window.__browserCardsRequests;
      S.inspSig = null; S.inspHistSig = null;
      renderApp(); window.scrollTo(0, 0); return true;
    })()`);
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await page.frame();
  }
}

async function captureNativeEvidence(page, context, target = "valueGroups", ancestor = null) {
  const directory = process.env.DAIKIN_BROWSER_EVIDENCE_DIR;
  if (!directory || !/^(desktop\/en|phone\/de)(\/|$)/.test(context)) return;
  assert.ok(path.isAbsolute(directory), "browser evidence directory must be absolute");
  fs.mkdirSync(directory, { recursive: true });
  const elementQuery = ancestor
    ? `document.querySelector(${JSON.stringify(target)}).closest(${JSON.stringify(ancestor)})`
    : `document.getElementById(${JSON.stringify(target)})`;
  // Accordion classes change before their first expanded layout. Capture the settled surface,
  // while allowing the schematic's intentional, continuously running CSS animations.
  await page.waitFor(`(() => {
    const element = ${elementQuery};
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getAnimations({subtree:true})
      .every(animation => !(animation instanceof CSSTransition) || animation.playState !== "running");
  })()`);
  const clip = await page.evaluate(`(() => {
    const element = ${elementQuery};
    const rect = element.getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY,
      width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const capture = await page.send("Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true, clip });
  fs.writeFileSync(path.join(directory, `${context.replaceAll("/", "-")}.png`),
    Buffer.from(capture.data, "base64"));
}

async function assertPlantDiagnosis(page, context) {
  // Exercise the shipped renderer with independently scoped observations, including a real zero,
  // an absent heater channel and stale-source evidence. These fixtures do not certify a plant.
  await page.evaluate(`(() => {
    window.__browserDiagnosisOriginal = { status: S.status, open: new Set(S.descOpen), card: S.dashboardCard };
    S.status = structuredClone(S.status);
    S.status.refrigerant_service = {
      state: 'limited', continuous_s: 75, samples: 4, blocker: null,
      special_phases_known: false, limitations: ['pressure_sides_incomplete'],
      metrics: { compressor_rps: { min: 20, mean: 27.5, max: 40 },
        discharge_c: { min: 46.5, mean: 60.5, max: 81.4 },
        eev_command_pls: { min: 200, mean: 230.5, max: 250 } }
    };
    S.status.health = {
      status: "info", full_span: true, span_s: 86400, source_fresh: true, source_age_s: 1,
      available: 8, assessable: 2, evaluated: 2,
      checks: [
        { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0 },
        { id: "dhw_loss", verdict: "info", evidence: "heuristic", max_k_h: 1,
          windows: 4, high_windows: 1, high_with_pump: 1, high_pump_off: 0,
          quiet_high_windows: 1, draw_windows: 1, pump_windows: 2,
          observed_s: 14285, required_s: 3600, circulation_known_s: 14285,
          circulation_on_s: 3600, aborts: 3, abort_reasons: ["charge", "blind"],
          best_aborted_s: 2400 },
        { id: "cycling", verdict: "ok", evidence: "observation", reason: "class_unavailable",
          starts: 17, mean_run_s: null, space_runs: null, censored_runs: 3,
          observed_s: 77760, required_s: 77760 },
        { id: "defrost", verdict: "ok", evidence: "observation",
          reason: "defrost_events_insufficient", count: 0, paired_count: 0,
          share_pct: null, defrost_s: 0, run_s: 7200 },
        { id: "pressure", verdict: "info", evidence: "heuristic", min_bar: 0,
          current_bar: 1.5, min_unix_s: 1791871200, confirmed_low: false,
          observed_s: 77760, required_s: 77760 },
        { id: "flow", verdict: "ok", evidence: "observation", min_l_min: 10.7,
          observed_s: 60, required_s: 0 },
        { id: "heater", verdict: "ok", evidence: "observation", buh_s: 59,
          bsh_s: null, buh_observed_s: 7200, bsh_observed_s: 0,
          observed_s: 7200, required_s: 0 },
        { id: "retries", verdict: "ok", evidence: "experimental", seen: 0,
          observed_s: 7200, required_s: 0 }
      ]
    };
    S.descOpen.clear();
    renderApp();
    return true;
  })()`);
  try {
    const selector = "[data-desc^='model:health_']";
    assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`), 8,
      `${context}: all eight diagnosis rows must render`);
    await activateDashboardCardForSelector(page, "[data-desc='model:health_pressure']");
    await captureNativeEvidence(page, `${context}/overview`,
      "[data-desc='model:health_pressure']", ".card");
    const selectors = await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),
      el => '[data-desc="' + el.dataset.desc + '"]')`);
    selectors.push("[data-desc='service:refrigerant']");
    for (const row of selectors) await clickDisclosure(page, row);
    // The real pointer lifecycle protects the accordion for 600ms after release. Polling is
    // stopped in this fixture, so wait for that protection before explicitly repainting new data.
    await page.waitFor("S.clickHold === false");
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/expanded`);
    await assertAccessibility(page, `${context}/expanded`, { nativeTree: true });
    const blocks = await page.evaluate(`Array.from(document.querySelectorAll(
      "[data-desc^='model:health_'], [data-desc='service:refrigerant']"), row => {
      const body = row.closest('.vitem').querySelector('.vdesc-body');
      return { id: row.dataset.desc, count: body.children.length,
        firstValue: body.children[0]?.firstElementChild?.className,
        normal: body.children[2]?.querySelector('.vdesc-n')?.innerText,
        text: Array.from(body.children, block => block.innerText) };
    })`);
    assert.equal(blocks.length, 9, `${context}: include the independent refrigerant observation`);
    const normalLabel = await page.evaluate("t('normal.label')");
    for (const block of blocks) {
      assert.equal(block.count, 3, `${context}/${block.id}: exactly three blocks`);
      assert.equal(block.firstValue, 'vdesc-n', `${context}/${block.id}: value first`);
      assert.equal(block.normal, normalLabel, `${context}/${block.id}: Normal last`);
      assert.ok(block.text.every(text => text.trim()), `${context}/${block.id}: no empty block`);
    }
    const discardedContext = await page.evaluate(`(() => {
      const fixture = S.status.health.checks.find(check => check.id === 'dhw_loss');
      return t('check.detail.dhw_aborted', fixture.aborts,
        fixture.abort_reasons.map(reason => t('check.detail.dhw_reason.' + reason)).join(', '),
        '40 min').trim();
    })()`);
    const dhwText = () => page.evaluate(`document.querySelector("[data-desc='model:health_dhw_loss']")
      .closest('.vitem').innerText`);
    assert.ok((await dhwText()).includes(discardedContext),
      `${context}: a NOTE retains discarded reading-gap evidence`);
    assert.equal(await page.evaluate(`document.querySelector("[data-desc='model:health_pressure']")
      .closest('.card').querySelector('.section-badge')?.innerText || ''`),
      await page.evaluate("t('check.summary.notes', 2)"),
      `${context}: badge counts findings rather than assessed fractions`);
    await captureNativeEvidence(page, `${context}/expanded`);
    for (const id of ["pressure", "dhw_loss", "cycling", "defrost"])
      await captureNativeEvidence(page, `${context}/${id}`,
        `[data-desc='model:health_${id}']`, ".vitem");
    // Exercise the formerly blind band, then the exact no-window screenshot state, through the
    // real accordion. Ordinary use may explain the drop: it stays MEASURED, with a heat example.
    await page.evaluate(`(() => {
      Object.assign(S.status.health.checks[1], { verdict: 'ok', evidence: 'observation',
        max_k_h: 6, quiet_high_windows: 0, draw_windows: 4, pump_windows: 4 });
      renderApp();
      return true;
    })()`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/dhw-net-cooling`);
    assert.equal(await page.evaluate(`document.querySelector("[data-desc='model:health_dhw_loss'] .vrow-val").innerText`),
      await page.evaluate("t('check.status.observation')"),
      `${context}: marked rapid cooling stays measured`);
    assert.ok((await page.evaluate(`document.querySelector("[data-desc='model:health_dhw_loss']").closest('.vitem').innerText`))
      .includes('kWh'), `${context}: measured cooling has the energy illustration`);
    assert.ok((await dhwText()).includes(discardedContext),
      `${context}: MEASURED retains discarded reading-gap evidence`);
    await captureNativeEvidence(page, `${context}/dhw-net-cooling`,
      "[data-desc='model:health_dhw_loss']", ".vitem");
    await page.evaluate(`(() => {
      Object.assign(S.status.health.checks[1], { verdict: 'unavailable', blocked: true,
        max_k_h: null, windows: 0, high_windows: 0, quiet_high_windows: 0,
        draw_windows: 0, pump_windows: 0, aborts: 7, best_aborted_s: 2820,
        abort_reasons: ['charge', 'blind'] });
      renderApp();
      return true;
    })()`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/dhw-no-window`);
    assert.equal(await page.evaluate(`document.querySelector("[data-desc='model:health_dhw_loss'] .vrow-val").innerText`),
      await page.evaluate("t('check.status.no_window')"),
      `${context}: a blocked day must not promise ongoing checking`);
    assert.ok(!(await page.evaluate(`document.querySelector("[data-desc='model:health_dhw_loss']").closest('.vitem').innerText`))
      .includes('kWh'), `${context}: no measured rate means no energy number`);
    await captureNativeEvidence(page, `${context}/dhw-no-window`,
      "[data-desc='model:health_dhw_loss']", ".vitem");
    await captureNativeEvidence(page, `${context}/refrigerant`,
      "[data-desc='service:refrigerant']", ".vitem");
    await page.evaluate(`(() => {
      const h = S.status.health;
      h.source_fresh = false;
      h.source_age_s = 120;
      h.checks[0] = { id: 'fault', verdict: 'collecting', evidence: 'manufacturer',
        reason: 'source_stale', active: null };
      h.checks[4].current_bar = null;
      renderApp();
      return true;
    })()`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/stale`);
    assert.equal(await page.evaluate(`document.querySelector("[data-desc='model:health_fault'] .vrow-val").innerText`),
      await page.evaluate("t('check.status.collecting')"),
      `${context}: stale current fault state cannot render an all-clear`);
    await captureNativeEvidence(page, `${context}/stale`);
    // The production pump-off case is collecting flow in a partial day. Pressure still needs
    // the day; a flow observation needs eligible pump runtime and must not inherit that wait.
    await page.evaluate(`(() => {
      S.status.health = {
        status: 'collecting', full_span: false, span_s: 900,
        source_fresh: true, source_age_s: 1, available: 2, assessable: 1, evaluated: 0,
        checks: [
          { id: 'pressure', verdict: 'collecting', evidence: 'heuristic', reason: 'input_coverage',
            min_bar: 1.5, current_bar: 1.5, min_unix_s: 1791871200, confirmed_low: false,
            observed_s: 900, required_s: 77760 },
          { id: 'flow', verdict: 'collecting', evidence: 'observation', reason: 'input_coverage',
            min_l_min: null, observed_s: 0, required_s: 0 }
        ]
      };
      renderApp();
      return true;
    })()`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/flow-waiting`);
    await assertAccessibility(page, `${context}/flow-waiting`, { nativeTree: true });
    const missingDay = await page.evaluate("t('check.detail.horizon_wait', '23 h 45 min')");
    const pressureDetail = await page.evaluate(`document.querySelector("[data-desc='model:health_pressure']")
      .closest('.vitem').innerText`);
    const flowDetail = await page.evaluate(`document.querySelector("[data-desc='model:health_flow']")
      .closest('.vitem').innerText`);
    assert.ok(pressureDetail.includes(missingDay),
      `${context}: collecting pressure must retain its missing-day explanation`);
    assert.ok(!flowDetail.includes(missingDay),
      `${context}: collecting flow must not require a full day`);
    assert.ok(flowDetail.includes(await page.evaluate("t('check.detail.period_label') + ' 15 min'")),
      `${context}: collecting flow must retain its observed period`);
    assert.equal(await page.evaluate(`document.querySelector("[data-desc='model:health_flow'] .vrow-val").innerText`),
      await page.evaluate("t('check.status.collecting')"),
      `${context}: missing eligible flow stays neutral collection`);
    await captureNativeEvidence(page, `${context}/flow-waiting`,
      "[data-desc='model:health_flow']", ".vitem");
  } finally {
    await page.evaluate(`(() => {
      S.status = window.__browserDiagnosisOriginal.status;
      S.descOpen = window.__browserDiagnosisOriginal.open;
      S.dashboardCard = window.__browserDiagnosisOriginal.card;
      delete window.__browserDiagnosisOriginal;
      renderApp();
      return true;
    })()`);
    await page.frame();
  }
}

async function assertNativeAltherma4(page, context) {
  try {
    await page.evaluate(`(() => {
      window.__browserNativeAltherma4Original = { ...S };
      S.status = structuredClone(S.status);
      S.status.hp.connected = false;
      S.status.diagnostics.enabled = false;
      S.status.modbus = { ...S.status.modbus, host: "native-altherma4.fixture.invalid",
        enabled: true, connected: true, profile: "altherma4" };
      // This fixture isolates native help and quiet-state truth with history disabled. Flow,
      // temperatures and power can offer real trends; their API/history contract is tested separately.
      S.status.history = { rows: [], modbus_rows: [], env3_rows: [] };
      S._values = [];
      S._modbus = ${JSON.stringify(nativeAltherma4Rows)}.map(
        ({ labelKey, valueKey, helpKey, ...row }) => ({ ...row, profile: "altherma4" }));
      S.descOpen = new Set();
      S.hist = new Map();
      S.histPin = new Map();
      S.histBusy = new Set();
      S.histRequests = new Map();
      S.insp = null;
      S.inspSig = null;
      S.inspHistSig = null;
      S.scrub = null;
      S.clickHold = false;
      renderApp();
      return true;
    })()`);
    await page.frame();
    assert.equal(await page.evaluate("document.querySelectorAll('#valueGroups .vrow').length"),
      nativeAltherma4Rows.length, `${context}: every native Modbus row must be visible with X10A down`);
    assert.deepEqual(await page.evaluate(`(() => ({
      x10aDown: x10aDown(),
      quiet: S.live?.quiet,
      active: document.getElementById("schem").classList.contains("quiet-on"),
      namedUnknown: document.getElementById("gQuietState").getAttribute("aria-label").endsWith(": —"),
      quietHistory: hasModbusHist("quiet_state"),
      selectionMetadata: S._modbus.find((row) => row.off === 9),
    }))()`), {
      x10aDown: true, quiet: null, active: false, namedUnknown: true, quietHistory: false,
      selectionMetadata: { off: 9, label: "Quiet mode selection", value: 1, unit: "",
        enum: "altherma4_quiet_selection", profile: "altherma4" },
    }, `${context}: quiet selection must not invent binary activity, a lit pill or a history source`);

    for (const row of nativeAltherma4Rows) {
      const selector = `#valueGroups button[data-desc=${JSON.stringify(row.label)}]`;
      const reading = await page.evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        const source = S._modbus.find((row) => row.off === ${row.off});
        const spec = ${JSON.stringify(row)};
        const copy = descFor(source.label, source);
        const translated = copy && descriptionCopy(copy);
        const expectedHelp = spec.helpKey ? t(spec.helpKey)
          : translated ? translated[0] : LANG === "de" && copy?.de ? copy.de.what : copy?.what;
        return {
          found: !!button,
          label: button?.querySelector(".vrow-label")?.textContent,
          expectedLabel: spec.labelKey ? t(spec.labelKey) : displayHomeHubLabel(source),
          value: button?.querySelector(".vrow-val")?.childNodes[0]?.textContent,
          expectedValue: spec.valueKey ? t(spec.valueKey) : String(spec.value),
          unit: button?.querySelector(".vrow-unit")?.textContent || "",
          expectedHelp,
          activeCopy: [spec.labelKey, spec.valueKey, spec.helpKey].filter(Boolean)
            .every((key) => typeof I18N[LANG][key] === "string" && I18N[LANG][key].trim()),
          closed: button?.getAttribute("aria-expanded") === "false",
          trend: button?.getAttribute("data-trend") || "",
        };
      })()`);
      assert.equal(reading.found, true, `${context}/${row.off}: production accordion must exist`);
      assert.equal(reading.activeCopy, true, `${context}/${row.off}: active locale must supply every native key`);
      for (const field of ["expectedLabel", "expectedValue", "expectedHelp"]) {
        assert.ok(typeof reading[field] === "string" && reading[field].trim(),
          `${context}/${row.off}: ${field} requires active-locale copy`);
        assert.doesNotMatch(reading[field], /^(?:a4\.|enum\.)/,
          `${context}/${row.off}: untranslated keys must never appear`);
      }
      assert.equal(reading.label, reading.expectedLabel, `${context}/${row.off}: localized native label`);
      assert.equal(reading.value, reading.expectedValue, `${context}/${row.off}: exact numeric/enum display`);
      assert.equal(reading.unit, row.unit || "", `${context}/${row.off}: native unit must survive rendering`);
      assert.equal(reading.closed, true, `${context}/${row.off}: fixture must start collapsed`);
      assert.equal(reading.trend, "", `${context}/${row.off}: no unadvertised trend may be attached`);

      await clickDisclosure(page, selector);
      assert.deepEqual(await page.evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        const item = button.closest(".vitem");
        return { remembered: S.descOpen.has(${JSON.stringify(row.label)}),
          help: item.querySelector(".vdesc-body .vdesc-p")?.innerText,
          visibleHelp: item.querySelector(".vdesc-body").getBoundingClientRect().height > 0,
          charts: item.querySelectorAll(".vhist, [data-hist]").length };
      })()`), { remembered: true, help: reading.expectedHelp, visibleHelp: true, charts: 0 },
      `${context}/${row.off}: pointer click must expose complete localized help without a fabricated trend`);
      assertLayout(await page.evaluate(layoutAudit), `${context}/${row.off}/open`);
    }
    await assertAccessibility(page, `${context}/all-open`, { nativeTree: true });
    assert.deepEqual(page.diagnostics, [], `${context}: native rendering and real clicks must emit no errors`);
    // Optional local evidence from the real page after every native disclosure was pointer-opened.
    // Capture just the values card, including its off-screen height, without creating CI artifacts.
    await captureNativeEvidence(page, `${context}/standalone`);
    // The same limits must survive both a live second opinion and a native stand-in under an
    // existing X10A row. The standalone card alone cannot establish those production routes.
    for (const connected of [true, false]) {
      await page.waitFor("!S.clickHold");
      await page.evaluate(`(() => {
        S.status.hp.connected = ${connected};
        S._values = [
          { label: "Flow sensor", value: "2.5", unit: "L/min", reg: 0x61, concept: "flow" },
          { label: "Water Pressure", value: "2.5", unit: "bar", reg: 0x61, concept: "water_pressure" },
        ];
        S._modbus = ${JSON.stringify(nativeAltherma4Rows.filter(r => [49, 79].includes(r.off)))}
          .map(({ labelKey, valueKey, helpKey, ...row }) => ({ ...row, profile: "altherma4",
            concept: row.off === 49 ? "flow" : "water_pressure" }));
        S.descOpen = new Set();
        renderApp();
      })()`);
      for (const [off, label, key, nativeValue] of [
        [49, "Flow sensor", "a4.flow_help", "2.6"],
        [79, "Water Pressure", "a4.pressure_help", "2"],
      ]) {
        const selector = `#valueGroups button[data-desc=${JSON.stringify(label)}]`;
        await clickDisclosure(page, selector);
        assert.deepEqual(await page.evaluate(`(() => {
          const button = document.querySelector(${JSON.stringify(selector)});
          const item = button.closest(".vitem");
          const text = Array.from(item.querySelectorAll(".vdesc-p"), e => e.innerText);
          return { help: text.includes(t(${JSON.stringify(key)})),
            value: button.querySelector(".vrow-val").childNodes[0].textContent,
            comparisons: item.querySelectorAll(".mb-line").length,
            deltas: item.querySelectorAll(".mb-delta").length };
        })()`), { help: true, value: connected ? "2.5" : nativeValue,
          comparisons: connected ? 1 : 0, deltas: 0 },
        `${context}/${off}/${connected ? "paired" : "stand-in"}: native limit stays visible without an unverified difference`);
        assertLayout(await page.evaluate(layoutAudit), `${context}/${off}/paired-limit`);
      }
      await assertAccessibility(page, `${context}/paired-limit/${connected}`, { nativeTree: true });
      assert.deepEqual(page.diagnostics, [], `${context}: paired limits must emit no browser errors`);
      await captureNativeEvidence(page, `${context}/${connected ? "paired" : "replacement"}`);
      for (const [target, key, nativeValue] of [
        ["flow", "a4.flow_help", "2.6"], ["wp", "a4.pressure_help", "2"],
      ]) {
        await page.waitFor("!S.clickHold");
        await page.evaluate("S.insp = null; renderInspect(); true");
        // Closing the preceding panel can clamp the document's scroll position on desktop.
        // Wait for its real collapse before measuring the next pointer target.
        await page.waitFor(`!document.getElementById("inspect").classList.contains("open") &&
          document.getElementById("inspect").getAnimations({subtree: true})
            .every(a => a.playState !== "running")`);
        const selector = `#schem [data-insp=${JSON.stringify(target)}]`;
        await page.evaluate(`document.querySelector(${JSON.stringify(selector)})
          .scrollIntoView({block: "center", behavior: "instant"}); true`);
        await page.frame();
        const point = await page.evaluate(`(() => {
          const hit = document.querySelector(${JSON.stringify(selector)});
          const rect = hit.getBoundingClientRect();
          const point = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
          return {...point, target: document.elementFromPoint(point.x, point.y)
            ?.closest("[data-insp]")?.dataset.insp};
        })()`);
        assert.equal(point.target, target, `${context}/${target}: settled pointer must reach the actual hit target`);
        const {x, y} = point;
        await page.send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y});
        await page.send("Input.dispatchMouseEvent",
          {type: "mousePressed", button: "left", clickCount: 1, x, y});
        await page.send("Input.dispatchMouseEvent",
          {type: "mouseReleased", button: "left", clickCount: 1, x, y});
        try {
          await page.waitFor(`S.insp === ${JSON.stringify(target)} &&
            document.getElementById("inspect").classList.contains("open") &&
            document.getElementById("inspect").getAnimations({subtree: true})
              .every(a => a.playState !== "running")`);
        } catch (error) {
          console.error(context, target, connected, await page.evaluate(`({
            target: S.insp, open: document.getElementById("inspect").className,
            animations: document.getElementById("inspect").getAnimations({subtree: true})
              .map(a => ({state: a.playState, name: a.animationName,
                target: a.effect.target.id || a.effect.target.className,
                iterations: a.effect.getTiming().iterations})),
          })`));
          throw error;
        }
        assert.deepEqual(await page.evaluate(`(() => ({
          help: document.getElementById(${JSON.stringify(connected ? "inspRows" : "inspBody")})
            .innerText.includes(t(${JSON.stringify(key)})),
          headline: document.getElementById("inspNow").innerText.split(" ")[0],
          deltas: document.getElementById("inspRows").querySelectorAll(".mb-delta").length,
        }))()`), {help: true, headline: connected ? "2.5" : nativeValue, deltas: 0},
        `${context}/${target}/${connected}: real inspector click retains the native limit`);
        assertLayout(await page.evaluate(layoutAudit), `${context}/${target}/native-inspector`);
        await captureNativeEvidence(page,
          `${context}/inspector-${target}-${connected ? "paired" : "replacement"}`, "inspect");
      }
    }
  } finally {
    // The last real click holds per-poll rebuilds briefly. Restore only after that production lease
    // releases, so the next fixture cannot be rendered against stale native-card markup.
    await page.waitFor("!S.clickHold");
    assert.equal(await page.evaluate(`(() => {
      const original = window.__browserNativeAltherma4Original;
      Object.assign(S, original);
      // Rendering caches describe DOM left by the fixture, not the restored logical state.
      S.inspSig = null;
      S.inspHistSig = null;
      renderApp();
      window.scrollTo(0, 0);
      delete window.__browserNativeAltherma4Original;
      return S.status === original.status && S._values === original._values &&
        S._modbus === original._modbus && S.descOpen === original.descOpen &&
        document.getElementById("inspect").classList.contains("open") === !!INSPECT[S.insp];
    })()`), true, `${context}: original status, values, disclosure and inspector DOM state must be restored`);
    await page.frame();
  }
}

async function assertHybridRoom(page, context, locale) {
  const decimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  await page.waitFor("!S.clickHold");
  try {
    await page.evaluate(`(() => {
      window.__browserHybridRoomOriginal = { ...S };
      S.status = structuredClone(S.status);
      S.status.hp.connected = true;
      S.status.diagnostics.enabled = false;
      S.status.profile = { id: "altherma_hybrid", name: "Altherma Hybrid" };
      S.status.modbus = { ...S.status.modbus, host: "", enabled: false, connected: false };
      S.status.history = { rows: [], modbus_rows: [], env3_rows: [] };
      S._modbus = [];
      // These are the Hybrid catalog's own labels, including its default RT Temp. spelling.
      S._values = [
        { label: "I/U operation mode", value: "Heating", reg: 0x60 },
        { label: "Outlet Water Heat Exch. Temp. (R1T)", value: "35.0", unit: "°C", reg: 0x61, off: 2 },
        { label: "Outlet Water BUH Temp. (R2T)", value: "35.2", unit: "°C", reg: 0x61, off: 4 },
        { label: "Inlet water temp.(R4T)", value: "30.0", unit: "°C", reg: 0x61, off: 8 },
        { label: "RT Temp.", value: "21.5", unit: "°C", reg: 0x61, off: 12, concept: "room_temp" },
        { label: "RT setpoint", value: "22.0", unit: "°C", reg: 0x62, off: 5 },
      ];
      S.descOpen = new Set();
      S.hist = new Map();
      S.histPin = new Map();
      S.histBusy = new Set();
      S.histRequests = new Map();
      S.insp = null;
      S.inspSig = null;
      S.inspHistSig = null;
      S.scrub = null;
      S.clickHold = false;
      renderApp();
      return true;
    })()`);
    await page.frame();
    assert.deepEqual(await page.evaluate(`(() => {
      const room = document.querySelector("#schem [data-insp=room]");
      const rect = room.getBoundingClientRect();
      return {
        noSubstitute: !mbLive() && S._modbus.length === 0 &&
          !S._values.some(row => /^indoor ambient temp/i.test(row.label)),
        room: S.live.room, target: S.live.roomSet,
        visible: !document.getElementById("schem").classList.contains("no-room") &&
          getComputedStyle(room).display !== "none" && rect.width > 0 && rect.height > 0,
        roomText: document.getElementById("svRoom").textContent,
        targetText: document.getElementById("svRoomSet").textContent,
        preBuh: S.live.lwt, postBuh: S.live.r2t,
        preBuhText: document.getElementById("svLwt").textContent,
        postBuhText: document.getElementById("svR2t").textContent,
      };
    })()`), { noSubstitute: true, room: 21.5, target: 22, visible: true,
      roomText: decimal.format(21.5), targetText: decimal.format(22), preBuh: 35, postBuh: 35.2,
      preBuhText: decimal.format(35), postBuhText: decimal.format(35.2) },
    `${context}: the original Hybrid room reading and target must render without a substitute source`);

    await page.waitFor(`!document.getElementById("inspect").classList.contains("open") &&
      document.getElementById("inspect").getAnimations({subtree: true})
        .every(animation => animation.playState !== "running")`);
    await page.evaluate(`document.querySelector("#schem [data-insp=room]")
      .scrollIntoView({block: "center", behavior: "instant"}); true`);
    await page.frame();
    const point = await page.evaluate(`(() => {
      const hit = document.querySelector("#schem [data-insp=room] .sc-hitarea");
      const rect = hit.getBoundingClientRect();
      const point = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
      return {...point, target: document.elementFromPoint(point.x, point.y)
        ?.closest("[data-insp]")?.dataset.insp};
    })()`);
    assert.equal(point.target, "room", `${context}: pointer must reach the actual room hit target`);
    const {x, y} = point;
    await page.send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y});
    await page.send("Input.dispatchMouseEvent",
      {type: "mousePressed", button: "left", clickCount: 1, x, y});
    await page.send("Input.dispatchMouseEvent",
      {type: "mouseReleased", button: "left", clickCount: 1, x, y});
    await page.waitFor(`S.insp === "room" && document.getElementById("inspect").classList.contains("open") &&
      document.getElementById("inspect").getAnimations({subtree: true})
        .every(animation => animation.playState !== "running")`);
    // The inspector preserves the source row's numeric text; the schematic formats it by locale.
    assert.deepEqual(await page.evaluate(`(() => ({
      label: inspCurRow(INSPECT.room)?.label,
      value: document.getElementById("inspNow").textContent,
      source: document.getElementById("inspSrc").textContent,
      expectedSource: displayReadingLabel("RT Temp.", inspCurRow(INSPECT.room)),
      substitute: !!mbForInspect("room"),
    }))()`), { label: "RT Temp.", value: "21.5 °C",
      source: await page.evaluate('displayReadingLabel("RT Temp.", inspCurRow(INSPECT.room))'),
      expectedSource: await page.evaluate('displayReadingLabel("RT Temp.", inspCurRow(INSPECT.room))'),
      substitute: false }, `${context}: a real room click must expose the original reading and its source`);
    assertLayout(await page.evaluate(layoutAudit), `${context}/inspector`);
    await assertAccessibility(page, `${context}/inspector`, { nativeTree: true });
    await captureNativeEvidence(page, `${context}/schematic`, "schem");
    await captureNativeEvidence(page, `${context}/inspector`, "inspect");

    // Render the real third-source curve in the same inspector, retaining the device headline.
    await page.evaluate(`(() => {
      S.status.diagnostics.enabled = true;
      S.status.reference_temperature = { configured: true, name: "Meross MTS200B",
        topic: "fixture/room", temperature_path: "temperature", has_value: true,
        temperature_c: 23.6, fresh: true, temperature_valid: true, control_eligible: false,
        reason: "disabled", freshness_reason: "fresh" };
      S.status.mqtt = { ...S.status.mqtt, configured: true };
      S.status.history = { ...S.status.history,
        rows: [{id: "room_temp", label: "RT Temp."}],
        modbus_rows: [{id: "room_temp", label: "Remote controller room temperature Main"}],
        room_rows: [{id: "room_temp", label: "Meross MTS200B"}] };
      syncHistSources();
      const ring = (v) => ({ at: Date.now(), gen: 1, dt: 300, unit: "°C", b0: 100, held: [], v });
      S.hist.set("room_temp", ring(Array(288).fill(215)));
      S.hist.set(histCacheKey("room_temp", "modbus"), ring(Array(288).fill(216)));
      S.hist.set(histCacheKey("room_temp", "room"), ring(Array.from({length:288},
        (_, i) => i >= 140 && i < 145 ? null : 230 + Math.round(i / 48))));
      S.inspHistSig = null;
      renderApp();
      return true;
    })()`);
    await page.frame();
    assert.deepEqual(await page.evaluate(`(() => ({
      sources: historyView("room_temp").series.map(s => s.source),
      headline: document.getElementById("inspNow").textContent,
      mqttRow: document.querySelector("#inspRows .room-row").textContent,
      legend: Array.from(document.querySelectorAll("#inspHist .vhist-source"), el => el.textContent),
      roomLine: !!document.querySelector("#inspHist .vhist-line.room"),
      roomArea: !!document.querySelector("#inspHist .vhist-area.room"),
      gap: historyView("room_temp").series.find(s => s.source === "room").v[142],
    }))()`), {
      sources: ["x10a", "modbus", "room"], headline: "21.5 °C",
      mqttRow: `Meross MTS200B · MQTT${decimal.format(23.6)} °C`,
      legend: ["X10A", "HomeHub · Modbus", "Meross MTS200B · MQTT"],
      roomLine: true, roomArea: true, gap: null,
    }, `${context}: the additional MQTT curve retains all three instruments and the device headline`);
    assert.ok(await page.evaluate('scrubText(historyView("room_temp"), 142).includes("Meross MTS200B · MQTT " + t("hist.nm"))'),
      `${context}: a missing MQTT sample is named independently in the common cursor readout`);
    assertLayout(await page.evaluate(layoutAudit), `${context}/mqtt-room-paired`);
    await captureNativeEvidence(page, `${context}/mqtt-room-paired`, "inspect");

    // With no plant instrument the independent source stays clickable and owns the current value.
    await page.evaluate(`(() => {
      const roomRing = S.hist.get(histCacheKey("room_temp", "room"));
      S.status.hp.connected = false;
      S.status.modbus = { ...S.status.modbus, host: "", enabled: false, connected: false };
      S._values = [];
      S._modbus = [];
      S.status.history.rows = [];
      S.status.history.modbus_rows = [];
      syncHistSources();
      S.hist.set(histCacheKey("room_temp", "room"), roomRing);
      S.insp = null;
      renderApp();
      return true;
    })()`);
    await page.waitFor(`!document.getElementById("inspect").classList.contains("open") &&
      document.getElementById("inspect").getAnimations({subtree:true})
        .every(animation => animation.playState !== "running")`);
    await page.evaluate('document.querySelector("#schem [data-insp=room]").scrollIntoView({block:"center",behavior:"instant"}); true');
    await page.frame();
    const mqttPoint = await page.evaluate(`(() => {
      const hit = document.querySelector("#schem [data-insp=room] .sc-hitarea");
      const rect = hit.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await page.send("Input.dispatchMouseEvent", {type:"mouseMoved", ...mqttPoint});
    await page.send("Input.dispatchMouseEvent", {type:"mousePressed", button:"left", clickCount:1, ...mqttPoint});
    await page.send("Input.dispatchMouseEvent", {type:"mouseReleased", button:"left", clickCount:1, ...mqttPoint});
    await page.waitFor(`(() => {
      const panel = document.getElementById("inspect");
      const rect = panel.getBoundingClientRect();
      return S.insp === "room" && panel.classList.contains("open") && rect.width > 0 && rect.height > 0 &&
        panel.getAnimations({subtree:true}).every(animation => animation.playState !== "running");
    })()`);
    assert.deepEqual(await page.evaluate(`(() => ({
      plantSnapshot: S.live, visible: !document.getElementById("schem").classList.contains("no-room"),
      pill: document.getElementById("svRoom").textContent,
      source: document.getElementById("inspSrc").textContent,
      headline: document.getElementById("inspNow").textContent,
      sourceStatus: document.getElementById("inspBody").textContent ===
        roomSourceStatusText(roomSourceStatus(S.status.reference_temperature, S.status.mqtt)),
      sources: historyView("room_temp").series.map(s => s.source),
      legend: document.querySelector("#inspHist .vhist-source.room")?.textContent,
    }))()`), { plantSnapshot:null, visible:true, pill:decimal.format(23.6),
      source:"Meross MTS200B · MQTT", headline:`${decimal.format(23.6)} °C`, sourceStatus:true,
      sources:["room"], legend:"Meross MTS200B · MQTT" },
    `${context}: an actual click opens the MQTT-only room instrument without inventing a device sensor`);
    await page.evaluate(`S.status.reference_temperature.fresh = false;
      S.status.reference_temperature.freshness_reason = "stale";
      renderApp(); true`);
    assert.deepEqual(await page.evaluate(`({
      headline: document.getElementById("inspNow").textContent,
      pill: document.getElementById("svRoom").textContent,
      history: !!document.querySelector("#inspHist .vhist-line.room"),
      stale: document.getElementById("inspBody").textContent.includes(t("ref.detail.stale"))
    })`), {headline:"— °C", pill:"—", history:true, stale:true},
    `${context}: a stale MQTT sample blanks current values while preserving the dated curve`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), `${context}/mqtt-room-only`);
    await assertAccessibility(page, `${context}/mqtt-room-only`, {nativeTree:true});
    await captureNativeEvidence(page, `${context}/mqtt-room-only`, "inspect");

    await page.evaluate(`(() => {
      const name = "Meross <img src=x onerror=alert(1)>";
      S.status.reference_temperature.name = name;
      S.status.history.room_rows[0].label = name;
      renderApp();
      return true;
    })()`);
    assert.equal(await page.evaluate(`document.getElementById("inspSrc").textContent ===
      "Meross <img src=x onerror=alert(1)> · MQTT" &&
      !document.querySelector("#inspect img") &&
      document.querySelector("#inspHist .vhist-source.room").textContent ===
      "Meross <img src=x onerror=alert(1)> · MQTT"`), true,
    `${context}: configured source names remain escaped text in both inspector and legend`);
    await page.evaluate(`(() => {
      S.status.reference_temperature = { ...S.status.reference_temperature, name:"Replacement room",
        topic:"fixture/replacement", temperature_c:24.1, fresh:true, freshness_reason:"fresh" };
      S.status.history.room_rows[0].label = "Replacement room";
      syncHistSources();
      S.hist.set(histCacheKey("room_temp", "room"),
        {at:Date.now(), gen:1, dt:300, unit:"°C", b0:388, held:[], v:[241]});
      renderApp();
      return true;
    })()`);
    assert.deepEqual(await page.evaluate(`({
      source:document.getElementById("inspSrc").textContent,
      headline:document.getElementById("inspNow").textContent,
      readings:historyView("room_temp").series[0].v,
      single:!!document.querySelector("#inspHist .vhist-pt.room"),
      oldLine:!!document.querySelector("#inspHist .vhist-line.room")
    })`), {source:"Replacement room · MQTT", headline:`${decimal.format(24.1)} °C`,
      readings:[241], single:true, oldLine:false},
    `${context}: a replacement source starts its own readings instead of inheriting the previous curve`);

    // Retire the mapping, then resume the existing device-only missing-room checks below.
    await page.evaluate(`(() => {
      S.status.reference_temperature = { configured:false };
      S.status.history.room_rows = [];
      S.status.hp.connected = true;
      S.status.diagnostics.enabled = false;
      S._values = [
        {label:"I/U operation mode",value:"Heating",reg:0x60},
        {label:"Outlet Water Heat Exch. Temp. (R1T)",value:"35.0",unit:"°C",reg:0x61,off:2},
        {label:"Outlet Water BUH Temp. (R2T)",value:"35.2",unit:"°C",reg:0x61,off:4},
        {label:"Inlet water temp.(R4T)",value:"30.0",unit:"°C",reg:0x61,off:8},
        {label:"RT Temp.",value:"21.5",unit:"°C",reg:0x61,off:12,concept:"room_temp"},
        {label:"RT setpoint",value:"22.0",unit:"°C",reg:0x62,off:5},
      ];
      renderApp();
      return true;
    })()`);
    assert.equal(await page.evaluate('document.querySelector("#inspHist .vhist-source.room") === null'), true,
      `${context}: removed MQTT mapping cannot leave its former curve behind`);

    for (const withheld of [false, true]) {
      await page.evaluate(`(() => {
        S._values = S._values.filter(row => row.label !== "RT Temp.");
        if (${withheld}) S._values.push({ label: "RT Temp.", value: null, unit: "°C",
          reg: 0x61, off: 12, concept: "room_temp" });
        renderApp();
        return true;
      })()`);
      await page.frame();
      assert.deepEqual(await page.evaluate(`(() => ({
        room: S.live.room,
        blank: document.getElementById("svRoom").textContent,
        hidden: document.getElementById("schem").classList.contains("no-room") &&
          getComputedStyle(document.querySelector("#schem [data-insp=room]")).display === "none",
        inspector: document.getElementById("inspNow").textContent,
        preBuh: S.live.lwt, postBuh: S.live.r2t,
      }))()`), { room: null, blank: "—", hidden: true, inspector: "—", preBuh: 35, postBuh: 35.2 },
      `${context}/${withheld ? "withheld" : "missing"}: no room reading must remain absent in drawing and inspector`);
      assertLayout(await page.evaluate(layoutAudit), `${context}/missing-room`);
    }
    await captureNativeEvidence(page, `${context}/missing-room`, "schem");
    assert.deepEqual(page.diagnostics, [], `${context}: room rendering and real clicks must emit no browser errors`);
  } finally {
    await page.waitFor("!S.clickHold");
    assert.equal(await page.evaluate(`(() => {
      const original = window.__browserHybridRoomOriginal;
      Object.assign(S, original);
      S.inspSig = null;
      S.inspHistSig = null;
      renderApp();
      window.scrollTo(0, 0);
      delete window.__browserHybridRoomOriginal;
      return S.status === original.status && S._values === original._values &&
        S._modbus === original._modbus && S.descOpen === original.descOpen &&
        document.getElementById("inspect").classList.contains("open") === !!INSPECT[S.insp];
    })()`), true, `${context}: the original source and inspector state must be restored`);
    await page.frame();
  }
}

async function assertHistoryReadouts(page, context) {
  // Use the shipped chart builders and delegated touch/keyboard wiring inside the same clipping
  // surface as an expanded value row. Synthetic rings keep this independent of device history.
  await page.evaluate(`(() => {
    window.__browserHistoryOriginal = { status:S.status, hist:S.hist, histPin:S.histPin,
      histHidden:S.histHidden,scrub:S.scrub,live:S.live,values:S._values,modbus:S._modbus };
    S.status = structuredClone(S.status);
    S.hist = new Map(); S.histPin = new Map(); S.histHidden = new Map(); S.scrub = null; S.live = null;
    S._values = []; S._modbus = [];
    const host = document.createElement("div");
    host.id = "browserHistoryFixture"; host.className = "vdesc-inner";
    // Keep the native finger stationary vertically as readouts grow; a fixture appended at the
    // document tail would invoke browser scroll anchoring and turn a horizontal drag into pan-y.
    host.style.cssText = "position:fixed;top:24px;left:50%;transform:translateX(-50%);" +
      "width:calc(100% - 32px);max-width:800px;z-index:10000;background:var(--bg)";
    document.body.appendChild(host);
    wireTrendScrub(host);
    window.__browserHistoryEvents = [];
    for (const type of ["pointerdown","pointermove","pointerup","pointercancel","lostpointercapture"])
      host.addEventListener(type,event => {
        window.__browserHistoryEvents.push({type,x:event.clientX,y:event.clientY,pointer:event.pointerType});
        window.__browserHistoryEvents = window.__browserHistoryEvents.slice(-12);
      });
    window.__browserHistoryRender = () => {
      const id = host.dataset.hist;
      host.innerHTML = '<div class="vdesc-body" style="margin:0;transform:none">' +
        (id === ENV3_COMBINED_ID ? env3HistHtml() : histHtml(id, id === "dhw_tank" ? "°C" : "", id)) + '</div>';
    };
    return true;
  })()`);
  await page.send("Page.bringToFront");
  await page.send("Emulation.setTouchEmulationEnabled", { enabled:true });
  try {
    for (const id of ["dhw_tank", "valve_dhw", "smart_grid_mode", "env3_combined"]) {
      await page.evaluate(`(() => {
        const id = ${JSON.stringify(id)}, end = Date.parse("2026-08-12T10:00:00Z") / 1000;
        const ring = (v, unit = "°C") => ({at:Date.now(),gen:1,dt:300,b0:100,
          t0:end - 5700,unit,held:[],v});
        S.hist.clear(); S.histPin.clear(); S.histHidden.clear(); S.scrub = null;
        S.status.history = {rows:[{id,label:id}],modbus_rows:[{id,label:id}],env3_rows:[]};
        S.status.ntp = {synced:true,time:"2026-08-12T10:00:00Z"};
        if (id === ENV3_COMBINED_ID) {
          S.status.history.rows = []; S.status.history.modbus_rows = [];
          S.status.history.env3_rows = ENV3_COMBINED_SERIES.map(s => ({id:s.id,label:s.id}));
          S.status.env3 = {supported:true,enabled:true,fresh:true,
            temperature_c:21.5,humidity_pct:48,pressure_hpa:1007};
          S.status.weather_forecast = {configured:true,available:true,fresh:true,hourly:[1,2,3].map(hour => ({
            time_unix_s:end + hour * 3600,temperature_c:22 + hour,humidity_pct:48 - hour,
            pressure_hpa:1007 + hour}))};
          for (const [index,s] of ENV3_COMBINED_SERIES.entries())
            S.hist.set(histCacheKey(s.id,"env3"),ring(Array.from({length:20},(_,i) =>
              i === 7 && index === 1 ? null : [205 + i,500 - i,10050 + i][index]),["°C","%","hPa"][index]));
        } else {
          const values = Array.from({length:20},(_,i) => id === "dhw_tank" ? 480 - i
            : id === "smart_grid_mode" ? (i % 4) * 10 : i < 10 ? 0 : 10);
          S.hist.set(id,ring(values.map((v,i) => id === "dhw_tank" && i === 7 ? null : v),id === "dhw_tank" ? "°C" : ""));
          S.hist.set(histCacheKey(id,"modbus"),ring(values.map(v => id === "dhw_tank" ? v + 2 : v),
            id === "dhw_tank" ? "°C" : ""));
        }
        document.getElementById("browserHistoryFixture").dataset.hist = id;
        window.__browserHistoryRender();
        document.getElementById("browserHistoryFixture").scrollIntoView({block:"center",behavior:"instant"});
        return true;
      })()`);
      const point = async (fraction) => page.evaluate(`(() => {
        const plot = document.querySelector("#browserHistoryFixture [data-hist]");
        const r = plot.getBoundingClientRect();
        return {x:r.left + r.width * ${fraction},y:r.top + r.height / 2};
      })()`);
      const touch = async (type, position) => {
        await page.send("Input.dispatchTouchEvent", {
          type, touchPoints:position ? [{...position,id:1,radiusX:1,radiusY:1,force:1}] : [],
        });
        // Native touch movement can be coalesced until the compositor's next frame. A real finger
        // supplies successive frames; sending one jump and then only polling can leave a pending
        // movement (or one inside platform touch slop) without any pointermove for the UI to read.
        await page.evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");
      };
      const waitForTime = async (fraction, phase) => {
        try {
          await page.waitFor(`(() => {
            const host=document.getElementById("browserHistoryFixture"),plot=host.querySelector("[data-hist]");
            const i=scrubIndex(plot,plot.getBoundingClientRect().left + plot.clientWidth * ${fraction});
            return host.querySelector(".vhist-time.vhist-live").textContent === scrubTime(historyView(plot.dataset.hist),i);
          })()`);
        } catch (error) {
          const state = await page.evaluate(`(() => {
            const host=document.getElementById("browserHistoryFixture"),plot=host.querySelector("[data-hist]");
            const r=plot.getBoundingClientRect(),time=host.querySelector(".vhist-time.vhist-live");
            const i=scrubIndex(plot,r.left + plot.clientWidth * ${fraction});
            return {id:plot.dataset.hist,scrub:S.scrub,actual:time.textContent,hidden:time.hidden,
              expected:scrubTime(historyView(plot.dataset.hist),i),sample:i,
              plot:{left:r.left,top:r.top,width:r.width,height:r.height},events:window.__browserHistoryEvents};
          })()`);
          throw new Error(`${context}/${id}/${phase}/${fraction}: native touch selection did not reach its sample; ` +
            `${JSON.stringify(state)}; ${error.message}`);
        }
      };
      const start = await point(0.2);
      await touch("touchStart", start);
      await touch("touchEnd");
      assert.equal(await page.evaluate(`S.histPin.has(${JSON.stringify(id)})`),true,
        `${context}/${id}: a real touch release pins its selected sample`);
      await page.evaluate("window.__browserHistoryRender(); true");
      const baseline = await page.evaluate(`(() => {
        const host = document.getElementById("browserHistoryFixture");
        const p = host.querySelector("[data-hist]").getBoundingClientRect();
        return {top:p.top + scrollY,height:p.height,
          tip:host.querySelector(".vhist-tip.vhist-pinned").textContent,
          time:host.querySelector(".vhist-time.vhist-pinned").textContent,
          timeTop:host.querySelector(".vhist-time.vhist-pinned").getBoundingClientRect().top + scrollY};
      })()`);
      if(["dhw_tank","env3_combined"].includes(id))
        assert.equal(baseline.tip.includes(baseline.time),false,
          `${context}/${id}: pinned measurement time belongs on the axis rather than in the bubble`);
      // Start far from the preceding tap so this is unambiguously a new drag rather than a second
      // tap. Its first destination also clears movement slop on narrow phone plots.
      let finger = await point(0.9);
      await touch("touchStart", finger);
      await waitForTime(0.9,"start");
      assert.equal(await page.evaluate("S.scrub"),id,`${context}/${id}: touchstart owns the active scrub`);
      const rows = new Set();
      for (const fraction of [0.35,0.8,1,0]) {
        const destination = await point(fraction);
        const steps = Math.min(8,Math.max(3,Math.ceil(Math.abs(destination.x-finger.x)/48)));
        for (let step=1;step<=steps;step++)
          await touch("touchMove",{x:finger.x+(destination.x-finger.x)*step/steps,y:destination.y});
        finger = destination;
        await waitForTime(fraction,"move");
        const state = await page.evaluate(`(() => {
          const host = document.getElementById("browserHistoryFixture");
          const plot = host.querySelector("[data-hist]");
          const pin = host.querySelector(".vhist-tip.vhist-pinned"), live = host.querySelector(".vhist-tip.vhist-live");
          const pinTime = host.querySelector(".vhist-time.vhist-pinned"), liveTime = host.querySelector(".vhist-time.vhist-live");
          const rect = el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,
            top:r.top + scrollY,bottom:r.bottom + scrollY,height:r.height,width:r.width};};
          const p=rect(plot), a=rect(pin), b=rect(live), c=rect(pinTime), d=rect(liveTime), clip=rect(host);
          const view=historyView(plot.dataset.hist,plot.dataset.source || "");
          const i=scrubIndex(plot,plot.getBoundingClientRect().left + plot.clientWidth * ${fraction});
          return {visible:!live.hidden && !liveTime.hidden && a.height > 0 && b.height > 0,
            overlap:a.right + 8 > b.left && b.right + 8 > a.left,
            stacked:a.top >= b.bottom + 7, shared:Math.abs(a.bottom-b.bottom)<1,
            abovePlot:a.bottom <= d.top && b.bottom <= d.top, timesStacked:d.bottom <= p.top - 4,
            plotTop:p.top,plotHeight:p.height,pin:pin.textContent,pinTime:pinTime.textContent,
            axisTime:liveTime.textContent,expectedTime:scrubTime(view,i),
            selectedTimeInBubble:!STATE_HIST[plot.dataset.hist] && live.textContent.includes(scrubTime(view,i)),
            axisBelow:c.top >= p.bottom, pinTimeTop:c.top,
            inside:[a,b,c,d].every(r=>r.left >= clip.left - 1 && r.right <= clip.right + 1 && r.bottom <= clip.bottom + 1),
            bounds:{pin:a,live:b,pinTime:c,liveTime:d,clip},
            forecast:i >= view.v.length,
            forecastLabel:live.textContent.includes(t("hist.forecast")),
            cross:!plot.querySelector(".vhist-cross.vhist-pinned").hidden};
        })()`);
        const label = `${context}/${id}/${fraction}`;
        assert.equal(state.visible,true,`${label}: both selected readouts remain visible`);
        assert.equal(state.overlap ? state.stacked : state.shared,true,
          `${label}: the preview moves above the pin only when their horizontal boxes would overlap`);
        rows.add(state.overlap ? "stacked" : "shared");
        assert.equal(state.abovePlot,true,`${label}: both bubbles must remain above the time strip and curve`);
        assert.equal(state.timesStacked,true,`${label}: the moving time belongs above the plot`);
        assert.equal(state.inside,true,`${label}: neither readout nor time may be clipped: ${JSON.stringify(state.bounds)}`);
        assert.equal(state.axisBelow,true,`${label}: the pinned time remains below the curve`);
        assert.ok(Math.abs(state.pinTimeTop-baseline.timeTop)<1,`${label}: showing or moving a preview must not move the pinned time: ${JSON.stringify({baseline,state:state.bounds})}`);
        assert.equal(state.axisTime,state.expectedTime,`${label}: the axis follows the selected sample`);
        assert.equal(state.selectedTimeInBubble,false,`${label}: measurement tooltips contain values, with time on the axis`);
        assert.equal(state.pin,baseline.tip,`${label}: movement must preserve the pinned reading`);
        assert.equal(state.pinTime,baseline.time,`${label}: movement must preserve its pinned instant`);
        assert.equal(state.cross,true,`${label}: the pinned crosshair remains visible`);
        assert.ok(Math.abs(state.plotTop-baseline.top)<1,`${label}: tooltip height must not move the plot`);
        assert.equal(state.plotHeight,baseline.height,`${label}: tooltip height must not stretch the plot`);
        if(id === "env3_combined" && fraction === 0.8) {
          assert.equal(state.forecast,true,`${label}: the gesture reaches a provider forecast point`);
          assert.equal(state.forecastLabel,true,`${label}: forecast provenance remains visible`);
        }
        if(fraction === 0.35)
          await captureNativeEvidence(page,`${context}/${id}/comparison`,"browserHistoryFixture");
      }
      assert.ok(rows.has("stacked"),`${context}/${id}: the touch sequence must exercise a collision`);
      if(context.startsWith("desktop/") && id === "dhw_tank")
        assert.ok(rows.has("shared"),`${context}/${id}: separated readouts must also exercise sharing a row`);
      await captureNativeEvidence(page,`${context}/${id}`,"browserHistoryFixture");
      await touch("touchCancel");
      assert.equal(await page.evaluate(`(() => {
        const host = document.getElementById("browserHistoryFixture");
        return host.querySelector(".vhist-tip.vhist-live").hidden && host.querySelector(".vhist-time.vhist-live").hidden &&
          !host.querySelector(".vhist-tip.vhist-pinned").hidden && !host.querySelector(".vhist-time.vhist-pinned").hidden;
      })()`),true,`${context}/${id}: cancelling removes only the moving readout and its time`);
      assert.equal(await page.evaluate(`document.querySelector("#browserHistoryFixture .vhist-time.vhist-pinned").getBoundingClientRect().top + scrollY`),
        baseline.timeTop,`${context}/${id}: hiding the preview preserves the pinned time position`);
      await page.evaluate('document.querySelector("#browserHistoryFixture [data-hist]").focus(); true');
      await page.key("End",{code:"End",keyCode:35});
      assert.equal(await page.evaluate(`(() => {
        const host=document.getElementById("browserHistoryFixture"),plot=host.querySelector("[data-hist]");
        return !host.querySelector(".vhist-time.vhist-live").hidden &&
          host.querySelector(".vhist-time.vhist-live").textContent === scrubTime(historyView(plot.dataset.hist),scrubCount(plot)-1);
      })()`),true,`${context}/${id}: keyboard selection updates the same axis time`);
      await page.evaluate('document.querySelector("#browserHistoryFixture [data-hist]").blur(); true');
      if (["dhw_tank","env3_combined"].includes(id)) {
        const legend = await page.evaluate(`(() => {
          const host=document.getElementById("browserHistoryFixture"),id=host.dataset.hist;
          const sources=id === "dhw_tank" ? ["x10a","modbus"]
            : ["env3_temperature","env3_humidity","env3_pressure"];
          const pathClass={modbus:"mb",env3_humidity:"env-humidity",env3_pressure:"env-pressure"};
          const rings=JSON.stringify(Array.from(S.hist));
          const button=source=>host.querySelector('[data-hist-series="' + source + '"]');
          const changed=[];
          for (const source of sources.slice(1)) {
            const name=historyView(id).series.find(s=>s.source === source).name;
            button(source).click(); window.__browserHistoryRender();
            const plot=host.querySelector("[data-hist]");
            scrubMove(plot,+plot.dataset.n - 1);
            const cls=pathClass[source];
            changed.push(button(source).getAttribute("aria-pressed") === "false" && !button(source).disabled &&
              !host.querySelector(".vhist-line." + cls) && !host.querySelector(".vhist-area." + cls) &&
              !host.querySelector(".vhist-tip.vhist-pinned").textContent.includes(source === "modbus" ? "Modbus" : name) &&
              Array.from(host.querySelectorAll('.vhist-mark.vhist-live[data-source="' + source + '"]')).every(mark=>mark.hidden));
          }
          const last=sources[0],hidden=JSON.stringify(Array.from(S.histHidden.get(id)));
          const protectedLast=button(last).disabled && button(last).getAttribute("aria-pressed") === "true";
          button(last).click(); window.__browserHistoryRender();
          const unchanged=JSON.stringify(Array.from(S.histHidden.get(id))) === hidden;
          for (const source of sources.slice(1)) {button(source).click();window.__browserHistoryRender();}
          const beforePoll=button(sources[1]);
          beforePoll.focus(); S.clickHold=false;
          setHtml(host.id,host.innerHTML + "<!-- changed poll -->");
          const pollFocus=button(sources[1]) !== beforePoll && document.activeElement === button(sources[1]);
          return {hidden:changed.every(Boolean),protectedLast,unchanged,
            pollFocus,
            restored:sources.every(source=>button(source).getAttribute("aria-pressed") === "true" && !button(source).disabled) &&
              sources.slice(1).every(source=>!!host.querySelector(".vhist-line." + pathClass[source])),
            ringsUnchanged:JSON.stringify(Array.from(S.hist)) === rings};
        })()`);
        assert.deepEqual(legend,{hidden:true,protectedLast:true,unchanged:true,pollFocus:true,restored:true,ringsUnchanged:true},
          `${context}/${id}: legend clicks hide and restore independent series while retaining the final curve and source history`);
      }
    }
    assert.deepEqual(page.diagnostics,[],`${context}: history interactions must emit no browser errors`);
  } finally {
    await page.send("Emulation.setTouchEmulationEnabled",{enabled:false});
    await page.evaluate(`(() => {
      const original=window.__browserHistoryOriginal;
      Object.assign(S,{status:original.status,hist:original.hist,histPin:original.histPin,
        histHidden:original.histHidden,scrub:original.scrub,live:original.live,_values:original.values,_modbus:original.modbus});
      document.getElementById("browserHistoryFixture").remove();
      delete window.__browserHistoryOriginal; delete window.__browserHistoryRender; delete window.__browserHistoryEvents;
      renderApp(); window.scrollTo(0,0); return true;
    })()`);
  }
}

let browser, server;
try {
  server = await startFixtureServer({ pageFile, projectRoot: ROOT });
  browser = await launchBrowser();
} catch (error) {
  await server?.close();
  console.error(`browser render setup: ${error.message}`);
  process.exit(2);
}
try {
  const { page } = browser;
  await page.send("Page.bringToFront");
  await page.navigate(server.url);
  try {
    await page.waitFor("typeof S !== 'undefined' && S.status && Array.isArray(S._values) && document.querySelector('#settingsCards .vgroup')");
  } catch (error) {
    const state = await page.evaluate(`({ ready: document.readyState, title: document.title,
      hasApp: typeof S !== "undefined", hasStatus: typeof S !== "undefined" && !!S.status,
      body: document.body?.innerText?.slice(0, 120) || "" })`);
    throw new Error(`${error.message}; state=${JSON.stringify(state)}; diagnostics=${page.diagnostics.join(" | ")}`);
  }
  // Every case below installs synthetic source frames. Keep automatic polling stopped when the
  // owned tab is brought forward: the real visibility handler otherwise resumes polling and
  // replaces those frames with the server's baseline in the middle of a native pointer sequence.
  // Poll cadence and visibility-resume behavior have separate production-function contract tests.
  await page.evaluate("pollStop(); pollSchedule = () => {}; true");

  assert.equal(await page.evaluate(`(() => {
    const feedback = document.getElementById("toasts");
    return feedback.getAttribute("role") === "status" &&
      feedback.getAttribute("aria-live") === "polite" &&
      feedback.getAttribute("aria-atomic") === "false";
  })()`), true, "dashboard feedback must announce new notices without repeating older toasts");

  assert.deepEqual(await page.evaluate(`(async () => {
    const response = await fetch('/favicon.ico');
    const decoded = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', decoded);
    return { type: response.headers.get('Content-Type'), encoding: response.headers.get('Content-Encoding'),
      sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
  })()`), { type: "image/vnd.microsoft.icon", encoding: "gzip",
    sha256: createHash("sha256").update(fs.readFileSync(path.join(ROOT, "main/www/favicon.ico"))).digest("hex") },
  "the real browser must decode the gzip favicon to every original ICO byte");

  const browserLocales = await page.evaluate("Array.from(UI_LANGS)");
  const fileLocales = fs.readdirSync(path.join(ROOT, "main/www/locales"))
    .filter((name) => /^[a-z]{2}\.js$/.test(name)).map((name) => name.slice(0, 2));
  assert.deepEqual([...browserLocales].sort(), ["en", ...fileLocales].sort(),
    "browser coverage must follow every shipped locale catalog");

  // Exercise the complete Settings entry surface, including diagnostics-dependent rows, through
  // the same production rendering path as a device with that explicitly enabled feature.
  await page.evaluate("S.status.diagnostics.enabled = true; renderApp(); true");
  const modalTriggers = Object.freeze({
    wifiModal: "#connTile [data-edit='wifi']",
    mqttModal: "#connTile [data-edit='mqtt']",
    refTempModal: "#settingsCards [data-act='ref-temp']",
    circulationModal: "#settingsCards [data-act='circulation']",
    weatherModal: "#settingsCards [data-act='weather']",
    syslogModal: "#connTile [data-edit='syslog']",
    ntpModal: "#connTile [data-edit='ntp']",
    homehubModal: "#connTile [data-edit='homehub']",
    boardModal: "#settingsCards [data-act='board']",
    bugModal: "#footBug",
  });
  const routedModalIds = await page.evaluate("Array.from(ROUTED_MODALS)");
  assert.deepEqual(Object.keys(modalTriggers).sort(), [...routedModalIds].sort(),
    "real-browser keyboard triggers must cover every routed modal");

  let viewports = [{ name: "phone", width: 320, height: 760 },
                     { name: "desktop", width: 1200, height: 900 }];
  const vpIndex = process.argv.indexOf("--viewport");
  if (vpIndex !== -1 && process.argv[vpIndex + 1]) {
    const requested = process.argv[vpIndex + 1];
    viewports = viewports.filter((v) => v.name === requested);
    if (viewports.length === 0)
      throw new Error(`unknown viewport requested: ${requested}`);
  }
  const cumulativeOtaNotes = [
    "v1.0.3-dev.15 — Hard-reset ESP32-S3 after serial flash",
    "v1.0.3-dev.17 — Fix OTA stress HTTP handoff",
    "v1.0.3-dev.18 — Maintenance and reliability improvements.",
    "v1.0.3-dev.19 — Preserve legacy bench restore compatibility",
    "v1.0.3-dev.20 — Accept exact legacy writer evidence",
  ];
  const otaMemoryError = "Not enough memory to check for updates — retry after reboot";

  // Keep the mutation selftest fast and focused: it proves the layout assertion itself can fail,
  // while the normal invocation below owns the full locale/state/browser matrix exactly once.
  if (mutation === "root-overflow") {
    await page.viewport(viewports[0].width, viewports[0].height);
    await activateLocale(page, "en");
    await page.evaluate(`(() => { showStage("dashboard"); const style = document.createElement("style");
      style.textContent = ".app{min-width:640px!important}"; document.head.appendChild(style); })()`);
    await page.frame();
    assertLayout(await page.evaluate(layoutAudit), "selftest/root-overflow");
    throw new Error("root-overflow mutation unexpectedly survived the layout gate");
  }

  if (mutation === "modal-focus-delay") {
    await page.viewport(viewports[1].width, viewports[1].height);
    await activateLocale(page, "pl");
    await page.evaluate(`(() => {
      showStage("settings");
      writeRoute("settings", null, { replace: true, parent: null });
      openOverlay = (id) => {
        const modal = document.getElementById(id);
        modal.hidden = false;
        setTimeout(() => {
          syncModalScrollLock();
          modal.querySelector('[role="dialog"]')?.focus?.({ preventScroll: true });
        }, 75);
      };
      return true;
    })()`);
    await openModalWithKeyboard(page, "refTempModal", modalTriggers.refTempModal,
      "selftest/desktop/pl/refTempModal");
    await assertModalKeyboard(page, "refTempModal", "selftest/desktop/pl/refTempModal");
    console.log("browser modal-focus selftest passed: delayed focus and scroll lock were awaited");
  } else if (mutation === "route-hashchange-manual") {
    await page.viewport(viewports[1].width, viewports[1].height);
    await activateLocale(page, "en");
    await page.evaluate(`(() => {
      showStage("settings");
      writeRoute("settings", null, { replace: true, parent: null });
      return true;
    })()`);
    await openModalWithKeyboard(page, "refTempModal", modalTriggers.refTempModal,
      "selftest/desktop/en/refTempModal");
    await assertModalKeyboard(page, "refTempModal", "selftest/desktop/en/refTempModal");
    await page.evaluate(`(() => {
      window.__browserOtaDecision = askOtaInstall({
        current: "1.0.3-dev.14", available: "1.0.3-dev.20", available_channel: "dev"
      }, "v1.0.3-dev.20 — delayed route completion", false,
      document.getElementById("e32Chan"), "settings");
      return true;
    })()`);
    await page.waitFor(`(() => {
      const modal = document.getElementById("otaModal");
      return !modal.hidden && document.activeElement?.closest("#otaModal") !== null;
    })()`);
    await page.key("Escape", { code: "Escape", keyCode: 27 });
    await page.waitFor("document.getElementById('otaModal').hidden");
    console.log("browser route-event selftest passed: popstate and the manually released hashchange were awaited");
  } else if (mutation === "route-isolation-bypass") {
    // Keep this mutation focused on the exact route-isolation boundary. Running the complete
    // locale/viewport matrix would exercise unrelated transient dialogs before reaching the first
    // isolated modal, so a timing failure there could hide whether this mutation still has teeth.
    await page.viewport(viewports[1].width, viewports[1].height);
    await activateLocale(page, "de");
    await page.evaluate(`(() => {
      showStage("settings");
      writeRoute("settings", null, { replace: true, parent: null });
      return true;
    })()`);
    await openModalWithKeyboard(page, "refTempModal", modalTriggers.refTempModal,
      "selftest/desktop/de/refTempModal", { route: false });
    throw new Error("route-isolation-bypass mutation unexpectedly survived the route gate");
  } else if (process.argv.includes("--history-only")) {
    for (const viewport of viewports) {
      await page.viewport(viewport.width, viewport.height);
      for (const locale of browserLocales) {
        await activateLocale(page, locale);
        await assertHistoryReadouts(page, `${viewport.name}/${locale}/history`);
        console.log(`history readouts checked: ${viewport.name}/${locale}`);
      }
    }
    console.log(`focused history rendering passed: ${browserLocales.length} locales; ${viewports.length} viewports`);
  } else if (process.argv.includes("--room-only")) {
    for (const viewport of viewports) {
      await page.viewport(viewport.width, viewport.height);
      for (const locale of browserLocales) {
        await activateLocale(page, locale);
        await page.evaluate("showStage('dashboard'); window.scrollTo(0, 0); true");
        await assertHybridRoom(page, `${viewport.name}/${locale}/hybrid-room`, locale);
        console.log(`room render checked: ${viewport.name}/${locale}`);
      }
    }
    assert.deepEqual(page.diagnostics, [], "room source states must emit no browser errors");
    console.log(`focused room rendering passed: ${browserLocales.length} locales; ${viewports.length} viewports`);
  } else if (process.argv.includes("--cards-only")) {
    // Small prototype-parity pass for sidebar iterations. The normal invocation still owns the
    // complete locale/modal matrix and the supervisor's independent negative controls.
    const focusedViewports = viewports.flatMap(viewport => viewport.name === "phone"
      ? [viewport, { name: "phone", width: 390, height: 844 }] : [viewport]);
    for (const scheme of ["light", "dark"]) {
      await page.send("Emulation.setEmulatedMedia", { media: "screen",
        features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const viewport of focusedViewports) {
        await page.viewport(viewport.width, viewport.height);
        for (const locale of ["en", "de"]) {
          await activateLocale(page, locale);
          await page.evaluate("showStage('dashboard'); window.scrollTo(0, 0); true");
          await assertDashboardCardNavigation(page, `${viewport.name}/${locale}/card-navigation/${viewport.width}/${scheme}`, viewport);
          console.log(`card prototype checked: ${viewport.name}/${viewport.width}/${locale}/${scheme}`);
        }
      }
    }
    assert.deepEqual(page.diagnostics, [], "prototype card states must emit no browser errors");
    console.log(`focused card prototype rendering passed: 2 locales; 2 themes; ${focusedViewports.map(viewport => viewport.width).join("/")} px`);
  } else if (process.argv.includes("--setup-only")) {
    for (const viewport of viewports) await assertSetup(page, server, viewport);
  } else if (process.argv.includes("--diagnosis-only")) {
    // A focused rendering pass for diagnosis-copy iterations. The default full matrix below and
    // the supervisor's independent mutation controls remain unchanged.
    for (const viewport of viewports) {
      await page.viewport(viewport.width, viewport.height);
      for (const locale of browserLocales) {
        await activateLocale(page, locale);
        await page.evaluate("showStage('dashboard'); window.scrollTo(0, 0); true");
        await page.frame();
        await assertPlantDiagnosis(page, `${viewport.name}/${locale}/diagnosis`);
        console.log(`diagnosis render checked: ${viewport.name}/${locale}`);
      }
    }
    assert.deepEqual(page.diagnostics, [], "diagnosis states must emit no browser errors");
    console.log(`focused diagnosis rendering passed: ${browserLocales.length} locales; ${viewports.length} viewports`);
  } else {

  // Full semantic matrix: every shipped locale, both supported viewport classes, both views and
  // every routed modal receive DOM naming/colour checks and a native Chrome AX-tree inspection.
  // The same matrix dispatches real keyboard events for navigation plus dialog focus, Tab and Esc.
  // Browser History itself is locale-independent, so exercise every modal's real route once per
  // viewport and keep the remaining translated cases on the same keyboard/modal lifecycle without
  // flooding one long-lived document with hundreds of duplicate push/back transitions.
  const routedKeyboardBudget = viewports.length * routedModalIds.length;
  let routedKeyboardOpens = 0;
  let isolatedKeyboardOpens = 0;
  let nativeAltherma4Checks = 0;
  let hybridRoomChecks = 0;
  for (const viewport of viewports) {
    // The mutation seeds one complete locale's route budget, then exercises this same assertion on
    // the first extra route. It proves the boundary without running a deliberately flooded modal
    // matrix far enough to fail first on an unrelated transient-dialog timing condition.
    let routedKeyboardOpensInViewport =
      mutation === "history-flood" ? routedModalIds.length : 0;
    await page.viewport(viewport.width, viewport.height);
    for (const locale of browserLocales) {
      await activateLocale(page, locale);
      await page.evaluate("showStage('dashboard'); window.scrollTo(0, 0); true");
      await page.frame();
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/dashboard`);
      await assertAccessibility(page, `${viewport.name}/${locale}/dashboard`, { nativeTree: true });
      await assertDashboardCardNavigation(page, `${viewport.name}/${locale}/card-navigation`, viewport);
      await assertFlowSwitchWords(page, `${viewport.name}/${locale}/flow-switch`);
      await assertPlantDiagnosis(page, `${viewport.name}/${locale}/diagnosis`);
      await assertStatusTruth(page, `${viewport.name}/${locale}/status-truth`);
      await assertNativeAltherma4(page, `${viewport.name}/${locale}/native-altherma4`);
      nativeAltherma4Checks++;
      await assertHybridRoom(page, `${viewport.name}/${locale}/hybrid-room`, locale);
      hybridRoomChecks++;
      await assertHistoryReadouts(page, `${viewport.name}/${locale}/history`);

      // Firmware errors are intentionally preserved verbatim because they carry the safe next step.
      // Unlike compact progress labels, they can be a sentence. Exercise the production failure
      // path so the message appears in the persistent card rather than widening the identity line.
      await page.evaluate(`otaFail(${JSON.stringify(otaMemoryError)}); renderApp(); true`);
      await page.frame();
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/dashboard/ota-error`);
      await assertSymmetricBorder(page, "#otaAlertDash",
        `${viewport.name}/${locale}/dashboard/ota-error`);
      assert.equal(await page.evaluate("document.querySelector('#otaAlertDash .ota-alert-message').innerText"), otaMemoryError,
        `${viewport.name}/${locale}/dashboard/ota-error: firmware reason must remain complete`);
      assert.equal(await page.evaluate("document.getElementById('otaStat').innerText"), "",
        `${viewport.name}/${locale}/dashboard/ota-error: terminal prose must leave the meta line`);
      assert.equal(await page.evaluate(`(() => {
        const close = document.querySelector("#otaAlertDash .ota-alert-close");
        close.focus();
        const observer = new MutationObserver(() => {});
        observer.observe(document.getElementById("otaAlertDash"),
          { subtree: true, childList: true, attributes: true, characterData: true });
        renderApp();
        const mutations = observer.takeRecords().length;
        observer.disconnect();
        return mutations === 0 && document.activeElement === close &&
          document.querySelector("#otaAlertDash .ota-alert-close") === close;
      })()`), true, `${viewport.name}/${locale}/dashboard/ota-error: repaint must preserve close focus`);
      await page.key("Enter", { code: "Enter", keyCode: 13 });
      await page.waitFor("document.getElementById('otaAlertDash').hidden && document.getElementById('otaAlertSettings').hidden");

      // Crash reports are the other persistent red evidence card. Keep the same all-sided border
      // contract there instead of letting either card regress to a heavy left accent stripe.
      await page.evaluate(`(() => {
        S.status.last_crash = { reason: "panic", fault: true, coredump: false };
        renderCrashBanner();
        return true;
      })()`);
      await page.frame();
      await assertSymmetricBorder(page, "#crashBanner",
        `${viewport.name}/${locale}/dashboard/crash-error`);
      await page.evaluate("S.status.last_crash = null; renderCrashBanner(); true");

      await page.evaluate("document.getElementById('btnSettings').focus(); true");
      await page.key("Enter", { code: "Enter", keyCode: 13 });
      await page.waitFor("document.getElementById('viewSettings').classList.contains('active')");
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/settings`);
      await assertAccessibility(page, `${viewport.name}/${locale}/settings`, { nativeTree: true });

      for (const busy of [false, true]) {
        await page.evaluate(`S.transportUnavailable = "status"; S.transportBusy = ${busy}; renderApp(); true`);
        assert.equal(await page.evaluate(`(() => {
          const note = document.getElementById("statusSnapshot");
          return !note.hidden && note.getAttribute("role") === "status" &&
            note.innerText.includes(t("ota.snapshot_value")) &&
            note.innerText.includes(t(${JSON.stringify(busy ? "toast.busy_retry" : "toast.unreachable")})) &&
            !document.querySelector("#connTile .conn-val.ok, #connTile .conn-detail, #connTile .signal");
        })()`), true, `${viewport.name}/${locale}/settings: lost status labels every retained frame as a snapshot`);
        assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/settings/status-loss`);
        await assertAccessibility(page, `${viewport.name}/${locale}/settings/status-loss`, { nativeTree: true });
      }
      await page.evaluate('S.transportUnavailable = null; S.transportBusy = false; renderApp(); true');
      assert.equal(await page.evaluate('document.getElementById("statusSnapshot").hidden'), true,
        `${viewport.name}/${locale}/settings: fresh status removes the snapshot warning`);

      await page.evaluate(`otaFail(${JSON.stringify(otaMemoryError)}); renderApp(); true`);
      await page.frame();
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/settings/ota-error`);
      await assertSymmetricBorder(page, "#otaAlertSettings",
        `${viewport.name}/${locale}/settings/ota-error`);
      assert.equal(await page.evaluate("document.querySelector('#otaAlertSettings .ota-alert-message').innerText"), otaMemoryError,
        `${viewport.name}/${locale}/settings/ota-error: firmware reason must remain complete`);
      assert.equal(await page.evaluate("document.getElementById('otaStatSet').innerText"), "",
        `${viewport.name}/${locale}/settings/ota-error: terminal prose must leave the version row`);
      assert.equal(await page.evaluate(`(() => {
        const close = document.querySelector("#otaAlertSettings .ota-alert-close");
        close.focus();
        const observer = new MutationObserver(() => {});
        observer.observe(document.getElementById("otaAlertSettings"),
          { subtree: true, childList: true, attributes: true, characterData: true });
        renderApp();
        const mutations = observer.takeRecords().length;
        observer.disconnect();
        return mutations === 0 && document.activeElement === close &&
          document.querySelector("#otaAlertSettings .ota-alert-close") === close;
      })()`), true, `${viewport.name}/${locale}/settings/ota-error: repaint must preserve close focus`);
      await page.key("Enter", { code: "Enter", keyCode: 13 });
      await page.waitFor("document.getElementById('otaAlertDash').hidden && document.getElementById('otaAlertSettings').hidden");

      for (const modalId of routedModalIds) {
        const exerciseRoute = mutation === "history-flood" || locale === browserLocales[0];
        if (exerciseRoute) {
          routedKeyboardOpens++;
          routedKeyboardOpensInViewport++;
          assert.ok(routedKeyboardOpensInViewport <= routedModalIds.length,
            "real browser History transitions must stay bounded to one locale per viewport");
        } else {
          isolatedKeyboardOpens++;
        }
        await openModalWithKeyboard(page, modalId, modalTriggers[modalId],
          `${viewport.name}/${locale}/${modalId}`, { route: exerciseRoute });
        assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/${modalId}`);
        await assertAccessibility(page, `${viewport.name}/${locale}/${modalId}`, { nativeTree: true });
        await assertModalKeyboard(page, modalId, `${viewport.name}/${locale}/${modalId}`,
          { route: exerciseRoute });
      }

      // The OTA decision is deliberately transient rather than routed. Render the real skipped-dev
      // history in every shipped locale and viewport so a cumulative feed cannot silently turn the
      // modal into clipped, inaccessible or single-build-only output.
      await page.evaluate(`(() => {
        window.__browserOtaDecision = askOtaInstall({
          current: "1.0.3-dev.14", available: "1.0.3-dev.20", available_channel: "dev"
        }, ${JSON.stringify(cumulativeOtaNotes.join("\n"))}, false,
        document.getElementById("e32Chan"), "settings");
        return true;
      })()`);
      await page.waitFor(`(() => {
        const modal = document.getElementById("otaModal");
        return !modal.hidden && document.activeElement?.closest("#otaModal") !== null;
      })()`);
      assert.deepEqual(await page.evaluate(`(() => ({
        title: document.getElementById("otaModalTitle").textContent,
        expectedTitle: t("ota.dialog_title"),
        changesTitle: document.querySelector("#otaModal .ota-changes-title").textContent,
        expectedChangesTitle: t("ota.changes_title"),
        version: document.getElementById("otaVersionLine").textContent,
        notes: Array.from(document.querySelectorAll("#otaChanges li"), (item) => item.textContent),
        route: location.hash,
      }))()`), {
        title: await page.evaluate(`t("ota.dialog_title")`),
        expectedTitle: await page.evaluate(`t("ota.dialog_title")`),
        changesTitle: await page.evaluate(`t("ota.changes_title")`),
        expectedChangesTitle: await page.evaluate(`t("ota.changes_title")`),
        version: "v1.0.3-dev.14 → v1.0.3-dev.20",
        notes: cumulativeOtaNotes,
        route: "#settings",
      }, `${viewport.name}/${locale}/otaModal: complete skipped-build history must render literally`);
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/otaModal`);
      await assertAccessibility(page, `${viewport.name}/${locale}/otaModal`, { nativeTree: true });
      await page.key("Tab", { code: "Tab", keyCode: 9 });
      assert.equal(await page.evaluate(`document.activeElement?.closest("#otaModal") !== null`), true,
        `${viewport.name}/${locale}/otaModal: Tab must remain inside the transient decision`);
      await page.key("Escape", { code: "Escape", keyCode: 27 });
      await page.waitFor("document.getElementById('otaModal').hidden");
      assert.equal(await page.evaluate("window.__browserOtaDecision"), false,
        `${viewport.name}/${locale}/otaModal: Escape must resolve the OTA decision as cancel`);
      assert.equal(await page.evaluate("document.documentElement.classList.contains('modal-open')"),
        false, `${viewport.name}/${locale}/otaModal: Escape must release scroll lock`);

      await page.key("Escape", { code: "Escape", keyCode: 27 });
      await page.waitFor("document.getElementById('viewDash').classList.contains('active')");
      console.log(`browser render checked: ${viewport.name}/${locale}`);
    }
  }

  // Reduced-motion is CSS/media behavior rather than translated content, but exercise every locale
  // and viewport anyway. Dashboard, Settings, a real dialog, progress animation and disclosure
  // transitions cover each distinct motion mechanism without duplicating every same-class modal.
  await page.reducedMotion(true);
  for (const viewport of viewports) {
    await page.viewport(viewport.width, viewport.height);
    for (const locale of browserLocales) {
      await activateLocale(page, locale);
      await page.evaluate("showStage('dashboard'); true");
      await assertReducedMotion(page, `${viewport.name}/${locale}/dashboard/reduced-motion`);
      await page.evaluate("showStage('settings'); true");
      await assertReducedMotion(page, `${viewport.name}/${locale}/settings/reduced-motion`);
      await page.evaluate("openPopupForRoute('wifiModal'); true");
      await assertReducedMotion(page, `${viewport.name}/${locale}/wifiModal/reduced-motion`, { modal: true });
      await page.evaluate("closePopupForRoute('wifiModal'); true");
    }
  }
  await page.reducedMotion(false);

  assert.equal(routedKeyboardOpens, routedKeyboardBudget,
    "every routed modal requires one real browser History roundtrip per viewport");
  assert.equal(isolatedKeyboardOpens,
    viewports.length * (browserLocales.length - 1) * routedModalIds.length,
    "every remaining locale requires the route-isolated keyboard/modal lifecycle");
  assert.equal(nativeAltherma4Checks, viewports.length * browserLocales.length,
    "native Altherma 4 must render and open its rows in every shipped locale and viewport");
  assert.equal(hybridRoomChecks, viewports.length * browserLocales.length,
    "Hybrid room readings and their inspector must render in every shipped locale and viewport");

  assert.deepEqual(page.diagnostics, [], "real page must emit no console errors or uncaught exceptions");
  for (const viewport of viewports) await assertSetup(page, server, viewport);
  console.log(`browser render gate passed: ${browser.product}; ${browserLocales.length} locales; ` +
    `${viewports.length} viewports; native AX + keyboard on dashboard/settings/all routed modals; ` +
    "connected card tabs + single-row mobile swipe/wheel navigation + native pointer/keyboard selection; " +
    "native Altherma 4 numeric metadata + localized pointer-opened accordions; " +
    "Hybrid room source + pointer-opened inspector + honest absence; " +
    "bounded real History roundtrips; reduced motion on dashboard/settings/WiFi/progress/disclosures");
  }
} finally {
  try { await browser.close(); }
  finally { await server.close(); }
}
