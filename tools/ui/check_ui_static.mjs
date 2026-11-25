// Zero-dependency static UI audit gate for daikin-altherma-esp32.
// Checks:
//   1. JS lexical scope / no-undef across app.sources, locales/*.js, setup.html <script>,
//      and mcp_dashboard.js, plus unused top-level function declarations in app.sources.
//   2. Global DOM-ID cross-check across HTML markup and JS DOM queries.
//   3. Global i18n key check: HTML data-i18n* and JS t(...) vs I18N.en, and zero dead I18N.en keys.
//   4. CSS custom property check: every var(--name) has a matching --name declaration in scope.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLineStarts, lineColFromStarts, parseJavaScript, SourceMapper } from "./js_ast.mjs";
import { appSourceFiles } from "./read_app_source.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Tight explicit ECMAScript + Web/DOM globals allowlist for classic browser scripts.
export const BROWSER_GLOBALS = new Set([
  "Array", "ArrayBuffer", "Boolean", "DataView", "Date", "Error", "EvalError",
  "Float32Array", "Float64Array", "Function", "Infinity", "Int8Array", "Int16Array",
  "Int32Array", "Intl", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise",
  "Proxy", "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "String",
  "Symbol", "SyntaxError", "TypeError", "URIError", "Uint8Array", "Uint8ClampedArray",
  "Uint16Array", "Uint32Array", "WeakMap", "WeakSet", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "globalThis", "isFinite", "isNaN", "parseFloat",
  "parseInt", "undefined", "structuredClone",
  "AbortController", "AbortSignal", "Blob", "CSS", "CustomEvent", "DOMException",
  "DOMParser", "DOMPoint", "Document", "Element", "Event", "File", "FileReader", "FormData",
  "Headers", "HTMLElement", "HTMLInputElement", "History", "IntersectionObserver",
  "KeyboardEvent", "Location", "MutationObserver", "Navigator", "Node", "NodeList",
  "Performance", "PointerEvent", "Request", "ResizeObserver", "Response", "SVGElement",
  "Storage", "TextDecoder", "TextEncoder", "TouchEvent", "URL", "URLSearchParams",
  "Window", "XMLHttpRequest",
  "alert", "atob", "btoa", "cancelAnimationFrame", "clearInterval", "clearTimeout",
  "confirm", "console", "crypto", "document", "fetch", "getComputedStyle", "history",
  "localStorage", "location", "matchMedia", "navigator", "performance", "prompt",
  "queueMicrotask", "requestAnimationFrame", "screen", "self", "sessionStorage",
  "setInterval", "setTimeout", "window",
]);

class Scope {
  constructor(kind, parent = null) {
    this.kind = kind; // "script" | "function" | "block"
    this.parent = parent;
    this.bindings = new Set();
  }

  has(name) {
    if (this.bindings.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  nearestVarScope() {
    let cur = this;
    while (cur && cur.kind === "block") cur = cur.parent;
    return cur || this;
  }
}

function collectPatternBindings(pattern, targetSet) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      targetSet.add(pattern.name);
      break;
    case "RestElement":
      collectPatternBindings(pattern.argument, targetSet);
      break;
    case "AssignmentPattern":
      collectPatternBindings(pattern.left, targetSet);
      break;
    case "ArrayPattern":
      for (const el of pattern.elements) collectPatternBindings(el, targetSet);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") collectPatternBindings(prop.argument, targetSet);
        else collectPatternBindings(prop.value, targetSet);
      }
      break;
  }
}

function hoistDeclarationsInBody(nodes, varScope, blockScope, skipBlockBody = false) {
  const visit = (node, inNestedBlock) => {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "VariableDeclaration":
        if (node.kind === "var") {
          for (const d of node.declarations) collectPatternBindings(d.id, varScope.bindings);
        } else if (!inNestedBlock) {
          for (const d of node.declarations) collectPatternBindings(d.id, blockScope.bindings);
        }
        return;
      case "FunctionDeclaration":
        if (!inNestedBlock) {
          if (varScope === blockScope) varScope.bindings.add(node.id.name);
          else blockScope.bindings.add(node.id.name);
        }
        return;
      case "ClassDeclaration":
        if (!inNestedBlock && node.id) blockScope.bindings.add(node.id.name);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassExpression":
        return;
      case "BlockStatement":
        if (skipBlockBody && inNestedBlock) return;
        for (const stmt of node.body) visit(stmt, true);
        return;
      case "IfStatement":
        visit(node.consequent, true);
        visit(node.alternate, true);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
      case "WithStatement":
      case "LabeledStatement":
        visit(node.body, true);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        if (node.init?.type === "VariableDeclaration" && node.init.kind === "var") visit(node.init, true);
        if (node.left?.type === "VariableDeclaration" && node.left.kind === "var") visit(node.left, true);
        visit(node.body, true);
        return;
      case "SwitchStatement":
        for (const c of node.cases) for (const stmt of c.consequent) visit(stmt, true);
        return;
      case "TryStatement":
        visit(node.block, true);
        if (node.handler) visit(node.handler.body, true);
        if (node.finalizer) visit(node.finalizer, true);
        return;
    }
  };
  for (const stmt of nodes) visit(stmt, false);
}

/**
 * Analyze lexical scopes of a parsed AST.
 * Returns `{ undefErrors, topLevelFns, externalRefs, allRefs }` where `externalRefs` records
 * references outside the declaration's own top-level function body.
 */
