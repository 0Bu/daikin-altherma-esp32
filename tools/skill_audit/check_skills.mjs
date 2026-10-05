#!/usr/bin/env node
// Canonical runner-neutral skill and reviewer audit tool.
// Audits every canonical skill under .agents/skills/ and reviewer in .codex/agents/ against repository facts:
// - Valid YAML frontmatter (name, description)
// - Frontmatter name matches directory name
// - All relative markdown file links resolve to real files
// - All referenced scripts in scripts/ exist and are executable
// - Dynamically discovered partition offsets from partitions.csv match
// - Dynamically discovered HTTP endpoints from main/ match registered routes
// - Target architecture esp32s3 (sdkconfig.defaults)
// - Board RX/TX pins (XIAO RX=44/TX=43, AtomS3 Lite RX=1/TX=2)
// - Baseline pinning contracts for review skills
// - Stamp format contracts (bare short SHA: git rev-parse --short=12 HEAD)
// - Self-analysis and self-optimization section present
// - Completeness of skill-audit checklist against discovered skills and reviewers
// - Reviewer TOML configuration validity and referenced paths
//
// Usage: node tools/skill_audit/check_skills.mjs [--repo-root DIR] [--optimize | --fix]
// Exit: 0 = clean, 1 = drift/findings, 2 = usage/runtime error

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function die(code, message) {
  console.error(`skill-audit: ${message}`);
  process.exit(code);
}

let repoRoot = path.resolve(moduleDir, "../..");
let optimizeMode = false;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--repo-root") {
    repoRoot = path.resolve(process.argv[++i] || "");
  } else if (arg === "--optimize" || arg === "--fix") {
    optimizeMode = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log("Usage: check_skills.mjs [--repo-root DIR] [--optimize | --fix]");
    process.exit(0);
  } else {
    die(2, `unknown argument: ${arg}`);
  }
}

const skillsDir = path.join(repoRoot, ".agents/skills");
if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
  die(2, `skills directory missing: ${skillsDir}`);
}

const partitionsFile = path.join(repoRoot, "partitions.csv");
if (!fs.existsSync(partitionsFile)) {
  die(2, `partitions.csv missing: ${partitionsFile}`);
}

const partitionsContent = fs.readFileSync(partitionsFile, "utf8");

// 1. Dynamically discover all partition offsets and sizes from partitions.csv
function normalizeHex(val) {
  if (!val) return val;
  const str = val.trim().toLowerCase();
  if (str.startsWith("0x")) {
    try {
      return "0x" + BigInt(str).toString(16);
    } catch {
      return str;
    }
  }
  return str;
}

function parsePartitions(csvContent) {
  const partitions = new Map();
  for (const line of csvContent.split(/\r?\n/)) {
    const withoutComment = line.split("#")[0].trim();
    if (!withoutComment) continue;
    const parts = withoutComment.split(",").map((p) => p.trim());
    if (parts.length >= 5) {
      const name = parts[0];
      const type = parts[1];
      const subType = parts[2];
      const offset = normalizeHex(parts[3]);
      const size = normalizeHex(parts[4]);
      partitions.set(name, { name, type, subType, offset, size });
    }
  }
  return partitions;
}

const discoveredPartitions = parsePartitions(partitionsContent);
if (discoveredPartitions.size === 0) {
  die(2, `no valid partitions parsed from ${partitionsFile}`);
}

