import { createHash } from "node:crypto";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { buildAnalysisLink } from "@/lib/signal-agent/analysisLink";
import { persistRunResult } from "@/lib/signal-agent/resultStore";
import { loadRoutingConfig, classifyLifecycle, buildLaneRouting } from "@/lib/webex/peachtreeRouting";
import { buildMessagesForRouting, buildEmailsForRouting } from "@/lib/webex/messageBuilder";
import { deliverMessages } from "@/lib/webex/delivery";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { sendOutlookEmail } from "@/lib/outlook/send";
import { getProcessedTranscript, markTranscriptProcessed, addLanesSent, appendWebexAudit } from "@/lib/webex/store";
import { synthesizeQualifiedMessages } from "@/lib/qualification/openaiMessageSynthesis";
import { validateMessageQuality } from "@/lib/webex/messageQuality";
import type { AnalysisLink, SynthesizedMessages } from "@/lib/qualification/types";
import type { ChannelDeliveryResult, EmailMessagePreview, PeachtreePilotResult, WebexLane, WebexMessagePreview, WebexTranscriptSource } from "@/lib/webex/types";

/**
 * Shared pipeline that turns a completed Signal-to-Solution result into
 * the Peachtree pilot's lifecycle classification, two-lane routing
 * decisions, tailored Webex + email message previews, and (optionally)
 * real delivery on both channels — reused identically by "auto-send
 * after analysis", the "Retry failed delivery" action, and the
 * autonomous Webex webhook handler.
 *
 * Deduplication key: `<id>:lane:channel` (e.g. `run_123:sales:webex`),
 * where `<id>` is the analysis run ID for a fresh single analysis, and
 * the stable Webex-transcript-derived ID for autonomous/repeated runs
 * over the exact same transcript content — so re-running the same
 * transcript never re-delivers to a lane/channel that already
 * succeeded. One lane or channel failing never blocks any other
 * lane/channel; each is attempted and recorded independently.
 */

export function computeTranscriptId(transcriptText: string, webexSource: WebexTranscriptSource | null): string {
  if (webexSource?.transcriptId) return webexSource.transcriptId;
  return `local-${createHash("sha256").update(transcriptText).digest("hex").slice(0, 16)}`;
}

/** Builds (and persists) the "Open full analysis" link for this result,
 * before any message is constructed — see @/lib/signal-agent/analysisLink
 * for the full validation checklist. Never derives the link from a
 * request Host header or localhost; only from the configured
 * APP_PUBLIC_BASE_URL. */
async function resolveAnalysisLink(result: SecureNetworkingTriageResult): Promise<AnalysisLink> {
  return buildAnalysisLink({
    run_id: result.run_id,
    created_at: result.timestamp,
    account: result.executive_summary.account,
    verdict: result.executive_summary.verdict,
    confidence: result.executive_summary.confidence,
    qualification_json: result as unknown as Record<string, unknown>,
    sales_message: null,
    technical_message: null,
    source_summary: (result.public_enrichment?.accepted_evidence ?? [])
      .filter((item) => item.url)
      .map((item) => ({ title: item.title ?? item.url ?? "Source", url: item.url as string, domain: item.url ? new URL(item.url).hostname : "" })),
    delivery_summary: {}
  });
}

/** Re-persists the run record with the final built messages/emails and
 * delivery summary once they exist, so the shared results page reflects
 * exactly what was sent — without changing the already-issued link
 * (same run_id, same token). */
async function finalizeRunPersistence(params: {
  result: SecureNetworkingTriageResult;
  analysisLink: AnalysisLink;
  messages: Array<{ lane: string; markdown: string }>;
  delivery: ChannelDeliveryResult[];
}): Promise<void> {
  if (!params.analysisLink.included) return;
  const sales = params.messages.find((m) => m.lane === "sales")?.markdown ?? null;
  const technical = params.messages.find((m) => m.lane === "technical")?.markdown ?? null;
  await persistRunResult({
    run_id: params.result.run_id,
    created_at: params.result.timestamp,
    expires_at: params.analysisLink.expires_at ?? new Date().toISOString(),
    account: params.result.executive_summary.account,
    verdict: params.result.executive_summary.verdict,
    confidence: params.result.executive_summary.confidence,
    qualification_json: params.result as unknown as Record<string, unknown>,
    sales_message: sales,
    technical_message: technical,
    source_summary: (params.result.public_enrichment?.accepted_evidence ?? [])
      .filter((item) => item.url)
      .map((item) => ({ title: item.title ?? item.url ?? "Source", url: item.url as string, domain: item.url ? new URL(item.url).hostname : "" })),
    delivery_summary: { channels: params.delivery }
  });
}

