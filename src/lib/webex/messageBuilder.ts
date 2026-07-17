import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { AnalysisLink } from "@/lib/qualification/types";
import type { EmailMessagePreview, LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";

/**
 * Builds the concise, tailored Webex direct-message markdown and Outlook
 * email content for each lane, per the exact templates in the pilot
 * spec. Never pastes the full transcript; Webex messages are kept under
 * ~1,200 characters. Sales and technical content is always distinct —
 * each lane's message is built from lane-specific evidence, never a
 * shared generic template.
 *
 * The "Open full analysis" link is only ever rendered as a hyperlink
 * when `analysis_link.included` is true — i.e. a real, validated,
 * public HTTPS URL was constructed and the run was persisted (see
 * @/lib/signal-agent/analysisLink). A localhost/relative URL is never
 * sent to a remote recipient; when no valid public link exists, a
 * plain-text run-ID reference is used instead (never a dead hyperlink).
 */

// Webex accepts up to 7,439 bytes of markdown. We compose a rich brief
// against a BYTE budget (not a character guess), reserving headroom for
// the link/footer, and — when over budget — drop whole low-priority
// trailing sections rather than cutting a field mid-sentence with an
// ellipsis (Phase 13).
const MAX_MESSAGE_BYTES = 6400;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Field-level clip that cuts only at a word boundary and NEVER appends
 * an ellipsis (Phase 13: no truncation ellipsis, no mid-word cut). Used
 * with generous limits so real sentences survive; the byte budget is the
 * true cap. */
function clipAtWord(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}

/** Clip preferring a full sentence/clause boundary within budget, so a field
 * never ends mid-clause ("...and diagnosis in"). Strips a dangling trailing
 * connective ("... within three minutes, and"). Falls back to a word clip. */
function clipAtClause(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  const tidy = (s: string) => s.replace(/[,;:]\s*$/, "").replace(/\s+(?:and|or|but|with|to|for|the|a|an|in|of|by)$/i, "").trim();
  if (t.length <= maxChars) return tidy(t);
  const slice = t.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  const clauseEnd = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf("; "));
  const cut = sentenceEnd > maxChars * 0.5 ? sentenceEnd + 1 : clauseEnd > maxChars * 0.5 ? clauseEnd : -1;
  return tidy(cut > 0 ? slice.slice(0, cut) : clipAtWord(t, maxChars));
}

/** Turns a raw customer "success criteria" quote into a crisp expected outcome —
 * strips conversational lead-ins ("For success criteria, I suggest…") and clips
 * at a clause boundary (never mid-sentence). */
function cleanOutcome(text: string): string {
  const stripped = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:for\s+)?success criteria(?:\s+(?:are|would be|could be|include|is|i suggest))?[:,]?\s*/i, "")
    .replace(/^(?:i(?:'d| would)?\s+suggest|i think|maybe|ideally|we(?:'d| would)?\s+(?:like|want))[:,]?\s*/i, "")
    .trim();
  const base = stripped.length > 3 ? stripped : text.trim();
  const clipped = clipAtClause(base, 200);
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/** Joins pre-built brief sections into markdown, dropping empty sections
 * and collapsing consecutive blank lines. */
function joinSections(parts: Array<string | null | undefined>): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part === "" && out[out.length - 1] === "") continue;
    out.push(part);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Composes markdown from ordered sections against a byte budget. Each
 * section is tagged droppable or core; when over budget, droppable
 * sections are removed from lowest priority first (never mid-content),
 * and core sections (account/signal/pursuit/primary actions/footer) are
 * always retained. Produces no ellipsis. */
type Section = { text: string | null | undefined; droppable?: boolean; priority?: number };

function composeToByteBudget(sections: Section[], budgetBytes: number): string {
  const active = sections.map((s, index) => ({ ...s, index }));
  let markdown = joinSections(active.map((s) => s.text));
  if (byteLength(markdown) <= budgetBytes) return markdown;

  // Remove droppable sections, lowest priority first, then latest.
  const droppableOrder = active
    .filter((s) => s.droppable && s.text)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || b.index - a.index);
  const removed = new Set<number>();
  for (const section of droppableOrder) {
    if (byteLength(markdown) <= budgetBytes) break;
    removed.add(section.index);
    markdown = joinSections(active.filter((s) => !removed.has(s.index)).map((s) => s.text));
  }
  return markdown;
}

