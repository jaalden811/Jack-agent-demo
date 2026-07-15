"use client";

import { useEffect, useState } from "react";
import type { CatalogResponse, SignalAgentStatus } from "@/lib/signal-agent/types";
import type { WebexAutomationRunResult, WebexStatus } from "@/lib/webex/types";
import type { OutlookStatus } from "@/lib/outlook/types";
import { TopBar } from "@/components/signal-agent/TopBar";
import { ReferencePackPanel } from "@/components/signal-agent/ReferencePackPanel";
import { SetupDrawer } from "@/components/signal-agent/SetupDrawer";
import { UseCaseCard } from "@/components/signal-agent/UseCaseCard";
import { TranscriptCard, type TranscriptRunPayload } from "@/components/signal-agent/TranscriptCard";
import { ContextCard } from "@/components/signal-agent/ContextCard";
import { SummaryCard } from "@/components/signal-agent/SummaryCard";
import { ActionCenter } from "@/components/signal-agent/ActionCenter";
import { DeliveryResultCard } from "@/components/signal-agent/DeliveryResultCard";
import { ResultTabs } from "@/components/signal-agent/ResultTabs";
import { SignalToActionJourney } from "@/components/signal-agent/SignalToActionJourney";
import { ScoreSemanticsSummary } from "@/components/signal-agent/ScoreSemanticsSummary";
import { TranscriptViewModal } from "@/components/signal-agent/TranscriptViewModal";

