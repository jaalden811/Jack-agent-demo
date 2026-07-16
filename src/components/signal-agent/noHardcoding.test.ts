import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  "@/lib/signal-agent/runAgent",
  "@/lib/signal-agent/polarity",
  "@/lib/signal-agent/intentExtraction",
  "@/lib/signal-agent/ruleEvaluation",
  "@/lib/signal-agent/commercialSignals",
  "@/lib/signal-agent/publicSignals",
  "@/lib/signal-agent/status",
  "@/lib/webex/client",
  "@/lib/webex/store",
  "@/lib/webex/tokenManager",
  "@/lib/webex/peachtreeRouting",
  "@/lib/webex/automation",
  "@/lib/webex/delivery",
  "@/lib/webex/messageBuilder",
  "@/lib/webex/transcriptNormalizer"
];

function componentFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(fullPath);
      }
    }
  }
  walk(COMPONENTS_DIR);
  return files;
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

describe("Peachtree pilot recipient emails are never hard-coded", () => {
  it("no source file under src/ contains the pilot recipient emails literally", () => {
    const offenders: string[] = [];
    const forbiddenEmails = ["belrobin@cisco.com", "jaalden@cisco.com"];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue; // this assertion's own literals don't count
        const source = readFileSync(fullPath, "utf8");
        if (forbiddenEmails.some((email) => source.includes(email))) offenders.push(fullPath);
      }
    }

    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

describe("Webex delivery never hard-codes a room ID", () => {
  it("messageBuilder and delivery send by toPersonEmail only — no roomId literal", () => {
    const files = [
      path.join(process.cwd(), "src", "lib", "webex", "messageBuilder.ts"),
      path.join(process.cwd(), "src", "lib", "webex", "delivery.ts"),
      path.join(process.cwd(), "src", "lib", "webex", "client.ts")
    ];
    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8");
      expect(source, `${path.basename(filePath)} should not send by a hard-coded roomId`).not.toMatch(/roomId:\s*["'`]/);
    }
  });
});

describe("Setup drawer surfaces the Circuit AI-provider status and the Webex scope diagnostics", () => {
  it("SetupDrawer's AI providers tab shows Circuit configured/contract/model/operational status", () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, "SetupDrawer.tsx"), "utf8");
    expect(source).toContain("agentStatus?.ai_provider.configured");
    expect(source).toContain("agentStatus?.ai_provider.contract_confirmed");
    expect(source).toContain("agentStatus?.ai_provider.model");
    expect(source).toContain("agentStatus?.ai_provider.operational");
    expect(source).toContain("agentStatus?.ai_provider.state");
    expect(source).toContain("Test Circuit");
    expect(source).toContain("Test Search");
  });

  it("SetupDrawer's Webex tab shows requested scopes, copy/reset actions, and the incremental scope tests", () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, "SetupDrawer.tsx"), "utf8");
    expect(source).toContain("Requested scopes");
    expect(source).toContain("Copy requested scopes");
    expect(source).toContain("Copy redirect URI");
    expect(source).toContain("Retry connection");
    expect(source).toContain("Reset Webex OAuth state");
    expect(source).toContain("Test basic Webex connection");
    expect(source).toContain("Server configuration");
  });

  it("TopBar shows a top-level AI readiness badge", () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, "TopBar.tsx"), "utf8");
    expect(source).toContain("AI:");
  });
});

describe("The main signal-agent page no longer shows the large integration diagnostics panel", () => {
  it("SignalAgentWorkspace renders a compact Setup drawer instead of always-on integration panels", () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, "SignalAgentWorkspace.tsx"), "utf8");
    expect(source).toContain("SetupDrawer");
    expect(source).not.toContain("IntegrationsPanel");
    expect(source).not.toContain("WebexIntegrationPanel");
  });

  it("removed the old always-expanded WebexIntegrationPanel and IntegrationsPanel components", () => {
    const removedFiles = [path.join(COMPONENTS_DIR, "IntegrationsPanel.tsx"), path.join(COMPONENTS_DIR, "webex", "WebexIntegrationPanel.tsx")];
    for (const filePath of removedFiles) {
      expect(existsSync(filePath), `${filePath} should have been removed in favor of SetupDrawer`).toBe(false);
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