/** Returns trimmed text unless it is empty or a "nothing stated" placeholder
 * (so a concise message never surfaces "No quantified impact was stated"). */
function meaningful(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (/^(not stated|none|no quantified|no explicit|not yet|unknown|n\/a)\b/i.test(t)) return null;
  return t;
}

function firstMeaningful(candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const m = meaningful(c);
    if (m) return m;
  }
  return null;
}

/** The single recommended action: the canonical Next Best Action summary when
 * it is a real action, else the routed lane's first action, else a lane
 * default — never a vague "follow up". */
// A real date/schedule token — a month, weekday, quarter, relative date, or a
// numeric date. Deliberately NOT a bare digit (so "$116,000" is not a "date").
const DATEISH_RE = /\b(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|next (?:week|month|quarter|year)|this (?:week|quarter|month)|end of (?:the )?(?:week|month|quarter)|in \d+ (?:days?|weeks?|months?)|\d{1,2}\/\d{1,2})\b/i;

function actionLine(result: SecureNetworkingTriageResult, decision: LaneRoutingDecision, lane: "sales" | "technical"): string {
  const nba = result.next_best_action;
  // Prefer the concise action title over the verbose summary — a push message
  // needs one crisp imperative, not a paragraph that gets clipped mid-list.
  // The recommended timing is appended when it is a real date/deadline.
  if (nba && nba.action_type !== "hold" && nba.action_type !== "suppress") {
    const title = nba.title?.trim();
    if (title) {
      const timing = nba.recommended_timing?.trim();
      // Only append the timing when it is a SHORT, actual date/schedule token —
      // never a raw quote that merely contains a digit ("$116,000 …") or a full
      // sentence that happens to mention a date ("…stays on the incumbent through
      // next year"), either of which would splice an irrelevant fragment onto the
      // action. Real scheduling phrases are short ("by September 2", "next week").
      const hasDate = !!timing && timing.length <= 48 && DATEISH_RE.test(timing);
      return hasDate ? `${title} — ${clipAtClause(timing!, 80)}` : title;
    }
    if (nba.summary?.trim()) return nba.summary.trim();
  }
  const first = decision.actions?.[0];
  if (first) return first;
  return lane === "sales" ? "Confirm the next commercial step and owner with the customer." : "Scope the technical validation and success criteria with the customer.";
}

function analysisLinkMarkdown(analysisLink: AnalysisLink, runId: string): string {
  if (analysisLink.included && analysisLink.url) {
    return `[Open full analysis](${analysisLink.url})`;
  }
  return `**Analysis reference:** Run \`${runId}\`\nFull analysis is available in the Signal-to-Solution app.`;
}

function analysisLinkHtml(analysisLink: AnalysisLink, runId: string): string {
  if (analysisLink.included && analysisLink.url) {
    return `<p><a href="${analysisLink.url}">Open full analysis</a></p>`;
  }
  return `<p><strong>Analysis reference:</strong> Run <code>${runId}</code>. Full analysis is available in the Signal-to-Solution app.</p>`;
}

function technicalCounterpartText(decision: LaneRoutingDecision): string {
  const requiresTechnical = decision.signal_types.some((signal) =>
    ["network_refresh", "splunk_opportunity", "security_initiative", "ai_initiative", "software_buying", "technical_validation", "architecture_workshop"].includes(signal)
  );
  return requiresTechnical ? "required" : "not required";
}

function whyNowEvidence(result: SecureNetworkingTriageResult): string {
  const budget = result.commercial_signals.budget;
  const timeline = result.commercial_signals.timeline;
  const renewal = result.commercial_signals.renewal_events[0];
  const evidence = budget || timeline || renewal || result.executive_summary.business_impact || result.executive_summary.urgency;
  return clipAtWord(evidence || "No explicit commercial evidence quoted.", 400);
}

// ─── Webex direct messages ──────────────────────────────────────────────────

