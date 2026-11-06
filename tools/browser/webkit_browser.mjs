import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The matching package and its browsers belong to the pinned test image, never the source tree
// or a maintainer's installed browser/profile. Linux is also required for direct helper invocations.
export async function launchWebKit({ viewport, allowedOrigin, timeoutMs = 30000 } = {}) {
  if (process.platform !== "linux")
    throw new Error("WebKit tests require the pinned Linux browser container; no native app is launched");
  const require = createRequire("/opt/daikin-browser/package.json");
  const { webkit, devices } = require("playwright");
  const descriptor = devices["iPad Pro 11"];
  assert.ok(descriptor?.isMobile && descriptor.hasTouch, "pinned Playwright must supply the iPad descriptor");
  assert.ok(viewport && Number.isInteger(viewport.width) && Number.isInteger(viewport.height),
    "WebKit requires an explicit iPad viewport");
  const browser = await webkit.launch({ headless: true, timeout: timeoutMs });
  let context;
  try {
    context = await browser.newContext({ ...descriptor, viewport,
      screen: viewport, locale: "en-US", reducedMotion: "no-preference", serviceWorkers: "block" });
    const diagnostics = [];
    await context.route("**/*", async route => {
      const request = route.request();
      if (new URL(request.url()).origin !== allowedOrigin || !["GET", "HEAD"].includes(request.method())) {
        diagnostics.push("WebKit attempted a non-read or unrelated-origin request: " + request.method() + " " + request.url());
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript(() => {
      window.__webkitTrusted = { touchstart: 0, touchend: 0, pointerdown: 0, pointerup: 0 };
      const seen = new WeakSet();
      const count = (name, event) => {
        if (!seen.has(event) && event.isTrusted &&
            (!name.startsWith("pointer") || event.pointerType === "touch")) {
          seen.add(event); window.__webkitTrusted[name]++;
        }
      };
      for (const name of Object.keys(window.__webkitTrusted))
        document.addEventListener(name, event => {
          count(name, event);
          // Pinning may replace the plot in its pointerup handler before WebKit emits touchend.
          // The native end still reaches its original detached target, but cannot bubble through
          // document. Observe that target directly as well, deduplicating the same native event.
          if (name === "touchstart" && event.isTrusted)
            event.target.addEventListener("touchend", end => count("touchend", end), { once: true, capture: true });
        }, true);
    });
    const native = await context.newPage();
    const touchDurations = [];
    native.on("pageerror", error => diagnostics.push("page exception: " + error.message));
    native.on("console", message => {
      if (["error", "assert"].includes(message.type())) diagnostics.push("console " + message.type() + ": " + message.text());
    });
    const page = {
      inputMode: "touch", diagnostics,
      evaluate: expression => native.evaluate(expression),
      async navigate(url) { await native.goto(url, { waitUntil: "load", timeout: timeoutMs }); },
      async waitFor(expression, { timeoutMs: waitMs = 10000, intervalMs = 40 } = {}) {
        const handle = await native.waitForFunction("Boolean(" + expression + ")", null,
          { timeout: waitMs, polling: intervalMs });
        await handle.dispose();
      },
      async frame() { await native.evaluate("document.documentElement.getBoundingClientRect().width"); },
      async bringToFront() { await native.bringToFront(); },
      async focusEmulation(enabled) { if (enabled) await native.bringToFront(); },
      async nativeClick(x, y) {
        const before = await native.evaluate("({...window.__webkitTrusted})");
        const started = performance.now();
        await native.touchscreen.tap(x, y);
        const after = await native.evaluate("({...window.__webkitTrusted})");
        // Include the trusted delivery witness, not just protocol acknowledgement.
        touchDurations.push(performance.now() - started);
        for (const type of Object.keys(before))
          assert.ok(after[type] > before[type], "WebKit native tap must deliver a trusted touch/pointer pair: " +
            type + "; " + JSON.stringify({ before, after }));
      },
      async nativeKey(type, key, code) {
        const name = code === "ShiftLeft" ? "Shift" : key;
        if (["rawKeyDown", "keyDown"].includes(type)) await native.keyboard.down(name);
        else if (type === "keyUp") await native.keyboard.up(name);
        else throw new Error("unknown native key event: " + type);
      },
      screenshotClip: clip => native.screenshot({ type: "png", clip, animations: "allow", caret: "hide", scale: "css" }),
      touchWitness: () => native.evaluate("({...window.__webkitTrusted})"),
      touchTimings: () => [...touchDurations],
    };
    let closing;
    return { page, product: "WebKit/" + browser.version(), descriptor: "iPad Pro 11",
      close() {
        closing ||= (async () => { try { await context.close(); } finally { await browser.close(); } })();
        return closing;
      } };
  } catch (error) {
    try { await context?.close(); } finally { await browser.close(); }
    throw error;
  }
}
