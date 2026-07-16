import { createSearchProviderClient } from "@/lib/services";
import type { PublicSignal } from "@/lib/signal-agent/types";

/**
 * Optional public-signal enrichment (Section 11). Reuses the same
 * multi-provider search client the main research app already uses
 * (@/lib/services.createSearchProviderClient) instead of a second,
 * duplicate HTTP client. Search is entirely optional, additive, and
 * never blocks transcript analysis — any failure here just yields an
 * empty list.
 *
 * These signals are kept in their own `public_signals` array in the
 * result and are never merged into structured account/CRM corroboration,
 * and never used to invent opportunity stage, budget, install base, or
 * any other internal fact.
 */

/**
 * MIGRATION (objective-aware search): live execution of this legacy generic
 * public-signal query is DISABLED BY DEFAULT. Public opportunity evidence is
 * now controlled solely by the objective-aware planner + execution controller
 * (@/lib/objective-search) feeding result.serpapi_signals → Stage B → the
 * canonical search trace. This function no longer issues an independent
 * duplicate query via the second search-provider client; the reusable client
 * code (@/lib/services.createSearchProviderClient) is preserved for the
 * market-research app. Kept as a no-op stub so the wire shape is unchanged.
 */
export async function fetchPublicSignals(accountName: string | null, enabled: boolean): Promise<PublicSignal[]> {
  void accountName;
  void enabled;
  void createSearchProviderClient;
  return [];
}