/** Honest message for a NOISE/suppress or HOLD result — the deterministic
 * engine found no qualified opportunity (or not enough signal), so the message
 * must say exactly that, never a fabricated "why you / recommended action /
 * champion / pursuit" nudge that would send the seller chasing a support case,
 * a trap, or a low-signal mention. */
function buildNoActionMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  lane: "sales" | "technical";
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview {
  const { result, decision, lane, runId, analysisLink } = params;
  const summary = result.executive_summary;
  const nba = result.next_best_action;
  const acct = getCanonicalAccount(result).name ?? "the account";
  const isSuppress = nba?.action_type === "suppress";
  const reason = firstMeaningful([nba?.summary, summary.business_problem]) ?? "No qualified opportunity signal was found in this conversation.";
  // Prefer the customer's own disqualifying boundary ("we are not evaluating…",
  // "keep sales out…") — the most honest, specific reason not to pursue.
  const objections = result.decision_packet?.objections ?? [];
  const boundary = (objections.find((o) => o.type === "disqualifier") ?? objections[0])?.statement ?? null;
  const action = isSuppress
    ? lane === "sales"
      ? "No sales outreach — this is not a qualified sales opportunity."
      : "No technical action — no workshop or validation is warranted."
    : "Monitor only — revisit if a clearer buying signal appears; do not push a next step yet.";
  const markdown = composeToByteBudget(
    [
      { text: `**${summary.verdict.replace(/_/g, " ")} · ${acct}** — ${lane}: no action recommended` },
      { text: `**Assessment:** ${clipAtWord(nba?.title ?? (isSuppress ? "No internal action" : "Hold — insufficient signal"), 140)}` },
      { text: `**Why:** ${clipAtWord(reason, 240)}` },
      { text: `**Recommended action:** ${action}` },
      { text: boundary ? `**Customer boundary:** "${clipAtWord(boundary, 180)}"` : null },
      { text: "" },
      { text: analysisLinkMarkdown(analysisLink, runId) }
    ],
    MAX_MESSAGE_BYTES
  );
  return {
    lane,
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `${lane === "sales" ? "Sales" : "Technical"} — ${summary.verdict} — ${acct} — no action`,
    markdown,
    character_count: markdown.length,
    synthesized_by_ai: false
  };
}

