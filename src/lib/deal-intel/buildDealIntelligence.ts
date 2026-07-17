import { readFileSync } from "node:fs";
import path from "node:path";
import type { AccountRecord, IngestedTranscript, SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { qualitativeImpactSentences } from "@/lib/signal-agent/intentExtraction";
import { normalizeSpelledNumbers } from "@/lib/signal-agent/numberWords";
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
type ComposedRisk = { id: string; label: string; note?: string; all_of: string[][] };
type RoleDef = { id: string; label: string; cues: string[]; play: string };
type TimingCues = { deadline_markers: string[]; months: string[]; procurement_markers: string[]; not_procurement_markers: string[]; locked_in_markers?: string[] };
type DealIntelConfig = {
  shape_tags: ShapeTag[];
  participant_role_terms: string[];
  momentum_cues: CueGroup[];
  risk_cues: CueGroup[];
  composed_risk_cues?: ComposedRisk[];
  timing_cues?: TimingCues;
  stakeholder_roles: RoleDef[];
  stakeholder_stance: { supportive_cues: string[]; skeptical_cues: string[] };
};

/** Dynamic (compositional) risk match: a chunk qualifies only when EVERY token
 * group is represented — e.g. a money term AND a non-approval term in the same
 * sentence. This captures the SEMANTIC pattern ("funding … not approved",
 * "the pool … cannot be transferred", "the envelope … is not an award")
 * generally, instead of memorizing one transcript's exact phrasing. Prefers a
 * complete, substantive sentence. */
function firstComposedMatch(chunks: TranscriptChunk[], groups: string[][]): TranscriptChunk | null {
  let firstAny: TranscriptChunk | null = null;
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    if (!groups.every((group) => group.some((token) => lower.includes(token.toLowerCase())))) continue;
    if (!firstAny) firstAny = chunk;
    if (isSubstantiveStatement(chunk.text)) return chunk;
  }
  return firstAny;
}

// Business nouns that make a bare count meaningful as a headline metric.
const METRIC_NOUNS = "minutes?|hours?|days?|weeks?|sessions?|users?|customers?|incidents?|outages?|tickets?|analysts?|people|endpoints?|sites?|locations?|branches?|stores?|percent|terabytes?|records?|transactions?|accounts?";
const DURATION_UNIT = /\b(\d[\d,.]*)\s*(minutes?|hours?|days?|weeks?)\b/i;
const TARGET_MARKER = /\b(target|goal|under|below|less than|within|down to|to under|reduce|cut)\b/i;
const BASELINE_MARKER = /\b(was|is|currently|today|average|averaged|mean|median|takes?|took|baseline|per incident)\b/i;

/** Distills the single most compelling quantified metric from the customer's
 * own sentences, in DIGITS (spelled numbers normalized). Prefers a
 * baseline→target duration pair ("from 96 to under 30 minutes"); otherwise the
 * largest business-relevant count. Returns null when nothing quantified. */
function distillHeadlineMetric(chunks: TranscriptChunk[]): string | null {
  const normalized = chunks.map((c) => ({ raw: c.text, norm: normalizeSpelledNumbers(c.text) }));
  let baseline: { value: number; unit: string } | null = null;
  let target: { value: number; unit: string } | null = null;
  // Scan EVERY duration (baseline and target can share one sentence), and
  // classify each by the words immediately preceding it.
  const durAll = new RegExp(DURATION_UNIT.source, "gi");
  for (const { norm } of normalized) {
    for (const d of norm.matchAll(durAll)) {
      const value = Number(d[1].replace(/[,.]/g, ""));
      if (!Number.isFinite(value)) continue;
      const unit = d[2].toLowerCase().replace(/s$/, "");
      const before = norm.slice(Math.max(0, (d.index ?? 0) - 28), d.index);
      if (TARGET_MARKER.test(before)) {
        if (!target || value < target.value) target = { value, unit };
      } else if (BASELINE_MARKER.test(before)) {
        if (!baseline || value > baseline.value) baseline = { value, unit };
      }
    }
  }
  if (baseline && target && baseline.unit === target.unit && baseline.value > target.value) {
    return `${baseline.value} → under ${target.value} ${target.unit}s`;
  }
  // Otherwise the largest business-relevant count with its noun.
  const countRe = new RegExp(`\\b(\\d[\\d,]{2,})\\s+(${METRIC_NOUNS})\\b`, "gi");
  let best: { value: number; text: string } | null = null;
  for (const { norm } of normalized) {
    for (const m of norm.matchAll(countRe)) {
      const value = Number(m[1].replace(/[,.]/g, ""));
      if (Number.isFinite(value) && (!best || value > best.value)) best = { value, text: `${value.toLocaleString("en-US")} ${m[2].toLowerCase()}` };
    }
  }
  return best?.text ?? null;
}

