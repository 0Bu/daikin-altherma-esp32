import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const PATH_CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

function executable(path) {
  if (!path) return false;
  try {
    fs.accessSync(path, fs.constants.X_OK);
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findBrowser(explicit = process.env.DAIKIN_BROWSER_BIN) {
  if (explicit) return executable(explicit) ? explicit : null;

  for (const candidate of PATH_CANDIDATES) {
    for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const found = path.join(directory, candidate);
      if (executable(found)) return found;
    }
  }
  return MAC_CANDIDATES.find(executable) || null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const browser = findBrowser();
  if (!browser) {
    console.error("no executable Chrome or Chromium browser found");
    process.exitCode = 1;
  } else {
    process.stdout.write(browser + "\n");
  }
}
