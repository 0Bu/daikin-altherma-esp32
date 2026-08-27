import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../tools/browser/cdp_browser.mjs";
import { startFixtureServer } from "../tools/browser/fixture_server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageFile = process.env.DAIKIN_BROWSER_PAGE;
if (!pageFile || !fs.statSync(pageFile, { throwIfNoEntry: false })?.isFile())
  throw new Error("DAIKIN_BROWSER_PAGE must name the production-marker-assembled dashboard page");

const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
if (mutation && ![
  "root-overflow", "modal-focus-delay", "history-flood", "route-isolation-bypass",
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
    if (rect.left < -1 || rect.right > innerWidth + 1) outside.push(describe(el));
  }
  const clipped = [];
  const candidates = document.querySelectorAll(
    "button, [role=button], [role=dialog], .field-label, .field-help, .hint, .section-label, " +
    ".hdr-title, .hdr-name, .conn-label, .conn-value, .vrow-label, .vrow-val"
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
      window.addEventListener("popstate", () => {
        window.__browserPopstateSettled = true;
      }, { once: true });
      return true;
    })()`);
  }
  await page.key("Escape", { code: "Escape", keyCode: 27 });
  await page.waitFor(`document.getElementById(${JSON.stringify(modalId)}).hidden &&
    location.hash === "#settings" && ${route ? "window.__browserPopstateSettled === true" : "true"}`);
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

const server = await startFixtureServer({ pageFile, projectRoot: ROOT });
const browser = await launchBrowser();
try {
  const { page } = browser;
  await page.navigate(server.url);
  try {
    await page.waitFor("typeof S !== 'undefined' && S.status && Array.isArray(S._values) && document.querySelector('#settingsCards .vgroup')");
  } catch (error) {
    const state = await page.evaluate(`({ ready: document.readyState, title: document.title,
      hasApp: typeof S !== "undefined", hasStatus: typeof S !== "undefined" && !!S.status,
      body: document.body?.innerText?.slice(0, 120) || "" })`);
    throw new Error(`${error.message}; state=${JSON.stringify(state)}; diagnostics=${page.diagnostics.join(" | ")}`);
  }
  await page.evaluate("pollStop(); true");

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

  const viewports = [{ name: "phone", width: 320, height: 760 },
                     { name: "desktop", width: 1200, height: 900 }];
  const cumulativeOtaNotes = [
    "v1.0.3-dev.15 — Hard-reset ESP32-S3 after serial flash",
    "v1.0.3-dev.17 — Fix OTA stress HTTP handoff",
    "v1.0.3-dev.18 — Maintenance and reliability improvements.",
    "v1.0.3-dev.19 — Preserve legacy bench restore compatibility",
    "v1.0.3-dev.20 — Accept exact legacy writer evidence",
  ];

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
  for (const viewport of viewports) {
    let routedKeyboardOpensInViewport = 0;
    await page.viewport(viewport.width, viewport.height);
    for (const locale of browserLocales) {
      await activateLocale(page, locale);
      await page.evaluate("showStage('dashboard'); window.scrollTo(0, 0); true");
      await page.frame();
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/dashboard`);
      await assertAccessibility(page, `${viewport.name}/${locale}/dashboard`, { nativeTree: true });

      await page.evaluate("document.getElementById('btnSettings').focus(); true");
      await page.key("Enter", { code: "Enter", keyCode: 13 });
      await page.waitFor("document.getElementById('viewSettings').classList.contains('active')");
      assertLayout(await page.evaluate(layoutAudit), `${viewport.name}/${locale}/settings`);
      await assertAccessibility(page, `${viewport.name}/${locale}/settings`, { nativeTree: true });

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

  assert.deepEqual(page.diagnostics, [], "real page must emit no console errors or uncaught exceptions");
  console.log(`browser render gate passed: ${browser.product}; ${browserLocales.length} locales; ` +
    `${viewports.length} viewports; native AX + keyboard on dashboard/settings/all routed modals; ` +
    "bounded real History roundtrips; reduced motion on dashboard/settings/WiFi/progress/disclosures");
  }
} finally {
  await browser.close();
  await server.close();
}
