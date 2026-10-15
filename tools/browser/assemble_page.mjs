import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spliceInlineAssets } from "../ui/inline_page.mjs";
import { readAppSource } from "../ui/read_app_source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("usage: node tools/browser/assemble_page.mjs <output.html>");

const htmlFile = path.join(root, "main/www/index.html");
const cssFile = path.join(root, "main/www/style.css");
const manifest = path.join(root, "main/www/app.sources");
// Literal splice, byte-identical to the firmware's inline_assets.cmake (see tools/ui/inline_page.mjs).
const page = spliceInlineAssets(fs.readFileSync(htmlFile, "utf8"), {
  css: fs.readFileSync(cssFile, "utf8"),
  js: readAppSource(manifest),
});
fs.writeFileSync(output, page);
