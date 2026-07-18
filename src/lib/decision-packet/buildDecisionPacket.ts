import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IngestedTranscript, SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { qualitativeImpactSentences } from "@/lib/signal-agent/intentExtraction";
import { refineEvidenceItems } from "@/lib/signal-agent/evidenceQuality";
import { buildWorkshopPlan } from "@/lib/decision-packet/workshopPlan";
import type { DecisionCriterion, DecisionPacket, ImpactEntry, ObjectionEntry, ObjectionType, WorkshopPlan } from "@/lib/decision-packet/types";

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

// Forward-looking exploratory-interest markers. A sentence carrying these is a
// latent-interest / soft-expansion signal ("we've started wondering whether we
// have enough visibility"), which must never be typed as a disqualifier even
// when it also contains a soft deferral ("not committing today").
const EXPLORATION_INTEREST_RE =
  /\b(?:started wondering|begun wondering|began to wonder|started thinking about|exploring whether|looking into whether|curious (?:about|whether)|keen to (?:explore|understand)|open to exploring|wondering whether|wondering if)\b/i;

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
      if (!includesAny(lower, t.cues)) continue;
      // A "disqualifier" (out of scope / not a buying motion) is the strongest
      // negative type. Never assign it to a sentence that actually expresses
      // forward-looking EXPLORATORY INTEREST ("I'm not committing to anything
      // today, but we've started wondering whether ..."): that is a soft,
      // latent-interest signal, not a scope rejection. Fall through to a weaker
      // type if one also matches, else treat it as not an objection.
      if (t.id === "disqualifier" && EXPLORATION_INTEREST_RE.test(lower)) continue;
      return t;
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

function topLabels<T extends { label: string }>(items: T[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([l]) => l);
}

/** Deterministic executive read of the packet, grounded in the extracted
 * criteria/objection labels + workshop request (no new claims). Circuit may
 * later rephrase this (see decision-packet/narrative.ts); this is the fallback. */
function deterministicNarrative(p: { account: string | null; decision_criteria: DecisionCriterion[]; objections: ObjectionEntry[]; workshop_plan: WorkshopPlan }): string {
  const acct = p.account ?? "The account";
  const parts: string[] = [];
  if (p.decision_criteria.length > 0) {
    parts.push(`${acct} weighs ${p.decision_criteria.length} decision criteria (notably ${topLabels(p.decision_criteria, 3).join(", ").toLowerCase()})`);
  }
  if (p.objections.length > 0) {
    parts.push(`with ${p.objections.length} objection${p.objections.length > 1 ? "s" : ""} to address (mostly ${topLabels(p.objections, 2).join(" and ").toLowerCase()})`);
  }
  if (p.workshop_plan.requested) {
    parts.push(
      `the customer requested a ${(p.workshop_plan.format ?? "working session").toLowerCase()}${p.workshop_plan.candidate_scenarios.length ? ` around ${p.workshop_plan.candidate_scenarios.length} scenarios` : ""}`
    );
  }
  if (parts.length === 0) return `${acct}: no explicit decision criteria or objections were extracted from this conversation.`;
  return `${parts.join("; ")}. Lead with the requested next step and address the top objection with the customer's own evidence.`;
}

export function buildDecisionPacket(params: {
  result: SecureNetworkingTriageResult;
  transcript: IngestedTranscript;
}): DecisionPacket {
  const taxonomy = loadTaxonomy();
  const chunks = selectRelevantChunks(params.transcript);

  // Refine so every surfaced quote is a complete, substantive, de-duplicated
  // statement (no context-free fragments like "So not zero." / "Then skills.").
  const decision_criteria = refineEvidenceItems(extractDecisionCriteria(chunks, taxonomy), {
    text: (c) => c.statement,
    category: (c) => c.category,
    cap: 4
  });
  const objections = refineEvidenceItems(extractObjections(params.result, chunks, taxonomy), {
    text: (o) => o.statement,
    category: (o) => o.type,
    cap: 3
  });
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
    narrative: { text: deterministicNarrative({ account: params.result.account_resolution?.name ?? params.result.executive_summary.account, decision_criteria, objections, workshop_plan }), source: "deterministic" },
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
