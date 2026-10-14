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
  // and makes the contract fail. ubuntu-26.04 does not install rg by default; Node + Git are the
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
  // Include new public Markdown pages before staging: relocated contracts must reach the fixture
  // while this selftest is validating an in-progress documentation change.
  const publicDocs = execFileSync(git,
    ["ls-files", "-z", "--others", "--exclude-standard", "--", "docs/*.md"], { cwd: root })
    .toString("utf8").split("\0").filter(Boolean);
  for (const file of new Set([...tracked, ...publicDocs])) {
    const destination = path.join(seededRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  execFileSync(git, ["init", "-q"], { cwd: seededRoot });
  execFileSync(git, ["add", "-A"], { cwd: seededRoot });

  const seedFile = path.join(seededRoot, "test/test_ui_use_cases.mjs");
  const originalSeedFile = fs.readFileSync(seedFile, "utf8");
  // Pin full literal capture across each quote style and the exact UTF-8/escape fixtures.
  // Each seed is one complete source string; no split name can hide a policy regression.
  const positiveSsidSeeds = [
    "const ssid = \"ExampleNet\";",
    "const ssid = 'ExampleNet';",
    "const ssid = `ExampleNet`;",
    "const privacySeed = { \"ssid\": \"new-net\" };",
    "const privacySeed = { \"wifi_ssid\": \"test-wifi\" };",
    "const wifi_ssid = \"Café \\\"quoted\\\"\\\\line\\n\";",
    "const privacySeed = { \"ssid\": \" \\\"é\\\\網 \" };",
  ];
  for (const [index, seed] of positiveSsidSeeds.entries()) {
    fs.writeFileSync(seedFile, `${originalSeedFile}\n${seed}\n`);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.equal(seeded.status, 0,
      `public-readiness audit rejected approved complete SSID literal ${index}\n${seeded.stdout}\n${seeded.stderr}`);
  }
  fs.writeFileSync(seedFile, originalSeedFile);

  const privacySeeds = [
    ["escaped quote followed by unapproved Unicode-SSID suffix",
      "const wifi_ssid = \"Café \\\"quoted\\\"\\\\line\\n PrivateFixture\";", /WiFi fixture SSIDs/],
    ["unapproved name after escaped Unicode JSON quote",
      "const privacySeed = { \"ssid\": \" \\\"é\\\\網 PrivateFixture \" };", /WiFi fixture SSIDs/],
    ["unapproved name after escaped double quote",
      "const ssid = \"ExampleNet\\\"PrivateFixture\";", /WiFi fixture SSIDs/],
    ["unapproved name after escaped single quote",
      "const ssid = \u0027ExampleNet\\\u0027PrivateFixture\u0027;", /WiFi fixture SSIDs/],
    ["unapproved name after escaped backtick",
      "const ssid = \u0060ExampleNet\\\u0060PrivateFixture\u0060;", /WiFi fixture SSIDs/],
    ["incomplete quoted SSID",
      "const ssid = \"ExampleNet\\\"PrivateFixture;", /WiFi fixture SSIDs/],
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

  const codeFile = path.join(seededRoot, "main/hp_comm.cpp");
  const originalCode = fs.readFileSync(codeFile, "utf8");
  const codeSeeds = [
    ["bare predecessor number in code", "// Regression witness from #123\n", /bare predecessor #N reference/],
  ];
  for (const [name, seed, expected] of codeSeeds) {
    fs.writeFileSync(codeFile, `${seed}\n${originalCode}`);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  // An explicit per-line audit-allow-issue-ref marker exempts intentional fixtures:
  fs.writeFileSync(codeFile, `// Test fixture (#123) # audit-allow-issue-ref\n${originalCode}`);
  const allowResult = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
    cwd: seededRoot,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  assert.equal(allowResult.status, 0, `public-readiness audit must accept lines with audit-allow-issue-ref marker\n${allowResult.stdout}\n${allowResult.stderr}`);
  fs.writeFileSync(codeFile, originalCode);

  // Canonical project hooks are public repository input and executable after project trust. Keep
  // them exact and consolidated: a guard cannot disappear, an arbitrary command cannot replace a
  // reviewed core, and one per-policy hook cannot turn the aggregate gate back into N dispatches.
  const hooksFile = path.join(seededRoot, ".agents/hooks.json");
  const originalHooksText = fs.readFileSync(hooksFile, "utf8");
  const hookSeeds = [
    [
      "missing secret and partition guard",
      (hooks) => { hooks["safety-guards"].PreToolUse.shift(); },
      /PreToolUse hook dispatch count drifted/,
    ],
    [
      "unapproved inline hook command",
      (hooks) => { hooks["safety-guards"].PreToolUse[0].hooks[0].command = "bash -c 'env'"; },
      /unapproved canonical hook definition/,
    ],
    [
      "duplicate policy dispatch",
      (hooks) => {
        hooks["safety-guards"].PreToolUse.push({
          matcher: "run_command|Bash",
          hooks: [{
            type: "command",
            command: 'bash "$(git rev-parse --show-toplevel)/tools/agent-hooks/require-pr-gates.sh"',
            timeout: 600,
          }],
        });
      },
      /PreToolUse hook dispatch count drifted/,
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

  const mcpFile = path.join(seededRoot, ".mcp.json");
  const originalMcp = fs.readFileSync(mcpFile, "utf8");
  const mcpSeeds = [
    ["floating canonical MCP dependency",
      originalMcp.replace("@upstash/context7-mcp@4.0.2", "@upstash/context7-mcp@latest"),
      /floating @latest dependency in \.mcp\.json/],
    ["unpinned canonical MCP version",
      originalMcp.replace("@upstash/context7-mcp@4.0.2", "@upstash/context7-mcp"),
      /context7 must be pinned to one exact npm version/],
  ];
  for (const [name, text, expected] of mcpSeeds) {
    fs.writeFileSync(mcpFile, text);
    const seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
      cwd: seededRoot,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    assert.notEqual(seeded.status, 0, `public-readiness audit accepted MCP mutation: ${name}`);
    assert.match(`${seeded.stdout}\n${seeded.stderr}`, expected,
      `public-readiness audit rejected ${name} for the wrong reason`);
  }
  fs.writeFileSync(mcpFile, originalMcp);

  const apiFile = path.join(seededRoot, "docs/API.md");
  const originalApi = fs.readFileSync(apiFile, "utf8");
  fs.writeFileSync(
    apiFile,
    originalApi.replace("trusted-LAN route count of 39", "trusted-LAN route count of 38"),
  );
  let seeded = spawnSync("/bin/bash", ["scripts/run-public-readiness-audit.sh"], {
    cwd: seededRoot,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  assert.notEqual(seeded.status, 0, "public-readiness audit accepted route-count documentation drift");
  assert.match(`${seeded.stdout}\n${seeded.stderr}`, /exact trusted-LAN route budget/);
  fs.writeFileSync(apiFile, originalApi);

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
