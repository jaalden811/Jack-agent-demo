"use client";

import { useState } from "react";
import type { SecureNetworkingTriageResult, SignalAgentStatus } from "@/lib/signal-agent/types";
import { ExecutiveSummaryTab } from "@/components/signal-agent/tabs/ExecutiveSummaryTab";
import { OpportunitySignalsTab } from "@/components/signal-agent/tabs/OpportunitySignalsTab";
import { SolutionArchitectureTab } from "@/components/signal-agent/tabs/SolutionArchitectureTab";
import { ScoreEvidenceTab } from "@/components/signal-agent/tabs/ScoreEvidenceTab";
import { InternalBriefTab } from "@/components/signal-agent/tabs/InternalBriefTab";
import { AuditTab } from "@/components/signal-agent/tabs/AuditTab";

const TABS = [
  { id: "executive", label: "Executive summary" },
  { id: "signals", label: "Opportunity signals" },
  { id: "architecture", label: "Solution architecture" },
  { id: "score", label: "Score & evidence" },
  { id: "brief", label: "Internal brief" },
  { id: "audit", label: "Audit" }
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ResultTabs({ result, status }: { result: SecureNetworkingTriageResult; status: SignalAgentStatus | null }) {
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
        {activeTab === "signals" && <OpportunitySignalsTab result={result} />}
        {activeTab === "architecture" && <SolutionArchitectureTab result={result} />}
        {activeTab === "score" && <ScoreEvidenceTab result={result} />}
        {activeTab === "brief" && <InternalBriefTab result={result} />}
        {activeTab === "audit" && <AuditTab result={result} status={status} />}
      </div>
    </section>
  );
}
