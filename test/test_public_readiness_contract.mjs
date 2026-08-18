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
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)));
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

  // Canonical project hooks are public repository input and executable after project trust. Keep
  // them exact and consolidated: a guard cannot disappear, an arbitrary command cannot replace a
  // reviewed core, and one per-policy hook cannot turn the aggregate gate back into N dispatches.
  const hooksFile = path.join(seededRoot, ".codex/hooks.json");
  const originalHooksText = fs.readFileSync(hooksFile, "utf8");
  const hookSeeds = [
    [
      "missing secret and partition guard",
      (hooks) => { hooks.hooks.PreToolUse.shift(); },
      /PreToolUse Codex hook dispatch count drifted/,
    ],
    [
      "unapproved inline hook command",
      (hooks) => { hooks.hooks.PreToolUse[0].hooks[0].command = "bash -c 'env'"; },
      /unapproved canonical Codex hook definition/,
    ],
    [
      "duplicate policy dispatch",
      (hooks) => {
        hooks.hooks.PreToolUse.push({
          matcher: "^(?:Bash|exec_command)$",
          hooks: [{
            type: "command",
            command: 'bash "$(git rev-parse --show-toplevel)/tools/agent-hooks/require-pr-gates.sh"',
            statusMessage: "Duplicate policy evaluation",
            timeout: 600,
          }],
        });
      },
      /PreToolUse Codex hook dispatch count drifted/,
    ],
  ];
  for (const [name, mutate, expected] of hookSeeds) {
    const hooks = JSON.parse(originalHooksText);
    mutate(hooks);
    fs.writeFileSync(hooksFile, `${JSON.stringify(hooks, null, 2)}\n`);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted hook mutation: ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  fs.writeFileSync(hooksFile, originalHooksText);

  const configFile = path.join(seededRoot, ".codex/config.toml");
  const originalConfig = fs.readFileSync(configFile, "utf8");
  const configSeeds = [
    ["disabled multi-agent mode", originalConfig.replace("enabled = true", "enabled = false"),
      /canonical multi-agent settings drifted/],
    ["floating canonical MCP dependency",
      originalConfig.replace("@upstash/context7-mcp@4.0.2", "@upstash/context7-mcp@latest"),
      /canonical Context7 settings drifted/],
  ];
  for (const [name, text, expected] of configSeeds) {
    fs.writeFileSync(configFile, text);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted config mutation: ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  fs.writeFileSync(configFile, originalConfig);

  const architectureFile = path.join(seededRoot, "docs/ARCHITECTURE.md");
  const originalArchitecture = fs.readFileSync(architectureFile, "utf8");
  fs.writeFileSync(
    architectureFile,
    originalArchitecture.replace("trusted-LAN route count of 37", "trusted-LAN route count of 36"),
  );
  let seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
    cwd: seededRoot,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  assert.notEqual(seeded.status, 0, "public-readiness audit accepted route-count documentation drift");
  assert.match(`${seeded.stdout}\n${seeded.stderr}`, /exact trusted-LAN route budget/);
  fs.writeFileSync(architectureFile, originalArchitecture);

  const wrapperFile = path.join(seededRoot, "scripts/gh-with-git-credentials.sh");
  const originalWrapper = fs.readFileSync(wrapperFile, "utf8");
  fs.writeFileSync(
    wrapperFile,
    originalWrapper.replace(
      '"$git_bin" credential-store --file "$credential_file" get',
      'head -n1 "$credential_file"',
    ),
  );
  seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
    cwd: seededRoot,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  assert.notEqual(seeded.status, 0, "public-readiness audit accepted direct credential-store access");
  assert.match(`${seeded.stdout}\n${seeded.stderr}`, /credential wrapper no longer keeps credentials transient/);

  const tokenTransportSeeds = [
    ["multiline env launch", originalWrapper.replace(
      '/bin/bash -p -c "$token_child_script" _ "$gh_bin" "${args[@]}"',
      'GH_TOKEN="$token" \\\n        /bin/bash -p -c "$token_child_script" _ "$gh_bin" "${args[@]}"',
    )],
    ["child environment", originalWrapper.replace(
      "extra_child_env=()",
      'extra_child_env=()\nchild_env[0]="GH_TOKEN=$token"',
    )],
    ["extra child environment", originalWrapper.replace(
      "extra_child_env=()",
      'extra_child_env=()\nleak="GH_TOKEN=$token"\nextra_child_env[0]="$leak"',
    )],
    ["pre-environment command", originalWrapper.replace(
      '\nrepo_override="${GH_REPO:-}"',
      '\n/usr/bin/env "GH_TOKEN=$token" /usr/bin/true\n\nrepo_override="${GH_REPO:-}"',
    )],
    ["child script", originalWrapper.replace(
      'exec "$@"\'',
      'exec /usr/bin/env GH_TOKEN="$token" "$@"\'',
    )],
    ["body no-follow", originalWrapper.replaceAll(
      "os.O_RDONLY | os.O_NOFOLLOW",
      "os.O_RDONLY",
    )],
    ["physical wrapper identity", originalWrapper.replace(
      '[ ! -L "$wrapper_source" ]',
      '[ -n "$wrapper_source" ]',
    )],
    ["replacement-object environment", originalWrapper.replace(
      '"GIT_NO_REPLACE_OBJECTS=1"',
      '"GIT_NO_REPLACE_OBJECTS=0"',
    )],
    ["replacement-ref rejection", originalWrapper.replace(
      "for-each-ref --format='%(refname)' refs/replace",
      "for-each-ref --format='%(refname)' refs/heads",
    )],
    ["body secret path", originalWrapper.replace(
      '".git", ".ssh", ".gnupg"',
      '".git", ".gnupg"',
    )],
    ["body hardlink", originalWrapper.replace(
      "info.st_nlink != 1",
      "False",
    )],
    ["body owner", originalWrapper.replace(
      "info.st_uid != os.getuid()",
      "False",
    )],
    ["body unsafe mode", originalWrapper.replace(
      "info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)",
      "False",
    )],
    ["live PR head", originalWrapper.replace(
      "git/ref/heads/$AGENT_GH_PR_CREATE_BRANCH",
      "git/ref/heads/main",
    )],
    ["created PR head", originalWrapper.replace(
      "--json headRefOid --jq .headRefOid",
      "--json baseRefOid --jq .baseRefOid",
    )],
    ["PR revert", originalWrapper.replace(
      '|"pr revert"',
      "",
    )],
    ["issue transfer", originalWrapper.replace(
      '|"issue transfer"',
      "",
    )],
  ];
  for (const [name, text] of tokenTransportSeeds) {
    fs.writeFileSync(wrapperFile, text);
    seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted token argv via ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`,
      /credential wrapper no longer keeps credentials transient/);
  }
  fs.writeFileSync(wrapperFile, originalWrapper);
  console.log(
    "public readiness: Node + Git/no-rg baseline, privacy/provenance, hook/config, route-count, and credential-wrapper mutations pass",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
