import { spawnSync } from "node:child_process";
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
// Match inline_assets.cmake, then render the production minifier and startup packer's output.
const page = spliceInlineAssets(fs.readFileSync(htmlFile, "utf8"), {
  css: fs.readFileSync(cssFile, "utf8"),
  js: readAppSource(manifest),
});
const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
const budget = cmake.match(/^set\(UI_GZIP_MAX_BYTES ([1-9][0-9]*)\)$/m)?.[1];
if (!budget) throw new Error("dashboard gzip budget unavailable");
const staged = path.resolve(output);
const work = fs.mkdtempSync(path.join(path.dirname(staged), "dashboard-assets-"));
try {
  const input = path.join(work, "index.inlined.html");
  fs.writeFileSync(input, page);
  const built = spawnSync("python3", [path.join(root, "tools/web_asset/minify_and_gzip.py"),
    "--input", input, "--output", path.join(work, "index.html.gz"), "--html-output", staged,
    "--gzip-encoder", "zopfli", "--zopfli-iterations", "5",
    "--pack-startup-script", manifest, "--max-gzip-bytes", budget,
  ], { cwd: root, encoding: "utf8" });
  if (built.status !== 0) throw built.error || new Error(built.stderr || built.stdout || "dashboard build failed");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
