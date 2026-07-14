import type { PublicSignalCategory, QueryPurpose } from "@/lib/opportunity-fit/types";

/**
 * Generic strategic-objective/executive-priority/trigger-event/
 * technology-alignment/buying-capacity/competition/timing query
 * catalog (Section 4). Every template is parameterized by the
 * resolved account name/domain and by transcript-derived signals —
 * never a hard-coded company, product, or industry. Only templates
 * actually supported by transcript evidence are ever instantiated by
 * the planner (see planOpportunityFitQueries below).
 */

export type QueryTemplate = {
  purpose: QueryPurpose;
  category: PublicSignalCategory;
  subcategory: string;
  build: (company: string, domain: string | null) => string;
};

// A. Strategic objectives — one template per generic transformation
// theme; only instantiated when the transcript's own language matches
// that theme's keyword set (never all of them unconditionally).
export const STRATEGIC_OBJECTIVE_THEMES: Array<{ subcategory: string; keywords: string[]; template: string }> = [
  { subcategory: "cloud_modernization", keywords: ["cloud modernization", "cloud migration", "cloud transformation"], template: "cloud modernization strategy" },
  { subcategory: "ai_infrastructure", keywords: ["ai infrastructure", "artificial intelligence", "machine learning", "gpu"], template: "AI infrastructure strategy" },
  { subcategory: "cybersecurity_modernization", keywords: ["cybersecurity", "security modernization", "zero trust"], template: "cybersecurity modernization" },
  { subcategory: "observability_reliability", keywords: ["observability", "reliability", "site reliability", "uptime"], template: "observability strategy" },
  { subcategory: "network_transformation", keywords: ["network transformation", "wan modernization", "sd-wan"], template: "network transformation" },
  { subcategory: "digital_experience", keywords: ["digital experience", "customer experience", "user experience"], template: "digital experience strategy" },
  { subcategory: "application_modernization", keywords: ["application modernization", "legacy modernization", "microservices"], template: "application modernization" },
  { subcategory: "data_platform_consolidation", keywords: ["data platform", "data consolidation", "centralized data"], template: "data platform consolidation" },
  { subcategory: "cost_optimization", keywords: ["cost optimization", "cost reduction", "efficiency program"], template: "cost optimization technology" },
  { subcategory: "operational_resilience", keywords: ["operational resilience", "business continuity", "disaster recovery"], template: "operational resilience" },
  { subcategory: "zero_trust", keywords: ["zero trust", "identity security", "access control"], template: "zero trust strategy" },
  { subcategory: "hybrid_work", keywords: ["hybrid work", "remote work", "workplace"], template: "hybrid work strategy" },
  { subcategory: "branch_modernization", keywords: ["branch modernization", "distributed sites", "retail locations"], template: "branch modernization" },
  { subcategory: "acquisition_integration", keywords: ["acquisition", "merger", "integration"], template: "acquisition integration" },
  { subcategory: "regulatory_compliance", keywords: ["regulatory", "compliance", "audit requirement"], template: "regulatory compliance initiative" }
];

export function planStrategicObjectiveQueries(company: string, transcriptSignals: string[]): Array<{ query: string; subcategory: string }> {
  const signalText = transcriptSignals.join(" ").toLowerCase();
  const matched = STRATEGIC_OBJECTIVE_THEMES.filter((theme) => theme.keywords.some((kw) => signalText.includes(kw)));
  return matched.map((theme) => ({ query: `"${company}" ${theme.template}`, subcategory: theme.subcategory }));
}

// B. Executive priorities — generic, always applicable once an
// account is resolved (earnings/annual-report/investor language is a
// standard public-disclosure category, not tied to any one company).
export function planExecutivePriorityQueries(company: string, domain: string | null): Array<{ query: string; subcategory: string }> {
  const queries = [
    { query: `"${company}" earnings technology priorities`, subcategory: "earnings_call" },
    { query: `"${company}" annual report technology investment`, subcategory: "annual_report" },
    { query: `"${company}" investor presentation digital transformation`, subcategory: "investor_presentation" }
  ];
  if (domain) queries.push({ query: `site:${domain} strategy technology`, subcategory: "official_strategy_page" });
  return queries;
}

