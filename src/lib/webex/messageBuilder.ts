import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { AnalysisLink } from "@/lib/qualification/types";
import type { EmailMessagePreview, LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";

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

// Rich briefs need more room than a one-line alert. Webex supports long
// markdown messages; the delivery validator enforces the hard ceiling
// (WEBEX_HARD_CHAR_CEILING). We target a rich-but-scannable brief that
// stays well under that ceiling.
const MAX_MESSAGE_CHARS = 2300;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
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
  return truncate(evidence || "No explicit commercial evidence quoted.", 260);
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
  const confidencePct = Math.round(summary.confidence * 100);

  // Webex-specific caps so the action-oriented sections (Bella next,
  // risks) always survive truncation — the full-length brief is retained
  // for the UI and email.
  const whyNow = brief.why_now.slice(0, 4).map((s) => truncate(s, 120));
  const stakeholders = brief.stakeholder_lines.filter((s) => !s.includes("(role only)")).slice(0, 5);
  const salesActions = brief.sales_actions.slice(0, 5);
  const topRisks = brief.top_risks.slice(0, 4);

  const markdown = truncate(
    joinSections([
      `**Sales action — ${summary.verdict.replace(/_/g, " ")} (${confidencePct}%)**`,
      brief.pursuit_line ? `**Pursuit:** ${brief.pursuit_line}` : null,
      `**Account:** ${summary.account ?? "Not resolved"}${brief.account_action ? ` — ${brief.account_action}` : ""}`,
      `**Lifecycle:** ${decision.lifecycle_stage}`,
      "",
      "**Opportunity thesis**",
      brief.opportunity_thesis,
      whyNow.length > 0 ? "" : null,
      whyNow.length > 0 ? "**Why now**" : null,
      whyNow.length > 0 ? bulletList(whyNow) : null,
      "",
      "**MEDDPICC**",
      bulletList(brief.meddpicc_lines),
      "",
      "**Bella next**",
      bulletList(salesActions),
      topRisks.length > 0 ? "" : null,
      topRisks.length > 0 ? "**Top risks**" : null,
      topRisks.length > 0 ? bulletList(topRisks) : null,
      stakeholders.length > 0 ? "" : null,
      stakeholders.length > 0 ? "**Stakeholders**" : null,
      stakeholders.length > 0 ? bulletList(stakeholders) : null,
      "",
      `**Technical counterpart:** ${technicalCounterpartText(decision)} — Jack to define architecture, integrations, and POV success criteria.`,
      "",
      analysisLinkMarkdown(analysisLink, runId),
      "",
      "You received this because the transcript produced a Sales / Commercial action for the Peachtree Select pilot."
    ]),
    MAX_MESSAGE_CHARS
  );
  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Sales action — ${summary.verdict} — ${summary.account ?? "Unknown account"}`,
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

  const brief = buildDeterministicBrief(result);

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "Not stated in transcript";

  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "Not yet routed";

  const evidenceSnippets = (primaryMatch?.matched_text ?? []).slice(0, 2).map((snippet) => truncate(snippet, 160));

  // Technical lane is deliberately distinct from sales: architecture,
  // integrations, evidence, and validation — and the commercial pursuit
  // score is intentionally omitted (Section 13).
  const markdown = truncate(
    joinSections([
      `**Technical action — ${summary.verdict.replace(/_/g, " ")}**`,
      `**Account:** ${summary.account ?? "Not resolved"}`,
      `**Lifecycle:** ${decision.lifecycle_stage}`,
      "",
      "**Customer pain**",
      truncate(summary.business_problem, 320),
      "",
      `**Current environment:** ${truncate(currentEnvironment, 200)}`,
      `**Solution motion:** ${truncate(solutionMotion, 200)}`,
      "",
      "**Jack next — architecture & validation**",
      bulletList(brief.technical_actions),
      "",
      "**Evidence**",
      evidenceSnippets.length > 0 ? bulletList(evidenceSnippets.map((s) => `"${s}"`)) : "- No verbatim snippet available.",
      "",
      technicalStrategyContextMarkdown(result) || null,
      "",
      analysisLinkMarkdown(analysisLink, runId),
      "",
      "You received this because the transcript produced a Technical / Specialist action for the Peachtree Select pilot."
    ]),
    MAX_MESSAGE_CHARS
  );
  return {
    lane: "technical",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Technical action — ${summary.verdict} — ${summary.account ?? "Unknown account"}`,
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

  const commercialSignalParts = [
    result.commercial_signals.budget ? `Budget: ${result.commercial_signals.budget}` : null,
    result.commercial_signals.timeline ? `Timeline: ${result.commercial_signals.timeline}` : null,
    result.commercial_signals.renewal_events[0] ? `Renewal: ${result.commercial_signals.renewal_events[0]}` : null
  ].filter(Boolean) as string[];

  const bullets = [
    { label: "Account", value: summary.account ?? "Unknown" },
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
    subject: `[${summary.verdict}] Sales action — ${summary.account ?? "Unknown account"} — ${summary.primary_opportunity ?? "Opportunity"}`,
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
    { label: "Account", value: summary.account ?? "Unknown" },
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
    subject: `[${summary.verdict}] Technical action — ${summary.account ?? "Unknown account"} — ${summary.primary_opportunity ?? "Opportunity"}`,
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
