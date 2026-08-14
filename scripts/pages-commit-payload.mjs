#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function blobOid(contents) {
  const header = Buffer.from(`blob ${contents.length}\0`);
  return crypto.createHash("sha1").update(header).update(contents).digest("hex");
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`pages payload: symlink is not publishable: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else fail(`pages payload: unsupported file type: ${absolute}`);
    }
  };
  visit(root);
  return files.sort();
}

function parseCurrentTree(treePath) {
  const result = new Map();
  const text = fs.readFileSync(treePath, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) fail(`pages payload: malformed ls-tree line: ${line}`);
    const fields = line.slice(0, tab).split(" ");
    if (fields.length !== 3 || fields[1] !== "blob") {
      fail(`pages payload: only regular blobs are publishable: ${line}`);
    }
    const repositoryPath = line.slice(tab + 1);
    if (result.has(repositoryPath)) fail(`pages payload: duplicate path: ${repositoryPath}`);
    result.set(repositoryPath, fields[2]);
  }
  return result;
}

function prepare(args) {
  if (args.length !== 8) {
    fail("usage: pages-commit-payload.mjs prepare MODE SITE TREE HEAD REPO MESSAGE PAYLOAD META");
  }
  const [mode, siteRoot, treePath, expectedHeadOid, repository, message, payloadPath, metaPath] = args;
  if (mode !== "root" && mode !== "dev") fail(`pages payload: bad mode: ${mode}`);
  if (!/^[0-9a-f]{40}$/.test(expectedHeadOid)) fail("pages payload: expected head is not SHA-1");
  if (!/^[^/]+\/[^/]+$/.test(repository)) fail("pages payload: GITHUB_REPOSITORY must be owner/repo");

  const current = parseCurrentTree(treePath);
  const additions = [];
  const desired = new Set();
  let decodedBytes = 0;

  for (const absolute of walkFiles(siteRoot)) {
    const relative = path.relative(siteRoot, absolute).split(path.sep).join("/");
    const isDev = relative === "dev" || relative.startsWith("dev/");
    if ((mode === "dev") !== isDev) continue;
    const contents = fs.readFileSync(absolute);
    desired.add(relative);
    decodedBytes += contents.length;
    if (current.get(relative) !== blobOid(contents)) {
      additions.push({ path: relative, contents: contents.toString("base64") });
    }
  }

  const deletions = [];
  for (const repositoryPath of current.keys()) {
    const isDev = repositoryPath === "dev" || repositoryPath.startsWith("dev/");
    if ((mode === "dev") === isDev && !desired.has(repositoryPath)) {
      deletions.push({ path: repositoryPath });
    }
  }
  additions.sort((a, b) => a.path.localeCompare(b.path));
  deletions.sort((a, b) => a.path.localeCompare(b.path));

  const mutation = `mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
        signature { isValid state wasSignedByGitHub }
      }
    }
  }`;
  const payload = {
    query: mutation,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repository, branchName: "gh-pages" },
        expectedHeadOid,
        message: { headline: message },
        fileChanges: { additions, deletions },
      },
    },
  };
  const encoded = `${JSON.stringify(payload)}\n`;
  fs.writeFileSync(payloadPath, encoded, { mode: 0o600 });
  const meta = {
    additions: additions.length,
    deletions: deletions.length,
    changes: additions.length + deletions.length,
    desiredFiles: desired.size,
    decodedBytes,
    payloadBytes: Buffer.byteLength(encoded),
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  console.log([
    meta.changes,
    meta.additions,
    meta.deletions,
    meta.desiredFiles,
    meta.decodedBytes,
    meta.payloadBytes,
  ].join(" "));
}

function verify(args) {
  if (args.length !== 2) fail("usage: pages-commit-payload.mjs verify RESPONSE EXPECTED_HEAD");
  const [responsePath, expectedHead] = args;
  let response;
  try {
    response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
  } catch (error) {
    fail(`pages publish: GraphQL response is not JSON: ${error.message}`, 10);
  }
  if (Array.isArray(response.errors) && response.errors.length) {
    fail(`pages publish: GraphQL error: ${response.errors.map((entry) => entry.message).join("; ")}`, 10);
  }
  const commit = response?.data?.createCommitOnBranch?.commit;
  if (!commit || !/^[0-9a-f]{40}$/.test(commit.oid) || commit.oid === expectedHead) {
    fail("pages publish: GraphQL returned no new commit", 10);
  }
  const signature = commit.signature;
  if (!signature || signature.isValid !== true || signature.state !== "VALID" ||
      signature.wasSignedByGitHub !== true) {
    fail(`pages publish: commit ${commit.oid} is not GitHub-signed and verified`, 11);
  }
  console.log(commit.oid);
}

function verifyRest(args) {
  if (args.length !== 2) fail("usage: pages-commit-payload.mjs verify-rest RESPONSE EXPECTED_HEAD");
  const [responsePath, expectedHead] = args;
  let response;
  try {
    response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
  } catch (error) {
    fail(`pages publish: commit response is not JSON: ${error.message}`, 10);
  }
  const verification = response?.commit?.verification;
  if (response?.sha !== expectedHead || verification?.verified !== true ||
      verification?.reason !== "valid") {
    fail(`pages publish: existing commit ${expectedHead} is not verified`, 11);
  }
  console.log(expectedHead);
}

const [command, ...args] = process.argv.slice(2);
if (command === "prepare") prepare(args);
else if (command === "verify") verify(args);
else if (command === "verify-rest") verifyRest(args);
else fail("usage: pages-commit-payload.mjs prepare|verify|verify-rest ...");
