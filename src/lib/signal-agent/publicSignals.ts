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

export async function fetchPublicSignals(accountName: string | null, enabled: boolean): Promise<PublicSignal[]> {
  if (!enabled || !accountName) return [];

  const client = createSearchProviderClient();
  if (!client) return [];

  try {
    const results = await client.search({ query: `"${accountName}" network OR security OR IT infrastructure news`, maxResults: 5 });
    return results.slice(0, 5).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet ?? "",
      relevance: "Public search result for the stated account name — not CRM data, not verified against internal systems."
    }));
  } catch {
    // Search is optional and must never block transcript analysis.
    return [];
  }
}
