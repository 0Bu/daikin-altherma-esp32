import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-public-audit-"));

try {
  const bin = path.join(temp, "bin");
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));

  const git = execFileSync("/bin/sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  assert.ok(git, "git must be available to enumerate tracked fixtures");
  fs.symlinkSync(git, path.join(bin, "git"));

  // If the audit regresses to calling ripgrep, the sentinel is found before any host installation
  // and makes the contract fail. ubuntu-24.04 does not install rg by default; Node + Git are the
  // intentionally declared baseline.
  const rg = path.join(bin, "rg");
  fs.writeFileSync(rg, "#!/bin/sh\nexit 91\n", { mode: 0o755 });

  const result = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `public-readiness audit must run without ripgrep\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /Public-readiness audit passed/);

  // Prove the generic fixture policy catches private-shaped values without storing any real
  // installation denylist in the public tree. Build a tracked throwaway snapshot from the current
  // working files (not HEAD: this selftest must cover an uncommitted audit edit too), mutate one
  // fixture at a time, and require the complete audit to fail for the intended reason.
  const seededRoot = path.join(temp, "seeded-tree");
  fs.mkdirSync(seededRoot);
  const tracked = execFileSync(git, ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    const destination = path.join(seededRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  execFileSync(git, ["init", "-q"], { cwd: seededRoot });
  execFileSync(git, ["add", "-A"], { cwd: seededRoot });

  const seedFile = path.join(seededRoot, "test/test_ui_use_cases.mjs");
  const originalSeedFile = fs.readFileSync(seedFile, "utf8");
  const privacySeeds = [
    ["compact hardware id", ['const privacySeed = { device_', 'id: "012345', '6789ab" };'].join(""),
      /compact hardware identifier/],
    ["backtick SSID", ["const privacySeed = { ss", "id: `Private", "FixtureNet` };"].join(""),
      /WiFi fixture SSIDs/],
    ["quoted JSON source name",
      ['const privacySeed = { "reference_', 'temperature": { "name": "Private ',
        'fixture room" } };'].join(""),
      /UI source-name fixtures/],
    ["explicit-plus coordinate", ["const lati", "tude=+48.", "123456;"].join(""),
      /coordinate fixtures/],
  ];
  for (const [name, seed, expected] of privacySeeds) {
    fs.writeFileSync(seedFile, `${originalSeedFile}\n${seed}\n`);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(
      seeded.status,
      0,
      `public-readiness audit accepted private-shaped ${name}`,
    );
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  fs.writeFileSync(seedFile, originalSeedFile);

  const contributingFile = path.join(seededRoot, "CONTRIBUTING.md");
  const originalContributing = fs.readFileSync(contributingFile, "utf8");
  const provenanceSeeds = [
    ["numbered predecessor URL",
      "https://github.com/0Bu/daikin-altherma-esp32/issues/123",
      /numbered private-predecessor work item/],
    ["bare predecessor number", "Historical regression (see #123).", /bare predecessor #N reference/],
  ];
  for (const [name, seed, expected] of provenanceSeeds) {
    fs.writeFileSync(contributingFile, `${originalContributing}\n${seed}\n`);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  fs.writeFileSync(contributingFile, originalContributing);
  console.log(
    "public readiness: Node + Git/no-rg baseline, four private fixtures, and two legacy-link mutations pass",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