// C. Trigger events — only instantiated when the transcript itself
// makes that trigger type relevant.
export const TRIGGER_EVENT_THEMES: Array<{ subcategory: string; keywords: string[]; template: string }> = [
  { subcategory: "outage", keywords: ["outage", "downtime", "service disruption"], template: "outage" },
  { subcategory: "cyber_incident", keywords: ["breach", "cyber incident", "ransomware"], template: "cybersecurity incident" },
  { subcategory: "regulatory_deadline", keywords: ["regulatory deadline", "compliance deadline"], template: "regulatory deadline" },
  { subcategory: "merger_acquisition", keywords: ["merger", "acquisition", "acquired"], template: "merger acquisition" },
  { subcategory: "leadership_change", keywords: ["new cio", "new ceo", "leadership change"], template: "new executive appointment" },
  { subcategory: "cloud_migration", keywords: ["cloud migration", "migrating to the cloud"], template: "major cloud migration" },
  { subcategory: "new_data_center", keywords: ["new data center", "data center expansion"], template: "new data center" },
  { subcategory: "geographic_expansion", keywords: ["expansion", "new market", "new region"], template: "geographic expansion" },
  { subcategory: "product_launch", keywords: ["product launch", "new product"], template: "product launch" },
  { subcategory: "restructuring", keywords: ["restructuring", "reorganization"], template: "restructuring" },
  { subcategory: "cost_reduction_program", keywords: ["cost reduction", "layoffs", "cost cutting"], template: "cost reduction program" },
  { subcategory: "public_reliability_issue", keywords: ["reliability issue", "service quality complaint"], template: "public reliability issue" }
];

export function planTriggerEventQueries(company: string, transcriptSignals: string[]): Array<{ query: string; subcategory: string }> {
  const signalText = transcriptSignals.join(" ").toLowerCase();
  const matched = TRIGGER_EVENT_THEMES.filter((theme) => theme.keywords.some((kw) => signalText.includes(kw)));
  return matched.map((theme) => ({ query: `"${company}" ${theme.template}`, subcategory: theme.subcategory }));
}

// D. Technology alignment — only for products/technologies actually
// detected in the transcript or selected taxonomy entries, never an
// unconditional per-vendor sweep.
export function planTechnologyAlignmentQueries(company: string, domain: string | null, detectedTechnologies: string[]): Array<{ query: string; subcategory: string }> {
  const queries = detectedTechnologies.slice(0, 4).map((tech) => ({ query: `"${company}" ${tech}`, subcategory: `technology:${tech}` }));
  if (domain && detectedTechnologies.length > 0) {
    queries.push({ query: `site:${domain}/careers ${detectedTechnologies[0]}`, subcategory: "hiring_signal" });
  }
  return queries;
}

// F. Competitive/incumbent signals — only for competitors/incumbents
// actually named in the transcript, account context, or taxonomy.
export function planCompetitionQueries(company: string, domain: string | null, namedCompetitors: string[]): Array<{ query: string; subcategory: string }> {
  const queries = namedCompetitors.slice(0, 3).map((competitor) => ({ query: `"${company}" "${competitor}"`, subcategory: `competitor:${competitor}` }));
  if (domain && namedCompetitors.length > 0) {
    queries.push({ query: `site:${domain} "${namedCompetitors[0]}"`, subcategory: "incumbent_site_mention" });
  }
  return queries;
}

// G. Timing/urgency — generic public deadline/transformation-timeline
// language, only when the transcript itself surfaces timing pressure.
export function planTimingQueries(company: string, mentionsUrgency: boolean): Array<{ query: string; subcategory: string }> {
  if (!mentionsUrgency) return [];
  return [
    { query: `"${company}" transformation deadline timeline`, subcategory: "transformation_timeline" },
    { query: `"${company}" platform retirement end of life`, subcategory: "platform_retirement" }
  ];
}
