import fs from "node:fs";
import path from "node:path";

// Repository documentation is English-only. Localized UI strings belong in main/www, not in the
// maintained guides, contributor documentation, review skills, or agent instruction/config files.
// This intentionally uses a small, high-confidence German-language signature instead of pretending
// to be a general language model.
const GERMAN_CHARACTERS = /[ÄÖÜäöüß]/u;
const HIGH_CONFIDENCE_GERMAN = /\b(?:beziehungsweise|durchgehend|einfach|fachbetrieb|gerätemeldung|hinweis|keine|keinen|keiner|können|müssen|nicht|pflege-regel|projektanteil|prüfung|prüft|rückregelungen|störung|übernommen|verfügbar|vollständig|während|warnung|wenn|werden|wurde|wurden|zusätzlich|zusatzheizer)\b/iu;
const GERMAN_FUNCTION_WORDS = /\b(?:das|dass|dem|den|des|diese|dieser|dieses|eine|einem|einen|einer|kein|keine|keinen|keiner|nicht|sich|sind|und|vom|wenn|wird|werden|zum|zur)\b/giu;

const ROOT_DOCS = [
  "AGENTS.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "main/www/js/README.md",
  "test/README.md",
];
const DOC_TREES = [
  { path: "docs", extensions: [".md"] },
  { path: ".agents/skills", extensions: [".md", ".yaml", ".yml"] },
  { path: ".codex", extensions: [".md", ".toml"] },
];

// Shared with tools/pr_hygiene/, which applies the same shape to PR titles/descriptions and commit
// messages instead of doc files. One predicate, so a threshold tuned here cannot quietly diverge
// from what the PR-text gate enforces.
export function isLikelyGerman(line) {
  const functionWords = [...line.matchAll(GERMAN_FUNCTION_WORDS)].length;
  return GERMAN_CHARACTERS.test(line) || HIGH_CONFIDENCE_GERMAN.test(line) || functionWords >= 2;
}

function documentationTreeFiles(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...documentationTreeFiles(target, extensions));
    else if (entry.isFile() && extensions.includes(path.extname(entry.name))) files.push(target);
  }
  return files;
}

export function documentationFiles(root) {
  const files = ROOT_DOCS.map((relative) => path.join(root, relative)).filter(fs.existsSync);
  for (const tree of DOC_TREES) {
    files.push(...documentationTreeFiles(path.join(root, tree.path), tree.extensions));
  }
  return [...new Set(files)].sort();
}

export function auditEnglishDocumentation(root) {
  const findings = [];
  for (const file of documentationFiles(root)) {
    const relative = path.relative(root, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!isLikelyGerman(line)) continue;
      findings.push({
        code: "U014",
        subject: `${relative}:${index + 1}`,
        message: "repository documentation must be written in English",
      });
    }
  }
  return findings;
}