function channelKey(lane: WebexLane, channel: "webex" | "email"): string {
  return `${lane}:${channel}`;
}

// The rich deterministic brief targets ~2300 chars; the ceiling gives
// AI synthesis a little headroom above that while staying well within
// Webex's markdown limit.
const WEBEX_HARD_CHAR_CEILING = 2600;
const SYNTHESIS_CHAR_LIMIT = 2300;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stage D: replaces the deterministic Webex/email content with
 * OpenAI-synthesized, evidence-backed content when qualification/
 * message synthesis is enabled, configured, and validates — otherwise
 * the already-built deterministic messages/emails are returned
 * unchanged. Never blocks delivery on a synthesis failure. */
async function applyAiMessageSynthesis(params: {
  result: SecureNetworkingTriageResult;
  routing: ReturnType<typeof buildLaneRouting>;
  runId: string;
  analysisLink: AnalysisLink;
  messages: WebexMessagePreview[];
  emails: EmailMessagePreview[];
}): Promise<{ messages: WebexMessagePreview[]; emails: EmailMessagePreview[]; used: boolean; fallback_reason: string | null }> {
  const salesDecision = params.routing.find((d) => d.lane === "sales");
  const technicalDecision = params.routing.find((d) => d.lane === "technical");
  if (!salesDecision || !technicalDecision) {
    return { messages: params.messages, emails: params.emails, used: false, fallback_reason: "no sales/technical lane routed for this transcript" };
  }

  const publicEvidenceSummaries = (params.result.public_enrichment?.accepted_evidence ?? [])
    .filter((item) => item.url)
    .slice(0, 3)
    .map((item) => ({ title: item.title ?? "Source", url: item.url as string, summary: item.quote_or_snippet }));

  // Allowed URLs: the validated public analysis link plus any real
  // SerpAPI source URLs; anything else in an AI message is treated as
  // invented and rejected.
  const allowedUrls = [
    ...(params.analysisLink.included && params.analysisLink.url ? [params.analysisLink.url] : []),
    ...params.result.serpapi_signals.signals.map((s) => s.source_url),
    ...(params.result.public_enrichment?.accepted_evidence ?? []).map((e) => e.url).filter((u): u is string => Boolean(u))
  ];
  const qualityContext = {
    verdict: params.result.executive_summary.verdict,
    allowedUrls,
    charCeiling: WEBEX_HARD_CHAR_CEILING,
    requireRichBrief: params.result.executive_summary.verdict !== "NOISE"
  };

  const synthesisArgs = {
    result: params.result,
    meddpicc: params.result.meddpicc,
    accountResolution: params.result.account_resolution,
    namedStakeholders: params.result.stakeholder_analysis.named_stakeholders,
    salesRecipientName: salesDecision.recipient_name,
    technicalRecipientName: technicalDecision.recipient_name,
    analysisLink: params.analysisLink,
    runId: params.runId,
    webexCharLimit: SYNTHESIS_CHAR_LIMIT,
    publicEvidenceSummaries,
    enabled: true
  };

  // Section 15: try synthesis, validate; on validation failure retry ONCE
  // with the failures fed back; if still invalid, fall through to the
  // rich deterministic messages (recording the reason).
  let lastFailureReason: string | null = null;
  let synthesized: SynthesizedMessages | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await synthesizeQualifiedMessages({ ...synthesisArgs, validationFeedback: attempt === 0 ? undefined : lastFailureReason ? lastFailureReason.split("; ") : undefined });
    if (!outcome.used || !outcome.messages) {
      lastFailureReason = outcome.fallback_reason;
      break; // a provider/parse failure will not be fixed by a retry with feedback
    }
    const validation = validateMessageQuality({
      salesMarkdown: outcome.messages.sales_webex_markdown,
      technicalMarkdown: outcome.messages.technical_webex_markdown,
      context: qualityContext
    });
    if (validation.valid) {
      synthesized = outcome.messages;
      break;
    }
    lastFailureReason = `message quality validation failed: ${validation.failures.join("; ")}`;
  }

  if (!synthesized) {
    return { messages: params.messages, emails: params.emails, used: false, fallback_reason: lastFailureReason };
  }
  const messages = params.messages.map((message) =>
    message.lane === "sales"
      ? { ...message, markdown: synthesized.sales_webex_markdown, character_count: synthesized.sales_webex_markdown.length, synthesized_by_ai: true }
      : { ...message, markdown: synthesized.technical_webex_markdown, character_count: synthesized.technical_webex_markdown.length, synthesized_by_ai: true }
  );
  const emails = params.emails.map((email) =>
    email.lane === "sales"
      ? { ...email, subject: synthesized.sales_email_subject, html: synthesized.sales_email_html, text: stripHtml(synthesized.sales_email_html), synthesized_by_ai: true }
      : { ...email, subject: synthesized.technical_email_subject, html: synthesized.technical_email_html, text: stripHtml(synthesized.technical_email_html), synthesized_by_ai: true }
  );

  return { messages, emails, used: true, fallback_reason: null };
}

