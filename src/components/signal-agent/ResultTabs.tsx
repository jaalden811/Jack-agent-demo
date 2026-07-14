"use client";

import { useState } from "react";
import type { SignalAgentStatus } from "@/lib/signal-agent/types";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import { ExecutiveSummaryTab } from "@/components/signal-agent/tabs/ExecutiveSummaryTab";
import { OpportunitySignalsTab } from "@/components/signal-agent/tabs/OpportunitySignalsTab";
import { StakeholdersTab } from "@/components/signal-agent/tabs/StakeholdersTab";
import { SolutionArchitectureTab } from "@/components/signal-agent/tabs/SolutionArchitectureTab";
import { ScoreEvidenceTab } from "@/components/signal-agent/tabs/ScoreEvidenceTab";
import { RoutingPreviewTab } from "@/components/signal-agent/tabs/RoutingPreviewTab";
import { InternalBriefTab } from "@/components/signal-agent/tabs/InternalBriefTab";
import { AuditTab } from "@/components/signal-agent/tabs/AuditTab";
import { SourcesEnrichmentTab } from "@/components/signal-agent/tabs/SourcesEnrichmentTab";
import { SerpApiSignalsTab } from "@/components/signal-agent/tabs/SerpApiSignalsTab";

const TABS = [
  { id: "executive", label: "Executive summary" },
  { id: "stakeholders", label: "Stakeholders" },
  { id: "signals", label: "Opportunity signals" },
  { id: "architecture", label: "Solution architecture" },
  { id: "score", label: "Score & evidence" },
  { id: "sources", label: "Sources & enrichment" },
  { id: "serpapi", label: "SerpAPI signals" },
  { id: "routing", label: "Routing preview" },
  { id: "brief", label: "Internal brief" },
  { id: "audit", label: "Audit" }
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ResultTabs({
  result,
  status,
  onResultUpdate
}: {
  result: WebexAutomationRunResult;
  status: SignalAgentStatus | null;
  onResultUpdate: (result: WebexAutomationRunResult) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("executive");

  return (
    <section className="panel">
      <div className="tab-bar" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-panel">
        {activeTab === "executive" && <ExecutiveSummaryTab result={result} />}
        {activeTab === "stakeholders" && <StakeholdersTab result={result} />}
        {activeTab === "signals" && <OpportunitySignalsTab result={result} />}
        {activeTab === "architecture" && <SolutionArchitectureTab result={result} />}
        {activeTab === "score" && <ScoreEvidenceTab result={result} />}
        {activeTab === "sources" && <SourcesEnrichmentTab result={result} />}
        {activeTab === "serpapi" && <SerpApiSignalsTab result={result} onResultUpdate={onResultUpdate} />}
        {activeTab === "routing" && <RoutingPreviewTab result={result} onResultUpdate={onResultUpdate} />}
        {activeTab === "brief" && <InternalBriefTab result={result} />}
        {activeTab === "audit" && <AuditTab result={result} status={status} />}
      </div>
    </section>
  );
}
