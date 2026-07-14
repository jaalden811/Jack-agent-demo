import { getConfig } from "@/lib/config";
import type { PlannedQuery, QueryPlannerInput, SearchPurpose } from "@/lib/connectors/serpapi/types";

/**
 * Turns transcript-derived signals into targeted, purpose-tagged
 * SerpAPI queries — never a generic search dump, never a hard-coded
 * per-competitor template run unconditionally. Every query is
 * generated only when the supplied evidence supports it.
 */

const GENERIC_ACCOUNT_NAMES = new Set([
  "unknown",
  "not stated",
  "demo account",
  "customer",
  "test account",
  "sample company",
  "global retail operations",
  "example corporation"
]);

export function isGenericAccountName(name: string | null | undefined): boolean {
  if (!name) return true;
  return GENERIC_ACCOUNT_NAMES.has(name.trim().toLowerCase());
}

let queryCounter = 0;
function nextQueryId(): string {
  queryCounter += 1;
  return `q_${String(queryCounter).padStart(3, "0")}`;
}

function priorityFor(purpose: SearchPurpose): number {
  const order: Record<SearchPurpose, number> = {
    account_resolution: 0.95,
    stakeholder_verification: 0.88,
    strategic_initiative: 0.8,
    public_incident: 0.75,
    competition: 0.68,
    technology_footprint: 0.65,
    financial_priority: 0.55,
    regulatory_context: 0.5
  };
  return order[purpose];
}

/** Builds the full candidate query list (no limit applied yet) — the
 * caller applies SERPAPI_MAX_QUERIES_PER_RUN and priority ordering. */
export function planSerpApiQueries(input: QueryPlannerInput): PlannedQuery[] {
  const queries: PlannedQuery[] = [];
  const primaryAccount = input.account_candidates.find((c) => !isGenericAccountName(c.name));
  if (!primaryAccount) return [];

  const company = primaryAccount.name;
  const domain = primaryAccount.domain ?? input.company_domains[0] ?? null;

  function push(purpose: SearchPurpose, query: string, reason: string) {
    queries.push({ query_id: nextQueryId(), purpose, query, reason, evidence_ids: [], priority: priorityFor(purpose) });
  }

  // A. Account resolution — only when identity confidence is uncertain.
  if (primaryAccount.confidence < 0.85) {
    push("account_resolution", `"${company}" official company`, "Account identity confidence is below the full-enrichment threshold.");
    if (domain) push("account_resolution", `"${domain}" company`, "Verify the candidate company domain.");
  }

  // B. Stakeholder verification — one named stakeholder, if any.
  const stakeholder = input.stakeholders.find((s) => s.name);
  if (stakeholder) {
    push("stakeholder_verification", `"${stakeholder.name}" "${company}" title`, "Verify the stated title of a named transcript stakeholder.");
    if (domain) push("stakeholder_verification", `site:${domain} "${stakeholder.name}"`, "Confirm the stakeholder's public association with the company domain.");
  }

  // C. Strategic initiatives — only from transcript/taxonomy signals actually present.
  const initiativeMap: Array<{ keywords: string[]; template: string }> = [
    { keywords: ["network", "sd-wan", "campus", "catalyst"], template: "network modernization" },
    { keywords: ["observability", "opentelemetry", "apm", "monitoring"], template: "observability strategy" },
    { keywords: ["security", "zero trust", "soc", "siem"], template: "security modernization" },
    { keywords: ["ai infrastructure", "gpu", "ai factory"], template: "AI infrastructure" },
    { keywords: ["cloud", "cloud transformation", "migration"], template: "cloud transformation" },
    { keywords: ["digital experience", "user experience", "rum"], template: "digital experience" },
    { keywords: ["reliability", "uptime", "resilience"], template: "application reliability" }
  ];
  const signalText = [...input.buying_signals, ...input.commercial_signals, ...input.selected_taxonomy_entries].join(" ").toLowerCase();
  for (const initiative of initiativeMap) {
    if (initiative.keywords.some((keyword) => signalText.includes(keyword))) {
      push("strategic_initiative", `"${company}" ${initiative.template}`, `Transcript/taxonomy evidence referenced ${initiative.template}.`);
    }
  }

  // D. Financial/business priority — only for later-lifecycle or renewal-heavy deals.
  if (input.lifecycle_stage === "RENEW" || input.lifecycle_stage === "EXPAND") {
    push("financial_priority", `"${company}" earnings technology priorities`, `Lifecycle stage (${input.lifecycle_stage}) suggests commercial timing is material.`);
  }

  // E. Incidents — only when the transcript actually mentions one.
  if (input.mentions_incident) {
    push("public_incident", `"${company}" outage`, "Transcript referenced an incident, outage, or reliability impact.");
    push("public_incident", `"${company}" service disruption`, "Transcript referenced an incident, outage, or reliability impact.");
  }

  // F. Technology footprint — only for products explicitly detected.
  for (const product of input.detected_products.slice(0, 3)) {
    push("technology_footprint", `"${company}" ${product}`, `${product} was mentioned in the transcript or selected taxonomy entries.`);
  }
  if (domain && input.detected_products.length > 0) {
    push("technology_footprint", `site:${domain}/careers ${input.detected_products[0]}`, "Public hiring signal for the primary detected product.");
  }

  // G. Competition — only when the transcript mentions a competitor.
  if (input.mentions_competitor) {
    push("competition", `"${company}" competitor OR alternative`, "Transcript referenced a competitor or incumbent alternative.");
  }

  const config = getConfig();
  return queries.sort((a, b) => b.priority - a.priority).slice(0, config.SERPAPI_MAX_QUERIES_PER_RUN);
}
