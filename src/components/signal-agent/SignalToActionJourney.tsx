import type { WebexAutomationRunResult } from "@/lib/webex/types";

/**
 * The Signal-to-Action spine, rendered as a horizontal pipeline so the
 * app reads as one coherent operational flow rather than a set of
 * analysis tabs. Each stage's status/inputs/outputs are DERIVED from the
 * actual run result — provider status and delivery state are never
 * hard-coded (Section 3). Solid = executed this run; dashed = a
 * configured-but-not-connected future adapter.
 */

type StageStatus = "completed" | "review" | "failed" | "skipped" | "future";

type JourneyStage = {
  label: string;
  status: StageStatus;
  detail: string;
  future?: boolean;
};

function deriveStages(result: WebexAutomationRunResult): JourneyStage[] {
  const parser = result.transcript_diagnostics;
  // Two distinct, legitimate counts: `sentences_parsed` is every speaker's
  // sentence; `sentence_count` is the customer-attributed subset actually
  // analyzed for signals. Show both so the numbers reconcile instead of
  // appearing to contradict each other elsewhere in the UI.
  const totalSentences = parser?.sentences_parsed ?? 0;
  const analyzedSentences = result.transcript_meta?.sentence_count ?? totalSentences;
  const sentenceDetail =
    analyzedSentences < totalSentences
      ? `${analyzedSentences} of ${totalSentences} sentences analyzed`
      : `${totalSentences} sentences`;
  const verdict = result.executive_summary.verdict;
  const account = result.account_resolution;
  const scoring = result.opportunity_scoring;
  const peachtree = result.peachtree;
  const lanes = peachtree?.routing?.map((r) => r.lane) ?? [];
  const delivery = peachtree?.delivery ?? [];
  const anyDelivered = delivery.some((d) => d.delivered);
  const anyFailed = delivery.some((d) => d.attempted && !d.delivered);

  const accountResolved = account.status === "confirmed" || account.status === "probable";
  const serpRan = result.serpapi_signals.status === "completed" || result.serpapi_signals.status === "partial";

  return [
    { label: "Signal capture", status: "completed", detail: `${parser?.turns_parsed ?? 0} turns · ${sentenceDetail}` },
    {
      label: "Intent evaluation",
      status: verdict === "NOISE" ? "skipped" : "completed",
      detail: verdict === "NOISE" ? "NOISE — suppressed, logged" : `${verdict.replace(/_/g, " ")} · signal ${scoring.signal_strength.score}%`
    },
    {
      label: "Account + context",
      status: accountResolved ? "completed" : "review",
      detail: accountResolved ? `${account.name ?? "resolved"} · SerpAPI ${serpRan ? "ran" : "not run"}` : "Unresolved — confirmation action required"
    },
    { label: "Prioritization", status: "completed", detail: `${scoring.decision.replace(/_/g, " ")} · ${Math.round(scoring.final_pursuit_score)}/100` },
    {
      label: "Owner resolution",
      status: lanes.length > 0 ? "completed" : verdict === "NOISE" ? "skipped" : "review",
      detail: lanes.length > 0 ? lanes.map((l) => (l === "sales" ? "Bella (sales)" : "Jack (technical)")).join(" · ") : "No lane routed"
    },
    {
      label: "Action delivery",
      status: anyFailed ? "failed" : anyDelivered ? "completed" : verdict === "NOISE" ? "skipped" : "review",
      detail: delivery.length > 0 ? delivery.map((d) => `${d.lane}:${d.delivered ? "sent" : d.attempted ? "failed" : "preview"}`).join(" · ") : "Preview only"
    },
    { label: "Audit", status: "completed", detail: `Run ${result.run_id.slice(0, 8)} · evidence preserved` },
    { label: "CRM writeback", status: "future", detail: "Planned adapter", future: true }
  ];
}

const STATUS_SYMBOL: Record<StageStatus, string> = {
  completed: "●",
  review: "◐",
  failed: "✕",
  skipped: "○",
  future: "◌"
};

export function SignalToActionJourney({ result }: { result: WebexAutomationRunResult }) {
  const stages = deriveStages(result);
  return (
    <section className="panel signal-journey">
      <div className="signal-journey-header">
        <h3>Signal-to-Action journey</h3>
        <span className="muted small">Conversation → detect → filter → resolve account → context → prioritize → owner → deliver → audit</span>
      </div>
      <ol className="signal-journey-spine">
        {stages.map((stage, i) => (
          <li key={stage.label} className={`journey-stage journey-${stage.status}${stage.future ? " journey-dashed" : ""}`}>
            <span className="journey-symbol" aria-hidden>
              {STATUS_SYMBOL[stage.status]}
            </span>
            <span className="journey-label">{stage.label}</span>
            <span className="journey-detail muted small">{stage.detail}</span>
            {i < stages.length - 1 && <span className={`journey-connector${stages[i + 1].future ? " journey-connector-dashed" : ""}`} aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="muted small journey-legend">
        <span className="journey-symbol">●</span> executed this run · <span className="journey-symbol">◐</span> needs attention · <span className="journey-symbol">○</span> suppressed/skipped · <span className="journey-symbol">◌</span> planned adapter (dashed)
      </p>
    </section>
  );
}
