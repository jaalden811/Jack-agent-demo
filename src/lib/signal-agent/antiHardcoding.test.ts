import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guardrail: the regression fixture
 * (signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt)
 * and its exact content must never leak into production decision logic.
 * The engine must remain generic and data-driven — every product/
 * category decision must come from the taxonomy JSON and generic
 * evidence scoring, never from a special case tied to this one
 * transcript's wording, speakers, or expected score.
 *
 * Scans only production source directories — test files and the
 * fixture file itself are explicitly exempt, since fixture content and
 * test assertions are exactly where this content is supposed to live.
 */

const PRODUCTION_DIRS = ["src/lib/signal-agent", "src/lib/qualification", "src/lib/webex", "src/app/api/signal-agent", "src/lib/account-resolution", "src/lib/opportunity-fit", "src/lib/connectors/serpapi"];

const FIXTURE_FILENAME = "splunk_platform_rationalization";

// Long, distinctive phrases lifted verbatim from the fixture — long
// enough that they could only appear via a copy-paste special case,
// never via coincidental generic wording.
const EXACT_FIXTURE_PHRASES = [
  "platform rationalization",
  "Vertex Industrial Holdings",
  "$1.8 million in delayed orders",
  "recreate the May incident",
  "ordering-service architecture",
  "identifying the likely failure path in under 20 minutes"
];

// The fixture's full speaker set — checked as a SET (all names present
// together in one file), never as individual names, since a single
// common first name appearing alone in an unrelated comment/example is
// not evidence of fixture-specific hardcoding (e.g. other fixtures also
// use short first names like "Maya" or "Daniel").
const FIXTURE_SPEAKER_SET = ["Maya", "Erin", "Marcus", "Tom", "Priya", "Daniel", "Leah"];

// Taxonomy entry ids that must never be referenced as a literal,
// special-cased string in production logic — all category/product
// selection must flow generically through the loaded catalog, never a
// hard-coded id check such as `if (entry.id === "siem_compliance")`.
const FIXTURE_RELEVANT_ENTRY_IDS = ["siem_compliance", "cloud_native_observability"];

function isExemptPath(filePath: string): boolean {
  return /\.test\.tsx?$/.test(filePath) || filePath.includes(`${path.sep}data${path.sep}transcripts${path.sep}`);
}

function collectSourceFiles(rootRelative: string): string[] {
  const root = path.join(process.cwd(), rootRelative);
  const files: string[] = [];
  function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (isExemptPath(fullPath)) continue;
      files.push(fullPath);
    }
  }
  walk(root);
  return files;
}

function allProductionFiles(): string[] {
  return PRODUCTION_DIRS.flatMap((dir) => collectSourceFiles(dir));
}

describe("Anti-hardcoding: the Splunk regression fixture must never leak into production logic", () => {
  it("never references the fixture filename outside test/fixture files", () => {
    const offenders: string[] = [];
    for (const filePath of allProductionFiles()) {
      const source = readFileSync(filePath, "utf8");
      if (source.includes(FIXTURE_FILENAME)) offenders.push(filePath);
    }
    expect(offenders, `files referencing the fixture filename: ${offenders.join(", ")}`).toEqual([]);
  });

  it("never contains an exact long phrase copied verbatim from the fixture", () => {
    const offenders: Array<{ file: string; phrase: string }> = [];
    for (const filePath of allProductionFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const phrase of EXACT_FIXTURE_PHRASES) {
        if (source.includes(phrase)) offenders.push({ file: filePath, phrase });
      }
    }
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("never contains the fixture's full speaker set together (evidence of a special-cased branch for this exact transcript)", () => {
    const offenders: string[] = [];
    for (const filePath of allProductionFiles()) {
      const source = readFileSync(filePath, "utf8");
      const containsAll = FIXTURE_SPEAKER_SET.every((name) => new RegExp(`\\b${name}\\b`).test(source));
      if (containsAll) offenders.push(filePath);
    }
    expect(offenders, `files containing the entire fixture speaker set: ${offenders.join(", ")}`).toEqual([]);
  });

  it("never special-cases a taxonomy entry id the fixture happens to resolve to", () => {
    const offenders: Array<{ file: string; id: string }> = [];
    for (const filePath of allProductionFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const id of FIXTURE_RELEVANT_ENTRY_IDS) {
        // A literal string match for the entry id anywhere in production
        // logic is disallowed — every category/product decision must be
        // generic and data-driven from the loaded catalog, never keyed
        // to a specific id this fixture happens to score highest.
        if (source.includes(`"${id}"`) || source.includes(`'${id}'`)) offenders.push({ file: filePath, id });
      }
    }
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("never hard-codes a hyphenated word from the fixture's parser stress-test phrases as a special case", () => {
    const offenders: Array<{ file: string; phrase: string }> = [];
    const stressWords = ["cross-environment", "customer-service overtime", "business-service reliability", "sensitive-field masking"];
    for (const filePath of allProductionFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const phrase of stressWords) {
        if (source.includes(phrase)) offenders.push({ file: filePath, phrase });
      }
    }
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });
});
