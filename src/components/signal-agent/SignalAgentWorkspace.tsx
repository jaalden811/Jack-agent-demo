"use client";

import { useEffect, useState } from "react";
import type { CatalogResponse, SecureNetworkingTriageResult, SignalAgentStatus } from "@/lib/signal-agent/types";
import { TopBar } from "@/components/signal-agent/TopBar";
import { IntegrationsPanel } from "@/components/signal-agent/IntegrationsPanel";
import { ReferencePackPanel } from "@/components/signal-agent/ReferencePackPanel";
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

  const [result, setResult] = useState<SecureNetworkingTriageResult | null>(null);
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
        setResult(data as SecureNetworkingTriageResult);
      }
    } catch {
      setRunError("Could not reach the signal agent API.");
    } finally {
      setLoading(false);
      void fetchStatus();
    }
  }

  return (
    <>
      <TopBar status={status} loading={loading} onToggleSettings={() => setShowSettings((value) => !value)} />

      {showSettings && (
        <>
          <IntegrationsPanel status={status} lastRun={result} onTestIntegrations={testIntegrations} testing={testingIntegrations} />
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
              <ResultTabs result={result} status={status} />
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
