#!/usr/bin/env node
// Local transport used only by run-pages-publish-tests.sh. It applies the GraphQL payload to a
// throwaway bare repository and returns GitHub-shaped signature metadata; no network is involved.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const origin = process.env.MOCK_PAGES_ORIGIN;
if (!origin) throw new Error("MOCK_PAGES_ORIGIN is required");

function git(args, options = {}) {
  const result = spawnSync("git", [`--git-dir=${origin}`, ...args], {
    encoding: options.input ? undefined : "utf8",
    input: options.input,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "GitHub",
      GIT_AUTHOR_EMAIL: "noreply@github.com",
      GIT_COMMITTER_NAME: "GitHub",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
    },
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString() : result.stderr;
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout.toString().trim() : result.stdout.trim();
}

function currentHead() {
  return git(["rev-parse", "refs/heads/gh-pages"]);
}

function applyEmptyRaceOnce() {
  const marker = process.env.MOCK_PAGES_RACE_ONCE;
  if (!marker || fs.existsSync(marker)) return;
  fs.writeFileSync(marker, "raced\n");
  const old = currentHead();
  const tree = git(["show", "-s", "--format=%T", old]);
  const commit = git(["commit-tree", tree, "-p", old, "-m", "concurrent pages publish"]);
  git(["update-ref", "refs/heads/gh-pages", commit, old]);
}

const apiArgs = process.argv.slice(2);
if (apiArgs[0] !== "api") throw new Error(`unexpected gh command: ${apiArgs.join(" ")}`);

if (apiArgs[1]?.startsWith("repos/") && apiArgs[1].includes("/commits/")) {
  const requested = apiArgs[1].split("/").at(-1);
  const verified = process.env.MOCK_PAGES_EXISTING_UNVERIFIED !== "1";
  process.stdout.write(`${JSON.stringify({
    sha: requested,
    commit: { verification: { verified, reason: verified ? "valid" : "unsigned" } },
  })}\n`);
  process.exit(0);
}

if (apiArgs[1] !== "graphql") throw new Error(`unexpected gh API: ${apiArgs.join(" ")}`);
const inputIndex = apiArgs.indexOf("--input");
if (inputIndex < 0 || !apiArgs[inputIndex + 1]) throw new Error("missing --input payload");
if (process.env.MOCK_PAGES_FAIL === "unretryable") {
  console.error("simulated GraphQL outage");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(apiArgs[inputIndex + 1], "utf8"));
const input = payload.variables.input;
applyEmptyRaceOnce();
const old = currentHead();
if (old !== input.expectedHeadOid) {
  console.error("expectedHeadOid did not match");
  process.exit(1);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pages-graphql-index-"));
const index = path.join(temp, "index");
try {
  const indexEnv = { ...process.env, GIT_INDEX_FILE: index, GIT_WORK_TREE: temp };
  const runIndex = (args, options = {}) => {
    const result = spawnSync("git", [`--git-dir=${origin}`, ...args], {
      env: indexEnv,
      input: options.input,
      encoding: options.input ? undefined : "utf8",
    });
    if (result.status !== 0) throw new Error(`index git failed: ${result.stderr}`);
    return Buffer.isBuffer(result.stdout) ? result.stdout.toString().trim() : result.stdout.trim();
  };
  runIndex(["read-tree", old]);
  for (const deletion of input.fileChanges.deletions) {
    runIndex(["update-index", "--force-remove", "--", deletion.path]);
  }
  for (const addition of input.fileChanges.additions) {
    const contents = Buffer.from(addition.contents, "base64");
    const oid = runIndex(["hash-object", "-w", "--stdin"], { input: contents });
    runIndex(["update-index", "--add", "--cacheinfo", `100644,${oid},${addition.path}`]);
  }
  const tree = runIndex(["write-tree"]);
  const commit = git(["commit-tree", tree, "-p", old, "-m", input.message.headline]);
  git(["update-ref", "refs/heads/gh-pages", commit, old]);
  const valid = process.env.MOCK_PAGES_BAD_SIGNATURE !== "1";
  process.stdout.write(`${JSON.stringify({
    data: {
      createCommitOnBranch: {
        commit: {
          oid: commit,
          signature: {
            isValid: valid,
            state: valid ? "VALID" : "UNSIGNED",
            wasSignedByGitHub: valid,
          },
        },
      },
    },
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