export function analyzeProgramScopes(ast, mapper, extraGlobals = new Set()) {
  const scriptScope = new Scope("script", null);
  for (const g of BROWSER_GLOBALS) scriptScope.bindings.add(g);
  for (const g of extraGlobals) scriptScope.bindings.add(g);

  const topLevelFns = new Map(); // name -> { node, file }
  const undefErrors = [];
  const referencedTopLevel = new Set();

  hoistDeclarationsInBody(ast.body, scriptScope, scriptScope, true);
  for (const stmt of ast.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      topLevelFns.set(stmt.id.name, stmt);
    }
  }

  let currentTopFnName = null;

  function recordRef(idNode, scope) {
    if (!scope.has(idNode.name)) {
      undefErrors.push(`${mapper.format(idNode.start)}: undeclared identifier '${idNode.name}'`);
      return;
    }
    if (topLevelFns.has(idNode.name) && currentTopFnName !== idNode.name) {
      referencedTopLevel.add(idNode.name);
    }
  }

  function visitPatternDefaults(pattern, scope) {
    if (!pattern) return;
    switch (pattern.type) {
      case "AssignmentPattern":
        visitPatternDefaults(pattern.left, scope);
        visitNode(pattern.right, scope);
        break;
      case "RestElement":
        visitPatternDefaults(pattern.argument, scope);
        break;
      case "ArrayPattern":
        for (const el of pattern.elements) visitPatternDefaults(el, scope);
        break;
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") {
            visitPatternDefaults(prop.argument, scope);
          } else {
            if (prop.computed) visitNode(prop.key, scope);
            visitPatternDefaults(prop.value, scope);
          }
        }
        break;
    }
  }

  function visitAssignmentTarget(target, scope) {
    if (!target) return;
    switch (target.type) {
      case "Identifier":
        recordRef(target, scope);
        break;
      case "MemberExpression":
        visitNode(target, scope);
        break;
      case "RestElement":
        visitAssignmentTarget(target.argument, scope);
        break;
      case "AssignmentPattern":
        visitAssignmentTarget(target.left, scope);
        visitNode(target.right, scope);
        break;
      case "ArrayPattern":
        for (const el of target.elements) visitAssignmentTarget(el, scope);
        break;
      case "ObjectPattern":
        for (const prop of target.properties) {
          if (prop.type === "RestElement") visitAssignmentTarget(prop.argument, scope);
          else {
            if (prop.computed) visitNode(prop.key, scope);
            visitAssignmentTarget(prop.value, scope);
          }
        }
        break;
    }
  }

  function visitFunction(node, outerScope, isTopLevel = false) {
    const fnName = isTopLevel && node.id ? node.id.name : null;
    const prevTopFn = currentTopFnName;
    if (fnName) currentTopFnName = fnName;

    let paramParent = outerScope;
    if (node.type === "FunctionExpression" && node.id) {
      paramParent = new Scope("block", outerScope);
      paramParent.bindings.add(node.id.name);
    }
    const paramScope = new Scope("function", paramParent);
    if (node.type !== "ArrowFunctionExpression") paramScope.bindings.add("arguments");
    for (const p of node.params) {
      collectPatternBindings(p, paramScope.bindings);
      visitPatternDefaults(p, paramScope);
    }
    if (node.body.type === "BlockStatement") {
      const bodyScope = new Scope("function", paramScope);
      hoistDeclarationsInBody(node.body.body, bodyScope, bodyScope, true);
      for (const stmt of node.body.body) visitNode(stmt, bodyScope);
    } else {
      visitNode(node.body, paramScope);
    }

    currentTopFnName = prevTopFn;
  }

  function visitClass(node, outerScope) {
    if (node.superClass) visitNode(node.superClass, outerScope);
    let bodyParent = outerScope;
    if (node.type === "ClassExpression" && node.id) {
      bodyParent = new Scope("block", outerScope);
      bodyParent.bindings.add(node.id.name);
    }
    for (const elem of node.body) {
      if (elem.type === "StaticBlock") {
        const sbScope = new Scope("function", bodyParent);
        hoistDeclarationsInBody(elem.body, sbScope, sbScope, true);
        for (const stmt of elem.body) visitNode(stmt, sbScope);
      } else {
        if (elem.computed) visitNode(elem.key, bodyParent);
        if (elem.type === "MethodDefinition") visitFunction(elem.value, bodyParent, false);
        else if (elem.value) {
          const fieldScope = new Scope("function", bodyParent);
          visitNode(elem.value, fieldScope);
        }
      }
    }
  }

  function visitNode(node, scope, topLevel = false) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "Program":
        for (const stmt of node.body) visitNode(stmt, scope, true);
        break;
      case "BlockStatement": {
        const bScope = new Scope("block", scope);
        hoistDeclarationsInBody(node.body, bScope.nearestVarScope(), bScope, true);
        for (const stmt of node.body) visitNode(stmt, bScope);
        break;
      }
      case "VariableDeclaration":
        for (const d of node.declarations) {
          visitPatternDefaults(d.id, scope);
          if (d.init) visitNode(d.init, scope);
        }
        break;
      case "FunctionDeclaration":
        visitFunction(node, scope, topLevel);
        break;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunction(node, scope, false);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        visitClass(node, scope);
        break;
      case "ExpressionStatement":
        visitNode(node.expression, scope);
        break;
      case "IfStatement":
        visitNode(node.test, scope);
        visitNode(node.consequent, scope);
        visitNode(node.alternate, scope);
        break;
      case "WhileStatement":
        visitNode(node.test, scope);
        visitNode(node.body, scope);
        break;
      case "DoWhileStatement":
        visitNode(node.body, scope);
        visitNode(node.test, scope);
        break;
      case "ForStatement": {
        const fScope = new Scope("block", scope);
        if (node.init?.type === "VariableDeclaration") {
          if (node.init.kind !== "var") {
            for (const d of node.init.declarations) collectPatternBindings(d.id, fScope.bindings);
          }
          visitNode(node.init, fScope);
        } else if (node.init) {
          visitNode(node.init, fScope);
        }
        if (node.test) visitNode(node.test, fScope);
        if (node.update) visitNode(node.update, fScope);
        visitNode(node.body, fScope);
        break;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const fScope = new Scope("block", scope);
        if (node.left.type === "VariableDeclaration") {
          if (node.left.kind !== "var") {
            for (const d of node.left.declarations) collectPatternBindings(d.id, fScope.bindings);
          }
          visitPatternDefaults(node.left.declarations[0]?.id, fScope);
        } else {
          visitAssignmentTarget(node.left, fScope);
        }
        visitNode(node.right, fScope);
        visitNode(node.body, fScope);
        break;
      }
      case "SwitchStatement": {
        visitNode(node.discriminant, scope);
        const sScope = new Scope("block", scope);
        const caseStmts = node.cases.flatMap((c) => c.consequent);
        hoistDeclarationsInBody(caseStmts, sScope.nearestVarScope(), sScope, true);
        for (const c of node.cases) {
          if (c.test) visitNode(c.test, sScope);
          for (const stmt of c.consequent) visitNode(stmt, sScope);
        }
        break;
      }
      case "TryStatement":
        visitNode(node.block, scope);
        if (node.handler) {
          const cScope = new Scope("block", scope);
          if (node.handler.param) {
            collectPatternBindings(node.handler.param, cScope.bindings);
            visitPatternDefaults(node.handler.param, cScope);
          }
          hoistDeclarationsInBody(node.handler.body.body, cScope.nearestVarScope(), cScope, true);
          for (const stmt of node.handler.body.body) visitNode(stmt, cScope);
        }
        if (node.finalizer) visitNode(node.finalizer, scope);
        break;
      case "ReturnStatement":
      case "ThrowStatement":
        if (node.argument) visitNode(node.argument, scope);
        break;
      case "LabeledStatement":
        visitNode(node.body, scope);
        break;
      case "WithStatement":
        visitNode(node.object, scope);
        visitNode(node.body, scope);
        break;
      case "EmptyStatement":
      case "DebuggerStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "ThisExpression":
      case "Super":
      case "Literal":
      case "MetaProperty":
        break;
      case "Identifier":
        recordRef(node, scope);
        break;
      case "ParenthesizedExpression":
        visitNode(node.expression, scope);
        break;
      case "SequenceExpression":
        for (const expr of node.expressions) visitNode(expr, scope);
        break;
      case "AssignmentExpression":
        if (node.operator === "=") visitAssignmentTarget(node.left, scope);
        else visitNode(node.left, scope);
        visitNode(node.right, scope);
        break;
      case "ConditionalExpression":
        visitNode(node.test, scope);
        visitNode(node.consequent, scope);
        visitNode(node.alternate, scope);
        break;
      case "BinaryExpression":
      case "LogicalExpression":
        visitNode(node.left, scope);
        visitNode(node.right, scope);
        break;
      case "UnaryExpression":
      case "UpdateExpression":
      case "AwaitExpression":
      case "YieldExpression":
      case "SpreadElement":
        if (node.argument) visitNode(node.argument, scope);
        break;
      case "ImportExpression":
        visitNode(node.source, scope);
        break;
      case "CallExpression":
      case "NewExpression":
        visitNode(node.callee, scope);
        for (const arg of node.arguments) visitNode(arg, scope);
        break;
      case "MemberExpression":
        visitNode(node.object, scope);
        if (node.computed) visitNode(node.property, scope);
        break;
      case "TaggedTemplateExpression":
        visitNode(node.tag, scope);
        visitNode(node.quasi, scope);
        break;
      case "TemplateLiteral":
        for (const expr of node.expressions) visitNode(expr, scope);
        break;
      case "ArrayExpression":
        for (const el of node.elements) if (el) visitNode(el, scope);
        break;
      case "ObjectExpression":
        for (const prop of node.properties) {
          if (prop.type === "SpreadElement") visitNode(prop.argument, scope);
          else {
            if (prop.computed) visitNode(prop.key, scope);
            visitNode(prop.value, scope);
          }
        }
        break;
      default:
        throw new Error(`unhandled AST node in scope walk: ${node.type}`);
    }
  }

  visitNode(ast, scriptScope, true);
  return { undefErrors, topLevelFns, referencedTopLevel, scriptBindings: scriptScope.bindings };
}

