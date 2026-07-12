import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";

/**
 * Structural guardrails: UI components must stay presentational. Scoring,
 * matching, and product-mapping logic must live only in
 * src/lib/signal-agent/*, never inside a React component or an inline
 * conditional in the API route/page layer.
 */

const COMPONENTS_DIR = path.join(process.cwd(), "src", "components", "signal-agent");
const FORBIDDEN_LOGIC_IMPORTS = [
  "@/lib/signal-agent/loadCatalog",
  "@/lib/signal-agent/scoring",
  "@/lib/signal-agent/keywordMatch",
  "@/lib/signal-agent/semanticMatch",
  "@/lib/signal-agent/accountContext",
  "@/lib/signal-agent/routing",
  "@/lib/signal-agent/notification",
  "@/lib/signal-agent/auditLog",
  "@/lib/signal-agent/runAgent"
];

function componentFiles(): string[] {
  return readdirSync(COMPONENTS_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => path.join(COMPONENTS_DIR, name));
}

describe("Signal-to-Solution UI components stay presentational", () => {
  it("never import the scoring/matching/catalog engine modules directly", () => {
    for (const filePath of componentFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const forbidden of FORBIDDEN_LOGIC_IMPORTS) {
        expect(source, `${path.basename(filePath)} should not import ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("never hard-code a taxonomy entry id that only exists in the loaded catalog JSON", () => {
    const catalog = getCatalog();
    const entryIds = catalog.entries.map((entry) => entry.id);
    // A handful of real ids from the shipped JSON — if any of these appear
    // as literal strings in component source, the UI is hard-coding
    // category ids instead of rendering whatever the API returns.
    const sampleIds = entryIds.slice(0, 10);

    for (const filePath of componentFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const id of sampleIds) {
        expect(source, `${path.basename(filePath)} should not hard-code entry id "${id}"`).not.toContain(id);
      }
    }
  });

  it("never hard-code a specific specialist string from the catalog", () => {
    const catalog = getCatalog();
    const specialists = Array.from(new Set(catalog.entries.map((entry) => entry.recommendedSpecialist).filter(Boolean))) as string[];

    for (const filePath of componentFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const specialist of specialists) {
        expect(source, `${path.basename(filePath)} should not hard-code specialist "${specialist}"`).not.toContain(specialist);
      }
    }
  });
});

describe(".env.local is never touched by application code", () => {
  it("no source file under src/ references .env.local by path", () => {
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue; // this assertion's own literal doesn't count
        const source = readFileSync(fullPath, "utf8");
        if (source.includes(".env.local")) offenders.push(fullPath);
      }
    }

    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
