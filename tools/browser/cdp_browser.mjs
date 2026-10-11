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

async function connectSocket(url, signal) {
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        signal.removeEventListener("abort", onAbort);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        if (error) reject(error); else resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(new Error("Chrome DevTools WebSocket failed"));
      const onAbort = () => finish(signal.reason);
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return socket;
  } catch (error) {
    // Ownership has not passed to launchBrowser yet. Its failure cleanup joins the owned
    // Chrome process, ending the peer even if the native socket is still CONNECTING.
    socket.addEventListener("error", () => {}, { once: true });
    try { socket.close(); } catch { /* already closed */ }
    throw error;
  }
}

async function devToolsEndpoint(child, signal) {
  return new Promise((resolve, reject) => {
    let output = "";
    const finish = (error, value) => {
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      child.off("exit", onExit);
      child.off("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value);
    };
    const inspect = (chunk) => {
      output = (output + chunk.toString()).slice(-16384);
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const onExit = (code, reason) => finish(new Error(`Chrome exited before DevTools was ready (${code ?? reason})\n${output}`));
    const onError = (error) => finish(error);
    const onAbort = () => finish(signal.reason);
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", onExit);
    child.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function childExited(child) {
  return child.pid === undefined || child.exitCode != null || child.signalCode != null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return true;
  return new Promise((resolve) => {
    let timer;
    const finish = (exited) => {
      if (timer) clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    // Do not miss an exit between the initial check and listener registration.
    if (childExited(child)) finish(true);
  });
}

export async function stopBrowser(child, { termTimeoutMs = 3000, killTimeoutMs = 3000 } = {}) {
  if (!childExited(child)) child.kill("SIGTERM");
  if (await waitForChildExit(child, termTimeoutMs)) return;
  if (!childExited(child)) child.kill("SIGKILL");
  if (!await waitForChildExit(child, killTimeoutMs)) {
    throw new Error("Chrome did not exit after SIGKILL");
  }
}

const RETRYABLE_PROFILE_ERRORS = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);

export async function removeBrowserProfile(profile, {
  remove = fs.rmSync,
  pause = delay,
  maxRetries = 20,
  retryDelayMs = 50,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      remove(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE_PROFILE_ERRORS.has(error?.code) || attempt >= maxRetries) throw error;
      await pause(retryDelayMs);
    }
  }
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function launchBrowser({ timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid Chrome launch deadline");
  const executable = findBrowser();
  if (!executable) throw new Error("no executable Chrome or Chromium browser found");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-gate-"));
  const child = spawn(executable, [
    "--headless=new",
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Chrome launch deadline exceeded")), timeoutMs);
  let closing;
  const close = () => {
    if (!closing) closing = (async () => {
      try {
        try { socket?.close(); } catch { /* already closed */ }
        await stopBrowser(child);
        await removeBrowserProfile(profile);
      } finally {
        process.off("SIGINT", onInt);
        process.off("SIGTERM", onTerm);
      }
    })();
    return closing;
  };
  const onSignal = (signal) => {
    controller.abort(new Error(`Chrome interrupted by ${signal}`));
    close().then(() => process.exit(signal === "SIGINT" ? 130 : 143), (error) => {
      console.error(`Chrome signal cleanup failed: ${error.message}`);
      process.exit(2);
    });
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const json = async (url) => {
    // The same absolute launch deadline covers response headers AND the complete JSON body.
    const response = await fetch(url, { signal: controller.signal });
    return response.json();
  };
  try {
    const browserWs = await devToolsEndpoint(child, controller.signal);
    const endpoint = new URL(browserWs);
    const listUrl = `http://${endpoint.host}/json/list`;
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      try {
        const targets = await json(listUrl);
        target = targets.find((item) => item.type === "page");
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        // The browser endpoint can precede creation of the initial page by a few milliseconds.
      }
      if (!target) await delay(25);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
    socket = await connectSocket(target.webSocketDebuggerUrl, controller.signal);
    const page = new CdpPage(socket);
    await abortable(page.enable(), controller.signal);
    const version = await json(`http://${endpoint.host}/json/version`);
    clearTimeout(timer);
    return {
      page,
      executable,
      product: version.Browser || "Chrome/Chromium",
      close,
    };
  } catch (error) {
    clearTimeout(timer);
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        "Browser launch failed and its temporary profile could not be cleaned up");
    }
    throw error;
  }
}
