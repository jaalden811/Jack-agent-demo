import type { NormalizedSerpResult } from "@/lib/connectors/serpapi/types";
import type { EvidenceItem } from "@/lib/qualification/types";

/**
 * Converts accepted SerpAPI results into evidence-graph candidates.
 * Acceptance thresholds (Section 4/14): entity match >= 0.70 and
 * public_evidence_score >= 0.65 for general purposes; stakeholder
 * verification requires entity match >= 0.85. Never upgrades a public
 * result into a private commercial fact — every item here is tagged
 * source_type: "serpapi" and classification never exceeds "partial"
 * (only transcript/account_context/salesforce evidence may be
 * "confirmed" for private facts; a SerpAPI item may still be
 * "confirmed" for genuinely public facts like company identity).
 */

const GENERAL_ENTITY_THRESHOLD = 0.7;
const STAKEHOLDER_ENTITY_THRESHOLD = 0.85;
const EVIDENCE_SCORE_THRESHOLD = 0.65;

export type AcceptanceResult = { accepted: NormalizedSerpResult[]; rejected: Array<{ source_id: string; reason: string }> };

export function filterAcceptedResults(results: NormalizedSerpResult[]): AcceptanceResult {
  const accepted: NormalizedSerpResult[] = [];
  const rejected: Array<{ source_id: string; reason: string }> = [];

  for (const result of results) {
    const entityThreshold = result.purpose === "stakeholder_verification" ? STAKEHOLDER_ENTITY_THRESHOLD : GENERAL_ENTITY_THRESHOLD;
    if (result.account_match_confidence < entityThreshold) {
      rejected.push({ source_id: result.source_id, reason: "ambiguous_or_no_entity_match" });
      continue;
    }
    if (result.public_evidence_score < EVIDENCE_SCORE_THRESHOLD) {
      rejected.push({ source_id: result.source_id, reason: "low_evidence_score" });
      continue;
    }
    if (!result.url || !result.title) {
      rejected.push({ source_id: result.source_id, reason: "missing_url_or_title" });
      continue;
    }
    accepted.push(result);
  }

  return { accepted, rejected };
}

export function toEvidenceItems(results: NormalizedSerpResult[]): EvidenceItem[] {
  return results.map((result) => ({
    evidence_id: result.source_id,
    source_type: "serpapi",
    source_id: result.source_id,
    claim: null,
    quote_or_snippet: result.snippet,
    speaker: null,
    timestamp: null,
    title: result.title,
    url: result.url,
    published_at: result.published_at,
    confidence: Math.round(result.public_evidence_score * 100) / 100,
    classification: "partial"
  }));
}