export function buildSalesMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview {
  const { result, decision, runId, analysisLink } = params;
  const summary = result.executive_summary;
  const account = getCanonicalAccount(result);
  const nba = result.next_best_action;
  // A NOISE/suppress or HOLD result must never be dressed up as a pursue nudge.
  if (nba && (nba.action_type === "suppress" || nba.action_type === "hold")) {
    return buildNoActionMessage({ result, decision, lane: "sales", runId, analysisLink });
  }

  // Concise, action-first commercial nudge. The full MEDDPICC / stakeholders /
  // do-not-re-ask detail lives in the app (Decision Packet + Specialist
  // handoff) — the push message only has to make the recipient act.
  const opportunity = summary.primary_opportunity ?? result.matches[0]?.pain_category ?? "this opportunity";
  const di = result.deal_intelligence;
  // "Why now" leads with the honest timing driver (a decision boundary, framed
  // as such — never manufactured procurement urgency), then the accepted next
  // step, then generic urgency.
  const whyNow = firstMeaningful([di?.timing?.label ?? null, ...(nba?.why_now ?? []), summary.urgency]) ?? "The customer asked for a concrete next step.";
  const action = actionLine(result, decision, "sales");
  // Expected OUTCOME — never the raw pain quote (that is the metric/impact, not
  // an outcome). Use concrete success criteria when present, else a clean goal.
  const expected = firstMeaningful([...(nba?.success_criteria ?? [])]) ?? "A qualified go/no-go with an agreed owner and next step.";
  // Prefer the distilled headline metric (digits, baseline→target) over a raw
  // impact quote — the crisp number is what makes the recipient act.
  const metricLine = di?.headline_metric ? `**Metric:** ${clipAtWord(di.headline_metric, 120)}` : meaningful(summary.business_impact) ? `**Business impact:** ${clipAtWord(meaningful(summary.business_impact)!, 200)}` : null;
  const scoring = result.opportunity_scoring;
  const pursuitLine =
    scoring && scoring.decision ? `**Pursuit:** ${scoring.decision} — ${Math.round(scoring.final_pursuit_score)}/100` : null;
  const dealShapeLine = di ? `**Deal shape:** ${clipAtWord(di.deal_shape.label, 120)}` : null;
  // Commercial lane cares most about funding/authority/privacy landmines.
  const salesRisk = di?.risks.find((r) => ["budget_not_approved", "no_single_eb", "privacy_gate", "cost_governance"].includes(r.id)) ?? di?.risks[0] ?? null;
  const watchOutLine = salesRisk ? `**Watch-out:** ${clipAtWord(salesRisk.label, 160)}` : null;
  const champion = di?.power_map.find((p) => p.role_id === "business_champion");
  const championLine = champion ? `**Champion:** ${champion.name} — ${clipAtWord(champion.play, 160)}` : null;
  // Distilled public research (when it surfaced) — one punchy account fact.
  const publicIntel = di?.public_context[0];
  const accountIntelLine = publicIntel ? `**Account intel:** ${clipAtWord(publicIntel.label, 170)}` : null;

  // Goal-aligned framing (Oscar's "speak their language / 60%-to-quota" ask).
  // The recipient teaser carries a goal-aligned "why you" and an OWNER-ONLY
  // goal/quota hook (already nulled for non-owner lanes — no quota leak).
  const salesTeaser = result.personalization?.recipient_teasers?.sales;
  const whyYouText =
    salesTeaser?.why_you && !/^You are the routed owner/i.test(salesTeaser.why_you)
      ? clipAtWord(salesTeaser.why_you, 200)
      : `Commercial owner for the ${clipAtWord(opportunity, 90)} opportunity at ${account.prose}.`;
  const goalImpactLine = salesTeaser?.goal_impact ? `**Goal impact:** ${clipAtWord(salesTeaser.goal_impact, 130)}` : null;
  // The concrete goals this opportunity advances (Oscar's "speak to my goals") —
  // named, not an abstract "goal alignment". Owner-scoped teaser; null when no
  // profile/goals exist, so profile-less runs are unaffected.
  const goalFitLine = salesTeaser?.goal_alignment ? `**Goal fit:** ${clipAtWord(salesTeaser.goal_alignment.replace(/^Supports:\s*/i, ""), 140)}` : null;

  const markdown = composeToByteBudget(
    [
      { text: `**${summary.verdict.replace(/_/g, " ")} · ${account.label}** — commercial` },
      { text: dealShapeLine },
      // Owner's goal/quota hook is placed high — the exciting reason to open it.
      { text: goalImpactLine },
      { text: `**Why you:** ${whyYouText}` },
      { text: goalFitLine, droppable: true, priority: 5 },
      { text: `**Why now:** ${clipAtWord(whyNow, 240)}` },
      { text: `**Recommended action:** ${clipAtWord(action, 320)}` },
      { text: `**Expected outcome:** ${cleanOutcome(expected)}` },
      { text: metricLine },
      { text: championLine },
      { text: accountIntelLine },
      { text: watchOutLine },
      { text: pursuitLine },
      { text: "" },
      { text: analysisLinkMarkdown(analysisLink, runId) }
    ],
    MAX_MESSAGE_BYTES
  );
  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Sales action — ${summary.verdict} — ${account.label}`,
    markdown,
    character_count: markdown.length,
    synthesized_by_ai: false
  };
}

export function buildTechnicalMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview {
  const { result, decision, runId, analysisLink } = params;
  const summary = result.executive_summary;
  const primaryMatch = result.matches[0];
  const account = getCanonicalAccount(result);
  const nba = result.next_best_action;
  if (nba && (nba.action_type === "suppress" || nba.action_type === "hold")) {
    return buildNoActionMessage({ result, decision, lane: "technical", runId, analysisLink });
  }

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "not stated";
  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "to be scoped";
  const evidence = meaningful((primaryMatch?.matched_text ?? [])[0]);

  // Concise, action-first technical nudge — distinct from sales (environment +
  // workshop scope, not the commercial framing). Detail lives in the app.
  const di = result.deal_intelligence;
  const whyNow = firstMeaningful([di?.timing?.label ?? null, ...(nba?.why_now ?? []), summary.urgency]) ?? "The customer asked for a scenario-based working session.";
  const action = actionLine(result, decision, "technical");
  const expected = firstMeaningful([...(nba?.success_criteria ?? [])]) ?? "Validated data sources and pass/fail criteria for the scenarios.";
  const metricLine = di?.headline_metric ? `**Metric:** ${clipAtWord(di.headline_metric, 120)}` : null;
  const dealShapeLine = di ? `**Deal shape:** ${clipAtWord(di.deal_shape.label, 120)}` : null;
  // The most technical landmine to respect (credibility/feasibility/sovereignty).
  const techRisk = di?.risks.find((r) => ["credibility", "sovereignty", "skills_gap", "cost_governance", "privacy_gate"].includes(r.id)) ?? di?.risks[0] ?? null;
  const watchOutLine = techRisk ? `**Watch-out:** ${clipAtWord(techRisk.label, 160)}` : null;
  // Goal-aligned framing for the technical owner (owner-only goal hook is null
  // unless the technical recipient is themselves the profile owner).
  const techTeaser = result.personalization?.recipient_teasers?.technical;
  const whyYouText =
    techTeaser?.why_you && !/^You are the routed owner/i.test(techTeaser.why_you)
      ? clipAtWord(techTeaser.why_you, 200)
      : "Technical owner — scope the workshop and validate the environment.";
  const goalImpactLine = techTeaser?.goal_impact ? `**Goal impact:** ${clipAtWord(techTeaser.goal_impact, 130)}` : null;
  const goalFitLine = techTeaser?.goal_alignment ? `**Goal fit:** ${clipAtWord(techTeaser.goal_alignment.replace(/^Supports:\s*/i, ""), 140)}` : null;

  const markdown = composeToByteBudget(
    [
      { text: `**${summary.verdict.replace(/_/g, " ")} · ${account.label}** — technical` },
      { text: dealShapeLine },
      { text: goalImpactLine },
      { text: `**Why you:** ${whyYouText}` },
      { text: goalFitLine, droppable: true, priority: 5 },
      { text: `**Why now:** ${clipAtWord(whyNow, 240)}` },
      { text: `**Recommended action:** ${clipAtWord(action, 320)}` },
      { text: `**Expected outcome:** ${cleanOutcome(expected)}` },
      { text: metricLine },
      { text: `**Environment:** ${clipAtWord(currentEnvironment, 140)} · **Motion:** ${clipAtWord(solutionMotion, 140)}` },
      { text: watchOutLine },
      { text: evidence ? `**Proof:** "${clipAtClause(evidence, 200)}"` : null },
      { text: "" },
      { text: analysisLinkMarkdown(analysisLink, runId) }
    ],
    MAX_MESSAGE_BYTES
  );
  return {
    lane: "technical",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Technical action — ${summary.verdict} — ${account.label}`,
    markdown,
    character_count: markdown.length,
    synthesized_by_ai: false
  };
}

