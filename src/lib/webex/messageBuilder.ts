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
function actionLine(result: SecureNetworkingTriageResult, decision: LaneRoutingDecision, lane: "sales" | "technical"): string {
  const nba = result.next_best_action;
  if (nba && nba.action_type !== "hold" && nba.action_type !== "suppress" && nba.summary?.trim()) return nba.summary.trim();
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

  // Concise, action-first commercial nudge. The full MEDDPICC / stakeholders /
  // do-not-re-ask detail lives in the app (Decision Packet + Specialist
  // handoff) — the push message only has to make the recipient act.
  const opportunity = summary.primary_opportunity ?? result.matches[0]?.pain_category ?? "this opportunity";
  const whyNow = firstMeaningful([...(nba?.why_now ?? []), summary.urgency]) ?? "The customer asked for a concrete next step.";
  const action = actionLine(result, decision, "sales");
  const expected = firstMeaningful([...(nba?.success_criteria ?? []), summary.business_impact]) ?? "A documented outcome and an agreed next step.";
  const impact = meaningful(summary.business_impact);
  const scoring = result.opportunity_scoring;
  const pursuitLine =
    scoring && scoring.decision ? `**Pursuit:** ${scoring.decision} — ${Math.round(scoring.final_pursuit_score)}/100` : null;
  const di = result.deal_intelligence;
  const dealShapeLine = di ? `**Deal shape:** ${clipAtWord(di.deal_shape.label, 120)}` : null;
  const watchOutLine = di && di.risks[0] ? `**Watch-out:** ${clipAtWord(di.risks[0].label, 160)}` : null;
  const champion = di?.power_map.find((p) => p.role_id === "business_champion");
  const championLine = champion ? `**Champion:** ${champion.name} — ${clipAtWord(champion.play, 160)}` : null;

  const markdown = composeToByteBudget(
    [
      { text: `**${summary.verdict.replace(/_/g, " ")} · ${account.label}** — commercial` },
      { text: dealShapeLine },
      { text: `**Why you:** Commercial owner for the ${clipAtWord(opportunity, 90)} opportunity at ${account.label}.` },
      { text: `**Why now:** ${clipAtWord(whyNow, 240)}` },
      { text: `**Recommended action:** ${clipAtWord(action, 320)}` },
      { text: `**Expected outcome:** ${clipAtWord(expected, 200)}` },
      { text: championLine },
      { text: watchOutLine },
      { text: pursuitLine },
      { text: impact ? `**Business impact:** ${clipAtWord(impact, 200)}` : null },
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

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "not stated";
  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "to be scoped";
  const evidence = meaningful((primaryMatch?.matched_text ?? [])[0]);

  // Concise, action-first technical nudge — distinct from sales (environment +
  // workshop scope, not the commercial framing). Detail lives in the app.
  const whyNow = firstMeaningful([...(nba?.why_now ?? []), summary.urgency]) ?? "The customer asked for a scenario-based working session.";
  const action = actionLine(result, decision, "technical");
  const expected = firstMeaningful([...(nba?.success_criteria ?? [])]) ?? "Validated data sources and pass/fail criteria for the scenarios.";
  const di = result.deal_intelligence;
  const dealShapeLine = di ? `**Deal shape:** ${clipAtWord(di.deal_shape.label, 120)}` : null;
  // The most technical landmine to respect (credibility/feasibility/sovereignty).
  const techRisk = di?.risks.find((r) => ["credibility", "sovereignty", "skills_gap", "cost_governance"].includes(r.id)) ?? di?.risks[0] ?? null;
  const watchOutLine = techRisk ? `**Watch-out:** ${clipAtWord(techRisk.label, 160)}` : null;

  const markdown = composeToByteBudget(
    [
      { text: `**${summary.verdict.replace(/_/g, " ")} · ${account.label}** — technical` },
      { text: dealShapeLine },
      { text: `**Why you:** Technical owner — scope the workshop and validate the environment.` },
      { text: `**Why now:** ${clipAtWord(whyNow, 240)}` },
      { text: `**Recommended action:** ${clipAtWord(action, 320)}` },
      { text: `**Expected outcome:** ${clipAtWord(expected, 200)}` },
      { text: `**Environment:** ${clipAtWord(currentEnvironment, 140)} · **Motion:** ${clipAtWord(solutionMotion, 140)}` },
      { text: watchOutLine },
      { text: evidence ? `**Proof:** "${clipAtWord(evidence, 200)}"` : null },
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
