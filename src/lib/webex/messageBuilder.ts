import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { EmailMessagePreview, LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";

/**
 * Builds the concise, tailored Webex direct-message markdown and Outlook
 * email content for each lane, per the exact templates in the pilot
 * spec. Never pastes the full transcript; Webex messages are kept under
 * ~1,200 characters. Sales and technical content is always distinct —
 * each lane's message is built from lane-specific evidence, never a
 * shared generic template.
 */

const MAX_MESSAGE_CHARS = 1200;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function analysisUrl(baseUrl: string | null, runId: string): string {
  const base = baseUrl?.replace(/\/$/, "") ?? "";
  return `${base}/signal-agent?run=${encodeURIComponent(runId)}`;
}

function commercialStakeholders(result: SecureNetworkingTriageResult): string {
  const names = result.stakeholders
    .filter((s) => s.ownership_type === "executive" || s.ownership_type === "operational")
    .map((s) => (s.role ? `${s.name} (${s.role})` : s.name));
  return names.length > 0 ? names.join(", ") : "Not identified in transcript";
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
  baseUrl: string | null;
}): WebexMessagePreview {
  const { result, decision, runId, baseUrl } = params;
  const summary = result.executive_summary;

  const lines = [
    `**Sales action — ${summary.verdict}**`,
    "",
    `**Account:** ${summary.account ?? "Unknown"}`,
    `**Lifecycle:** ${decision.lifecycle_stage}`,
    `**Opportunity:** ${summary.primary_opportunity ?? "Not identified"}`,
    `**Why now:** ${whyNowEvidence(result)}`,
    `**Customer stakeholders:** ${truncate(commercialStakeholders(result), 160)}`,
    `**Recommended action:** ${decision.actions[0] ?? "Review the full analysis"}`,
    `**Technical counterpart:** ${technicalCounterpartText(decision)}`,
    "",
    `[Open full analysis](${analysisUrl(baseUrl, runId)})`,
    "",
    "You received this because the transcript produced a Sales / Commercial action for the Peachtree Select pilot."
  ];

  const markdown = truncate(lines.join("\n"), MAX_MESSAGE_CHARS);
  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Sales action — ${summary.verdict} — ${summary.account ?? "Unknown account"}`,
    markdown,
    character_count: markdown.length
  };
}

export function buildTechnicalMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  baseUrl: string | null;
}): WebexMessagePreview {
  const { result, decision, runId, baseUrl } = params;
  const summary = result.executive_summary;
  const primaryMatch = result.matches[0];

  const currentEnvironment = primaryMatch?.solution_decision.retained_existing_platforms.length
    ? primaryMatch.solution_decision.retained_existing_platforms.join(", ")
    : "Not stated in transcript";

  const solutionMotion = primaryMatch?.recommended_solutions.length ? primaryMatch.recommended_solutions.join(", ") : "Not yet routed";

  const recommendedAction = decision.actions[0] ?? "Schedule technical discovery / architecture review.";
  const evidenceSnippets = (primaryMatch?.matched_text ?? []).slice(0, 2).map((snippet) => truncate(snippet, 160));

  const lines = [
    `**Technical action — ${summary.verdict}**`,
    "",
    `**Account:** ${summary.account ?? "Unknown"}`,
    `**Lifecycle:** ${decision.lifecycle_stage}`,
    `**Customer pain:** ${truncate(summary.business_problem, 220)}`,
    `**Current environment:** ${truncate(currentEnvironment, 160)}`,
    `**Solution motion:** ${truncate(solutionMotion, 160)}`,
    `**Recommended action:** ${truncate(recommendedAction, 160)}`,
    `**Evidence:** ${evidenceSnippets.map((snippet) => `"${snippet}"`).join(" / ") || "No verbatim snippet available."}`,
    "",
    `[Open full analysis](${analysisUrl(baseUrl, runId)})`,
    "",
    "You received this because the transcript produced a Technical / Specialist action for the Peachtree Select pilot."
  ];

  const markdown = truncate(lines.join("\n"), MAX_MESSAGE_CHARS);
  return {
    lane: "technical",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Technical action — ${summary.verdict} — ${summary.account ?? "Unknown account"}`,
    markdown,
    character_count: markdown.length
  };
}

export function buildMessagesForRouting(params: {
  result: SecureNetworkingTriageResult;
  routing: LaneRoutingDecision[];
  runId: string;
  baseUrl: string | null;
}): WebexMessagePreview[] {
  return params.routing.map((decision) =>
    decision.lane === "sales"
      ? buildSalesMessage({ result: params.result, decision, runId: params.runId, baseUrl: params.baseUrl })
      : buildTechnicalMessage({ result: params.result, decision, runId: params.runId, baseUrl: params.baseUrl })
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
  baseUrl: string | null;
}): EmailMessagePreview {
  const { result, decision, runId, baseUrl } = params;
  const summary = result.executive_summary;
  const link = analysisUrl(baseUrl, runId);

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
    { label: "Technical counterpart requirement", value: technicalCounterpartText(decision) },
    { label: "Full analysis", value: link }
  ];

  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `[${summary.verdict}] Sales action — ${summary.account ?? "Unknown account"} — ${summary.primary_opportunity ?? "Opportunity"}`,
    html: `<p>Peachtree Select pilot — Sales action.</p>${bulletsToHtml(bullets)}<p><a href="${link}">Open full analysis</a></p>`,
    text: `Peachtree Select pilot — Sales action.\n\n${bulletsToText(bullets)}`
  };
}

export function buildTechnicalEmail(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  baseUrl: string | null;
}): EmailMessagePreview {
  const { result, decision, runId, baseUrl } = params;
  const summary = result.executive_summary;
  const primaryMatch = result.matches[0];
  const link = analysisUrl(baseUrl, runId);

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
    { label: "Recommended action", value: decision.actions[0] ?? "Schedule technical discovery / architecture review." },
    { label: "Full analysis", value: link }
  ];

  return {
    lane: "technical",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `[${summary.verdict}] Technical action — ${summary.account ?? "Unknown account"} — ${summary.primary_opportunity ?? "Opportunity"}`,
    html: `<p>Peachtree Select pilot — Technical action.</p>${bulletsToHtml(bullets)}<p><a href="${link}">Open full analysis</a></p>`,
    text: `Peachtree Select pilot — Technical action.\n\n${bulletsToText(bullets)}`
  };
}

export function buildEmailsForRouting(params: {
  result: SecureNetworkingTriageResult;
  routing: LaneRoutingDecision[];
  runId: string;
  baseUrl: string | null;
}): EmailMessagePreview[] {
  return params.routing.map((decision) =>
    decision.lane === "sales"
      ? buildSalesEmail({ result: params.result, decision, runId: params.runId, baseUrl: params.baseUrl })
      : buildTechnicalEmail({ result: params.result, decision, runId: params.runId, baseUrl: params.baseUrl })
  );
}
