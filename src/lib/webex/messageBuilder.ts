import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { AnalysisLink } from "@/lib/qualification/types";
import type { EmailMessagePreview, LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";
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

function bulletList(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
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

/** Technical-lane variant — architecture-relevant strategy/technology
 * alignment and trigger events only, never the commercial score number
 * (Section 16: "Do not overload Jack's technical message with the
 * commercial score"). */
function technicalStrategyContextMarkdown(result: SecureNetworkingTriageResult): string {
  const relevantSignals = result.serpapi_signals.signals
    // Only strong/supporting, transcript-aligned public signals belong in
    // an outbound message (Phase 9) — never weak/relevance-zero snippets.
    .filter((s) => s.evidence_class === "confirmed_public_fact" || s.evidence_class === "probable_public_signal")
    .filter((s) => s.category === "technology_alignment" || s.category === "trigger_event" || s.category === "strategic_objective")
    .slice(0, 3);
  if (relevantSignals.length === 0) return "";
  const lines = ["**Account strategy context**", ...relevantSignals.map((s) => `- ${s.claim.slice(0, 100)} ([source](${s.source_url}))`)];
  return lines.join("\n");
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
  const brief = buildDeterministicBrief(result);
  const account = getCanonicalAccount(result);
  const confidencePct = Math.round(summary.confidence * 100);

  // Full sentences survive (no per-field ellipsis); the byte budget drops
  // whole low-priority sections if ever needed. Core sections (account,
  // signal, pursuit, thesis, why-now, primary actions, footer) are never
  // dropped.
  const whyNow = brief.why_now.slice(0, 4);
  const stakeholders = brief.stakeholder_lines.filter((s) => !s.includes("(role only)")).slice(0, 5);
  const salesActions = brief.sales_actions.slice(0, 5);
  const topRisks = brief.top_risks.slice(0, 4);

  const markdown = composeToByteBudget(
    [
      { text: `**Sales action — ${summary.verdict.replace(/_/g, " ")} (${confidencePct}%)**` },
      { text: brief.pursuit_line ? `**Pursuit:** ${brief.pursuit_line}` : null },
      { text: `**Account:** ${account.label}${brief.account_action ? ` — ${brief.account_action}` : ""}` },
      { text: `**Lifecycle:** ${decision.lifecycle_stage}` },
      { text: "" },
      { text: "**Opportunity thesis**" },
      { text: brief.opportunity_thesis },
      { text: whyNow.length > 0 ? "\n**Why now**" : null },
      { text: whyNow.length > 0 ? bulletList(whyNow) : null },
      { text: "\n**MEDDPICC**" },
      { text: bulletList(brief.meddpicc_lines) },
      { text: "\n**Bella next**" },
      { text: bulletList(salesActions) },
      { text: topRisks.length > 0 ? "\n**Top risks**" : null, droppable: true, priority: 2 },
      { text: topRisks.length > 0 ? bulletList(topRisks) : null, droppable: true, priority: 2 },
      { text: stakeholders.length > 0 ? "\n**Stakeholders**" : null, droppable: true, priority: 1 },
      { text: stakeholders.length > 0 ? bulletList(stakeholders) : null, droppable: true, priority: 1 },
      { text: `\n**Technical counterpart:** ${technicalCounterpartText(decision)} — Jack to define architecture, integrations, and POV success criteria.` },
      { text: "" },
      { text: analysisLinkMarkdown(analysisLink, runId) },
      { text: "" },
      { text: "You received this because the transcript produced a Sales / Commercial action for the Peachtree Select pilot." }
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

  const brief = buildDeterministicBrief(result);

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "Not stated in transcript";

  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "Not yet routed";

  // Full verbatim snippets (generous word-boundary clip, no ellipsis).
  const evidenceSnippets = (primaryMatch?.matched_text ?? []).slice(0, 2).map((snippet) => clipAtWord(snippet, 400));
  const strategyContext = technicalStrategyContextMarkdown(result);

  // Technical lane is deliberately distinct from sales: architecture,
  // integrations, evidence, and validation — and the commercial pursuit
  // score is intentionally omitted (Section 13).
  const markdown = composeToByteBudget(
    [
      { text: `**Technical action — ${summary.verdict.replace(/_/g, " ")}**` },
      { text: `**Account:** ${account.label}` },
      { text: `**Lifecycle:** ${decision.lifecycle_stage}` },
      { text: "" },
      { text: "**Customer pain**" },
      { text: clipAtWord(summary.business_problem, 600) },
      { text: "" },
      { text: `**Current environment:** ${clipAtWord(currentEnvironment, 400)}` },
      { text: `**Solution motion:** ${clipAtWord(solutionMotion, 400)}` },
      { text: "\n**Jack next — architecture & validation**" },
      { text: bulletList(brief.technical_actions) },
      { text: "\n**Evidence**" },
      { text: evidenceSnippets.length > 0 ? bulletList(evidenceSnippets.map((s) => `"${s}"`)) : "- No verbatim snippet available.", droppable: true, priority: 2 },
      { text: strategyContext ? `\n${strategyContext}` : null, droppable: true, priority: 1 },
      { text: "" },
      { text: analysisLinkMarkdown(analysisLink, runId) },
      { text: "" },
      { text: "You received this because the transcript produced a Technical / Specialist action for the Peachtree Select pilot." }
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
