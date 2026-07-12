import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import type { CatalogResponse, CatalogWireEntry } from "@/lib/signal-agent/types";

// Read the taxonomy live on every request so editing the JSON on disk is
// reflected without a rebuild — never cache this route at the CDN/browser.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const catalog = getCatalog();

  const entries: CatalogWireEntry[] = catalog.entries.map((entry) => ({
    id: entry.id,
    domain: entry.domain,
    pain_category: entry.painCategory,
    customer_language: entry.customerLanguage,
    keywords: entry.keywords,
    semantic_cues: entry.semanticCues,
    negative_cues: entry.negativeCues,
    primary_solutions: entry.primarySolutions,
    adjacent_solutions: entry.adjacentSolutions,
    choose_when: entry.chooseWhen,
    do_not_choose_when: entry.doNotChooseWhen,
    corroboration_hints: entry.corroborationHints,
    install_base_signals: entry.installBaseSignals,
    buying_roles: entry.buyingRoles,
    intent_markers: entry.intentMarkers,
    recommended_specialist: entry.recommendedSpecialist
  }));

  const domains = Array.from(new Set(catalog.entries.map((entry) => entry.domain).filter(Boolean))).sort();

  const response: CatalogResponse = {
    source: catalog.source,
    source_path: catalog.sourcePath,
    metadata: catalog.metadata,
    domains,
    entry_count: entries.length,
    entries,
    source_catalog: catalog.sourceCatalog,
    // Surfaced read-only for the UI's architecture/transparency panel —
    // never re-derived or overridden by application code.
    matching_configuration: catalog.rawMatchingConfig
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" }
  });
}
