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

async function copyTarget(button) {
  const target = byId(button.dataset.copy);
  if (!target) return;
  const original = button.textContent;
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
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copied");
  }, 1600);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyTarget(button));
});

configureExamples();
