import { readFileSync } from "node:fs";
import path from "node:path";
import type { AccountRecord, IngestedTranscript, SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { qualitativeImpactSentences } from "@/lib/signal-agent/intentExtraction";
import { isSubstantiveStatement } from "@/lib/signal-agent/evidenceQuality";
import type { DealIntelligence, DealShape, DealSignal, StakeholderPlay } from "@/lib/deal-intel/types";

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
type RoleDef = { id: string; label: string; cues: string[]; play: string };
type DealIntelConfig = {
  shape_tags: ShapeTag[];
  participant_role_terms: string[];
  momentum_cues: CueGroup[];
  risk_cues: CueGroup[];
  stakeholder_roles: RoleDef[];
  stakeholder_stance: { supportive_cues: string[]; skeptical_cues: string[] };
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

/** Prefer a complete, substantive matching sentence over a context-free
 * fragment, so cited evidence always reads as a real point. */
function firstSubstantiveMatch(chunks: TranscriptChunk[], cues: string[]): TranscriptChunk | null {
  let firstAny: TranscriptChunk | null = null;
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    if (!cues.some((c) => lower.includes(c.toLowerCase()))) continue;
    if (!firstAny) firstAny = chunk;
    if (isSubstantiveStatement(chunk.text)) return chunk;
  }
  return firstAny;
}

function shortText(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const INFLUENCER_PLAY = "Keep them informed and confirm their specific requirements — they shape the group's view.";

function firstName(name: string): string {
  return name.trim().toLowerCase().split(/\s+/)[0] ?? "";
}

function countCues(texts: string[], cues: string[]): number {
  const blob = texts.join(" \u2022 ");
  return cues.filter((c) => blob.includes(c.toLowerCase())).length;
}

/** Evidence-cited "who to work, and how" map. Each named customer stakeholder
 * is classified by their OWN words into a deal role + stance + engagement play.
 * Never invents a person or a trait not backed by their statements. */
function buildStakeholderPlaybook(chunks: TranscriptChunk[], namedStakeholders: Array<{ name?: string | null }>, cfg: DealIntelConfig): StakeholderPlay[] {
  const plays: StakeholderPlay[] = [];
  const seen = new Set<string>();
  for (const ns of namedStakeholders) {
    const name = (ns.name ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const fn = firstName(name);
    const myChunks = chunks.filter((c) => c.speaker && firstName(c.speaker) === fn);
    const texts = myChunks.map((c) => c.text.toLowerCase());
    if (texts.length === 0) continue;

    let best: RoleDef | null = null;
    let bestHits = 0;
    for (const role of cfg.stakeholder_roles) {
      const hits = countCues(texts, role.cues);
      if (hits > bestHits) {
        bestHits = hits;
        best = role;
      }
    }
    const supportive = countCues(texts, cfg.stakeholder_stance.supportive_cues);
    const skeptical = countCues(texts, cfg.stakeholder_stance.skeptical_cues);
    const stance: StakeholderPlay["stance"] = skeptical > supportive && skeptical > 0 ? "skeptical" : supportive > skeptical && supportive > 0 ? "supportive" : "neutral";

    const roleCues = best?.cues ?? [];
    const matchesRole = (c: TranscriptChunk) => roleCues.some((cue) => c.text.toLowerCase().includes(cue.toLowerCase()));
    const evidenceChunk =
      myChunks.find((c) => matchesRole(c) && isSubstantiveStatement(c.text)) ??
      myChunks.find(matchesRole) ??
      myChunks.find((c) => isSubstantiveStatement(c.text)) ??
      myChunks[0] ??
      null;

    plays.push({
      name,
      role_id: best?.id ?? "influencer",
      role_label: best?.label ?? "Influencer",
      stance,
      play: best?.play ?? INFLUENCER_PLAY,
      evidence: evidenceChunk ? shortText(evidenceChunk.text) : null
    });
  }
  return plays.slice(0, 6);
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
    const anyHit = firstMatch(chunks, tag.cues);
    const expansionByPlatform = tag.id === "expansion" && retained.length > 0;
    if (anyHit || expansionByPlatform) {
      shapeTags.push(tag.id);
      shapeLabels.push(tag.label);
      if (!shapeRationale) {
        const substantive = firstSubstantiveMatch(chunks, tag.cues);
        if (substantive) shapeRationale = shortText(substantive.text);
      }
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

  for (const group of cfg.momentum_cues) pushSignal(momentum, group.id, group.label, firstSubstantiveMatch(chunks, group.cues));

  // Structured account context (open opportunity / budget signal) — never a
  // transcript claim, so labeled as account context.
  if (params.account.openOpportunity) momentum.push({ id: "open_opportunity", label: "Open opportunity in pipeline (account context)", evidence: "Marked as an open opportunity in the supplied account context.", speaker: null });
  if (params.account.budgetSignal) momentum.push({ id: "budget_signal", label: "Budget signal (account context)", evidence: shortText(params.account.budgetSignal), speaker: null });

  // ── Risks / landmines ─────────────────────────────────────────────────────
  const risks: DealSignal[] = [];
  for (const group of cfg.risk_cues) pushSignal(risks, group.id, group.label, firstSubstantiveMatch(chunks, group.cues));
  // The economic buyer being unestablished is a real risk even without a cue.
  const ebStatus = params.result.meddpicc?.economic_buyer?.status;
  if ((ebStatus === "MISSING" || ebStatus === "DISTRIBUTED") && !risks.some((r) => r.id === "no_single_eb")) {
    risks.push({ id: "no_single_eb", label: "No single economic buyer identified yet", evidence: params.result.meddpicc?.economic_buyer?.summary ?? "The economic buyer is not yet established.", speaker: null });
  }

  // ── Public context (distilled SerpAPI research) ───────────────────────────
  // Take advantage of the environment: when public research surfaced narrative-
  // eligible facts (account scale, strategic priorities), distill the strongest
  // few with their source. Context/narrative only — never scoring-eligible.
  const public_context: DealSignal[] = (params.result.serpapi_signals?.signals ?? [])
    .filter((s) => s.narrative_eligible)
    .slice(0, 3)
    .map((s, i) => ({ id: `public_${i}`, label: shortText(s.claim, 160), evidence: s.source_title || s.source_url, speaker: null }));

  // ── Value hypothesis (customer's own words) ───────────────────────────────
  const impact = qualitativeImpactSentences(params.transcript)[0] ?? params.result.commercial_signals?.quantified_impact?.[0] ?? null;
  const value_hypothesis = impact ? `Frame value in their words: "${shortText(impact, 220)}"` : null;

  // ── Honest, compelling headline ───────────────────────────────────────────
  const topMomentum = momentum[0]?.label ?? "an active, customer-driven conversation";
  const topRisk = risks[0]?.label ?? null;
  const headline = `${deal_shape.label} at ${accountName} — ${topMomentum.toLowerCase()}${topRisk ? `; watch: ${topRisk.toLowerCase()}` : ""}.`;

  const power_map = buildStakeholderPlaybook(chunks, params.result.stakeholder_analysis?.named_stakeholders ?? [], cfg);

  return {
    deal_shape,
    momentum: momentum.slice(0, 6),
    risks: risks.slice(0, 6),
    value_hypothesis,
    power_map,
    public_context,
    headline
  };
}