function previewOnlyDelivery(
  laneRouting: ReturnType<typeof buildLaneRouting>,
  runId: string,
  note: string
): ChannelDeliveryResult[] {
  return laneRouting.flatMap((decision) =>
    (["webex", "email"] as const).map((channel) => ({
      lane: decision.lane,
      channel,
      recipient_name: decision.recipient_name,
      recipient_email: decision.recipient_email,
      applicable: true,
      attempted: false,
      delivered: false,
      message_id: null,
      status_code: null,
      error: note,
      error_code: null,
      sent_at: null,
      delivery_key: `${runId}:${decision.lane}:${channel}`
    }))
  );
}

/** Preview-only: computes lifecycle + routing + message/email drafts
 * without sending anything or touching the idempotency guard. Still
 * builds/persists the real analysis link so the preview shown in the UI
 * matches exactly what would be sent. */
export async function computePeachtreePreview(result: SecureNetworkingTriageResult): Promise<PeachtreePilotResult> {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  const runId = result.timestamp;
  const analysisLink = await resolveAnalysisLink(result);
  result.analysis_link = analysisLink;
  const deterministicMessages = buildMessagesForRouting({ result, routing, runId, analysisLink });
  const deterministicEmails = buildEmailsForRouting({ result, routing, runId, analysisLink });
  const synthesis = await applyAiMessageSynthesis({ result, routing, runId, analysisLink, messages: deterministicMessages, emails: deterministicEmails });
  result.ai_processing.message_synthesis_used = synthesis.used;
  if (!synthesis.used && synthesis.fallback_reason) result.ai_processing.fallback_reason = result.ai_processing.fallback_reason ?? synthesis.fallback_reason;
  const previewDelivery = previewOnlyDelivery(routing, runId, "Preview only. Enable auto-send, or use Analyze & Route, to deliver this.");
  // Re-persist with the now-final analysis_link/messages so the shared
  // results page matches this preview exactly (same runId/token issued
  // above, just richer content).
  await finalizeRunPersistence({ result, analysisLink, messages: synthesis.messages, delivery: previewDelivery });

  return {
    lifecycle,
    routing,
    messages: synthesis.messages,
    emails: synthesis.emails,
    delivery: previewDelivery,
    routing_config_version: config.metadata.version,
    auto_send_enabled: false
  };
}

/** Delivers (or retries) any (lane, channel) pairs not already
 * successfully sent for this transcript, enforcing the idempotency
 * guard, and persists the audit trail + processed-transcript record.
 * Already-succeeded (lane, channel) pairs are always skipped, so
 * calling this again (the "Retry failed delivery" action) only ever
 * re-attempts pairs that previously failed or were never attempted. */
