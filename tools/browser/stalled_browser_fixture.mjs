import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";

const mode = process.env.DAIKIN_BROWSER_STALL_MODE;
const marker = process.env.DAIKIN_BROWSER_STALL_MARKER;
const profile = process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1];
const record = { pid: process.pid, parentPid: process.ppid, profile, versionReached: false,
  stallReached: null, enabled: [] };
const save = () => {
  fs.writeFileSync(marker + ".next", JSON.stringify(record));
  fs.renameSync(marker + ".next", marker);
};
save();
const stall = (response, prefix) => {
  if (prefix) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write(prefix);
  }
};
let port;
const server = http.createServer((request, response) => {
  if (request.url === "/json/list") {
    if (mode === "list-headers" || mode === "list-body") {
      stall(response, mode === "list-body" ? "[" : "");
      record.stallReached = mode;
      save();
    } else {
      response.end(JSON.stringify([{ type: "page", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/page` }]));
    }
  } else if (request.url === "/json/version") {
    record.versionReached = true;
    stall(response, mode === "version-body" ? "{" : "");
    record.stallReached = mode;
    save();
  }
});
server.on("upgrade", (request, socket) => {
  if (mode === "socket") {
    record.stallReached = mode;
    save();
    return; // Hold the actual TCP upgrade without responding.
  }
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] +
    "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
    `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buffered = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      let length = buffered[1] & 127;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      }
      const masked = (buffered[1] & 128) !== 0;
      const bodyOffset = offset + (masked ? 4 : 0);
      if (buffered.length < bodyOffset + length) return;
      const opcode = buffered[0] & 15;
      const body = Buffer.from(buffered.subarray(bodyOffset, bodyOffset + length));
      if (masked) for (let i = 0; i < body.length; i++) body[i] ^= buffered[offset + i % 4];
      buffered = buffered.subarray(bodyOffset + length);
      if (opcode === 8) { socket.end(); return; }
      if (opcode !== 1) continue;
      const { id, method } = JSON.parse(body.toString());
      record.enabled.push(method);
      save();
      const reply = Buffer.from(JSON.stringify({ id, result: {} }));
      socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
    }
  });
});
const startupDelay = Number(process.env.DAIKIN_BROWSER_STALL_STARTUP_DELAY_MS || 0);
if (!Number.isInteger(startupDelay) || startupDelay < 0 || startupDelay > 2000)
  throw new Error("invalid fixture startup delay");
setTimeout(() => server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  record.port = port;
  save();
  const announce = () => {
    if (process.env.DAIKIN_BROWSER_STALL_HOLD_ENDPOINT === "1" && !fs.existsSync(marker + ".release")) {
      setTimeout(announce, 10);
      return;
    }
    console.error(`DevTools listening on ws://127.0.0.1:${port}/browser`);
  };
  announce();
}), startupDelay);
