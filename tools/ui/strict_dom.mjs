// Strict HTML-derived DOM shim for Node/vm UI tests.
// Parses real element structure and IDs from main/www/index.html or main/www/setup.html and
// returns null for unknown IDs instead of auto-vivifying dummy elements.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00A0");
}

function escapeHtmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text) {
  return escapeHtmlText(text).replace(/"/g, "&quot;");
}

function toCamelCase(name) {
  return name.slice(5).replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function toKebabCase(name) {
  return `data-${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

export class StrictClassList {
  constructor(element) {
    this._el = element;
    this.names = new Set();
  }
  _sync() {
    if (this.names.size) this._el._attrs.set("class", [...this.names].join(" "));
    else this._el._attrs.delete("class");
  }
  _load(raw) {
    this.names = new Set(String(raw || "").trim().split(/\s+/).filter(Boolean));
  }
  add(...tokens) {
    for (const t of tokens) if (t) this.names.add(t);
    this._sync();
  }
  remove(...tokens) {
    for (const t of tokens) this.names.delete(t);
    this._sync();
  }
  contains(token) { return this.names.has(token); }
  toggle(token, force) {
    const on = force === undefined ? !this.names.has(token) : !!force;
    if (on) this.names.add(token);
    else this.names.delete(token);
    this._sync();
    return on;
  }
  toString() { return [...this.names].join(" "); }
}

function parseAttributes(rawAttrs) {
  const attrs = new Map();
  const rx = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of rawAttrs.matchAll(rx)) {
    const name = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs.set(name, decodeEntities(val));
  }
  return attrs;
}

function splitSelectorList(selector) {
  const parts = [];
  let depthBracket = 0;
  let depthParen = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote && selector[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "[") depthBracket++;
    else if (ch === "]" && depthBracket > 0) depthBracket--;
    else if (ch === "(") depthParen++;
    else if (ch === ")" && depthParen > 0) depthParen--;
    else if (ch === "," && depthBracket === 0 && depthParen === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = selector.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function splitCombinators(selector) {
  // Returns alternating [compound, combinator, compound, ...] where combinator is " " or ">".
  const tokens = [];
  let i = 0;
  while (i < selector.length) {
    while (i < selector.length && /\s/.test(selector[i])) i++;
    if (i >= selector.length) break;
    if (selector[i] === ">") {
      tokens.push(">");
      i++;
      continue;
    }
    let start = i;
    let depthB = 0;
    let depthP = 0;
    let quote = "";
    while (i < selector.length) {
      const ch = selector[i];
      if (quote) {
        if (ch === quote && selector[i - 1] !== "\\") quote = "";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
      if (ch === "[") depthB++;
      else if (ch === "]" && depthB > 0) depthB--;
      else if (ch === "(") depthP++;
      else if (ch === ")" && depthP > 0) depthP--;
      else if (depthB === 0 && depthP === 0 && (ch === ">" || /\s/.test(ch))) break;
      i++;
    }
    tokens.push(selector.slice(start, i));
    while (i < selector.length && /\s/.test(selector[i])) i++;
    if (i < selector.length && selector[i] === ">") {
      tokens.push(">");
      i++;
    } else if (i < selector.length) {
      tokens.push(" ");
    }
  }
  return tokens;
}

function matchCompound(el, compound, scopeRoot) {
  if (!el || el.nodeType !== 1) return false;
  let rest = compound;
  if (rest === ":scope") return el === scopeRoot;
  if (rest.startsWith(":scope")) {
    if (el !== scopeRoot) return false;
    rest = rest.slice(6);
  }
  const notClauses = [];
  rest = rest.replace(/:not\(([^()]+)\)/g, (_, inner) => {
    notClauses.push(inner.trim());
    return "";
  });
  for (const neg of notClauses) {
    if (matchCompound(el, neg, scopeRoot)) return false;
  }
  let attrOk = true;
  rest = rest.replace(/\[([^\]]+)\]/g, (_, body) => {
    const eq = body.indexOf("=");
    if (eq < 0) {
      const attr = body.trim().toLowerCase();
      if (!el.hasAttribute(attr)) attrOk = false;
    } else {
      const attr = body.slice(0, eq).trim().toLowerCase();
      let expected = body.slice(eq + 1).trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) ||
          (expected.startsWith("'") && expected.endsWith("'"))) {
        expected = expected.slice(1, -1);
      }
      if (el.getAttribute(attr) !== expected) attrOk = false;
    }
    return "";
  });
  if (!attrOk) return false;
  if (!rest) return true;

  const tagMatch = rest.match(/^[A-Za-z*][A-Za-z0-9_-]*/);
  if (tagMatch) {
    const tag = tagMatch[0].toLowerCase();
    if (tag !== "*" && el.tagName.toLowerCase() !== tag) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  for (const m of rest.matchAll(/([#.])([A-Za-z_:-][A-Za-z0-9_.:-]*)/g)) {
    if (m[1] === "#" && el.id !== m[2]) return false;
    if (m[1] === "." && !el.classList.contains(m[2])) return false;
  }
  const leftover = rest.replace(/([#.])([A-Za-z_:-][A-Za-z0-9_.:-]*)/g, "");
  return leftover === "";
}

function matchSingleSelector(el, selector, scopeRoot) {
  const parts = splitCombinators(selector);
  if (!parts.length) return false;
  if (!matchCompound(el, parts[parts.length - 1], scopeRoot)) return false;
  let cur = el;
  for (let i = parts.length - 2; i >= 1; i -= 2) {
    const comb = parts[i];
    const targetCompound = parts[i - 1];
    if (comb === ">") {
      cur = cur.parentNode;
      if (!cur || !matchCompound(cur, targetCompound, scopeRoot)) return false;
    } else {
      let anc = cur.parentNode;
      let matched = null;
      while (anc) {
        if (matchCompound(anc, targetCompound, scopeRoot)) { matched = anc; break; }
        anc = anc.parentNode;
      }
      if (!matched) return false;
      cur = matched;
    }
  }
  return true;
}

function serializeChildHtml(node) {
  if (node.nodeType === 3) return escapeHtmlText(node._value);
  if (node.nodeType !== 1) return "";
  return node.outerHTML;
}

function expandInsertNodes(nodes, doc) {
  const expanded = [];
  for (const n of nodes) {
    if (n == null) continue;
    if (typeof n === "string") {
      expanded.push(new StrictText(n, doc));
    } else if (n.nodeType === 11) {
      const moved = [...n.childNodes];
      n.childNodes.length = 0;
      for (const m of moved) {
        m.parentNode = null;
        expanded.push(m);
      }
    } else {
      expanded.push(n);
    }
  }
  return expanded;
}

function detachNode(node) {
  if (!node || !node.parentNode) return;
  const oldParent = node.parentNode;
  if (oldParent.isConnected && node.doc) node.doc._unregisterSubtreeDynamicIds(node);
  const idx = oldParent.childNodes.indexOf(node);
  if (idx >= 0) oldParent.childNodes.splice(idx, 1);
  node.parentNode = null;
}

export class StrictText {
  constructor(text, doc = null) {
    this.nodeType = 3;
    this.nodeName = "#text";
    this.doc = doc;
    this._value = String(text ?? "");
    this.parentNode = null;
  }
  get nodeValue() { return this._value; }
  set nodeValue(v) { this._value = String(v ?? ""); }
  get textContent() { return this._value; }
  set textContent(v) { this._value = String(v ?? ""); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return !!this.parentNode?.isConnected; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[idx + 1] : null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
  }
  remove() { detachNode(this); }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const expanded = expandInsertNodes(nodes, this.doc || parent.doc);
    const idx = parent.childNodes.indexOf(this);
    if (idx < 0) return;
    if (parent.isConnected && parent.doc) parent.doc._unregisterSubtreeDynamicIds(this);
    for (const n of expanded) detachNode(n);
    parent.childNodes.splice(idx, 1, ...expanded);
    this.parentNode = null;
    for (const n of expanded) {
      n.parentNode = parent;
      if (parent.isConnected && parent.doc && n.nodeType === 1) parent.doc._registerSubtreeDynamicIds(n);
    }
  }
  isEqualNode(other) {
    return !!other && other.nodeType === 3 && this._value === other._value;
  }
}

export class StrictFragment {
  constructor(doc) {
    this.nodeType = 11;
    this.nodeName = "#document-fragment";
    this.doc = doc;
    this.childNodes = [];
    this.parentNode = null;
  }
  get isConnected() { return false; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, refNode) {
    for (const n of expandInsertNodes([child], this.doc)) {
      detachNode(n);
      n.parentNode = this;
      if (!refNode) this.childNodes.push(n);
      else {
        const idx = this.childNodes.indexOf(refNode);
        if (idx >= 0) this.childNodes.splice(idx, 0, n);
        else this.childNodes.push(n);
      }
    }
    return child;
  }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    for (const n of expandInsertNodes(nodes, this.doc)) {
      detachNode(n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  append(...nodes) {
    for (const n of expandInsertNodes(nodes, this.doc)) this.appendChild(n);
  }
  querySelectorAll(selector) {
    const list = splitSelectorList(selector);
    const found = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (list.some((s) => matchSingleSelector(c, s, this))) found.push(c);
        walk(c);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export class StrictElement {
  constructor(tag, doc, id = "") {
    this.nodeType = 1;
    this.tagName = String(tag || "DIV").toUpperCase();
    this.doc = doc;
    this._id = id;
    this._attrs = new Map();
    if (id) this._attrs.set("id", id);
    this._value = "";
    this._checked = false;
    this._disabled = false;
    this._hidden = false;
    this._inert = false;
    this.childNodes = [];
    this.parentNode = null;
    if (this.tagName === "TEMPLATE") this.content = new StrictFragment(doc);
    this.classList = new StrictClassList(this);
    this.listeners = new Map();
    this.onclick = null;
    this.onsubmit = null;
    this.onchange = null;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    const styleProps = new Map();
    this.style = new Proxy({}, {
      get: (_, prop) => {
        if (prop === "setProperty") return (k, v) => styleProps.set(String(k), String(v));
        if (prop === "getPropertyValue") return (k) => styleProps.get(String(k)) || "";
        if (prop === "removeProperty") return (k) => styleProps.delete(String(k));
        return styleProps.get(String(prop)) ?? "";
      },
      set: (_, prop, val) => { styleProps.set(String(prop), String(val ?? "")); return true; },
    });
    this.dataset = new Proxy({}, {
      get: (_, prop) => {
        if (typeof prop !== "string") return undefined;
        return this._attrs.get(toKebabCase(prop));
      },
      set: (_, prop, val) => {
        if (typeof prop === "string") this._attrs.set(toKebabCase(prop), String(val));
        return true;
      },
      deleteProperty: (_, prop) => {
        if (typeof prop === "string") this._attrs.delete(toKebabCase(prop));
        return true;
      },
      ownKeys: () => [...this._attrs.keys()].filter((k) => k.startsWith("data-")).map(toCamelCase),
      getOwnPropertyDescriptor: (_, prop) => {
        if (typeof prop !== "string") return undefined;
        const k = toKebabCase(prop);
        return this._attrs.has(k)
          ? { enumerable: true, configurable: true, value: this._attrs.get(k) } : undefined;
      },
    });
  }

  get nodeName() { return this.tagName; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get attributes() {
    return [...this._attrs.entries()].map(([name, value]) => ({ name, value }));
  }

  get id() { return this._id; }
  set id(v) {
    const next = String(v ?? "");
    if (this._id && this.doc._dynamicById.get(this._id) === this) this.doc._dynamicById.delete(this._id);
    this._id = next;
    if (next) {
      this._attrs.set("id", next);
      if (this.isConnected) this.doc._dynamicById.set(next, this);
    } else {
      this._attrs.delete("id");
    }
  }

  get hidden() { return this._hidden; }
  set hidden(v) {
    this._hidden = !!v;
    if (this._hidden) this._attrs.set("hidden", "");
    else this._attrs.delete("hidden");
  }

  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = !!v;
    if (this._disabled) this._attrs.set("disabled", "");
    else this._attrs.delete("disabled");
  }

  get checked() { return this._checked; }
  set checked(v) {
    this._checked = !!v;
    if (this._checked) this._attrs.set("checked", "");
    else this._attrs.delete("checked");
  }

  get inert() { return this._inert; }
  set inert(v) {
    this._inert = !!v;
    if (this._inert) this._attrs.set("inert", "");
    else this._attrs.delete("inert");
  }

  get value() { return this._value; }
  set value(v) { this._value = String(v ?? ""); }

  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[idx + 1] : null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
  }

  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur === this.doc.documentElement || cur === this.doc.body) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  get textContent() {
    let out = "";
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }
  set textContent(val) {
    if (this.isConnected) {
      for (const c of this.children) this.doc._unregisterSubtreeDynamicIds(c);
    }
    this.childNodes = [];
    const text = String(val ?? "");
    if (text) {
      const node = new StrictText(text, this.doc);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  get innerHTML() {
    const host = this.tagName === "TEMPLATE" ? this.content : this;
    return host.childNodes.map(serializeChildHtml).join("");
  }
  set innerHTML(html) {
    const raw = String(html ?? "");
    if (this.tagName === "TEMPLATE") {
      for (const c of this.content.childNodes) c.parentNode = null;
      this.content.childNodes = [];
      if (raw) parseHtmlInto(raw, this.content, this.doc, false);
      return;
    }
    if (this.isConnected) {
      for (const c of this.children) this.doc._unregisterSubtreeDynamicIds(c);
    }
    this.childNodes = [];
    if (raw) parseHtmlInto(raw, this, this.doc, this.isConnected);
  }

  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrs = [...this._attrs.entries()]
      .map(([k, v]) => (v === "" && (k === "hidden" || k === "disabled" || k === "checked" || k === "inert" || k === "selected"))
        ? ` ${k}` : ` ${k}="${escapeHtmlAttr(v)}"`)
      .join("");
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    const val = String(value ?? "");
    this._attrs.set(key, val);
    if (key === "id") this.id = val;
    else if (key === "class") this.classList._load(val);
    else if (key === "hidden") this._hidden = true;
    else if (key === "disabled") this._disabled = true;
    else if (key === "checked") this._checked = true;
    else if (key === "inert") this._inert = true;
    else if (key === "value") this._value = val;
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this._attrs.has(key) ? this._attrs.get(key) : null;
  }

  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }

  removeAttribute(name) {
    const key = String(name).toLowerCase();
    this._attrs.delete(key);
    if (key === "hidden") this._hidden = false;
    else if (key === "disabled") this._disabled = false;
    else if (key === "checked") this._checked = false;
    else if (key === "inert") this._inert = false;
    else if (key === "class") this.classList._load("");
  }

  appendChild(child) {
    this.insertBefore(child, null);
    return child;
  }

  insertBefore(child, refNode) {
    for (const n of expandInsertNodes([child], this.doc)) {
      detachNode(n);
      n.parentNode = this;
      if (!refNode) {
        this.childNodes.push(n);
      } else {
        const idx = this.childNodes.indexOf(refNode);
        if (idx >= 0) this.childNodes.splice(idx, 0, n);
        else this.childNodes.push(n);
      }
      if (this.isConnected && n.nodeType === 1) this.doc._registerSubtreeDynamicIds(n);
    }
    return child;
  }

  prepend(...nodes) {
    const expanded = expandInsertNodes(nodes, this.doc);
    for (let i = expanded.length - 1; i >= 0; i--) {
      this.insertBefore(expanded[i], this.firstChild);
    }
  }

  append(...nodes) {
    for (const n of expandInsertNodes(nodes, this.doc)) {
      this.appendChild(n);
    }
  }

  replaceChildren(...nodes) {
    if (this.isConnected) {
      for (const c of this.children) this.doc._unregisterSubtreeDynamicIds(c);
    }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const expanded = expandInsertNodes(nodes, this.doc);
    const idx = parent.childNodes.indexOf(this);
    if (idx < 0) return;
    if (parent.isConnected) this.doc._unregisterSubtreeDynamicIds(this);
    for (const n of expanded) detachNode(n);
    parent.childNodes.splice(idx, 1, ...expanded);
    this.parentNode = null;
    for (const n of expanded) {
      n.parentNode = parent;
      if (parent.isConnected && n.nodeType === 1) this.doc._registerSubtreeDynamicIds(n);
    }
  }

  remove() {
    detachNode(this);
  }

  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  isEqualNode(other) {
    if (!other || other.nodeType !== 1 || this.nodeName !== other.nodeName) return false;
    if (this._attrs.size !== other._attrs.size) return false;
    for (const [k, v] of this._attrs) if (other._attrs.get(k) !== v) return false;
    if (this.childNodes.length !== other.childNodes.length) return false;
    return this.childNodes.every((c, i) => c.isEqualNode(other.childNodes[i]));
  }

  matches(selector) {
    return splitSelectorList(selector).some((s) => matchSingleSelector(this, s, this));
  }

  closest(selector) {
    const list = splitSelectorList(selector);
    let cur = this;
    while (cur) {
      if (cur.nodeType === 1 && list.some((s) => matchSingleSelector(cur, s, cur))) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const list = splitSelectorList(selector);
    const found = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (list.some((s) => matchSingleSelector(c, s, this))) found.push(c);
        walk(c);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, listener) {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  removeEventListener(type, listener) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  async fire(type, init = {}) {
    const event = {
      type,
      target: init.target || this,
      currentTarget: this,
      key: init.key,
      pointerId: 1,
      clientX: 0,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    if (type === "click" && typeof this.onclick === "function") await this.onclick(event);
    if (type === "submit" && typeof this.onsubmit === "function") await this.onsubmit(event);
    if (type === "change" && typeof this.onchange === "function") await this.onchange(event);
    return event;
  }

  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setPointerCapture() {}
  releasePointerCapture() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
  getBBox() { return { x: 0, y: 0, width: 40, height: 12 }; }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    const id = this._id ? `#${this._id}` : "";
    const cls = this.classList.names.size ? `.${[...this.classList.names].join(".")}` : "";
    return `<${this.tagName.toLowerCase()}${id}${cls}>`;
  }
}

function parseHtmlInto(html, rootParent, doc, registerDynamic) {
  const stack = [rootParent];
  const tokenRx = /<!--[\s\S]*?-->|<\/([A-Za-z][A-Za-z0-9:-]*)\s*>|<([A-Za-z][A-Za-z0-9:-]*)((?:\s+(?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))*)?)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(tokenRx)) {
    if (m[0].startsWith("<!--")) continue;
    const parent = stack[stack.length - 1];
    if (m[5] !== undefined) {
      if (parent && m[5]) {
        const text = decodeEntities(m[5]);
        if (text) {
          const tn = new StrictText(text, doc);
          tn.parentNode = parent;
          parent.childNodes.push(tn);
        }
      }
      continue;
    }
    if (m[1]) {
      const closeTag = m[1].toUpperCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === closeTag) {
          if (closeTag === "SELECT") {
            const sel = stack[i];
            const opt = sel.children.find((c) => c.tagName === "OPTION" && c.hasAttribute("selected"))
              || sel.children.find((c) => c.tagName === "OPTION");
            if (opt && !sel._value) sel._value = opt.hasAttribute("value") ? opt.getAttribute("value") : opt.textContent;
          }
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const tag = m[2];
    const rawAttrs = m[3] || "";
    const selfClose = m[4] === "/" || VOID_TAGS.has(tag.toLowerCase());
    const el = new StrictElement(tag, doc);
    for (const [k, v] of parseAttributes(rawAttrs)) el.setAttribute(k, v);
    el.parentNode = parent;
    parent.childNodes.push(el);
    if (el.id) {
      if (registerDynamic) doc._dynamicById.set(el.id, el);
      else if (parent.nodeType !== 11) doc._staticById.set(el.id, el);
    }
    if (!selfClose) {
      stack.push(el);
    }
  }
}

