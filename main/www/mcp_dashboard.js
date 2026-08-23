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

// The label a button must return to, the restore timer owed to it, and the latest copy attempt.
// The label is read ONCE per button, before any await can expose transient feedback to another
// click. The generation also makes overlapping clipboard promises latest-click-wins: an older
// success or rejection must not overwrite the result of a newer attempt that settled first.
// Keyed off the DOM node rather than a data- attribute so the page's markup stays unchanged.
const buttonRestore = new WeakMap();

async function copyTarget(button) {
  const target = byId(button.dataset.copy);
  if (!target) return;
  let restore = buttonRestore.get(button);
  if (!restore) {
    restore = { label: button.textContent, timer: 0, generation: 0 };
    buttonRestore.set(button, restore);
  }
  const generation = ++restore.generation;
  window.clearTimeout(restore.timer);
  restore.timer = 0;
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(target.textContent);
    } else {
      legacyCopy(target.textContent);
    }
    if (generation !== restore.generation) return;
    button.textContent = "Copied";
    button.classList.add("copied");
  } catch (_) {
    if (generation !== restore.generation) return;
    button.textContent = "Select and copy manually";
    button.classList.remove("copied");
  }
  restore.timer = window.setTimeout(() => {
    if (generation !== restore.generation) return;
    restore.timer = 0;
    button.textContent = restore.label;
    button.classList.remove("copied");
  }, 1600);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyTarget(button));
});

configureExamples();