// 2. Dynamically discover registered HTTP endpoints from main/
function discoverHttpEndpoints(mainDir) {
  const endpoints = new Set([
    "/",
    "/index.html",
    "/favicon.ico",
    "/heat-pump-icon.png",
    "/locale.js",
    "/*",
  ]);
  if (!fs.existsSync(mainDir) || !fs.statSync(mainDir).isDirectory()) {
    return endpoints;
  }
  const files = fs.readdirSync(mainDir).filter((f) => f.endsWith(".cpp") || f.endsWith(".hpp"));
  for (const file of files) {
    const filePath = path.join(mainDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const regPattern = /http_register(?:_on)?\s*\([^,]+,\s*(?:[A-Za-z0-9_]+,\s*)?"(\/[^"]*)"/g;
    let m;
    while ((m = regPattern.exec(content)) !== null) {
      endpoints.add(m[1]);
    }
    const uriPattern = /\.uri\s*=\s*"(\/[^"]*)"/g;
    while ((m = uriPattern.exec(content)) !== null) {
      endpoints.add(m[1]);
    }
  }
  return endpoints;
}

const discoveredEndpoints = discoverHttpEndpoints(path.join(repoRoot, "main"));

// 3. Dynamically discover target architecture from sdkconfig.defaults
function discoverTargetArch(repoRootPath) {
  const sdkconfigFile = path.join(repoRootPath, "sdkconfig.defaults");
  if (fs.existsSync(sdkconfigFile)) {
    const content = fs.readFileSync(sdkconfigFile, "utf8");
    const m = content.match(/^CONFIG_IDF_TARGET="([^"]+)"/m);
    if (m) return m[1];
  }
  return "esp32s3";
}

const targetArch = discoverTargetArch(repoRoot);

// 4. Discover all canonical skills
const discoveredSkills = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// 5. Discover all reviewer configurations
const codexAgentsDir = path.join(repoRoot, ".codex/agents");
const discoveredReviewers = [];
if (fs.existsSync(codexAgentsDir) && fs.statSync(codexAgentsDir).isDirectory()) {
  const agentFiles = fs.readdirSync(codexAgentsDir)
    .filter((f) => f.endsWith(".toml"))
    .sort();

  for (const agentFile of agentFiles) {
    const agentPath = path.join(codexAgentsDir, agentFile);
    const content = fs.readFileSync(agentPath, "utf8");
    const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
    const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
    discoveredReviewers.push({
      file: agentFile,
      path: agentPath,
      name: nameMatch ? nameMatch[1] : path.basename(agentFile, ".toml"),
      desc: descMatch ? descMatch[1] : "",
      content,
    });
  }
}

let findingsCount = 0;
function finding(skill, message) {
  console.error(`[SKILL-DRIFT] ${skill}: ${message}`);
  findingsCount++;
}

// Review skills that require baseline pinning and stamp format checks
const reviewSkills = new Set([
  "absence-review",
  "diagnostic-evidence-review",
  "domain-review",
  "feature-docs",
  "pr-hygiene-review",
  "project-review",
  "renovate-review",
  "schematic-review",
  "skill-audit",
  "ui-gif",
  "ui-use-case-review",
  "user-docs-review",
]);

let optimizationsCount = 0;
function recordOptimization(message) {
  console.log(`[OPTIMIZE] ${message}`);
  optimizationsCount++;
}

