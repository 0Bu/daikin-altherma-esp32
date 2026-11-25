// Zero-dependency static JS/DOM/i18n/CSS audit gate + lexer/scope self-checks.
// Runs automatically via scripts/run-ui-use-case-tests.sh (test/test_ui_*.mjs).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJavaScript, SourceMapper } from "../tools/ui/js_ast.mjs";
import { analyzeProgramScopes, runStaticChecks } from "../tools/ui/check_ui_static.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. Verify the repository's embedded web UI passes every static invariant.
const result = runStaticChecks(root);
assert.equal(result.ok, true, `UI static analysis failed:\n${result.errors.join("\n")}`);

// 2. Verify the AST scope analyzer handles tricky JS syntax and catches undeclared references.
function checkSnippet(code) {
  const mapped = SourceMapper.fromTextMap([{ file: "snippet.js", content: code, baseLine: 1 }]);
  const ast = parseJavaScript(mapped.code, mapped.mapper);
  return analyzeProgramScopes(ast, mapped.mapper);
}

{
  const unexecuted = checkSnippet("function f(a) { if (false) { return ghostOutdoorSourceLabel(a); } return a; } f(1);");
  assert.equal(unexecuted.undefErrors.length, 1);
  assert.match(unexecuted.undefErrors[0], /^snippet\.js:1:\d+: undeclared identifier 'ghostOutdoorSourceLabel'$/);

  const blockScope = checkSnippet("{ const innerConst = 1; let innerLet = 2; } void innerConst; void innerLet;");
  assert.equal(blockScope.undefErrors.length, 2);

  const catchAndForScope = checkSnippet("try { throw 1; } catch (err) { void err; } for (const item of [1]) { void item; } void err; void item;");
  assert.equal(catchAndForScope.undefErrors.length, 2);

  const nestedTemplateAndRegex = checkSnippet(
    "const x = 1; const msg = `v=${ /[{}]/.test(\"}\") ? (12 / 3 / 2) : x }`; void msg;",
  );
  assert.equal(nestedTemplateAndRegex.undefErrors.length, 0);

  const nestedTemplateUndef = checkSnippet(
    "const msg = `v=${ `${ /}/.test(\"}\") ? ghostNested : 1 }` }`; void msg;",
  );
  assert.equal(nestedTemplateUndef.undefErrors.length, 1);
  assert.match(nestedTemplateUndef.undefErrors[0], /undeclared identifier 'ghostNested'/);

  const objAndDestructure = checkSnippet(
    "const known = 1; const fn = ({ a, b: [c = known] = [], ...rest }) => ({ propKey: a, c, rest, known }); fn({});",
  );
  assert.equal(objAndDestructure.undefErrors.length, 0);

  const objShorthandUndef = checkSnippet("const o = { okKey: 1, missingShorthand }; void o;");
  assert.equal(objShorthandUndef.undefErrors.length, 1);
  assert.match(objShorthandUndef.undefErrors[0], /undeclared identifier 'missingShorthand'/);

  const bareArrowAndLabel = checkSnippet("const inc = x => x + 1; outer: for (let i = 0; i < 2; i++) { if (inc(i)) continue outer; }");
  assert.equal(bareArrowAndLabel.undefErrors.length, 0);

  const unusedFn = checkSnippet("function neverCalled() { return 1; }");
  assert.equal(unusedFn.topLevelFns.has("neverCalled"), true);
  assert.equal(unusedFn.referencedTopLevel.has("neverCalled"), false);
}

console.log(
  `UI static analysis passed (${result.stats.appFiles} app fragments, ${result.stats.localeFiles} locales, ` +
  `${result.stats.topLevelFunctions} top-level functions, ${result.stats.enKeys} I18N.en keys)`,
);
