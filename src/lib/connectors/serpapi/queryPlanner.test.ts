import { describe, expect, it } from "vitest";
import { planSerpApiQueries, isGenericAccountName } from "@/lib/connectors/serpapi/queryPlanner";
import type { QueryPlannerInput } from "@/lib/connectors/serpapi/types";

function baseInput(overrides: Partial<QueryPlannerInput> = {}): QueryPlannerInput {
  return {
    account_candidates: [{ name: "Meridian Health Systems", domain: null, confidence: 0.6 }],
    company_domains: [],
    stakeholders: [],
    selected_taxonomy_entries: [],
    detected_products: [],
    buying_signals: [],
    commercial_signals: [],
    lifecycle_stage: "ADOPT",
    meddpicc_gaps: [],
    mentions_incident: false,
    mentions_competitor: false,
    location: null,
    ...overrides
  };
}

describe("isGenericAccountName — blocks demo/synthetic identities (Section 2)", () => {
  it.each(["Unknown", "Not stated", "Demo Account", "Customer", "Test Account", "Sample Company", "Global Retail Operations", "Example Corporation", ""])(
    "treats %s as generic",
    (name) => {
      expect(isGenericAccountName(name)).toBe(true);
    }
  );

  it("does not block a real company name", () => {
    expect(isGenericAccountName("Meridian Health Systems")).toBe(false);
  });

  it("treats null/undefined as generic", () => {
    expect(isGenericAccountName(null)).toBe(true);
    expect(isGenericAccountName(undefined)).toBe(true);
  });
});

describe("planSerpApiQueries — data-driven, evidence-gated query generation", () => {
  it("generates no queries when there is no real (non-generic) account candidate", () => {
    const queries = planSerpApiQueries(baseInput({ account_candidates: [{ name: "Unknown", domain: null, confidence: 0.9 }] }));
    expect(queries).toHaveLength(0);
  });

  it("never exceeds 8 queries even when every category is triggered", () => {
    const queries = planSerpApiQueries(
      baseInput({
        account_candidates: [{ name: "Meridian Health Systems", domain: null, confidence: 0.5 }],
        stakeholders: [{ name: "Priya Nair", title: "Applications Engineering Lead" }],
        buying_signals: ["network modernization", "observability strategy", "security modernization", "cloud transformation"],
        detected_products: ["Splunk Observability Cloud", "Cisco Catalyst Center", "ThousandEyes"],
        lifecycle_stage: "RENEW",
        mentions_incident: true,
        mentions_competitor: true
      })
    );
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  it("only generates strategic-initiative queries actually supported by transcript signals", () => {
    const queries = planSerpApiQueries(baseInput({ buying_signals: ["observability strategy discussion"] }));
    const purposes = queries.map((q) => q.purpose);
    expect(purposes).toContain("strategic_initiative");
    expect(queries.some((q) => q.query.includes("observability strategy"))).toBe(true);
    // No incident mention -> no incident queries generated.
    expect(purposes).not.toContain("public_incident");
  });

  it("only generates incident queries when the transcript mentions an incident", () => {
    const withIncident = planSerpApiQueries(baseInput({ mentions_incident: true }));
    const withoutIncident = planSerpApiQueries(baseInput({ mentions_incident: false }));
    expect(withIncident.some((q) => q.purpose === "public_incident")).toBe(true);
    expect(withoutIncident.some((q) => q.purpose === "public_incident")).toBe(false);
  });

  it("only generates technology-footprint queries for explicitly detected products, never a hard-coded list", () => {
    const queries = planSerpApiQueries(baseInput({ detected_products: ["Splunk Observability Cloud"] }));
    expect(queries.some((q) => q.query.includes("Splunk Observability Cloud"))).toBe(true);
    expect(queries.some((q) => q.query.includes("Datadog"))).toBe(false);
  });

  it("every generated query has a purpose and a reason grounded in the supplied input", () => {
    const queries = planSerpApiQueries(baseInput({ mentions_incident: true }));
    for (const query of queries) {
      expect(query.purpose).toBeTruthy();
      expect(query.reason.length).toBeGreaterThan(0);
      expect(query.query).toContain("Meridian Health Systems");
    }
  });
});
