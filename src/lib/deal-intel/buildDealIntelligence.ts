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
const METRIC_NOUNS = "minutes?|hours?|days?|weeks?|sessions?|incidents?|outages?|failures?|rollbacks?|tickets?|analysts?|responders?|users?|people|endpoints?|records?|transactions?";
// Any improvement-bearing unit — durations AND percentages (a rollback/error
// rate improving from 9.6% to <3% is as much a headline metric as a duration).
const IMPROVE_UNITS = "minutes?|hours?|days?|weeks?|months?|percent|%";
// Allow a single descriptive adjective between the number and the unit
// ("21 calendar days", "median 42 minutes") so a real metric is not missed.
const METRIC_WITH_UNIT = new RegExp(
  `\\b(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:(?:calendar|business|working|elapsed|median|mean|average)\\s+)?(${IMPROVE_UNITS})\\b`,
  "gi"
);
const TARGET_MARKER = /\b(target|goal|under|below|less than|or less|or fewer|within|down to|to under|reduce|cut|threshold)\b/i;
const BASELINE_MARKER = /\b(was|is|currently|today|average|averaged|on average|mean|median|at the median|takes?|took|baseline|per incident|require|required)\b/i;
// A target number stated without repeating the unit ("under 15", "down to 3").
const BARE_TARGET = /\b(?:under|below|less than|down to|to under|to below|no more than|at most)\s+(\d[\d,]*(?:\.\d+)?)\b/gi;
// A unit token immediately following a bare number (so it was already captured
// with its unit by METRIC_WITH_UNIT and must not be re-counted as bare).
const UNIT_AFTER = /^\s*(?:%|percent|minutes?|hours?|days?|weeks?|months?)/i;

function canonicalMetricUnit(u: string): string {
  const l = u.toLowerCase();
  return l === "%" || l.startsWith("percent") ? "percent" : l.replace(/s$/, "");
}
function formatMetricNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/** Distills the single most compelling quantified metric from the customer's
 * own sentences, in DIGITS (spelled numbers normalized). Prefers a
 * baseline→target duration pair ("from 96 to under 30 minutes"); otherwise the
 * largest business-relevant count. Returns null when nothing quantified. */
function distillHeadlineMetric(chunks: TranscriptChunk[]): string | null {
  const normalized = chunks.map((c) => normalizeSpelledNumbers(c.text));
  // Track a baseline (largest) and target (smallest) PER UNIT, so a
  // "42 → under 10 minutes" duration pair and a "9.6% → under 3%" rate pair
  // are each recognized instead of being cross-contaminated into one broken
  // pair (mixing minutes with days). Preceding words classify each number as a
  // baseline (current/median/average) or a target (under/below/threshold).
  const byUnit = new Map<string, { baseline: number | null; target: number | null }>();
  for (const norm of normalized) {
    const chunkUnits = new Set<string>();
    for (const m of norm.matchAll(METRIC_WITH_UNIT)) {
      const value = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      const unit = canonicalMetricUnit(m[2]);
      chunkUnits.add(unit);
      // Classify from BOTH sides — a baseline qualifier often trails the number
      // ("42 minutes at the median", "14 hours per plant last quarter on
      // average", "eight days or less"). The trailing context runs only to the
      // next CLAUSE boundary (comma / "and" / "but" / sentence end), so a
      // qualifier for the NEXT clause's number is excluded ("96 minutes and our
      // board target is under 30" keeps 96 as the baseline, not the target),
      // while a same-clause trailing qualifier is still captured.
      const idx = m.index ?? 0;
      const afterClause = norm.slice(idx + m[0].length, idx + m[0].length + 60).split(/[,;.]| and | but | while | whereas /i)[0];
      const context = `${norm.slice(Math.max(0, idx - 30), idx)} ${afterClause}`;
      const entry = byUnit.get(unit) ?? { baseline: null, target: null };
      if (TARGET_MARKER.test(context)) {
        if (entry.target === null || value < entry.target) entry.target = value;
      } else if (BASELINE_MARKER.test(context)) {
        if (entry.baseline === null || value > entry.baseline) entry.baseline = value;
      }
      byUnit.set(unit, entry);
    }
    // Bare-target inference: a target stated WITHOUT repeating the unit ("from 40
    // minutes to under 15", "cut it from ninety minutes to under fifteen") is
    // common. When the chunk has exactly ONE metric unit, assign a bare target
    // ("under N", "below N", "down to N") — not already followed by a unit — to
    // that unit so the baseline→target pair is not lost.
    if (chunkUnits.size === 1) {
      const soleUnit = [...chunkUnits][0];
      for (const bm of norm.matchAll(BARE_TARGET)) {
        const after = norm.slice((bm.index ?? 0) + bm[0].length, (bm.index ?? 0) + bm[0].length + 12);
        if (UNIT_AFTER.test(after)) continue; // already captured with its unit above
        const value = Number(bm[1].replace(/,/g, ""));
        if (!Number.isFinite(value)) continue;
        const entry = byUnit.get(soleUnit) ?? { baseline: null, target: null };
        if (entry.target === null || value < entry.target) entry.target = value;
        byUnit.set(soleUnit, entry);
      }
    }
  }
  // The most compelling improvement pair = the largest relative reduction.
  let best: { unit: string; baseline: number; target: number; rel: number } | null = null;
  for (const [unit, e] of byUnit) {
    if (e.baseline !== null && e.target !== null && e.baseline > e.target) {
      const rel = 1 - e.target / e.baseline;
      if (!best || rel > best.rel) best = { unit, baseline: e.baseline, target: e.target, rel };
    }
  }
  if (best) {
    return best.unit === "percent"
      ? `${formatMetricNumber(best.baseline)}% → under ${formatMetricNumber(best.target)}%`
      : `${formatMetricNumber(best.baseline)} → under ${formatMetricNumber(best.target)} ${best.unit}s`;
  }
  // Fallback: the largest business-relevant COUNT with its noun — but never a
  // hyphenated fragment ("408 customer-facing" must not yield "408 customer")
  // and never a neutral scale word alone; require a problem/relevant noun
  // immediately adjacent and NOT continuing into a compound.
  const countRe = new RegExp(`\\b(\\d[\\d,]{2,})\\s+(${METRIC_NOUNS})(?![-\\w])`, "gi");
  let bestCount: { value: number; text: string } | null = null;
  for (const norm of normalized) {
    for (const m of norm.matchAll(countRe)) {
      const value = Number(m[1].replace(/[,]/g, ""));
      if (Number.isFinite(value) && (!bestCount || value > bestCount.value)) bestCount = { value, text: `${value.toLocaleString("en-US")} ${m[2].toLowerCase()}` };
    }
  }
  return bestCount?.text ?? null;
}