// Audit each discovered skill
for (const skillName of discoveredSkills) {
  const skillFile = path.join(skillsDir, skillName, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    finding(skillName, "missing SKILL.md");
    continue;
  }

  let content = fs.readFileSync(skillFile, "utf8");
  let fileModified = false;
  const lines = content.split(/\r?\n/);

  // A. Frontmatter check
  if (lines[0] !== "---") {
    finding(skillName, "missing YAML frontmatter opener '---'");
    continue;
  }
  const endIdx = lines.indexOf("---", 1);
  if (endIdx < 0) {
    finding(skillName, "unterminated YAML frontmatter");
    continue;
  }

  const fmLines = lines.slice(1, endIdx);
  const fm = new Map();
  for (const fml of fmLines) {
    if (!fml.trim()) continue;
    const match = fml.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      finding(skillName, `invalid frontmatter line: ${fml}`);
      continue;
    }
    fm.set(match[1], match[2].trim());
  }

  if (fm.get("name") !== skillName) {
    finding(skillName, `frontmatter name '${fm.get("name")}' does not match directory '${skillName}'`);
  }
  if (!fm.get("description")) {
    finding(skillName, "frontmatter description is missing or empty");
  }

  const body = lines.slice(endIdx + 1).join("\n").trim();
  if (!body) {
    finding(skillName, "empty instruction body");
  }

  // B. Relative Markdown links check
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const rawTarget = match[2].split("#")[0].split("?")[0].trim();
    if (!rawTarget || /^(?:https?|mailto):/.test(rawTarget)) continue;
    if (rawTarget.startsWith("<") || rawTarget.endsWith(">")) continue;

    const targetPath = path.resolve(path.join(skillsDir, skillName), rawTarget);
    if (!fs.existsSync(targetPath)) {
      finding(skillName, `broken relative link '${match[2]}' (resolved to: ${targetPath})`);
    }
  }

  // C. Script references check (e.g. scripts/run-*.sh)
  const scriptRegex = /\b(scripts\/[A-Za-z0-9_.-]+\.(?:sh|py|mjs))\b/g;
  while ((match = scriptRegex.exec(content)) !== null) {
    const scriptRelative = match[1];
    const scriptPath = path.join(repoRoot, scriptRelative);
    if (!fs.existsSync(scriptPath)) {
      finding(skillName, `referenced script does not exist: ${scriptRelative}`);
    } else if (scriptRelative.endsWith(".sh")) {
      const st = fs.statSync(scriptPath);
      if ((st.mode & 0o111) === 0) {
        finding(skillName, `referenced script is not executable: ${scriptRelative}`);
      }
    }
  }

  // D. Dynamically discovered partition offset checks
  const partOffsetRegex = /\b([a-zA-Z0-9_]+)@(0x[0-9a-fA-F]+)\b/g;
  while ((match = partOffsetRegex.exec(content)) !== null) {
    const part = match[1].toLowerCase();
    const actualOffset = normalizeHex(match[2]);
    const partition = discoveredPartitions.get(part);
    if (!partition) {
      finding(skillName, `unknown partition '${match[0]}' (not in partitions.csv)`);
    } else {
      const expectedOffset = partition.offset;
      if (actualOffset !== expectedOffset) {
        if (optimizeMode) {
          content = content.replaceAll(match[0], `${part}@${expectedOffset}`);
          fileModified = true;
          recordOptimization(`${skillName}: corrected partition offset ${part}@${actualOffset} -> ${part}@${expectedOffset}`);
        } else {
          finding(skillName, `wrong ${part} offset '${match[0]}' (expected ${part}@${expectedOffset})`);
        }
      }
    }
  }

  const partPhraseRegex = /\b(nvs|otadata|phy_init|coredump|ota_0|ota_1|history)\s+(?:at|offset|\()\s*`?(0x[0-9a-fA-F]+)`?/gi;
  while ((match = partPhraseRegex.exec(content)) !== null) {
    const part = match[1].toLowerCase();
    const actualOffset = normalizeHex(match[2]);
    const partition = discoveredPartitions.get(part);
    if (partition) {
      const expectedOffset = partition.offset;
      if (actualOffset !== expectedOffset) {
        if (optimizeMode) {
          content = content.replaceAll(match[2], expectedOffset);
          fileModified = true;
          recordOptimization(`${skillName}: corrected partition offset ${part} ${actualOffset} -> ${expectedOffset}`);
        } else {
          finding(skillName, `wrong ${part} offset '${actualOffset}' (expected ${expectedOffset})`);
        }
      }
    }
  }

  // E. Board pin references check
  if (content.includes("XIAO ESP32-S3") || content.includes("XIAO")) {
    if (content.match(/XIAO.*?(?:RX\s*=\s*(\d+).*?TX\s*=\s*(\d+)|TX\s*=\s*(\d+).*?RX\s*=\s*(\d+))/s)) {
      const rx44 = /RX\s*=\s*44/.test(content);
      const tx43 = /TX\s*=\s*43/.test(content);
      if (!rx44 || !tx43) {
        finding(skillName, "XIAO ESP32-S3 pin assignment must cite RX=44/TX=43");
      }
    }
  }
  if (content.includes("AtomS3")) {
    if (content.match(/AtomS3.*?(?:RX\s*=\s*(\d+).*?TX\s*=\s*(\d+)|TX\s*=\s*(\d+).*?RX\s*=\s*(\d+))/s)) {
      const rx1 = /RX\s*=\s*1\b/.test(content);
      const tx2 = /TX\s*=\s*2\b/.test(content);
      if (!rx1 || !tx2) {
        finding(skillName, "AtomS3 Lite pin assignment must cite RX=1/TX=2");
      }
    }
  }

  // F. Target architecture check
  if (content.includes("esp32") && !content.includes(targetArch)) {
    // If target architecture is mentioned with wrong chip, flag it
    if (/\besp32(?:c3|s2|c6)\b/i.test(content) && !content.includes(targetArch)) {
      finding(skillName, `target architecture mismatch (expected ${targetArch})`);
    }
  }

  // G. Dynamic HTTP endpoint references check
  const candidateEndpoints = new Set();
  const filePrefixes = ["docs/", "main/", "scripts/", "tools/", "test/", ".agents/", ".codex/", ".github/"];

  function addCandidate(raw) {
    if (!raw) return;
    let ep = raw.split(/[?#]/)[0].replace(/[.,:;)]+$/, "");
    if (!ep || !ep.startsWith("/")) return;
    if (ep.startsWith("/tmp") || ep.startsWith("/dev") || ep.includes("<") || ep.includes(">") || ep === "/*") return;
    if (filePrefixes.some((pfx) => ep.startsWith("/" + pfx))) return;
    candidateEndpoints.add(ep);
  }

  // 1. Method + path (e.g. GET /status, POST to `/set_wifi`, GET `/index.html`)
  const methodEndpointRegex = /\b(?:GET|POST|PUT|DELETE)\s+(?:to\s+)?`?(\/[a-zA-Z0-9_./-]+)`?/g;
  while ((match = methodEndpointRegex.exec(content)) !== null) {
    addCandidate(match[1]);
  }

  // 2. curl commands targeting device host/IP
  const deviceHostPattern = /(?:https?:\/\/(?:daikin-altherma-esp32(?:\.local)?|localhost|127\.0\.0\.1|192\.168\.[0-9.]+|10\.[0-9.]+|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9.]+|\$(?:H|IP|HOST|TARGET|DEVICE_IP)\b|<[^>]+>)(?::\d+)?)(\/[a-zA-Z0-9_./-]+)/g;
  while ((match = deviceHostPattern.exec(content)) !== null) {
    addCandidate(match[1]);
  }

  // 3. Sentences/clauses mentioning endpoints or routes: match tokens in backticks or parens starting with /
  const epClauseRegex = /(?:endpoints?|routes?)\s*[:(]?\s*([^\n;]+?)(?:\.\s|\.$|$)/gi;
  while ((match = epClauseRegex.exec(content)) !== null) {
    const clause = match[1];
    const epMatches = clause.match(/(?:`|'|"|\(|\s)(\/[a-zA-Z0-9_./-]+)(?:`|'|"|\)|\s|$)/g) || [];
    for (const rawEp of epMatches) {
      const clean = rawEp.replace(/[`'"()\s]/g, "");
      addCandidate(clean);
    }
  }

  // 4. `/<path>` followed by endpoint(s) or route(s)
  const backtickEpRegex = /`(\/[a-zA-Z0-9_./-]+)`\s+(?:endpoints?|routes?)/gi;
  while ((match = backtickEpRegex.exec(content)) !== null) {
    addCandidate(match[1]);
  }

  for (const ep of candidateEndpoints) {
    if (!discoveredEndpoints.has(ep)) {
      finding(skillName, `unknown or removed HTTP endpoint '${ep}'`);
    }
  }

  // J. Repository file references check
  const fileRefRegex = /`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)`/g;
  const knownPrefixes = [
    "main/",
    "docs/",
    "scripts/",
    "tools/",
    "test/",
    ".agents/",
    ".codex/",
    ".github/",
  ];
  while ((match = fileRefRegex.exec(content)) !== null) {
    const refPath = match[1];
    if (knownPrefixes.some((pfx) => refPath.startsWith(pfx))) {
      if (refPath.includes("*") || refPath.includes("<") || refPath.includes(">")) continue;
      const resolved = path.join(repoRoot, refPath);
      if (!fs.existsSync(resolved)) {
        finding(skillName, `referenced repository file does not exist: ${refPath}`);
      }
    }
  }

  // H. Review skills baseline pinning and stamp format
  if (reviewSkills.has(skillName)) {
    const lower = content.toLowerCase();
    const hasBaseline = lower.includes("pin the baseline") || lower.includes("step 0");
    if (!hasBaseline) {
      finding(skillName, "review skill missing baseline pinning contract ('pin the baseline')");
    }
    const hasStamp = content.includes("git rev-parse --short=12 HEAD") || content.includes("<short-sha>");
    if (!hasStamp) {
      finding(skillName, "review skill missing short SHA stamp contract ('git rev-parse --short=12 HEAD')");
    }
  }

  // I. Self-analysis and self-optimization section check
  const hasSelfAnalysis = /##.*(?:Self-analysis|Self-optimization|self-analysis|self-optimization)/i.test(content);
  if (!hasSelfAnalysis) {
    finding(skillName, "skill missing 'Self-analysis and review audit' (or self-optimization) section");
  }

  if (fileModified) {
    fs.writeFileSync(skillFile, content, "utf8");
  }
}

// 6. Reviewer TOML configuration checks
for (const reviewer of discoveredReviewers) {
  const content = reviewer.content;
  const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
  const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
  const modeMatch = content.match(/^sandbox_mode\s*=\s*"([^"]+)"/m);

  let instructions = "";
  const multiDoubleMatch = content.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/);
  const multiSingleMatch = content.match(/developer_instructions\s*=\s*'''([\s\S]*?)'''/);
  const singleMatch = content.match(/developer_instructions\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (multiDoubleMatch) instructions = multiDoubleMatch[1];
  else if (multiSingleMatch) instructions = multiSingleMatch[1];
  else if (singleMatch) instructions = singleMatch[1];

  if (!nameMatch) {
    finding(`reviewer:${reviewer.file}`, "missing name in TOML");
  }
  if (!descMatch) {
    finding(`reviewer:${reviewer.file}`, "missing description in TOML");
  }
  if (!modeMatch || modeMatch[1] !== "read-only") {
    finding(`reviewer:${reviewer.file}`, "sandbox_mode must be 'read-only'");
  }
  if (!instructions.trim()) {
    finding(`reviewer:${reviewer.file}`, "empty developer_instructions");
  } else {
    const filePattern = /\b((?:docs|main|scripts|tools|test|\.agents|\.codex)\/[A-Za-z0-9_.-]+\.[a-zA-Z0-9]+|AGENTS\.md)\b/g;
    let fMatch;
    while ((fMatch = filePattern.exec(instructions)) !== null) {
      const candidate = fMatch[1].replace(/[.,:;]+$/, "");
      const refPath = path.join(repoRoot, candidate);
      if (!fs.existsSync(refPath)) {
        finding(`reviewer:${reviewer.file}`, `referenced file does not exist: ${candidate}`);
      }
    }
  }
}

// 7. Skill-Audit Self-Audit & Self-Optimization
const skillAuditFile = path.join(skillsDir, "skill-audit/SKILL.md");
if (fs.existsSync(skillAuditFile)) {
  const originalSkillAuditContent = fs.readFileSync(skillAuditFile, "utf8");
  let skillAuditContent = originalSkillAuditContent;

  // Verify partition offset examples in line 31
  const expectedOffsetList = [...discoveredPartitions.entries()]
    .map(([name, p]) => `\`${name}@${p.offset}\``)
    .join(", ");
  const partitionLineRegex = /partition offset \([^)]+\)/;
  const expectedPartitionLine = `partition offset (${expectedOffsetList})`;
  const partitionLineMatch = skillAuditContent.match(partitionLineRegex);
  const partitionExamplesInSync = partitionLineMatch && partitionLineMatch[0] === expectedPartitionLine;

  if (!partitionExamplesInSync) {
    if (optimizeMode) {
      if (partitionLineRegex.test(skillAuditContent)) {
        skillAuditContent = skillAuditContent.replace(partitionLineRegex, expectedPartitionLine);
        recordOptimization("skill-audit: synchronized partition offset examples with partitions.csv");
      }
    } else {
      finding("skill-audit", "partition offset examples in line 31 are out of sync with partitions.csv (run with --optimize to auto-sync)");
    }
  }

  // Extract checklist entries
  const checklistMatch = skillAuditContent.match(/## Per-target checklist[\s\S]*?(?=## Self-analysis|$)/);
  if (!checklistMatch) {
    finding("skill-audit", "could not find '## Per-target checklist' section in skill-audit/SKILL.md");
  } else {
    const checklistText = checklistMatch[0];

    const listedSkills = new Map();
    const listedReviewers = new Map();

    const skillsSectionMatch = checklistText.match(/\*\*Skills\*\*[^\n]*\n([\s\S]*?)(?=\*\*Reviewers\*\*|$)/);
    if (skillsSectionMatch) {
      const raw = skillsSectionMatch[1];
      const items = raw.split(/\n(?=- \*\*\`\$)/);
      for (const it of items) {
        const trimmed = it.trim();
        const m = trimmed.match(/^- \*\*\`\$([a-zA-Z0-9_-]+)\`\*\*/);
        if (m) {
          listedSkills.set(m[1], trimmed);
        }
      }
    }

    const reviewersSectionMatch = checklistText.match(/\*\*Reviewers\*\*[^\n]*\n([\s\S]*)$/);
    if (reviewersSectionMatch) {
      const raw = reviewersSectionMatch[1];
      const items = raw.split(/\n(?=- \*\*\`)/);
      for (const it of items) {
        const trimmed = it.trim();
        const m = trimmed.match(/^- \*\*\`([a-zA-Z0-9_-]+)\`\*\*/);
        if (m) {
          listedReviewers.set(m[1], trimmed);
        }
      }
    }

    const missingSkills = discoveredSkills.filter((s) => !listedSkills.has(s));
    const staleSkills = [...listedSkills.keys()].filter((s) => !discoveredSkills.includes(s));

    const reviewerNames = discoveredReviewers.map((r) => r.name);
    const missingReviewers = reviewerNames.filter((r) => !listedReviewers.has(r));
    const staleReviewers = [...listedReviewers.keys()].filter((r) => !reviewerNames.includes(r));

    // Self-optimization execution
    if (optimizeMode) {
      let checklistModified = false;

      // Build updated skills list
      const updatedSkillItems = [];
      for (const s of discoveredSkills) {
        if (listedSkills.has(s)) {
          updatedSkillItems.push(listedSkills.get(s));
        } else {
          // Generate new canonical checklist item from skill metadata
          const newSkillPath = path.join(skillsDir, s, "SKILL.md");
          let desc = "canonical project workflow";
          let refs = [];
          if (fs.existsSync(newSkillPath)) {
            const rawContent = fs.readFileSync(newSkillPath, "utf8");
            const descMatch = rawContent.match(/^description:\s*(.*)$/m);
            if (descMatch) desc = descMatch[1].trim().replace(/\.+$/, "");
            const refMatches = rawContent.match(/\b((?:scripts|main\/logic|docs)\/[A-Za-z0-9_.-]+)\b/g);
            if (refMatches) {
              refs = [...new Set(refMatches.map((r) => r.replace(/[.,:;]+$/, "")))].slice(0, 4);
            }
          }
          const refStr = refs.length > 0 ? ` Verify against ${refs.map(r => `\`${r}\``).join(", ")}.` : "";
          updatedSkillItems.push(`- **\`$${s}\`** — ${desc}.${refStr}`);
          recordOptimization(`skill-audit: added missing skill '$${s}' to Per-target checklist`);
          checklistModified = true;
        }
      }

      if (staleSkills.length > 0) {
        recordOptimization(`skill-audit: pruned removed skill(s) [${staleSkills.join(", ")}] from Per-target checklist`);
        checklistModified = true;
      }

      // Build updated reviewers list
      const updatedReviewerItems = [];
      for (const r of discoveredReviewers) {
        if (listedReviewers.has(r.name)) {
          updatedReviewerItems.push(listedReviewers.get(r.name));
        } else {
          const desc = (r.desc || "read-only reviewer").replace(/\.+$/, "");
          updatedReviewerItems.push(`- **\`${r.name}\`** (\`.codex/agents/${r.file}\`) — ${desc}.`);
          recordOptimization(`skill-audit: added missing reviewer '${r.name}' to Per-target checklist`);
          checklistModified = true;
        }
      }

      if (staleReviewers.length > 0) {
        recordOptimization(`skill-audit: pruned removed reviewer(s) [${staleReviewers.join(", ")}] from Per-target checklist`);
        checklistModified = true;
      }

      // Format updated checklist
      const newChecklistSection = [
        "## Per-target checklist (what each skill/agent must stay true to)",
        "",
        "Discover the list at runtime (step 1); this is the authoritative map of what each current",
        "skill/reviewer asserts:",
        "",
        "**Skills** (`.agents/skills/`):",
        "",
        updatedSkillItems.join("\n"),
        "",
        "**Reviewers** (`.codex/agents/`):",
        "",
        updatedReviewerItems.join("\n"),
        "",
      ].join("\n");

      if (checklistModified || checklistText.trim() !== newChecklistSection.trim()) {
        skillAuditContent = skillAuditContent.replace(checklistText, newChecklistSection);
        recordOptimization("skill-audit: synchronized Per-target checklist with repository facts");
      }
    } else {
      // Read-only audit reporting
      if (missingSkills.length > 0) {
        finding("skill-audit", `Per-target checklist missing discovered skill(s): ${missingSkills.join(", ")} (run with --optimize to auto-sync)`);
      }
      if (staleSkills.length > 0) {
        finding("skill-audit", `Per-target checklist contains non-existent skill(s): ${staleSkills.join(", ")} (run with --optimize to auto-sync)`);
      }
      if (missingReviewers.length > 0) {
        finding("skill-audit", `Per-target checklist missing discovered reviewer(s): ${missingReviewers.join(", ")} (run with --optimize to auto-sync)`);
      }
      if (staleReviewers.length > 0) {
        finding("skill-audit", `Per-target checklist contains non-existent reviewer(s): ${staleReviewers.join(", ")} (run with --optimize to auto-sync)`);
      }
    }
  }

  if (optimizeMode && skillAuditContent !== originalSkillAuditContent) {
    fs.writeFileSync(skillAuditFile, skillAuditContent, "utf8");
  }
}

if (findingsCount > 0) {
  console.error(`\nskill-audit failed with ${findingsCount} finding(s).`);
  process.exit(1);
}

if (optimizeMode) {
  if (optimizationsCount > 0) {
    console.log(`skill-audit: self-optimized and synchronized ${optimizationsCount} item(s) successfully.`);
  } else {
    console.log("skill-audit: already optimal and in sync with repository facts.");
  }
}

console.log(`skill-audit: all ${discoveredSkills.length} skills and reviewer agents clean and verified against repository facts.`);
process.exit(0);
