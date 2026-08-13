import fs from "node:fs";
import path from "node:path";

// Repository documentation is English-only. Localized UI strings belong in main/www, not in the
// maintained guides, contributor documentation, or review skills. This intentionally uses a small,
// high-confidence German-language signature instead of pretending to be a general language model.
const GERMAN_CHARACTERS = /[ÄÖÜäöüß]/u;
const HIGH_CONFIDENCE_GERMAN = /\b(?:beziehungsweise|durchgehend|einfach|fachbetrieb|gerätemeldung|hinweis|keine|keinen|keiner|können|müssen|nicht|pflege-regel|projektanteil|prüfung|prüft|rückregelungen|störung|übernommen|verfügbar|vollständig|während|warnung|wenn|werden|wurde|wurden|zusätzlich|zusatzheizer)\b/iu;
const GERMAN_FUNCTION_WORDS = /\b(?:das|dass|dem|den|des|diese|dieser|dieses|eine|einem|einen|einer|kein|keine|keinen|keiner|nicht|sich|sind|und|vom|wenn|wird|werden|zum|zur)\b/giu;

const ROOT_DOCS = [
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  ".claude/CLAUDE.md",
  "main/www/js/README.md",
  "test/README.md",
];
const DOC_TREES = ["docs", ".claude/agents", ".claude/skills"];

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
}

export function documentationFiles(root) {
  const files = ROOT_DOCS.map((relative) => path.join(root, relative)).filter(fs.existsSync);
  for (const relative of DOC_TREES) files.push(...markdownFiles(path.join(root, relative)));
  return [...new Set(files)].sort();
}

export function auditEnglishDocumentation(root) {
  const findings = [];
  for (const file of documentationFiles(root)) {
    const relative = path.relative(root, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const functionWords = [...line.matchAll(GERMAN_FUNCTION_WORDS)].length;
      if (!GERMAN_CHARACTERS.test(line) && !HIGH_CONFIDENCE_GERMAN.test(line) && functionWords < 2) continue;
      findings.push({
        code: "U014",
        subject: `${relative}:${index + 1}`,
        message: "repository documentation must be written in English",
      });
    }
  }
  return findings;
}
