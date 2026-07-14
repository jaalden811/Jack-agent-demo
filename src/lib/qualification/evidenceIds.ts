import type { IngestedTranscript } from "@/lib/signal-agent/types";
import type { EvidenceItem } from "@/lib/qualification/types";

/**
 * Assigns a stable evidence ID to every transcript sentence before
 * anything is sent to OpenAI — every extracted claim must reference
 * these IDs rather than restating unsupported facts (Section 5 of the
 * OpenAI implementation guide).
 */

export function buildTranscriptEvidenceItems(transcript: IngestedTranscript): EvidenceItem[] {
  return transcript.sentences.map((sentence) => ({
    evidence_id: `tr_${String(sentence.index).padStart(4, "0")}`,
    source_type: "transcript",
    source_id: "transcript",
    claim: null,
    quote_or_snippet: sentence.text,
    speaker: sentence.speaker,
    timestamp: sentence.timestamp,
    title: null,
    url: null,
    published_at: null,
    confidence: 1,
    classification: "confirmed"
  }));
}