// Past-event markers — a timing driver must be forward-looking; a renewal that
// "already happened" or a contract "signed in May" is not a reason to act now.
const PAST_EVENT_RE = /\b(already|was signed|were signed|signed in|happened|renewed last|\bago\b|last (year|quarter|month|week))\b/i;
// Decision-boundary words rank above a bare renewal/month as "why now".
const DECISION_BOUNDARY_RE = /\b(freeze|memo|committee|review closes|closes|reviews the case|recommendation|deadline|go-?live|cutover|due (by|on|date))\b/i;
// A sentence that NEGATES a deadline/date ("not a procurement deadline", "no
// hard deadline", "not a purchase date") — the opposite of a reason to act now.
const NEGATED_TIMING_RE = /\b(?:not|isn'?t|no)\s+(?:a\s+|an\s+|the\s+)?(?:hard\s+|firm\s+|real\s+|procurement\s+|purchase\s+|buying\s+|close\s+|commercial\s+|sign(?:ing|ature)?\s+)*(?:deadline|close date|purchase date|buying date)\b/i;
// A hedged / hypothetical statement — speculative impact, not a concrete driver.
const HEDGED_TIMING_RE = /\b(?:it may be|may be|might be|could be|would be|may become|might become|becoming harder|harder to meet|perhaps|possibly|hypothetically)\b/i;
// A media/production EVENT boundary (a screening, premiere, festival, broadcast)
// is an operational calendar date, never a buying/decision timing driver — even
// though it carries a date. Generic event nouns only; not tied to any account.
const PRODUCTION_EVENT_RE = /\b(screenings?|premieres?|festivals?|red carpet|broadcasts?|air dates?|showcases?|galas?|matinees?)\b/i;

/** Extracts the honest timing driver: the decision-relevant deadline, and
 * whether it is real procurement timing or only a decision/planning boundary.
 * Skips past events, prefers decision boundaries, and never manufactures
 * urgency — returns null when no forward-looking dated driver was stated. */
function distillTiming(chunks: TranscriptChunk[], cfg: DealIntelConfig): DealIntelligence["timing"] {
  const tc = cfg.timing_cues;
  if (!tc) return null;
  // A month counts as a DATE only when it is part of an actual date — adjacent to
  // a day number ("September 2", "18 August") or a date preposition ("in
  // September", "by October"). This prevents the ambiguous month words "may" and
  // "march" from matching the modal verb ("records that may need to exist") or the
  // action ("march toward"), which would fabricate a timing driver.
  const months = tc.months.join("|");
  // A day is a digit (optionally ordinal) OR a spelled-out ordinal word.
  const ordinalWord =
    "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[- ](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|thirtieth|thirty[- ]first";
  const day = `(?:\\d{1,2}(?:st|nd|rd|th)?|${ordinalWord})`;
  const monthRe = new RegExp(
    `\\b(?:${months})\\b\\.?\\s+${day}\\b|\\b${day}\\s+(?:of\\s+)?(?:${months})\\b|\\b(?:in|by|on|before|after|during|early|late|mid|end of|through|until)\\s+(?:${months})\\b`,
    "i"
  );
  const lockedIn = tc.locked_in_markers ?? [];
  let best: { chunk: TranscriptChunk; score: number } | null = null;
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    if (PAST_EVENT_RE.test(lower)) continue;
    // A QUESTION ("Is November 30 the decision deadline?") asks about timing — it
    // is not a stated driver. Never surface an interrogative as "why now".
    if (chunk.text.trim().endsWith("?")) continue;
    // A locked-in / "not under review" / "contracted through" statement is the
    // OPPOSITE of a reason to act now — never surface it as "why now".
    if (lockedIn.some((m) => lower.includes(m))) continue;
    // A sentence NEGATING the deadline ("it is not a procurement deadline", "not
    // a purchase date", "no hard deadline") states there is NO urgency — it must
    // never become the "why now" label. (Distinct from "the deadline is not until
    // September", which affirms a September deadline.)
    if (NEGATED_TIMING_RE.test(lower)) continue;
    // A HEDGED / hypothetical statement ("it may be ... a deadline becoming
    // harder to meet", "could be", "might become") is a speculative business
    // impact, not a concrete timing driver — never manufacture urgency from it.
    if (HEDGED_TIMING_RE.test(lower)) continue;
    // A production/media event date is an operational boundary, not buying timing.
    if (PRODUCTION_EVENT_RE.test(lower)) continue;
    const hasDeadlineWord = tc.deadline_markers.some((m) => lower.includes(m));
    const hasDate = monthRe.test(lower);
    if (!hasDeadlineWord && !hasDate) continue;
    // Rank so a CONCRETE DATE dominates: an actual dated milestone ("selection
    // September 15") is a far better "why now" than a date-less meta statement
    // that merely contains a deadline word ("this is a real evaluation, not a
    // renewal formality" trips on "renewal"). Dates outrank everything; a
    // decision-boundary word and a deadline word add secondary weight.
    const score = (hasDate ? 4 : 0) + (DECISION_BOUNDARY_RE.test(lower) ? 2 : 0) + (hasDeadlineWord ? 1 : 0);
    if (!best || score > best.score) best = { chunk, score };
  }
  if (!best) return null;
  const lower = best.chunk.text.toLowerCase();
  const isProcurement = tc.procurement_markers.some((m) => lower.includes(m)) && !tc.not_procurement_markers.some((m) => lower.includes(m));
  // The label is customer-facing prose — it carries ONLY the timing sentence.
  // Whether this is procurement timing vs. a decision boundary is an internal
  // classification exposed structurally via `is_procurement`, never spliced into
  // the message text (an annotation like "(decision boundary, not procurement)"
  // reads as debug output in a delivered message).
  return { label: shortText(best.chunk.text, 180), is_procurement: isProcurement, evidence: shortText(best.chunk.text, 200) };
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
  // Skip META / instruction statements ("record that as seller-proposed", "do
  // not use this as the business case", "not a customer commitment") — those are
  // process notes, never the value hypothesis.
  const META_RE = /\b(record that|do not use|don'?t use|note that|for the record|to be precise|be careful|not a customer commitment|seller[- ]proposed|do not treat|should not|not the business case|as a hypothesis)\b/i;
  const impactCandidates = [...qualitativeImpactSentences(params.transcript), ...(params.result.commercial_signals?.quantified_impact ?? [])];
  const impact = impactCandidates.find((s) => s && !META_RE.test(s)) ?? null;
  const value_hypothesis = impact ? `Frame value in their words: "${shortText(impact, 220)}"` : null;

  // ── Honest, compelling headline ───────────────────────────────────────────
  const topMomentum = momentum[0]?.label ?? "an active, customer-driven conversation";
  const topRisk = risks[0]?.label ?? null;
  const headline = `${deal_shape.label} at ${accountName} — ${topMomentum.toLowerCase()}${topRisk ? `; watch: ${topRisk.toLowerCase()}` : ""}.`;

  const power_map = buildStakeholderPlaybook(chunks, params.result.stakeholder_analysis?.named_stakeholders ?? [], cfg);

  // The customer who drives the accepted next step is the champion — a stronger,
  // more general signal than keyword cues. BUT the champion is the internal
  // seller who OWNS THE RECOMMENDATION and advocates, NOT the executive sponsor
  // who chairs the committee / holds budget authority. So never promote a person
  // whose behavior is executive-sponsor governance (committee chair, board,
  // "put it on the agenda") — that is sponsorship, not championing. The cue-based
  // champion (the person who owns the recommendation / coordinates) stands.
  const nextStepText = (params.result.generic_diagnostics?.signals.next_steps ?? [])[0]?.text;
  if (nextStepText) {
    const driverChunk = chunks.find((c) => c.speaker && c.text && (c.text.includes(nextStepText.slice(0, 40)) || nextStepText.includes(c.text.slice(0, 40))));
    const driver = driverChunk?.speaker ? firstName(driverChunk.speaker) : null;
    const championRole = cfg.stakeholder_roles.find((r) => r.id === "business_champion");
    if (driver && championRole) {
      const entry = power_map.find((p) => firstName(p.name) === driver);
      // Do not overwrite an executive sponsor with the champion label — their
      // governance next step ("place it on the committee agenda") is sponsorship.
      if (entry && entry.role_id !== "executive_sponsor") {
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