function walkAst(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visitor);
    return;
  }
  if (!node.type) return;
  visitor(node);
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" || k === "start" || k === "end") continue;
    if (v && typeof v === "object") walkAst(v, visitor);
  }
}

function extractInlineScriptsAndHandlers(htmlText, relPath) {
  const scripts = [];
  const handlers = [];
  const cleanHtml = stripHtmlComments(htmlText);
  for (const m of cleanHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const prefix = htmlText.slice(0, m.index + m[0].indexOf(">") + 1);
    const baseLine = prefix.split("\n").length;
    scripts.push({ file: relPath, content: m[1], baseLine });
  }
  for (const m of cleanHtml.matchAll(/\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    handlers.push(m[1] ?? m[2] ?? "");
  }
  return { scripts, handlers };
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function extractSelectorIds(selectorText) {
  const ids = [];
  // Strip bracketed attribute selectors like [data-x="#notAnId"] before matching #id tokens.
  const withoutAttrs = selectorText.replace(/\[[^\]]*\]/g, " ");
  for (const m of withoutAttrs.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    ids.push(m[1]);
  }
  return ids;
}

function extractStaticHtmlIds(htmlText) {
  const clean = stripHtmlComments(htmlText);
  const ids = new Set();
  for (const m of clean.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g)) {
    ids.add(m[1] ?? m[2]);
  }
  return ids;
}

