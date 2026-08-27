import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "../ui/read_app_source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("usage: node tools/browser/assemble_page.mjs <output.html>");

const htmlFile = path.join(root, "main/www/index.html");
const cssFile = path.join(root, "main/www/style.css");
const manifest = path.join(root, "main/www/app.sources");
let page = fs.readFileSync(htmlFile, "utf8");
const assets = [
  { marker: "/*@@INLINE:style.css@@*/\n", label: "CSS", content: fs.readFileSync(cssFile, "utf8") },
  { marker: "//@@INLINE:app.js@@\n", label: "JavaScript", content: readAppSource(manifest) },
];

for (const asset of assets) {
  const first = page.indexOf(asset.marker);
  const last = page.lastIndexOf(asset.marker);
  if (first < 0 || first !== last) throw new Error(`${asset.label} inline marker must appear exactly once`);
  for (const marker of assets.map((item) => item.marker.trimEnd())) {
    if (asset.content.includes(marker)) throw new Error(`${asset.label} contains reserved marker ${marker}`);
  }
  page = page.replace(asset.marker, asset.content);
}
fs.writeFileSync(output, page);
