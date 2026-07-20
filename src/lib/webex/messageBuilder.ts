import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { AnalysisLink } from "@/lib/qualification/types";
import type { EmailMessagePreview, LaneRoutingDecision, WebexMessagePreview } from "@/lib/webex/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildIntelligencePacket } from "@/lib/intelligence/intelligencePacket";
import { generateRoleMessage, renderWebexMessage } from "@/lib/intelligence/roleMessage";

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

// ─── Webex direct messages (rendered from the canonical RoleMessage) ─────────

/** Renders a lane's delivered Webex message from the ONE canonical RoleMessage
 * (generated from the IntelligencePacket) — no independent transcript
 * interpretation. Every lane/channel flows through here. The byte-budget footer
 * (analysis link) is the only channel-specific wrapper. */
function renderLaneWebexMessage(
  result: SecureNetworkingTriageResult,
  decision: LaneRoutingDecision,
  lane: "sales" | "technical",
  runId: string,
  analysisLink: AnalysisLink
): WebexMessagePreview {
  const account = getCanonicalAccount(result);
  const rm = generateRoleMessage(buildIntelligencePacket(result), lane);
  const body = renderWebexMessage(rm);
  const markdown = composeToByteBudget(
    [{ text: body }, { text: "" }, { text: analysisLinkMarkdown(analysisLink, runId) }],
    MAX_MESSAGE_BYTES
  );
  const laneWord = lane === "sales" ? "Sales" : "Technical";
  return {
    lane,
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: rm.kind === "no_action" ? `${laneWord} — ${account.label} — no action` : `${laneWord} action — ${account.label}`,
    markdown,
    character_count: markdown.length,
    synthesized_by_ai: rm.source === "circuit"
  };
}

export function buildSalesMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview {
  return renderLaneWebexMessage(params.result, params.decision, "sales", params.runId, params.analysisLink);
}

export function buildTechnicalMessage(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): WebexMessagePreview {
  return renderLaneWebexMessage(params.result, params.decision, "technical", params.runId, params.analysisLink);
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

/** The email bullet set derived from the ONE canonical RoleMessage — the email
 * channel renders the same content decision as Webex, never a re-interpretation. */
function roleMessageEmailBullets(rm: ReturnType<typeof generateRoleMessage>): Array<{ label: string; value: string }> {
  if (rm.kind === "no_action") {
    return [
      { label: "Account", value: rm.account },
      { label: "Assessment", value: rm.why_this_matters },
      { label: "Recommended action", value: rm.action },
      ...(rm.watch_out ? [{ label: "Customer boundary", value: rm.watch_out.replace(/^Customer boundary:\s*/, "") }] : [])
    ];
  }
  const ia = rm.internal_action;
  const coordinationBullets = (ia?.coordinate_with ?? []).map((p) => ({
    label: `Loop in ${p.name ?? p.role}`,
    value: `${p.why}${p.prepare.length > 0 ? ` Prepare: ${p.prepare.join("; ")}.` : ""}`
  }));
  const customerStep = ia ? ia.customer_engagement.next_step : rm.action;
  const championBullet =
    rm.lane === "sales" && ia?.customer_engagement.champion
      ? [{ label: "Customer champion", value: `${ia.customer_engagement.champion.name ?? ia.customer_engagement.champion.role}, who ${ia.customer_engagement.champion.why}` }]
      : [];
  return [
    { label: "Account", value: rm.account },
    { label: "Why this matters", value: rm.why_this_matters },
    { label: "Why now", value: rm.why_now },
    ...(ia ? [{ label: "Your move (internal)", value: ia.your_move }] : []),
    ...coordinationBullets,
    { label: "Customer next step", value: customerStep },
    ...championBullet,
    { label: "Expected outcome", value: rm.expected_outcome },
    ...(rm.goal_impact ? [{ label: "Goal impact", value: rm.goal_impact }] : []),
    ...(rm.goal_alignment ? [{ label: "Goal fit", value: rm.goal_alignment }] : []),
    ...(rm.environment ? [{ label: "Environment", value: rm.environment }] : []),
    ...(rm.watch_out ? [{ label: "Watch-out", value: rm.watch_out }] : [])
  ];
}

function renderLaneEmail(
  result: SecureNetworkingTriageResult,
  decision: LaneRoutingDecision,
  lane: "sales" | "technical",
  runId: string,
  analysisLink: AnalysisLink
): EmailMessagePreview {
  const account = getCanonicalAccount(result);
  const rm = generateRoleMessage(buildIntelligencePacket(result), lane);
  const bullets = roleMessageEmailBullets(rm);
  const laneWord = lane === "sales" ? "Sales" : "Technical";
  const heading = rm.kind === "no_action" ? `${laneWord} — no action` : `${laneWord} action`;
  const verdict = result.executive_summary.verdict;
  return {
    lane,
    recipient_name: decision.recipient_name,
    recipient_email: decision.recipient_email,
    subject: `[${verdict}] ${heading} — ${account.label}`,
    html: `<p>Peachtree Select pilot — ${heading}.</p>${bulletsToHtml(bullets)}${analysisLinkHtml(analysisLink, runId)}`,
    text: `Peachtree Select pilot — ${heading}.\n\n${bulletsToText(bullets)}\n\n${analysisLink.included && analysisLink.url ? `Full analysis: ${analysisLink.url}` : `Analysis reference: Run ${runId}`}`,
    synthesized_by_ai: rm.source === "circuit"
  };
}

export function buildSalesEmail(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): EmailMessagePreview {
  return renderLaneEmail(params.result, params.decision, "sales", params.runId, params.analysisLink);
}

export function buildTechnicalEmail(params: {
  result: SecureNetworkingTriageResult;
  decision: LaneRoutingDecision;
  runId: string;
  analysisLink: AnalysisLink;
}): EmailMessagePreview {
  return renderLaneEmail(params.result, params.decision, "technical", params.runId, params.analysisLink);
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
