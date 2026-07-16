import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IngestedTranscript, SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { qualitativeImpactSentences } from "@/lib/signal-agent/intentExtraction";
import { buildWorkshopPlan } from "@/lib/decision-packet/workshopPlan";
import type { DecisionCriterion, DecisionPacket, ImpactEntry, ObjectionEntry, ObjectionType } from "@/lib/decision-packet/types";

/**
 * Deterministic Decision Packet builder. Assembles a structured, evidence-
 * linked, confidence-scored analytical view from evidence the pipeline already
 * produced. Additive only — nothing here mutates scores, verdict, routing,
 * MEDDPICC, or evidence identity. Config-driven (no company/product/transcript
 * literals): all cues live in signal-agent-poc/config/decision_criteria_taxonomy.json.
 */

type CategoryDef = { id: string; label: string; cues: string[] };
type ObjectionTypeDef = { id: ObjectionType; label: string; cues: string[] };
type Taxonomy = {
  criteria_lead_cues: string[];
  categories: CategoryDef[];
  objection_types: ObjectionTypeDef[];
  objection_responses: Record<string, string>;
  limitations: string[];
};

let cachedTaxonomy: Taxonomy | null = null;

export function clearDecisionPacketCache(): void {
  cachedTaxonomy = null;
}

function loadTaxonomy(): Taxonomy {
  if (cachedTaxonomy) return cachedTaxonomy;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "decision_criteria_taxonomy.json");
  cachedTaxonomy = JSON.parse(readFileSync(filePath, "utf8")) as Taxonomy;
  return cachedTaxonomy;
}

function idFor(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

function includesAny(haystackLower: string, cues: string[]): boolean {
  return cues.some((cue) => haystackLower.includes(cue.toLowerCase()));
}

/** Extract a decomposed decision-criteria ledger. One sentence listing several
 * criteria yields one entry per matched category (each citing that sentence),
 * so a dense "our criteria are A, B, C..." statement is decomposed rather than
 * collapsed to a single vague line. */
export function extractDecisionCriteria(chunks: TranscriptChunk[], taxonomy: Taxonomy): DecisionCriterion[] {
  const out: DecisionCriterion[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    const hasLead = includesAny(lower, taxonomy.criteria_lead_cues);
    for (const category of taxonomy.categories) {
      if (!includesAny(lower, category.cues)) continue;
      const dedupeKey = `${category.id}::${chunk.index}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        criterion_id: idFor("dc", `${category.id}:${chunk.text}`),
        category: category.id,
        label: category.label,
        statement: chunk.text.trim(),
        speaker: chunk.speaker,
        // Explicit criteria language ("our decision criteria are...") is high
        // confidence; a bare thematic mention is medium.
        confidence: hasLead ? 0.8 : 0.5,
        evidence_ids: [idFor("ev", chunk.text)]
      });
    }
  }
  return out;
}

/** Type customer objections and attach a GENERIC, evidence-grounded response
 * framing (never an invented product claim). Sources: transcript objection
 * cues + already-detected negative cues on the primary match. */
export function extractObjections(
  result: SecureNetworkingTriageResult,
  chunks: TranscriptChunk[],
  taxonomy: Taxonomy
): ObjectionEntry[] {
  const out: ObjectionEntry[] = [];
  const seen = new Set<string>();

  const classify = (text: string): ObjectionTypeDef | null => {
    const lower = text.toLowerCase();
    for (const t of taxonomy.objection_types) {
      if (includesAny(lower, t.cues)) return t;
    }
    return null;
  };

  const add = (text: string, speaker: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const matched = classify(trimmed);
    if (!matched) return; // Only surface objections we can type from cues.
    const key = trimmed.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    const type = matched.id;
    out.push({
      objection_id: idFor("ob", trimmed),
      type,
      label: matched.label,
      statement: trimmed,
      speaker,
      suggested_response: taxonomy.objection_responses[type] ?? taxonomy.objection_responses.general,
      evidence_ids: [idFor("ev", trimmed)]
    });
  };

  for (const chunk of chunks) add(chunk.text, chunk.speaker);
  for (const cue of result.matches[0]?.negative_cues ?? []) add(cue.context || cue.phrase, null);

  return out.slice(0, 12);
}

function extractBusinessImpact(result: SecureNetworkingTriageResult, transcript: IngestedTranscript): ImpactEntry[] {
  const out: ImpactEntry[] = [];
  const seen = new Set<string>();
  const push = (statement: string, kind: ImpactEntry["kind"], confidence: number) => {
    const t = statement.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ statement: t, kind, confidence });
  };
  // Quantified impact (numeric) is high confidence; qualitative is moderate.
  for (const q of result.commercial_signals?.quantified_impact ?? []) push(q, "quantified", 0.85);
  for (const s of qualitativeImpactSentences(transcript)) push(s, "qualitative", 0.55);
  return out.slice(0, 6);
}

export function buildDecisionPacket(params: {
  result: SecureNetworkingTriageResult;
  transcript: IngestedTranscript;
}): DecisionPacket {
  const taxonomy = loadTaxonomy();
  const chunks = selectRelevantChunks(params.transcript);

  const decision_criteria = extractDecisionCriteria(chunks, taxonomy);
  const objections = extractObjections(params.result, chunks, taxonomy);
  const business_impact = extractBusinessImpact(params.result, params.transcript);
  const workshop_plan = buildWorkshopPlan(params.result, chunks);

  const limitations = [...taxonomy.limitations];
  // Transparency note: when the qualification status under-reads the number of
  // explicit criteria actually stated, say so (never silently).
  const criteriaStatus = params.result.meddpicc?.decision_criteria?.status;
  if (decision_criteria.length >= 3 && (criteriaStatus === "HYPOTHESIS" || criteriaStatus === "MISSING")) {
    limitations.push(
      `${decision_criteria.length} explicit decision criteria were stated, though MEDDPICC decision criteria is ${criteriaStatus} — confirm priority/weighting to firm this up.`
    );
  }

  const criteriaConfidence =
    decision_criteria.length > 0 ? decision_criteria.reduce((s, c) => s + c.confidence, 0) / decision_criteria.length : 0;

  return {
    business_impact,
    decision_criteria,
    objections,
    workshop_plan,
    evidence_quality: {
      criteria_count: decision_criteria.length,
      objection_count: objections.length,
      impact_count: business_impact.length,
      confidence: Math.round(criteriaConfidence * 100) / 100,
      limitations
    }
  };
}
