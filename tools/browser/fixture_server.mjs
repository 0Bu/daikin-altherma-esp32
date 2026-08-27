import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

const STATUS = Object.freeze({
  version: "browser-gate",
  uptime_s: 86400,
  ui: { lang: "auto" },
  wifi: { connected: true, ssid: "Browser fixture", ip: "192.0.2.10", rssi: -54, std: "Wi-Fi 6" },
  mqtt: { configured: true, connected: true, broker: "mqtts://fixture.invalid:8883", has_creds: true,
    base: "daikin-altherma-esp32", base_custom: false },
  syslog: { configured: false },
  ntp: { server: "pool.ntp.org", synced: true },
  net: { eth: { present: false } },
  hp: { connected: true, last_poll_ms: 50, rx: 44, tx: 43 },
  profile: { id: "browser-fixture", name: "Browser fixture" },
  detect: { valid: true, model: "Daikin Altherma browser fixture", capacity_kw: 8,
    families: ["Altherma 3 R"], ou_eeprom: "012345" },
  sys: { free_heap: 155648, max_alloc: 90112, safe_mode: false },
  diagnostics: { enabled: false },
  reference_temperature: { configured: false },
  circulation_source: { configured: false },
  weather_forecast: { latitude: "", longitude: "" },
  modbus: { host: "", port: 502, unit_id: 1, enabled: false, connected: false },
  board: {
    preset_id: "seeed_xiao_esp32s3", preset_name: "Seeed XIAO ESP32-S3", user_set: true,
    presets: [
      { id: "seeed_xiao_esp32s3", name: "Seeed XIAO ESP32-S3", vendor: "seeed",
        led_gpio: 21, led_type: 0, led_inverted: true, btn_gpio: -1, btn_active_low: true },
      { id: "m5stack_atoms3_lite", name: "M5Stack AtomS3 Lite", vendor: "m5stack",
        led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true },
    ],
    pins_local: [1, 2, 5, 6, 21, 35, 41, 43, 44],
    rx: 44, tx: 43, channel: 0, led_gpio: 21, led_type: 0, led_inverted: true,
    btn_gpio: -1, btn_active_low: true,
  },
  env3: { supported: true, enabled: false, sda: -1, scl: -1, pins_avail: [1, 2, 5, 6] },
});

const VALUES = Object.freeze({ values: [
  { label: "I/U Operation Mode", value: "Heating", group: "Operation" },
  { label: "INV frequency", value: "42", unit: "rps", group: "Operation" },
  { label: "Water flow", value: "14.2", unit: "l/min", group: "Water circuit" },
  { label: "Leaving water temperature before BUH", value: "35.0", unit: "°C", group: "Water circuit" },
  { label: "Inlet water temperature", value: "30.0", unit: "°C", group: "Water circuit" },
  { label: "DHW tank temperature", value: "48.0", unit: "°C", group: "Domestic hot water" },
  { label: "DHW setpoint", value: "50.0", unit: "°C", group: "Domestic hot water" },
  { label: "Compressor running", value: "ON", group: "Operation" },
  { label: "Pump operation", value: "ON", group: "Operation" },
  { label: "Error code", value: "0", group: "Protection" },
] });

function send(response, status, type, body) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
}

export async function startFixtureServer({ pageFile, projectRoot }) {
  const html = fs.readFileSync(pageFile, "utf8");
  const localeDir = path.join(projectRoot, "main/www/locales");
  const icon = fs.readFileSync(path.join(projectRoot, "main/www/heat_pump_icon.png"));
  const favicon = fs.readFileSync(path.join(projectRoot, "main/www/favicon.ico"));

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html")
      return send(response, 200, "text/html; charset=utf-8", html);
    if (url.pathname === "/heat-pump-icon.png") return send(response, 200, "image/png", icon);
    if (url.pathname === "/favicon.ico") return send(response, 200, "image/x-icon", favicon);
    if (url.pathname === "/locale.js") {
      const lang = url.searchParams.get("lang") || "";
      if (!/^[a-z]{2}$/.test(lang)) return send(response, 400, "text/plain", "invalid locale");
      const file = path.join(localeDir, `${lang}.js`);
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile())
        return send(response, 404, "text/plain", "unknown locale");
      return send(response, 200, "text/javascript; charset=utf-8", fs.readFileSync(file));
    }
    if (url.pathname === "/status") {
      response.writeHead(200, JSON_HEADERS);
      return response.end(JSON.stringify(STATUS));
    }
    if (url.pathname === "/values") {
      response.writeHead(200, JSON_HEADERS);
      return response.end(JSON.stringify(VALUES));
    }
    if (url.pathname === "/ota/status") {
      response.writeHead(200, JSON_HEADERS);
      return response.end(JSON.stringify({ state: "idle", busy: false, current: STATUS.version }));
    }
    if (request.method === "POST") {
      response.writeHead(200, JSON_HEADERS);
      return response.end(JSON.stringify({ ok: true, saved: true, reboot: false }));
    }
    return send(response, 404, "text/plain; charset=utf-8", "fixture route not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
