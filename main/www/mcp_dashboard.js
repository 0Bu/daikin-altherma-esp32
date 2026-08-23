"use strict";

const MCP_PROTOCOL = "2025-11-25";
const byId = (id) => document.getElementById(id);

function endpointUrl() {
  return `${location.origin}${location.pathname}`;
}

function configureExamples() {
  const endpoint = endpointUrl();
  byId("endpoint-url").textContent = endpoint;
  byId("client-json").textContent = JSON.stringify({
    mcpServers: {
      "daikin-altherma-esp32": {
        type: "http",
        url: endpoint,
      },
    },
  }, null, 2);
  byId("curl-example").textContent =
    `curl -sS '${endpoint}' \\\n` +
    "  -H 'Content-Type: application/json' \\\n" +
    `  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",` +
    `"params":{"protocolVersion":"${MCP_PROTOCOL}","capabilities":{},` +
    `"clientInfo":{"name":"curl","version":"1"}}}'`;
}

function legacyCopy(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy command was rejected");
}

// The label a button must return to, and the restore timer owed to it. Read ONCE per button, at the
// first click, and never again: the label is read before an await, so a second click landing inside
// the 1600 ms window would otherwise capture the transient "Copied" as the text to restore — and
// since the first timer was never cancelled, the two would fire in order and leave the button
// reading "Copied" for good. Keyed off the DOM node rather than a data- attribute so the page's
// markup stays the contract the test asserts on.
const buttonRestore = new WeakMap();

async function copyTarget(button) {
  const target = byId(button.dataset.copy);
  if (!target) return;
  let restore = buttonRestore.get(button);
  if (!restore) {
    restore = { label: button.textContent, timer: 0 };
    buttonRestore.set(button, restore);
  }
  window.clearTimeout(restore.timer);
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(target.textContent);
    } else {
      legacyCopy(target.textContent);
    }
    button.textContent = "Copied";
    button.classList.add("copied");
  } catch (_) {
    button.textContent = "Select and copy manually";
  }
  restore.timer = window.setTimeout(() => {
    button.textContent = restore.label;
    button.classList.remove("copied");
  }, 1600);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyTarget(button));
});

configureExamples();