export class StrictDocument {
  constructor(htmlText, { dynamicIds = [] } = {}) {
    this._staticById = new Map();
    this._dynamicById = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.hidden = false;
    this.execCommand = () => true;
    this.documentElement = new StrictElement("html", this);
    this.body = new StrictElement("body", this);
    this.documentElement.appendChild(this.body);
    parseHtmlInto(htmlText.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ""), this.body, this, false);
    for (const id of dynamicIds) {
      const tag = id.startsWith("e32") ? "select" : "div";
      this._dynamicById.set(id, new StrictElement(tag, this, id));
    }
  }

  _registerSubtreeDynamicIds(node) {
    if (node.nodeType !== 1) return;
    if (node.id) this._dynamicById.set(node.id, node);
    for (const c of node.children) this._registerSubtreeDynamicIds(c);
  }

  _unregisterSubtreeDynamicIds(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.id && this._dynamicById.get(node.id) === node) this._dynamicById.delete(node.id);
    for (const c of node.children) this._unregisterSubtreeDynamicIds(c);
  }

  getElementById(id) {
    return this._staticById.get(id) || this._dynamicById.get(id) || null;
  }

  createElement(tag) {
    return new StrictElement(tag, this);
  }

  createElementNS(_ns, tag) {
    return new StrictElement(tag, this);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  addEventListener(type, listener) {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  removeEventListener(type, listener) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  async fire(type, init = {}) {
    const event = {
      type,
      target: init.target || this.activeElement || this.body,
      currentTarget: this,
      key: init.key,
      pointerId: 1,
      clientX: 0,
      preventDefault() {},
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    return event;
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `[StrictDocument static=${this._staticById.size} dynamic=${this._dynamicById.size}]`;
  }
}

export function createStrictDocument(htmlRelPath = "main/www/index.html", options = {}) {
  const fullPath = path.isAbsolute(htmlRelPath) ? htmlRelPath : path.join(ROOT, htmlRelPath);
  const html = fs.readFileSync(fullPath, "utf8");
  return new StrictDocument(html, options);
}