export async function deliverPeachtreePipeline(
  result: SecureNetworkingTriageResult,
  transcriptText: string,
  webexSource: WebexTranscriptSource | null
): Promise<PeachtreePilotResult> {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  const transcriptId = computeTranscriptId(transcriptText, webexSource);
  const runId = result.timestamp;
  const analysisLink = await resolveAnalysisLink(result);
  result.analysis_link = analysisLink;
  const deterministicMessages = buildMessagesForRouting({ result, routing, runId, analysisLink });
  const deterministicEmails = buildEmailsForRouting({ result, routing, runId, analysisLink });
  const synthesis = await applyAiMessageSynthesis({ result, routing, runId, analysisLink, messages: deterministicMessages, emails: deterministicEmails });
  result.ai_processing.message_synthesis_used = synthesis.used;
  if (!synthesis.used && synthesis.fallback_reason) result.ai_processing.fallback_reason = result.ai_processing.fallback_reason ?? synthesis.fallback_reason;
  const messages = synthesis.messages;
  const emails = synthesis.emails;

  const alreadyProcessed = await getProcessedTranscript(transcriptId);
  const alreadySentKeys = new Set<string>(alreadyProcessed?.lanesSent ?? []);

  const skipped: ChannelDeliveryResult[] = [];
  const messagesToSend = messages.filter((message) => {
    if (!alreadySentKeys.has(channelKey(message.lane, "webex"))) return true;
    skipped.push({
      lane: message.lane,
      channel: "webex",
      recipient_name: message.recipient_name,
      recipient_email: message.recipient_email,
      applicable: true,
      attempted: false,
      delivered: true,
      message_id: null,
      status_code: null,
      error: "Already delivered for this transcript — skipped to avoid a duplicate message.",
      error_code: null,
      sent_at: alreadyProcessed?.processedAt ?? null,
      delivery_key: `${runId}:${message.lane}:webex`
    });
    return false;
  });
  const emailsToSend = emails.filter((email) => {
    if (!alreadySentKeys.has(channelKey(email.lane, "email"))) return true;
    skipped.push({
      lane: email.lane,
      channel: "email",
      recipient_name: email.recipient_name,
      recipient_email: email.recipient_email,
      applicable: true,
      attempted: false,
      delivered: true,
      message_id: null,
      status_code: null,
      error: "Already delivered for this transcript — skipped to avoid a duplicate email.",
      error_code: null,
      sent_at: alreadyProcessed?.processedAt ?? null,
      delivery_key: `${runId}:${email.lane}:email`
    });
    return false;
  });

  const sender = await resolveWebexSender();
  const webexResults = await deliverMessages(messagesToSend, { accessToken: sender.accessToken, mode: sender.mode, senderEmail: sender.senderEmail }, runId);

  const emailResults: ChannelDeliveryResult[] = [];
  for (const email of emailsToSend) {
    const base = {
      lane: email.lane,
      channel: "email" as const,
      recipient_name: email.recipient_name,
      recipient_email: email.recipient_email,
      applicable: true,
      delivery_key: `${runId}:${email.lane}:email`
    };
    if (!email.recipient_email) {
      emailResults.push({ ...base, attempted: false, delivered: false, message_id: null, status_code: null, error: `No recipient email configured for the ${email.lane} lane.`, error_code: "mail_send_missing", sent_at: null });
      continue;
    }
    const sent = await sendOutlookEmail({ toEmail: email.recipient_email, subject: email.subject, html: email.html, text: email.text });
    emailResults.push({
      ...base,
      attempted: true,
      delivered: sent.accepted,
      message_id: null,
      status_code: sent.status_code,
      error: sent.error,
      error_code: sent.error_code,
      sent_at: sent.sent_at
    });
  }

  const delivery = [...skipped, ...webexResults, ...emailResults];
  const newlySucceededKeys = [...webexResults, ...emailResults].filter((item) => item.delivered).map((item) => channelKey(item.lane, item.channel));

  await markTranscriptProcessed({
    transcriptId,
    processedAt: new Date().toISOString(),
    lanesSent: Array.from(new Set([...alreadySentKeys, ...newlySucceededKeys])),
    verdict: result.executive_summary.verdict,
    runId
  });
  if (newlySucceededKeys.length > 0) {
    await addLanesSent(transcriptId, newlySucceededKeys);
  }

  await appendWebexAudit({
    event: "transcript_processed",
    timestamp: new Date().toISOString(),
    transcriptId,
    meetingId: webexSource?.meetingId ?? null,
    meetingTitle: webexSource?.meetingTitle ?? null,
    transcriptSource: webexSource?.source ?? "manual",
    runId,
    lifecycleStage: lifecycle.lifecycle_stage,
    verdict: result.executive_summary.verdict,
    routing,
    recipientEmails: routing.map((item) => item.recipient_email),
    processedStatus: "processed"
  });

  for (const item of [...webexResults, ...emailResults]) {
    await appendWebexAudit({
      event: "message_sent",
      timestamp: item.sent_at ?? new Date().toISOString(),
      transcriptId,
      lane: item.lane,
      channel: item.channel,
      recipient_email: item.recipient_email,
      message_id: item.message_id,
      delivered: item.delivered,
      error: item.error
    });
  }

  await finalizeRunPersistence({ result, analysisLink, messages, delivery });

  return { lifecycle, routing, messages, emails, delivery, routing_config_version: config.metadata.version, auto_send_enabled: true };
}
