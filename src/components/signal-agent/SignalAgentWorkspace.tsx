"use client";

import { useEffect, useState } from "react";
import type { CatalogResponse, SignalAgentStatus } from "@/lib/signal-agent/types";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import { TopBar } from "@/components/signal-agent/TopBar";
import { IntegrationsPanel } from "@/components/signal-agent/IntegrationsPanel";
import { ReferencePackPanel } from "@/components/signal-agent/ReferencePackPanel";
import { WebexIntegrationPanel } from "@/components/signal-agent/webex/WebexIntegrationPanel";
import { UseCaseCard } from "@/components/signal-agent/UseCaseCard";
import { TranscriptCard, type TranscriptRunPayload } from "@/components/signal-agent/TranscriptCard";
import { ContextCard } from "@/components/signal-agent/ContextCard";
import { SummaryCard } from "@/components/signal-agent/SummaryCard";
import { ResultTabs } from "@/components/signal-agent/ResultTabs";
import { TranscriptViewModal } from "@/components/signal-agent/TranscriptViewModal";

export function SignalAgentWorkspace() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [status, setStatus] = useState<SignalAgentStatus | null>(null);
  const [testingIntegrations, setTestingIntegrations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [webexRefreshToken, setWebexRefreshToken] = useState(0);
  const [webexNotice, setWebexNotice] = useState<string | null>(null);

  const [result, setResult] = useState<WebexAutomationRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [useOpenAI, setUseOpenAI] = useState(true);
  const [enrichPublicSignals, setEnrichPublicSignals] = useState(false);
  const [accountOverrideText, setAccountOverrideText] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  function loadCatalog() {
    fetch("/api/signal-agent/catalog")
      .then((response) => response.json())
      .then((data: CatalogResponse) => setCatalog(data))
      .catch(() => setCatalogError("Could not load the taxonomy catalog."));
  }

  function fetchStatus(): Promise<void> {
    return fetch(`/api/signal-agent/status?useOpenAI=${useOpenAI}`)
      .then((response) => response.json())
      .then((data: SignalAgentStatus) => setStatus(data))
      .catch(() => undefined);
  }

  function testIntegrations() {
    setTestingIntegrations(true);
    fetchStatus().finally(() => setTestingIntegrations(false));
  }

  useEffect(() => {
    void loadCatalog();
    void fetchStatus();

    // Deferred to a microtask so these are not synchronous setState calls
    // within the effect body itself (avoids cascading-render warnings)
    // while still running once, right after mount.
    void Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      const webexParam = params.get("webex");
      if (webexParam === "connected") {
        setWebexNotice("Webex connected successfully.");
        setShowSettings(true);
        setWebexRefreshToken((token) => token + 1);
      } else if (webexParam === "error") {
        setWebexNotice("Could not connect Webex. Please try again.");
        setShowSettings(true);
      }
      if (webexParam) {
        params.delete("webex");
        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
        window.history.replaceState({}, "", newUrl);
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
      void fetchStatus();
      setWebexRefreshToken((token) => token + 1);
    }
  }

  return (
    <>
      <TopBar status={status} loading={loading} onToggleSettings={() => setShowSettings((value) => !value)} />

      {webexNotice && <div className="warning slim">{webexNotice}</div>}

      {showSettings && (
        <>
          <IntegrationsPanel status={status} lastRun={result} onTestIntegrations={testIntegrations} testing={testingIntegrations} />
          <WebexIntegrationPanel refreshToken={webexRefreshToken} />
          <ReferencePackPanel catalog={catalog} reportLoaded={status?.reference_report.loaded ?? false} onReload={loadCatalog} />
        </>
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
            onToggleEnrich={setEnrichPublicSignals}
            useOpenAI={useOpenAI}
            onToggleOpenAI={setUseOpenAI}
          />
        </div>

        <div className="workspace-column">
          {loading && (
            <section className="panel">
              <p className="muted">Running the signal-to-solution spine…</p>
            </section>
          )}
          {result && !loading ? (
            <>
              <SummaryCard result={result} />
              <ResultTabs result={result} status={status} onResultUpdate={setResult} />
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