// Documented GIF-recorder / browser-harness entry point (tools/uigif/scenes.js).
const INTENTIONAL_UI_GLOBALS = new Set(["pollStop"]);

function extractDynamicJsIds(ast) {
  const ids = new Set();
  const collectText = (text) => {
    for (const m of text.matchAll(/\bid\s*=\s*(?:"([^"$\s]+)"|'([^'$\s]+)')/g)) {
      ids.add(m[1] ?? m[2]);
    }
  };
  walkAst(ast, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") collectText(node.value);
    else if (node.type === "TemplateLiteral") {
      for (const q of node.quasis) if (q.value) collectText(q.value);
    }
  });

  // Track functions whose HTML templates bind id="${param}" and resolve literal IDs passed to them.
  const fnDefs = new Map();
  walkAst(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) {
      fnDefs.set(node.id.name, node);
    } else if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" &&
        (node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression")) {
      fnDefs.set(node.id.name, node.init);
    }
  });

  const idParamSinks = new Map(); // fnName -> Set<paramIndex>
  const addSink = (fnName, idx) => {
    let set = idParamSinks.get(fnName);
    if (!set) { set = new Set(); idParamSinks.set(fnName, set); }
    const before = set.size;
    set.add(idx);
    return set.size > before;
  };

  for (const [fnName, fn] of fnDefs) {
    const paramNames = fn.params.map((p) => (p.type === "Identifier" ? p.name : null));
    walkAst(fn.body, (node) => {
      if (node.type !== "TemplateLiteral") return;
      for (let i = 0; i < node.expressions.length; i++) {
        const prev = node.quasis[i]?.value || "";
        const next = node.quasis[i + 1]?.value || "";
        const expr = node.expressions[i];
        if (expr.type === "Identifier" && /\bid\s*=\s*(?:"|')$/.test(prev) && /^(?:"|')/.test(next)) {
          const idx = paramNames.indexOf(expr.name);
          if (idx >= 0) addSink(fnName, idx);
        }
      }
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [fnName, fn] of fnDefs) {
      const paramNames = fn.params.map((p) => (p.type === "Identifier" ? p.name : null));
      walkAst(fn.body, (node) => {
        if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
        const sinkIndices = idParamSinks.get(node.callee.name);
        if (!sinkIndices) return;
        for (const idx of sinkIndices) {
          const arg = node.arguments[idx];
          if (arg?.type === "Identifier") {
            const pIdx = paramNames.indexOf(arg.name);
            if (pIdx >= 0 && addSink(fnName, pIdx)) changed = true;
          }
        }
      });
    }
  }

  walkAst(ast, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
    const sinkIndices = idParamSinks.get(node.callee.name);
    if (!sinkIndices) return;
    for (const idx of sinkIndices) {
      const arg = node.arguments[idx];
      if (arg?.type === "Literal" && typeof arg.value === "string") ids.add(arg.value);
    }
  });
  return ids;
}

function extractDomIdQueries(ast, mapper, helperNames) {
  const queries = [];
  walkAst(ast, (node) => {
    if (node.type !== "CallExpression" || !node.arguments.length) return;
    const arg0 = node.arguments[0];
    if (arg0.type !== "Literal" || typeof arg0.value !== "string") return;
    const callee = node.callee;
    if (callee.type === "Identifier" && helperNames.has(callee.name)) {
      queries.push({ id: arg0.value, loc: mapper.format(arg0.start) });
      return;
    }
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
      const prop = callee.property.name;
      if (prop === "getElementById" && callee.object.type === "Identifier" && callee.object.name === "document") {
        queries.push({ id: arg0.value, loc: mapper.format(arg0.start) });
      } else if (prop === "querySelector" || prop === "querySelectorAll") {
        for (const id of extractSelectorIds(arg0.value)) {
          queries.push({ id, loc: mapper.format(arg0.start) });
        }
      }
    }
  });
  return queries;
}