export function buildMessagesForRouting(params: {
  result: SecureNetworkingTriageResult;
  routing: LaneRoutingDecision[];
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview[] {
  return params.routing.map((decision) =>
    decision.lane === "sales"
      ? buildSalesMessage({ result: params.result, decision, runId: params.runId, analysisLink: params.analysisLink })
      : buildTechnicalMessage({ result: params.result, decision, runId: params.runId, analysisLink: params.analysisLink })
  );
}

// ─── Outlook emails ──────────────────────────────────────────────────────────

function htmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bulletsToHtml(items: Array<{ label: string; value: string }>): string {
  const rows = items.map((item) => `<li><strong>${htmlEscape(item.label)}:</strong> ${htmlEscape(item.value)}</li>`).join("");
  return `<ul>${rows}</ul>`;
}

function bulletsToText(items: Array<{ label: string; value: string }>): string {
  return items.map((item) => `- ${item.label}: ${item.value}`).join("\n");
}

export function buildSalesEmail(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): EmailMessagePreview {
  const { result, decision, runId, analysisLink } = params;
  const summary = result.executive_summary;
  const account = getCanonicalAccount(result);

  const commercialSignalParts = [
    result.commercial_signals.budget ? `Budget: ${result.commercial_signals.budget}` : null,
    result.commercial_signals.timeline ? `Timeline: ${result.commercial_signals.timeline}` : null,
    result.commercial_signals.renewal_events[0] ? `Renewal: ${result.commercial_signals.renewal_events[0]}` : null
  ].filter(Boolean) as string[];

  const bullets = [
    { label: "Account", value: account.label },
    { label: "Verdict and confidence", value: `${summary.verdict} (${Math.round(summary.confidence * 100)}%)` },
    { label: "Lifecycle stage", value: decision.lifecycle_stage },
    { label: "Commercial signals", value: commercialSignalParts.length > 0 ? commercialSignalParts.join("; ") : "None explicitly stated" },
    { label: "Budget / timeline / renewal", value: whyNowEvidence(result) },
    { label: "Primary opportunity", value: summary.primary_opportunity ?? "Not identified" },
    { label: "Recommended sales action", value: decision.actions[0] ?? "Review the full analysis" },
    { label: "Technical counterpart requirement", value: technicalCounterpartText(decision) }
  ];

  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `[${summary.verdict}] Sales action — ${account.label} — ${summary.primary_opportunity ?? "Opportunity"}`,
    html: `<p>Peachtree Select pilot — Sales action.</p>${bulletsToHtml(bullets)}${analysisLinkHtml(analysisLink, runId)}`,
    text: `Peachtree Select pilot — Sales action.\n\n${bulletsToText(bullets)}\n\n${analysisLink.included && analysisLink.url ? `Full analysis: ${analysisLink.url}` : `Analysis reference: Run ${runId}`}`,
    synthesized_by_ai: false
  };
}

export function buildTechnicalEmail(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): EmailMessagePreview {
  const { result, decision, runId, analysisLink } = params;
  const summary = result.executive_summary;
  const primaryMatch = result.matches[0];
  const account = getCanonicalAccount(result);

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "Not stated in transcript";
  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "Not yet routed";
  const evidence = (primaryMatch?.matched_text ?? []).slice(0, 3).join(" / ") || "No verbatim snippet available.";
  const unresolvedRisks = (primaryMatch?.solution_decision.do_not_choose_conflicts ?? [])
    .filter((c) => c.status === "contradicted")
    .map((c) => c.rule)
    .join("; ");

  const bullets = [
    { label: "Account", value: account.label },
    { label: "Customer pain", value: summary.business_problem || "Not stated" },
    { label: "Current architecture / environment", value: currentEnvironment },
    { label: "Recommended solution motion", value: solutionMotion },
    { label: "Technical evidence", value: evidence },
    { label: "Risks / unknowns", value: unresolvedRisks || "None flagged" },
    { label: "Recommended action", value: decision.actions[0] ?? "Schedule technical discovery / architecture review." }
  ];

  return {
    lane: "technical",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `[${summary.verdict}] Technical action — ${account.label} — ${summary.primary_opportunity ?? "Opportunity"}`,
    html: `<p>Peachtree Select pilot — Technical action.</p>${bulletsToHtml(bullets)}${analysisLinkHtml(analysisLink, runId)}`,
    text: `Peachtree Select pilot — Technical action.\n\n${bulletsToText(bullets)}\n\n${analysisLink.included && analysisLink.url ? `Full analysis: ${analysisLink.url}` : `Analysis reference: Run ${runId}`}`,
    synthesized_by_ai: false
  };
}

export function buildEmailsForRouting(params: {
  result: SecureNetworkingTriageResult;
  routing: LaneRoutingDecision[];
  runId: string;
  analysisLink: AnalysisLink;
}): EmailMessagePreview[] {
  return params.routing.map((decision) =>
    decision.lane === "sales"
      ? buildSalesEmail({ result: params.result, decision, runId: params.runId, analysisLink: params.analysisLink })
      : buildTechnicalEmail({ result: params.result, decision, runId: params.runId, analysisLink: params.analysisLink })
  );
}