// Past-event markers — a timing driver must be forward-looking; a renewal that
// "already happened" or a contract "signed in May" is not a reason to act now.
const PAST_EVENT_RE = /\b(already|was signed|were signed|signed in|happened|renewed last|\bago\b|last (year|quarter|month|week))\b/i;
// Decision-boundary words rank above a bare renewal/month as "why now".
const DECISION_BOUNDARY_RE = /\b(freeze|memo|committee|review closes|closes|reviews the case|recommendation|deadline|go-?live|cutover|due (by|on|date))\b/i;
// A sentence that NEGATES a deadline/date ("not a procurement deadline", "no
// hard deadline", "not a purchase date") — the opposite of a reason to act now.
const NEGATED_TIMING_RE = /\b(?:not|isn'?t|no)\s+(?:a\s+|an\s+|the\s+)?(?:hard\s+|firm\s+|real\s+|procurement\s+|purchase\s+|buying\s+|close\s+|commercial\s+|sign(?:ing|ature)?\s+)*(?:deadline|close date|purchase date|buying date)\b/i;

/** Extracts the honest timing driver: the decision-relevant deadline, and
 * whether it is real procurement timing or only a decision/planning boundary.
 * Skips past events, prefers decision boundaries, and never manufactures
 * urgency — returns null when no forward-looking dated driver was stated. */
function distillTiming(chunks: TranscriptChunk[], cfg: DealIntelConfig): DealIntelligence["timing"] {
  const tc = cfg.timing_cues;
  if (!tc) return null;
  const monthRe = new RegExp(`\\b(${tc.months.join("|")})\\b`, "i");
  const lockedIn = tc.locked_in_markers ?? [];
  let best: { chunk: TranscriptChunk; score: number } | null = null;
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    if (PAST_EVENT_RE.test(lower)) continue;
    // A locked-in / "not under review" / "contracted through" statement is the
    // OPPOSITE of a reason to act now — never surface it as "why now".
    if (lockedIn.some((m) => lower.includes(m))) continue;
    // A sentence NEGATING the deadline ("it is not a procurement deadline", "not
    // a purchase date", "no hard deadline") states there is NO urgency — it must
    // never become the "why now" label. (Distinct from "the deadline is not until
    // September", which affirms a September deadline.)
    if (NEGATED_TIMING_RE.test(lower)) continue;
    const hasDeadlineWord = tc.deadline_markers.some((m) => lower.includes(m));
    const hasDate = monthRe.test(lower);
    if (!hasDeadlineWord && !hasDate) continue;
    // Rank: decision boundary (3) > deadline word (2) > month only (1).
    const score = DECISION_BOUNDARY_RE.test(lower) ? 3 : hasDeadlineWord ? 2 : 1;
    if (!best || score > best.score) best = { chunk, score };
  }
  if (!best) return null;
  const lower = best.chunk.text.toLowerCase();
  const isProcurement = tc.procurement_markers.some((m) => lower.includes(m)) && !tc.not_procurement_markers.some((m) => lower.includes(m));
  const label = isProcurement ? shortText(best.chunk.text, 160) : `${shortText(best.chunk.text, 150)} (decision boundary, not procurement)`;
  return { label, is_procurement: isProcurement, evidence: shortText(best.chunk.text, 200) };
}

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

  // Derived momentum from ALREADY-VALIDATED result fields — dynamic and
  // evidence-cited, not keyword-memorized. A confirmed metric, stated decision
  // criteria, or an active evaluation stage are all "why this is winnable now"
  // signals that a narrow cue list misses on a genuinely strong deal.
  const mdd = params.result.meddpicc;
  if (mdd?.metrics?.status === "CONFIRMED") pushSignal(momentum, "quantified_metrics", "Quantified business metrics on the table", null, shortText(mdd.metrics.summary));
  if (mdd?.decision_criteria?.status === "CONFIRMED") pushSignal(momentum, "clear_criteria", "Customer stated clear decision criteria", null, shortText(mdd.decision_criteria.summary));
  if (mdd?.economic_buyer?.status === "CONFIRMED") pushSignal(momentum, "eb_identified", "Economic buyer identified", null, shortText(mdd.economic_buyer.summary));
  const stage = params.result.opportunity_scoring?.deal_maturity;
  if (params.result.executive_summary.verdict !== "NOISE" && (stage === "VALIDATION" || stage === "COMMERCIAL_EVALUATION" || stage === "PROCUREMENT")) {
    const stageLabel = stage.toLowerCase().replace(/_/g, " ");
    pushSignal(momentum, "active_stage", `Active ${stageLabel} — a live deal, not early curiosity`, null, `Deal maturity is ${stageLabel}.`);
  }

  // Structured account context (open opportunity / budget signal) — never a
  // transcript claim, so labeled as account context.
  if (params.account.openOpportunity) momentum.push({ id: "open_opportunity", label: "Open opportunity in pipeline (account context)", evidence: "Marked as an open opportunity in the supplied account context.", speaker: null });
  if (params.account.budgetSignal) momentum.push({ id: "budget_signal", label: "Budget signal (account context)", evidence: shortText(params.account.budgetSignal), speaker: null });

  // ── Risks / landmines ─────────────────────────────────────────────────────
  const risks: DealSignal[] = [];
  for (const group of cfg.risk_cues) pushSignal(risks, group.id, group.label, firstSubstantiveMatch(chunks, group.cues));
  // Dynamic compositional risks (budget-not-approved, privacy-gate): a semantic
  // co-occurrence, not a memorized phrase — generalizes to any wording.
  for (const composed of cfg.composed_risk_cues ?? []) {
    pushSignal(risks, composed.id, composed.label, firstComposedMatch(chunks, composed.all_of));
  }
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

  // The customer who drives the accepted next step is the champion — a stronger,
  // more general signal than keyword cues (which can misfire on an exec sponsor
  // or a security owner). Promote that person to business_champion/supportive.
  const nextStepText = (params.result.generic_diagnostics?.signals.next_steps ?? [])[0]?.text;
  if (nextStepText) {
    const driverChunk = chunks.find((c) => c.speaker && c.text && (c.text.includes(nextStepText.slice(0, 40)) || nextStepText.includes(c.text.slice(0, 40))));
    const driver = driverChunk?.speaker ? firstName(driverChunk.speaker) : null;
    const championRole = cfg.stakeholder_roles.find((r) => r.id === "business_champion");
    if (driver && championRole) {
      const entry = power_map.find((p) => firstName(p.name) === driver);
      if (entry) {
        entry.role_id = "business_champion";
        entry.role_label = championRole.label;
        entry.play = championRole.play;
        // Driving the accepted next step is advancing behavior — read as
        // supportive (conditional), not skeptical, unless purely neutral before.
        entry.stance = "supportive";
      }
    }
  }

  const headline_metric = distillHeadlineMetric(chunks);
  const timing = distillTiming(chunks, cfg);

  return {
    deal_shape,
    momentum: momentum.slice(0, 6),
    risks: risks.slice(0, 6),
    value_hypothesis,
    power_map,
    public_context,
    headline_metric,
    timing,
    headline
  };
}
