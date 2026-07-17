import { readFileSync } from "node:fs";
import path from "node:path";
import type { AccountRecord, IngestedTranscript, SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { qualitativeImpactSentences } from "@/lib/signal-agent/intentExtraction";
import type { DealIntelligence, DealShape, DealSignal } from "@/lib/deal-intel/types";

/**
 * Deterministic Deal Intelligence. Reads the customer's own sentences + the
 * already-assembled result (existing platforms, MEDDPICC, next step, account
 * context) to produce an honest, evidence-cited read of the deal SHAPE,
 * MOMENTUM, RISKS, and value hypothesis. Config-driven; no company/product/
 * transcript literals; never invents a claim. Circuit may later rephrase the
 * narrative (Stage D / decision-packet), but the FACTS here are deterministic.
 */

type ShapeTag = { id: string; label: string; cues: string[] };
type CueGroup = { id: string; label: string; cues: string[] };
type DealIntelConfig = {
  shape_tags: ShapeTag[];
  participant_role_terms: string[];
  momentum_cues: CueGroup[];
  risk_cues: CueGroup[];
};

let cached: DealIntelConfig | null = null;

export function clearDealIntelCache(): void {
  cached = null;
}

function loadConfig(): DealIntelConfig {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "deal_intelligence_signals.json");
  cached = JSON.parse(readFileSync(filePath, "utf8")) as DealIntelConfig;
  return cached;
}

function firstMatch(chunks: TranscriptChunk[], cues: string[]): TranscriptChunk | null {
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    if (cues.some((c) => lower.includes(c.toLowerCase()))) return chunk;
  }
  return null;
}

function shortText(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function buildDealIntelligence(params: {
  result: SecureNetworkingTriageResult;
  account: AccountRecord;
  transcript: IngestedTranscript;
}): DealIntelligence {
  const cfg = loadConfig();
  const chunks = selectRelevantChunks(params.transcript);
  const accountName = params.result.account_resolution?.name ?? params.result.executive_summary.account ?? "This account";

  // ── Deal shape ────────────────────────────────────────────────────────────
  const shapeTags: string[] = [];
  const shapeLabels: string[] = [];
  let shapeRationale: string | null = null;
  const retained = params.result.matches[0]?.solution_decision.retained_existing_platforms ?? [];
  for (const tag of cfg.shape_tags) {
    const hit = firstMatch(chunks, tag.cues);
    const expansionByPlatform = tag.id === "expansion" && retained.length > 0;
    if (hit || expansionByPlatform) {
      shapeTags.push(tag.id);
      shapeLabels.push(tag.label);
      if (!shapeRationale && hit) shapeRationale = shortText(hit.text);
    }
  }
  const deal_shape: DealShape = {
    label: shapeLabels.length > 0 ? shapeLabels.slice(0, 3).join(" · ") : "New opportunity (net-new)",
    tags: shapeTags,
    rationale: shapeRationale
  };

  // ── Momentum (advancing) ──────────────────────────────────────────────────
  const momentum: DealSignal[] = [];
  const pushSignal = (list: DealSignal[], id: string, label: string, chunk: TranscriptChunk | null, fallbackEvidence?: string) => {
    if (chunk) list.push({ id, label, evidence: shortText(chunk.text), speaker: chunk.speaker });
    else if (fallbackEvidence) list.push({ id, label, evidence: fallbackEvidence, speaker: null });
  };

  // A customer-requested next step (objection-cleaned) is the strongest momentum.
  const nextStepSignal = (params.result.generic_diagnostics?.signals.next_steps ?? [])[0];
  if (nextStepSignal) momentum.push({ id: "requested_next_step", label: "Customer asked for the next step", evidence: shortText(nextStepSignal.text), speaker: null });

  // Named the required participants (a chunk listing ≥2 roles).
  const participantChunk = chunks.find((c) => {
    const lower = c.text.toLowerCase();
    return cfg.participant_role_terms.filter((r) => lower.includes(r.toLowerCase())).length >= 2;
  });
  if (participantChunk) momentum.push({ id: "named_participants", label: "Named the required participants", evidence: shortText(participantChunk.text), speaker: participantChunk.speaker });

  for (const group of cfg.momentum_cues) pushSignal(momentum, group.id, group.label, firstMatch(chunks, group.cues));

  // Structured account context (open opportunity / budget signal) — never a
  // transcript claim, so labeled as account context.
  if (params.account.openOpportunity) momentum.push({ id: "open_opportunity", label: "Open opportunity in pipeline (account context)", evidence: "Marked as an open opportunity in the supplied account context.", speaker: null });
  if (params.account.budgetSignal) momentum.push({ id: "budget_signal", label: "Budget signal (account context)", evidence: shortText(params.account.budgetSignal), speaker: null });

  // ── Risks / landmines ─────────────────────────────────────────────────────
  const risks: DealSignal[] = [];
  for (const group of cfg.risk_cues) pushSignal(risks, group.id, group.label, firstMatch(chunks, group.cues));
  // The economic buyer being unestablished is a real risk even without a cue.
  const ebStatus = params.result.meddpicc?.economic_buyer?.status;
  if ((ebStatus === "MISSING" || ebStatus === "DISTRIBUTED") && !risks.some((r) => r.id === "no_single_eb")) {
    risks.push({ id: "no_single_eb", label: "No single economic buyer identified yet", evidence: params.result.meddpicc?.economic_buyer?.summary ?? "The economic buyer is not yet established.", speaker: null });
  }

  // ── Value hypothesis (customer's own words) ───────────────────────────────
  const impact = qualitativeImpactSentences(params.transcript)[0] ?? params.result.commercial_signals?.quantified_impact?.[0] ?? null;
  const value_hypothesis = impact ? `Frame value in their words: "${shortText(impact, 220)}"` : null;

  // ── Honest, compelling headline ───────────────────────────────────────────
  const topMomentum = momentum[0]?.label ?? "an active, customer-driven conversation";
  const topRisk = risks[0]?.label ?? null;
  const headline = `${deal_shape.label} at ${accountName} — ${topMomentum.toLowerCase()}${topRisk ? `; watch: ${topRisk.toLowerCase()}` : ""}.`;

  return {
    deal_shape,
    momentum: momentum.slice(0, 6),
    risks: risks.slice(0, 6),
    value_hypothesis,
    headline
  };
}