function loadEnI18nKeys(root) {
  const i18nPath = path.join(root, "main/www/js/i18n.js");
  const code = fs.readFileSync(i18nPath, "utf8");
  const sandbox = vm.createContext({
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  vm.runInContext(`${code}\nthis.__enKeys = Object.keys(I18N.en);`, sandbox);
  return new Set(sandbox.__enKeys);
}

function extractHtmlI18nRefs(htmlText, relPath) {
  const clean = stripHtmlComments(htmlText);
  const refs = [];
  const lineStarts = buildLineStarts(clean);
  for (const m of clean.matchAll(/\bdata-i18n(?:-(?:aria|ph|title))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const lc = lineColFromStarts(lineStarts, m.index);
    refs.push({ key: m[1] ?? m[2], loc: `${relPath}:${lc.line}:${lc.col}` });
  }
  return refs;
}

// Exact frozen legacy entries retained solely to keep the 932-key 13-locale catalog invariant
// (test_ui_locale_catalogs.mjs). New or newly orphaned keys must NOT be added here.
const FROZEN_LEGACY_I18N_KEYS = new Set([
  "check.detail.value_label", "check.detail.assessment_label", "check.hour.other",
  "check.detail.period", "hist.gaps", "hist.held", "hist.heldnote", "hist.pin_hint",
  "hist.state_active", "hist.state_off", "hist.boost_none", "hist.defrost_none",
  "hist.quiet_none", "hist.heater_none", "hist.preheat_none", "hist.disinfection_none",
  "hist.buh_none", "hist.valve_none", "hist.circ_none", "hist.circ_gaps", "hist.valve2_none",
  "hist.flow_switch_none", "hist.comp_none", "hist.mb_defrost_none", "hist.pump_none",
  "env.saving", "card.hw_led", "card.hw_btn", "probe.response", "probe.frame", "probe.slice",
]);

function expandDynamicI18nFamilies(ast, sourceTexts) {
  const referenced = new Set(FROZEN_LEGACY_I18N_KEYS);
  const add = (k) => referenced.add(k);

  // Extract string literals across all JS AST nodes EXCEPT the I18N definition table itself
  // (and non-computed object property keys), so I18N.en cannot self-reference its own keys.
  const walkNonI18n = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walkNonI18n(item); return; }
    if (!node.type) return;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.id.name === "I18N") return;
    if (node.type === "Literal" && typeof node.value === "string") referenced.add(node.value);
    if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis[0]?.value != null) {
      referenced.add(node.quasis[0].value);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "type" || k === "start" || k === "end") continue;
      if (node.type === "Property" && k === "key" && !node.computed) continue;
      if (v && typeof v === "object") walkNonI18n(v);
    }
  };
  walkNonI18n(ast);

  // Verify dynamic template t(`...`) and constructed key patterns only for states actually present in JS.
  const fullJs = sourceTexts.join("\n");

  const matchArray = (rx) => {
    const m = fullJs.match(rx);
    if (!m) return [];
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };

  // sg.mode0..3
  if (/t\(`sg\.mode\$\{/.test(fullJs)) {
    for (let i = 0; i <= 3; i++) add(`sg.mode${i}`);
  }
  // lang.<code | auto>
  if (/t\(`lang\.\$\{/.test(fullJs)) {
    add("lang.auto");
    for (const c of matchArray(/const UI_LANGS = Object\.freeze\(\[([\s\S]*?)\]\)/)) add(`lang.${c}`);
  }
  // mode.<sc> and mode.<sc>_dhw
  if (/t\(`mode\.\$\{/.test(fullJs)) {
    for (const sc of ["stop", "heat", "cool", "space"]) {
      add(`mode.${sc}`);
      if (sc !== "stop") add(`mode.${sc}_dhw`);
    }
  }
  // group.<name> via GROUP_ORDER + "Other values"
  if (/I18N\.en\["group\." \+ name\]/.test(fullJs)) {
    for (const g of matchArray(/const GROUP_ORDER = \[([\s\S]*?)\];/)) add(`group.${g}`);
    if (fullJs.includes('"Other values"')) add("group.Other values");
  }
  // namedBinHist(..., p, onOff) state-history i18n families
  walkAst(ast, (node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" &&
        node.callee.name === "namedBinHist" &&
        node.arguments[2]?.type === "Literal" && typeof node.arguments[2].value === "string") {
      const p = node.arguments[2].value;
      const onOff = node.arguments[3]?.type === "Literal" && Boolean(node.arguments[3].value);
      add(`hist.${p}_total`);
      add(`hist.${p}_aria`);
      add(`hist.${p}_${onOff ? "on" : "active"}`);
      add(`hist.${p}_${onOff ? "off" : "inactive"}`);
    }
  });
  // board.led_<kind>_<phase>
  if (/t\(`board\.led_\$\{/.test(fullJs)) {
    const phases = matchArray(/const boardLedPhases = \[([\s\S]*?)\];/);
    for (const kind of ["rgb", "gpio"]) for (const p of phases) add(`board.led_${kind}_${p}`);
  }
  // probe.status_* and probe.transport_* (codes from /probe_hp firmware response)
  if (/t\(`probe\.status_\$\{/.test(fullJs)) {
    for (const s of [
      "ok", "busy", "no_link", "timeout", "no_reply", "rejected", "bad_crc",
      "unexpected_reply", "invalid_length", "short_reply", "out_of_bounds", "error",
    ]) add(`probe.status_${s}`);
  }
  if (/t\(`probe\.transport_\$\{/.test(fullJs)) {
    for (const s of [
      "ok", "busy", "no_link", "timeout", "no_reply", "rejected", "bad_crc",
      "unexpected_reply", "invalid_length", "short_reply", "out_of_bounds", "error",
    ]) add(`probe.transport_${s}`);
  }
  // probe.conv_*
  if (/probe\.conv_/.test(fullJs)) {
    for (const m of fullJs.matchAll(/:\s*"([a-z0-9_]+)"/g)) {
      if (fullJs.includes(`"probe.conv_${m[1]}"`)) add(`probe.conv_${m[1]}`);
    }
  }
  // check.cycling.<assessment> and check.cycling.run_<key> and check.cycling.<k>
  if (/t\(`check\.cycling\.\$\{/.test(fullJs)) {
    for (const k of [
      "short", "normal", "few", "waiting", "class_unavailable", "unavailable", "stale",
      "stop_req_off", "stop_tgt_drop", "stop_dhw",
    ]) {
      if (fullJs.includes(`"${k}"`)) add(`check.cycling.${k}`);
    }
  }
  if (/t\(`check\.cycling\.run_\$\{/.test(fullJs)) {
    for (const k of ["start", "stop", "duration"]) add(`check.cycling.run_${k}`);
  }
  if (/`check\.cycling\.\$\{/.test(fullJs)) {
    for (const k of [
      "s_cool", "s_req", "s_tgt", "s_defrost_after", "s_dhw_after", "s_defrost", "s_dhw", "s_gen",
      "e_low_flow", "e_low_rps", "e_req", "e_tgt", "e_defrost_run", "e_defrost_pause", "e_dhw", "e_norm",
      "find_low_flow", "find_low_rps", "find_defrost_dhw", "find_defrost", "stop_dhw",
    ]) {
      if (fullJs.includes(`"${k}"`)) add(`check.cycling.${k}`);
    }
  }
  // check.fault_unit_<unit>
  if (/t\(`check\.fault_unit_\$\{/.test(fullJs)) {
    for (const u of ["outdoor", "indoor", "both"]) {
      if (fullJs.includes(`"${u}"`)) add(`check.fault_unit_${u}`);
    }
  }
  // check.status.<statusKey>
  if (/t\(`check\.status\.\$\{/.test(fullJs)) {
    for (const k of ["ok", "info", "warn", "collecting", "observation", "experimental", "unavailable", "no_window"]) {
      if (fullJs.includes(`"${k}"`)) add(`check.status.${k}`);
    }
  }
  // check.dhw.marker_<yes|no>
  if (/t\(`check\.dhw\.marker_\$\{/.test(fullJs)) {
    add("check.dhw.marker_yes");
    add("check.dhw.marker_no");
  }
  // check.detail.dhw_reason.<r> (charge/pump/draw/reading/blind/blind_modbus from firmware)
  if (/t\(`check\.detail\.dhw_reason\.\$\{/.test(fullJs)) {
    for (const r of ["charge", "pump", "draw", "reading", "blind", "blind_modbus"]) {
      add(`check.detail.dhw_reason.${r}`);
    }
  }
  // check.detail.<reasonKey> and check.detail.<id>.<statusKey>
  if (/t\(`check\.detail\.\$\{/.test(fullJs)) {
    for (const r of ["defrost_events_insufficient", "source_stale", "source_stale_modbus", "no_paired_runtime"]) {
      if (fullJs.includes(`"${r}"`)) add(`check.detail.${r}`);
    }
  }
  if (/`check\.detail\.\$\{/.test(fullJs)) {
    for (const k of ["ok", "info", "warn", "collecting_unknown", "observation", "experimental", "unavailable"]) {
      if (fullJs.includes(`"${k}"`)) add(`check.detail.${k}`);
    }
    for (const k of [
      "fault.ok", "fault.error", "fault.warning", "fault.past", "fault.past_unknown",
      "defrost.info", "defrost.ok", "pressure.info", "pressure.warn", "pressure.ok",
    ]) {
      add(`check.detail.${k}`);
    }
  }
  // service.reason.<blocker>, service.metric.<inspectorKey>, service.limit.<key>, service.state.<state>, service.help.<state>
  if (/`service\.reason\.\$\{/.test(fullJs)) {
    for (const r of matchArray(/const reasonSlugs = \[([\s\S]*?)\];/)) add(`service.reason.${r}`);
  }
  if (/t\(`service\.metric\.\$\{/.test(fullJs)) {
    for (const m of ["comp", "disch", "eev", "hp", "lp"]) {
      if (fullJs.includes(`"${m}"`)) add(`service.metric.${m}`);
    }
  }
  if (/t\(`service\.limit\.\$\{/.test(fullJs)) {
    for (const l of matchArray(/const knownLimitations = \[([\s\S]*?)\];/)) add(`service.limit.${l}`);
  }
  if (/t\(`service\.state\.\$\{/.test(fullJs)) {
    for (const s of matchArray(/const states = \[([\s\S]*?)\];/)) {
      if (s !== "unsupported") add(`service.state.${s}`);
    }
  }
  const helpMatch = fullJs.match(/const helpKey = \[([^\]]+)\]\.includes\(state\)\s*\?\s*`service\.help\.\$\{state\}`/);
  if (helpMatch) {
    for (const m of helpMatch[1].matchAll(/"([^"]+)"/g)) add(`service.help.${m[1]}`);
  }
  // modbus.exc.<detail>, modbus.err.<key>, mqtt.err.<key>, err.mqtt_base_*
  if (/t\(`modbus\.exc\.\$\{/.test(fullJs)) {
    for (const k of ["1", "2", "3", "4", "5", "6", "8", "10", "11", "unknown"]) add(`modbus.exc.${k}`);
  }
  if (/`modbus\.err\.\$\{/.test(fullJs)) {
    for (const k of [
      "mdns_not_found", "no_address", "resolve_failed", "connect_timeout", "connection_refused",
      "network_unreachable", "host_unreachable", "connect_failed", "request_failed",
      "send_timeout", "send_failed", "response_timeout", "connection_closed",
      "receive_failed", "invalid_response", "internal_error", "exception",
    ]) add(`modbus.err.${k}`);
  }
  if (/`mqtt\.err\.\$\{/.test(fullJs)) {
    for (const k of ["waiting_x10a", "task_alloc", "transport", "refused", "connection"]) {
      if (fullJs.includes(`"${k}"`)) add(`mqtt.err.${k}`);
    }
  }
  if (/"err\."\s*\+\s*code/.test(fullJs) || /`err\.\$\{code\}`/.test(fullJs)) {
    for (const k of [
      "too_long", "wildcard", "reserved", "slash", "control", "space", "empty_segment", "not_sluggable",
    ]) add(`err.mqtt_base_${k}`);
  }
  return referenced;
}

function collectCssScopeVars(files, mapperTexts) {
  const declared = new Set();
  const usages = [];
  for (const { file, text, stripComments } of files) {
    const clean = stripComments(text);
    const lineStarts = buildLineStarts(clean);
    for (const m of clean.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
      declared.add(m[1]);
    }
    for (const m of clean.matchAll(/\bvar\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const lc = lineColFromStarts(lineStarts, m.index);
      usages.push({ name: m[1], loc: `${file}:${lc.line}:${lc.col}` });
    }
  }
  for (const { file, text, ast } of mapperTexts) {
    const lineStarts = buildLineStarts(text);
    walkAst(ast, (node) => {
      if (node.type === "CallExpression" &&
          node.callee.type === "MemberExpression" && !node.callee.computed &&
          node.callee.property.type === "Identifier" && node.callee.property.name === "setProperty" &&
          node.arguments[0]?.type === "Literal" && typeof node.arguments[0].value === "string" &&
          node.arguments[0].value.startsWith("--")) {
        declared.add(node.arguments[0].value);
      }
      if (node.type === "Literal" && typeof node.value === "string") {
        for (const m of node.value.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) declared.add(m[1]);
        for (const m of node.value.matchAll(/\bvar\(\s*(--[A-Za-z0-9_-]+)/g)) {
          const lc = lineColFromStarts(lineStarts, node.start);
          usages.push({ name: m[1], loc: `${file}:${lc.line}:${lc.col}` });
        }
      }
      if (node.type === "TemplateLiteral") {
        for (const q of node.quasis) {
          if (!q.value) continue;
          for (const m of q.value.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) declared.add(m[1]);
          for (const m of q.value.matchAll(/\bvar\(\s*(--[A-Za-z0-9_-]+)/g)) {
            const lc = lineColFromStarts(lineStarts, q.start);
            usages.push({ name: m[1], loc: `${file}:${lc.line}:${lc.col}` });
          }
        }
      }
    });
  }
  return usages.filter((u) => !declared.has(u.name)).map((u) => `${u.loc}: undeclared CSS custom property '${u.name}'`);
}

export function runStaticChecks(root = DEFAULT_ROOT) {
  const errors = [];
  const report = {
    undefErrors: [],
    unusedFunctions: [],
    domErrors: [],
    i18nMissing: [],
    i18nDead: [],
    cssErrors: [],
  };

  // 1. Parse and check app.sources as one classic script
  const appAbsFiles = appSourceFiles(path.join(root, "main/www/app.sources"));
  const appEntries = appAbsFiles.map((f) => ({
    file: path.relative(root, f).split(path.sep).join("/"),
    content: fs.readFileSync(f, "utf8"),
    baseLine: 1,
  }));
  const appBundle = SourceMapper.fromTextMap(appEntries);
  const appAst = parseJavaScript(appBundle.code, appBundle.mapper);
  const appScope = analyzeProgramScopes(appAst, appBundle.mapper);
  report.undefErrors.push(...appScope.undefErrors);

  // Also parse each individual JS file to gather per-file ASTs for CSS/reporting
  const individualJs = appEntries.map((entry) => {
    const mapper = SourceMapper.fromTextMap([entry]);
    return { file: entry.file, text: entry.content, ast: parseJavaScript(entry.content, mapper.mapper) };
  });

  // Parse and check each main/www/locales/*.js against the full app.sources classic-script scope
  const localeDir = path.join(root, "main/www/locales");
  const localeFiles = fs.readdirSync(localeDir).filter((n) => n.endsWith(".js")).sort();
  const localeExternalRefs = new Set();
  for (const name of localeFiles) {
    const abs = path.join(localeDir, name);
    const rel = `main/www/locales/${name}`;
    const content = fs.readFileSync(abs, "utf8");
    const mapped = SourceMapper.fromTextMap([{ file: rel, content, baseLine: 1 }]);
    const ast = parseJavaScript(mapped.code, mapped.mapper);
    const scope = analyzeProgramScopes(ast, mapped.mapper, appScope.scriptBindings);
    report.undefErrors.push(...scope.undefErrors);
    walkAst(ast, (node) => {
      if (node.type === "Identifier" && appScope.topLevelFns.has(node.name)) {
        localeExternalRefs.add(node.name);
      }
    });
  }

  // Parse and check main/www/setup.html inline script(s)
  const setupPath = path.join(root, "main/www/setup.html");
  const setupHtml = fs.readFileSync(setupPath, "utf8");
  const setupExtracted = extractInlineScriptsAndHandlers(setupHtml, "main/www/setup.html");
  const setupAsts = [];
  for (const s of setupExtracted.scripts) {
    const mapped = SourceMapper.fromTextMap([s]);
    const ast = parseJavaScript(mapped.code, mapped.mapper);
    const scope = analyzeProgramScopes(ast, mapped.mapper);
    report.undefErrors.push(...scope.undefErrors);
    setupAsts.push({ ast, mapper: mapped.mapper });
  }

  // Parse and check main/www/mcp_dashboard.js
  const mcpJsPath = path.join(root, "main/www/mcp_dashboard.js");
  const mcpJs = fs.readFileSync(mcpJsPath, "utf8");
  const mcpMapped = SourceMapper.fromTextMap([{ file: "main/www/mcp_dashboard.js", content: mcpJs, baseLine: 1 }]);
  const mcpAst = parseJavaScript(mcpMapped.code, mcpMapped.mapper);
  const mcpScope = analyzeProgramScopes(mcpAst, mcpMapped.mapper);
  report.undefErrors.push(...mcpScope.undefErrors);

  // Unused top-level functions in app.sources
  const indexHtmlPath = path.join(root, "main/www/index.html");
  const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  const indexExtracted = extractInlineScriptsAndHandlers(indexHtml, "main/www/index.html");
  const handlerRefs = new Set();
  for (const code of indexExtracted.handlers) {
    const m = SourceMapper.fromTextMap([{ file: "main/www/index.html", content: code, baseLine: 1 }]);
    const ast = parseJavaScript(m.code, m.mapper);
    walkAst(ast, (node) => {
      if (node.type === "Identifier") handlerRefs.add(node.name);
    });
  }
  for (const [fnName, fnNode] of appScope.topLevelFns) {
    if (!appScope.referencedTopLevel.has(fnName) &&
        !localeExternalRefs.has(fnName) &&
        !handlerRefs.has(fnName) &&
        !INTENTIONAL_UI_GLOBALS.has(fnName)) {
      report.unusedFunctions.push(`${appBundle.mapper.format(fnNode.start)}: unused top-level function '${fnName}'`);
    }
  }

  // 2. Global DOM-ID cross-check
  const indexStaticIds = extractStaticHtmlIds(indexHtml);
  const indexDynIds = extractDynamicJsIds(appAst);
  for (const q of extractDomIdQueries(appAst, appBundle.mapper, new Set(["$"]))) {
    if (!indexStaticIds.has(q.id) && !indexDynIds.has(q.id)) {
      report.domErrors.push(`${q.loc}: unknown DOM id '${q.id}' in dashboard script`);
    }
  }

  const setupStaticIds = extractStaticHtmlIds(setupHtml);
  for (const { ast, mapper } of setupAsts) {
    const setupDynIds = extractDynamicJsIds(ast);
    for (const q of extractDomIdQueries(ast, mapper, new Set(["el"]))) {
      if (!setupStaticIds.has(q.id) && !setupDynIds.has(q.id)) {
        report.domErrors.push(`${q.loc}: unknown DOM id '${q.id}' in setup.html`);
      }
    }
  }

  const mcpHtmlPath = path.join(root, "main/www/mcp_dashboard.html");
  const mcpHtml = fs.readFileSync(mcpHtmlPath, "utf8");
  const mcpStaticIds = extractStaticHtmlIds(mcpHtml);
  const mcpDynIds = extractDynamicJsIds(mcpAst);
  for (const q of extractDomIdQueries(mcpAst, mcpMapped.mapper, new Set(["byId"]))) {
    if (!mcpStaticIds.has(q.id) && !mcpDynIds.has(q.id)) {
      report.domErrors.push(`${q.loc}: unknown DOM id '${q.id}' in mcp_dashboard.js`);
    }
  }

  // 3. Global i18n key check
  const enKeys = loadEnI18nKeys(root);
  const htmlI18nRefs = extractHtmlI18nRefs(indexHtml, "main/www/index.html");
  const usedKeys = new Set();
  for (const ref of htmlI18nRefs) {
    usedKeys.add(ref.key);
    if (!enKeys.has(ref.key)) {
      report.i18nMissing.push(`${ref.loc}: missing I18N.en key '${ref.key}' in HTML data-i18n*`);
    }
  }
  walkAst(appAst, (node) => {
    if (node.type === "CallExpression" &&
        node.callee.type === "Identifier" && node.callee.name === "t" &&
        node.arguments[0]?.type === "Literal" && typeof node.arguments[0].value === "string") {
      const key = node.arguments[0].value;
      usedKeys.add(key);
      if (!enKeys.has(key)) {
        report.i18nMissing.push(`${appBundle.mapper.format(node.arguments[0].start)}: missing I18N.en key '${key}' in t(...)`);
      }
    }
  });
  const dynamicAndTableRefs = expandDynamicI18nFamilies(appAst, appEntries.map((e) => e.content));
  for (const k of dynamicAndTableRefs) usedKeys.add(k);
  for (const key of enKeys) {
    if (!usedKeys.has(key)) {
      report.i18nDead.push(`main/www/js/i18n.js: dead I18N.en key '${key}' (unreferenced in HTML/JS/data tables)`);
    }
  }

  // 4. CSS custom property check
  const dashStyle = fs.readFileSync(path.join(root, "main/www/style.css"), "utf8");
  report.cssErrors.push(...collectCssScopeVars([
    { file: "main/www/style.css", text: dashStyle, stripComments: stripCssComments },
    { file: "main/www/index.html", text: indexHtml, stripComments: stripHtmlComments },
  ], individualJs));

  report.cssErrors.push(...collectCssScopeVars([
    { file: "main/www/setup.html", text: setupHtml, stripComments: (s) => stripCssComments(stripHtmlComments(s)) },
  ], []));

  const mcpCss = fs.readFileSync(path.join(root, "main/www/mcp_dashboard.css"), "utf8");
  report.cssErrors.push(...collectCssScopeVars([
    { file: "main/www/mcp_dashboard.css", text: mcpCss, stripComments: stripCssComments },
    { file: "main/www/mcp_dashboard.html", text: mcpHtml, stripComments: stripHtmlComments },
  ], [{ file: "main/www/mcp_dashboard.js", text: mcpJs, ast: mcpAst }]));

  errors.push(
    ...report.undefErrors,
    ...report.unusedFunctions,
    ...report.domErrors,
    ...report.i18nMissing,
    ...report.i18nDead,
    ...report.cssErrors,
  );
  return { ok: errors.length === 0, errors, report, stats: {
    appFiles: appEntries.length,
    localeFiles: localeFiles.length,
    topLevelFunctions: appScope.topLevelFns.size,
    enKeys: enKeys.size,
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootArg = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  const result = runStaticChecks(rootArg);
  if (!result.ok) {
    for (const err of result.errors) console.error(err);
    process.exit(1);
  }
  console.log(`UI static check passed (${result.stats.appFiles} app fragments, ${result.stats.localeFiles} locales, ${result.stats.topLevelFunctions} top-level functions, ${result.stats.enKeys} I18N.en keys)`);
}
