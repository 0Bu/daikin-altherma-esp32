import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function findBrowser(explicit = process.env.DAIKIN_BROWSER_BIN, platform = process.platform) {
  // --headless still starts the native .app binary and can trigger macOS crash dialogs.
  // Automated browser work on macOS belongs in scripts/run-browser-tests-linux.sh.
  if (platform === "darwin") return null;
  if (explicit) return executable(explicit) ? explicit : null;

  if (process.env.DAIKIN_BROWSER_CONTAINER === "1") {
    const bundled = "/opt/daikin-browser/chromium";
    if (executable(bundled)) return bundled;
  }

  for (const candidate of PATH_CANDIDATES) {
    for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const found = path.join(directory, candidate);
      if (executable(found)) return found;
    }
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const browser = findBrowser();
  if (!browser) {
    console.error("no Linux headless Chrome/Chromium found; use scripts/run-browser-tests-linux.sh");
    process.exitCode = 1;
  } else {
    process.stdout.write(browser + "\n");
  }
}
