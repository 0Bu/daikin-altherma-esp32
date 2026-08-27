import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBrowser } from "./find_browser.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.diagnostics = [];
    socket.addEventListener("message", (event) => this.#message(event));
    socket.addEventListener("close", () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  #message(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails || {};
      this.diagnostics.push(`page exception: ${details.exception?.description || details.text || "unknown"}`);
    } else if (message.method === "Runtime.consoleAPICalled" &&
               ["error", "assert"].includes(message.params?.type)) {
      const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
      this.diagnostics.push(`console ${message.params.type}: ${text}`);
    } else if (message.method === "Log.entryAdded" &&
               ["error"].includes(message.params?.entry?.level)) {
      this.diagnostics.push(`page log: ${message.params.entry.text}`);
    }

    const waiters = this.waiters.get(message.method);
    if (!waiters?.length) return;
    this.waiters.delete(message.method);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
    }
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for CDP command ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const list = this.waiters.get(method) || [];
        this.waiters.set(method, list.filter((item) => item !== waiter));
        reject(new Error(`timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const list = this.waiters.get(method) || [];
      list.push(waiter);
      this.waiters.set(method, list);
    });
  }

  async enable() {
    await Promise.all([
      this.send("Page.enable"),
      this.send("Runtime.enable"),
      this.send("Log.enable"),
      this.send("Accessibility.enable"),
    ]);
  }

  async navigate(url) {
    const loaded = this.once("Page.loadEventFired");
    const result = await this.send("Page.navigate", { url });
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
    await loaded;
    await this.frame();
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description || details.text || "browser evaluation failed");
    }
    return result.result?.value;
  }

  async waitFor(expression, { timeoutMs = 10000, intervalMs = 40 } = {}) {
    const end = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < end) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return;
      } catch (error) {
        lastError = error.message;
      }
      await delay(intervalMs);
    }
    throw new Error(`browser condition timed out: ${expression}${lastError ? ` (${lastError})` : ""}`);
  }

  async frame() {
    // Reading layout through CDP flushes pending style/layout work even when headless Chrome decides
    // to throttle requestAnimationFrame for an unfocused target. A double-rAF wait can otherwise
    // hang forever after a long matrix run despite the DOM already being fully rendered.
    await this.send("Page.getLayoutMetrics");
    await delay(5);
  }

  async viewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 480,
      screenWidth: width,
      screenHeight: height,
    });
    await this.frame();
  }

  async reducedMotion(reduce) {
    await this.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
    });
    await this.frame();
  }

  async key(key, { code = key, keyCode = 0 } = {}) {
    const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    const text = key === "Enter" ? "\r" : key === " " ? " " : "";
    await this.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...common,
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    await this.frame();
  }

  async accessibilityTree() {
    const { nodes = [] } = await this.send("Accessibility.getFullAXTree", { depth: -1 });
    return nodes;
  }

  clearDiagnostics() {
    this.diagnostics.length = 0;
  }
}

async function connectSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out connecting to Chrome DevTools")), 10000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed")); }, { once: true });
  });
  return socket;
}

async function devToolsEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools\n${output}`)), 15000);
    const inspect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready (${code ?? signal})\n${output}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function launchBrowser() {
  const executable = findBrowser();
  if (!executable) throw new Error("no executable Chrome or Chromium browser found");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-gate-"));
  const child = spawn(executable, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--disable-gpu",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--window-size=1200,900",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let socket;
  try {
    const browserWs = await devToolsEndpoint(child);
    const endpoint = new URL(browserWs);
    const listUrl = `http://${endpoint.host}/json/list`;
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      try {
        const targets = await (await fetch(listUrl)).json();
        target = targets.find((item) => item.type === "page");
      } catch {
        // The browser endpoint can precede creation of the initial page by a few milliseconds.
      }
      if (!target) await delay(25);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
    socket = await connectSocket(target.webSocketDebuggerUrl);
    const page = new CdpPage(socket);
    await page.enable();
    const version = await (await fetch(`http://${endpoint.host}/json/version`)).json();
    return {
      page,
      executable,
      product: version.Browser || "Chrome/Chromium",
      async close() {
        try { socket.close(); } catch { /* already closed */ }
        if (child.exitCode == null) child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(3000).then(() => { if (child.exitCode == null) child.kill("SIGKILL"); }),
        ]);
        fs.rmSync(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    try { socket?.close(); } catch { /* best effort */ }
    if (child.exitCode == null) child.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}
