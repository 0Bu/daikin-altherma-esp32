// Shared structural contract for docs/DIAGNOSTIC_EVIDENCE.md.
//
// The user-docs gate uses this module to prevent authoritative-looking but unsupported prose. The
// dedicated diagnostic-evidence gate adds the review fingerprint that binds this ledger to the
// production evaluator. Keep the structural rules in one place so the two gates cannot drift.

const HEADING = /^###\s+\d+\.\s+.+\(`([a-z0-9_]+)`\)\s*$/gm;
const SOURCE_ANCHOR = /<a id="source-((?:d|e|r)\d+)"><\/a>/g;
const SOURCE_ID = /\[((?:D|E|R)\d+)\]/g;

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

export function auditEvidenceContract(evidence, rowIds, evidenceArg = "docs/DIAGNOSTIC_EVIDENCE.md") {
  const findings = [];
  const add = (code, subject, message) => findings.push({ code, subject, message });
  const headings = [...evidence.matchAll(HEADING)];
  const headingCounts = new Map();
  for (const heading of headings) {
    headingCounts.set(heading[1], (headingCounts.get(heading[1]) || 0) + 1);
  }

  for (const id of rowIds) {
    const count = headingCounts.get(id) || 0;
    if (count !== 1) add("E001", id, `evidence section must appear exactly once (found ${count})`);
  }
  for (const [id, count] of headingCounts) {
    if (!rowIds.includes(id)) add("E001", id, "stale evidence section has no visible diagnosis row");
    if (count > 1) add("E001", id, `evidence section is duplicated (${count})`);
  }

  const sourcesAt = evidence.indexOf("\n## Quellen");
  const citedSourceIds = new Set();
  // A new diagnosis is conservative by default: only the two direct device-reporting rows are
  // exempt from an explicit project/experimental boundary. Extending this allow-list is therefore
  // a deliberate gate change, not something a new row gets for free.
  const boundaryExemptIds = new Set(["fault", "heater"]);

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const id = heading[1];
    if (!rowIds.includes(id)) continue;
    const nextHeading = headings[i + 1]?.index ?? evidence.length;
    const end = sourcesAt > heading.index ? Math.min(nextHeading, sourcesAt) : nextHeading;
    const block = evidence.slice(heading.index, end);
    const labels = [
      ["E002", "**Extern belegt:**"],
      ["E003", "**Firmware-Regel:**"],
      ["E004", "**Nicht bewiesen:**"],
    ];
    for (const [code, label] of labels) {
      const count = occurrences(block, label);
      if (count !== 1) add(code, id, `evidence section needs '${label}' exactly once (found ${count})`);
    }

    const externalStart = block.indexOf("**Extern belegt:**");
    const firmwareStart = block.indexOf("**Firmware-Regel:**");
    const externalClaim = externalStart >= 0
      ? block.slice(externalStart, firmwareStart > externalStart ? firmwareStart : block.length)
      : "";
    const blockSources = [...externalClaim.matchAll(SOURCE_ID)].map((match) => match[1]);
    if (blockSources.length === 0) {
      add("E006", id, "'Extern belegt' needs a source identifier such as [D1], [E1] or [R1]");
    }
    for (const sourceId of blockSources) citedSourceIds.add(sourceId);

    if (!boundaryExemptIds.has(id) &&
        !block.includes("**Projektanteil:**") && !block.includes("**Experimentelle Grenze:**")) {
      add("E005", id, "project or experimental boundary must be named explicitly");
    }
  }

  if (sourcesAt < 0) add("E007", evidenceArg, "evidence ledger needs a '## Quellen' source catalog");
  if (!evidence.includes("## Pflege-Regel")) {
    add("E007", evidenceArg, "evidence ledger needs its maintenance rule");
  }

  const definitions = new Map();
  for (const match of evidence.matchAll(/^\[([A-Za-z0-9-]+)\]:\s+(https:\/\/\S+)\s*$/gm)) {
    definitions.set(match[1], match[2]);
  }
  const anchors = [...evidence.matchAll(SOURCE_ANCHOR)];
  const catalogIds = new Set(anchors.map((match) => match[1].toUpperCase()));
  for (const sourceId of citedSourceIds) {
    const slug = sourceId.toLowerCase();
    const anchor = `<a id="source-${slug}"></a>`;
    const anchorCount = occurrences(evidence, anchor);
    if (anchorCount !== 1) {
      add("E008", sourceId, `source anchor must appear exactly once (found ${anchorCount})`);
      continue;
    }
    const start = evidence.indexOf(anchor);
    const next = evidence.indexOf('<a id="source-', start + anchor.length);
    const sourceBlock = evidence.slice(start, next < 0 ? evidence.length : next);
    if (!sourceBlock.includes(`- **[${sourceId}]**`)) {
      add("E008", sourceId, "source catalog entry is missing");
    }
    if (!new RegExp(`^\\[${sourceId}\\]: #source-${slug}$`, "m").test(evidence)) {
      add("E008", sourceId, "citation must link back to its source catalog entry");
    }

    const linkLabels = [...sourceBlock.matchAll(/\]\[([A-Za-z0-9-]+)\]/g)].map((match) => match[1]);
    const resolvedUrls = linkLabels.map((label) => definitions.get(label)).filter(Boolean);
    if (resolvedUrls.length === 0) {
      add("E009", sourceId, "source entry needs a resolved HTTPS source link");
    }
    if (sourceId.startsWith("D")) {
      if (!/Modelle?\s/i.test(sourceBlock) || !/Dokument\s+\*\*[^*]+\*\*/i.test(sourceBlock) ||
          !/Revision\s+\d{4}-\d{2}/i.test(sourceBlock) || !/(Abschnitt|Stelle)/i.test(sourceBlock)) {
        add("E009", sourceId,
          "manufacturer source needs models, document number, revision and used section");
      }
      const officialDaikin = resolvedUrls.some((value) => {
        try { return /(^|\.)daikin\./i.test(new URL(value).hostname); }
        catch { return false; }
      });
      if (!officialDaikin) add("E009", sourceId, "manufacturer source needs an official Daikin HTTPS URL");
    }
  }
  for (const sourceId of catalogIds) {
    if (!citedSourceIds.has(sourceId)) add("E008", sourceId, "source catalog entry is not cited by a diagnosis");
  }

  return findings;
}
