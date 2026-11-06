// Execute the shipped positional decoder and selector when model copy lives in a locale asset.
// Both prose audits must judge the copy the browser selects, including a missing selected row.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function once(source, marker) {
  if (source.split(marker).length !== 2) throw new Error(`ambiguous model-copy marker: ${marker}`);
  return source.indexOf(marker);
}
function productionFunction(source, marker, bindings) {
  const begin = once(source, marker);
  const end = source.indexOf("\n}", begin);
  if (end < begin) throw new Error(`incomplete model-copy function: ${marker}`);
  return vm.runInNewContext(`(${source.slice(begin, end + 2)})`, bindings, { timeout: 5000 });
}

export function germanModelCopy(source, app, model) {
  const selected = Object.create(null);
  if (!model || Object.values(model).every((entry) => entry.de !== undefined)) return selected;
  const declaration = "const MODEL_DESCRIPTION_LOCALE_KEYS = ";
  const begin = once(source, declaration);
  const end = source.indexOf(";", begin);
  if (end < begin) throw new Error("incomplete model locale keys");
  const keys = vm.runInNewContext(source.slice(begin, end + 1) + "\nMODEL_DESCRIPTION_LOCALE_KEYS",
                                  Object.create(null), { timeout: 5000 });
  const decode = productionFunction(source, "function modelDescriptionValues(values) {",
                                    { MODEL_DESCRIPTION_LOCALE_KEYS: keys });
  const locale = fs.readFileSync(path.join(path.dirname(app), "locales/de.js"), "utf8");
  const marker = "MODEL_DESCRIPTION_I18N.de = modelDescriptionValues([";
  const from = once(locale, marker) + marker.length - 1;
  const to = locale.indexOf("\n]);", from);
  if (to < from) throw new Error("incomplete German model locale");
  const values = vm.runInNewContext(`(${locale.slice(from, to + 2)})`, Object.create(null),
                                     { timeout: 5000 });
  const select = productionFunction(source, "function modelDescriptionCopy(id) {",
                                    { LANG: "de", MODEL_DESCRIPTION_I18N: { de: decode(values) } });
  for (const id of Object.keys(model)) {
    const copy = select(id);
    if (copy) selected[id] = { what: copy[0], normal: copy[1] };
  }
  return selected;
}
