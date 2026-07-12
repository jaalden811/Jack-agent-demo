"use client";

import { useEffect, useState } from "react";
import type { CatalogResponse, SignalAgentRunResult } from "@/lib/signal-agent/types";
import { ArchitectureFlow } from "@/components/signal-agent/ArchitectureFlow";
import { InputPanel } from "@/components/signal-agent/InputPanel";
import { ResultDashboard } from "@/components/signal-agent/ResultDashboard";
import { EvidenceCards } from "@/components/signal-agent/EvidenceCards";
import { NotificationCard } from "@/components/signal-agent/NotificationCard";
import { TaxonomyBrowser } from "@/components/signal-agent/TaxonomyBrowser";
import { AuditCard } from "@/components/signal-agent/AuditCard";
import { RawJsonPanel } from "@/components/signal-agent/RawJsonPanel";

export function SignalAgentWorkspace() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [result, setResult] = useState<SignalAgentRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [useOpenAI, setUseOpenAI] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    fetch("/api/signal-agent/catalog")
      .then((response) => response.json())
      .then((data: CatalogResponse) => setCatalog(data))
      .catch(() => setCatalogError("Could not load the taxonomy catalog."));
  }, []);

  async function runAgent(body: Record<string, unknown>) {
    setLoading(true);
    setRunError(null);
    try {
      const response = await fetch("/api/signal-agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, options: { useOpenAIEmbeddings: useOpenAI } })
      });
      const data = await response.json();
      if (!response.ok) {
        setRunError(data?.detail ?? data?.error ?? "The run failed.");
        setResult(null);
      } else {
        setResult(data as SignalAgentRunResult);
        setRefreshToken((token) => token + 1);
      }
    } catch {
      setRunError("Could not reach the signal agent API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero signal-agent-hero">
        <div className="section-heading">
          <div>
            <h1>Signal-to-Solution Agent</h1>
            <p>Detect customer pain, validate with account context, map to Cisco solution families, and route internally.</p>
          </div>
          <span className="safety-badge">No customer contacted</span>
        </div>
        <ArchitectureFlow />
      </section>

      <InputPanel
        onRunDemo={(transcriptId) => runAgent({ transcriptId })}
        onRunCustom={(text) => runAgent({ customTranscript: text })}
        useOpenAI={useOpenAI}
        onToggleOpenAI={setUseOpenAI}
        loading={loading}
      />

      {catalogError && <div className="warning">{catalogError}</div>}
      {runError && <div className="warning">{runError}</div>}
      {loading && (
        <div className="panel">
          <p className="muted">Running the signal-to-solution spine…</p>
        </div>
      )}

      {result && !loading && (
        <>
          <ResultDashboard result={result} />
          <EvidenceCards result={result} />
          <NotificationCard result={result} />
          <RawJsonPanel title="Raw run result JSON" data={result} />
        </>
      )}

      <AuditCard latestAudit={result?.audit ?? null} refreshToken={refreshToken} />

      <TaxonomyBrowser catalog={catalog} />
    </>
  );
}
