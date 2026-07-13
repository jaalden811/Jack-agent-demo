import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";

/**
 * Builds the concise, tailored Webex direct-message markdown for each
 * lane, per the exact templates in the pilot spec. Never pastes the full
 * transcript; kept under ~1,200 characters.
 */

const MAX_MESSAGE_CHARS = 1200;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function analysisUrl(baseUrl: string | null, runId: string): string {
  const base = baseUrl?.replace(/\/$/, "") ?? "";
  return `${base}/signal-agent?run=${encodeURIComponent(runId)}`;
}

export function buildSalesMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  baseUrl: string | null;
}): WebexMessagePreview {
  const { result, decision, runId, baseUrl } = params;
  const summary = result.executive_summary;

  const buyingSignals = [
    result.commercial_signals.budget ? "budget" : null,
    result.commercial_signals.timeline ? "timeline" : null,
    decision.signal_types.includes("competitor_displacement") ? "competitor" : null,
    result.commercial_signals.renewal_events.length > 0 ? "renewal" : null,
    decision.signal_types.includes("expansion") ? "expansion" : null
  ]
    .filter(Boolean)
    .join(", ") || "none explicitly stated";

  const whyNow = truncate(summary.business_impact || summary.business_problem || "No explicit commercial evidence quoted.", 260);
  const technicalCounterpartNeeded =
    decision.signal_types.some((signal) => ["network_refresh", "splunk_opportunity", "security_initiative", "ai_initiative", "software_buying"].includes(signal)) ? "yes" : "no";

  const lines = [
    `**Sales signal — ${summary.verdict}**`,
    "",
    `**Account:** ${summary.account ?? "Unknown"}`,
    `**Assigned role:** ${decision.assigned_role}`,
    `**Lifecycle:** ${decision.lifecycle_stage}`,
    `**Opportunity motion:** ${summary.primary_opportunity ?? "Not identified"}`,
    `**Why now:** ${whyNow}`,
    `**Buying signals:** ${buyingSignals}`,
    `**Recommended commercial action:** ${decision.actions[0] ?? "Review the full analysis"}`,
    `**Technical counterpart needed:** ${technicalCounterpartNeeded}`,
    "",
    `[Open full analysis](${analysisUrl(baseUrl, runId)})`,
    "",
    "You are receiving this because the transcript produced a sales action for the Peachtree Select pilot."
  ];

  const markdown = truncate(lines.join("\n"), MAX_MESSAGE_CHARS);
  return {
    lane: "sales",
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `Sales signal — ${summary.verdict} — ${summary.account ?? "Unknown account"}`,
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

  const solutionMotion = primaryMatch?.recommended_solutions.length
    ? primaryMatch.recommended_solutions.join(", ")
    : "Not yet routed";

  const nextStepEvidence = primaryMatch?.intent_evidence.find((item) => item.type === "next_step");
  const technicalNextStep = nextStepEvidence?.text ?? "Schedule technical discovery / architecture review.";

  const evidenceSnippets = (primaryMatch?.matched_text ?? []).slice(0, 2).map((snippet) => truncate(snippet, 160));

  const lines = [
    `**Technical action — ${summary.verdict}**`,
    "",
    `**Account:** ${summary.account ?? "Unknown"}`,
    `**Assigned role:** ${decision.assigned_role}`,
    `**Lifecycle:** ${decision.lifecycle_stage}`,
    `**Customer pain:** ${truncate(summary.business_problem, 220)}`,
    `**Current environment:** ${truncate(currentEnvironment, 160)}`,
    `**Recommended solution motion:** ${truncate(solutionMotion, 160)}`,
    `**Technical next step:** ${truncate(technicalNextStep, 200)}`,
    `**Evidence:** ${evidenceSnippets.map((snippet) => `"${snippet}"`).join(" / ") || "No verbatim snippet available."}`,
    "",
    `[Open full analysis](${analysisUrl(baseUrl, runId)})`,
    "",
    "You are receiving this because the transcript produced a technical action for the Peachtree Select pilot."
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