export function SignalAgentWorkspace() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<SignalAgentStatus | null>(null);
  const [webexStatus, setWebexStatus] = useState<WebexStatus | null>(null);
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  const [result, setResult] = useState<WebexAutomationRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [useOpenAI, setUseOpenAI] = useState(true);
  const [enrichPublicSignals, setEnrichPublicSignals] = useState(false);
  const [enrichPublicSignalsTouched, setEnrichPublicSignalsTouched] = useState(false);
  const [accountOverrideText, setAccountOverrideText] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  // "Enrich with public account and stakeholder signals" (Section 13):
  // default ON once SerpAPI is confirmed configured/usable, unless the
  // user has already made an explicit choice — never overrides a
  // manual toggle, and never turns itself on for a run the user
  // explicitly opted out of.
  useEffect(() => {
    if (!enrichPublicSignalsTouched && agentStatus?.search.usable) {
      // Deferred to a microtask (same pattern as the connection-notice
      // effect above) so this is never a synchronous setState call
      // within the effect body itself.
      void Promise.resolve().then(() => setEnrichPublicSignals(true));
    }
  }, [agentStatus?.search.usable, enrichPublicSignalsTouched]);

  function handleToggleEnrich(value: boolean) {
    setEnrichPublicSignalsTouched(true);
    setEnrichPublicSignals(value);
  }

  function loadCatalog() {
    fetch("/api/signal-agent/catalog")
      .then((response) => response.json())
      .then((data: CatalogResponse) => setCatalog(data))
      .catch(() => setCatalogError("Could not load the taxonomy catalog."));
  }

  function fetchAgentStatus(): Promise<void> {
    return fetch(`/api/signal-agent/status?useOpenAI=${useOpenAI}`)
      .then((response) => response.json())
      .then((data: SignalAgentStatus) => setAgentStatus(data))
      .catch(() => undefined);
  }

  function fetchWebexStatus(): Promise<void> {
    return fetch("/api/webex/status")
      .then((response) => response.json())
      .then((data: WebexStatus) => setWebexStatus(data))
      .catch(() => undefined);
  }

  function fetchOutlookStatus(): Promise<void> {
    return fetch("/api/outlook/status")
      .then((response) => response.json())
      .then((data: OutlookStatus) => setOutlookStatus(data))
      .catch(() => undefined);
  }

  function refreshConnections() {
    void fetchWebexStatus();
    void fetchOutlookStatus();
  }

  useEffect(() => {
    void loadCatalog();
    void fetchAgentStatus();
    void fetchWebexStatus();
    void fetchOutlookStatus();

    // Deferred to a microtask so these are not synchronous setState calls
    // within the effect body itself (avoids cascading-render warnings)
    // while still running once, right after mount.
    void Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      const webexParam = params.get("webex");
      const outlookParam = params.get("outlook");

      if (webexParam === "connected") {
        setConnectionNotice("Webex connected successfully.");
        setShowSettings(true);
      } else if (webexParam === "error") {
        setConnectionNotice("Could not connect Webex — see Setup → Webex for the specific reason.");
        setShowSettings(true);
      }
      if (outlookParam === "connected") {
        setConnectionNotice("Outlook connected successfully.");
        setShowSettings(true);
      } else if (outlookParam === "error") {
        setConnectionNotice("Could not connect Outlook — see Setup → Outlook for the specific reason.");
        setShowSettings(true);
      }

      if (webexParam || outlookParam) {
        params.delete("webex");
        params.delete("outlook");
        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
        window.history.replaceState({}, "", newUrl);
        refreshConnections();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parseAccountOverride(): Record<string, string | number | boolean> | undefined {
    if (!accountOverrideText.trim()) return undefined;
    try {
      const parsed = JSON.parse(accountOverrideText);
      return typeof parsed === "object" && parsed !== null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function runAgent(payload: TranscriptRunPayload) {
    setLoading(true);
    setRunError(null);
    try {
      const response = await fetch("/api/signal-agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          accountOverride: parseAccountOverride(),
          options: {
            useOpenAIEmbeddings: useOpenAI,
            useOpenAISynthesis: useOpenAI,
            useQualification: useOpenAI,
            enrichPublicSignals
          }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setRunError(data?.detail ?? data?.error ?? "The run failed.");
        setResult(null);
      } else {
        setResult(data as WebexAutomationRunResult);
      }
    } catch {
      setRunError("Could not reach the signal agent API.");
    } finally {
      setLoading(false);
      void fetchAgentStatus();
      refreshConnections();
    }
  }

  return (
    <>
      <TopBar
        status={webexStatus}
        outlookStatus={outlookStatus}
        agentStatus={agentStatus}
        loading={loading}
        onToggleSettings={() => setShowSettings((value) => !value)}
      />

      {connectionNotice && <div className="warning slim">{connectionNotice}</div>}

      {showSettings && (
        <SetupDrawer
          onClose={() => setShowSettings(false)}
          status={webexStatus}
          agentStatus={agentStatus}
          onRefresh={() => {
            refreshConnections();
            void fetchAgentStatus();
          }}
        />
      )}

      {catalogError && <div className="warning">{catalogError}</div>}
      {runError && <div className="warning">{runError}</div>}

      <div className="workspace-columns">
        <div className="workspace-column">
          <UseCaseCard catalog={catalog} />
          <TranscriptCard
            onRun={runAgent}
            loading={loading}
            lastTranscriptMeta={result?.transcript_meta ?? null}
            onViewTranscript={() => setShowTranscript(true)}
          />
          <ContextCard
            accountOverrideText={accountOverrideText}
            onAccountOverrideTextChange={setAccountOverrideText}
            enrichPublicSignals={enrichPublicSignals}
            onToggleEnrich={handleToggleEnrich}
            useOpenAI={useOpenAI}
            onToggleOpenAI={setUseOpenAI}
          />
          <ReferencePackPanel catalog={catalog} reportLoaded={agentStatus?.reference_report.loaded ?? false} onReload={loadCatalog} />
        </div>

        <div className="workspace-column">
          {loading && (
            <section className="panel">
              <p className="muted">Running the signal-to-solution spine…</p>
            </section>
          )}
          {result && !loading ? (
            <>
              <SignalToActionJourney result={result} />
              <ActionCenter result={result} />
              <ScoreSemanticsSummary result={result} />
              <SummaryCard result={result} />
              <DeliveryResultCard result={result} onResultUpdate={setResult} />
              <ResultTabs result={result} status={agentStatus} onResultUpdate={setResult} />
            </>
          ) : (
            !loading && (
              <section className="panel">
                <p className="muted">Run a transcript on the left to see results here.</p>
              </section>
            )
          )}
        </div>
      </div>

      {showTranscript && result?.transcript_meta && (
        <TranscriptViewModal meta={result.transcript_meta} onClose={() => setShowTranscript(false)} />
      )}
    </>
  );
}
