import type { BuyingIntentEvidence, SecureNetworkingTriageResult, Stakeholder } from "@/lib/signal-agent/types";

function SignalCard({ title, quotes, emptyText }: { title: string; quotes: string[]; emptyText: string }) {
  return (
    <div className="signal-row">
      <strong>{title}</strong>
      {quotes.length > 0 ? (
        <ul className="evidence-list">
          {quotes.map((quote, index) => (
            <li key={index}>“{quote}”</li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {emptyText}
        </p>
      )}
    </div>
  );
}

function ownerQuotes(stakeholders: Stakeholder[], type: Stakeholder["ownership_type"]): string[] {
  return stakeholders.filter((s) => s.ownership_type === type).map((s) => `${s.name} — ${s.role}`);
}

function evidenceQuotes(evidence: BuyingIntentEvidence[], type: BuyingIntentEvidence["type"]): string[] {
  return Array.from(new Set(evidence.filter((item) => item.type === type).map((item) => item.text)));
}

export function OpportunitySignalsTab({ result }: { result: SecureNetworkingTriageResult }) {
  const allEvidence = result.matches.flatMap((match) => match.intent_evidence);
  const executiveOwners = ownerQuotes(result.stakeholders, "executive");
  const operationalOwners = ownerQuotes(result.stakeholders, "operational").concat(
    ownerQuotes(result.stakeholders, "technical"),
    ownerQuotes(result.stakeholders, "security"),
    ownerQuotes(result.stakeholders, "application")
  );

  return (
    <div className="tab-content evidence-grid">
      <SignalCard title="Budget" quotes={evidenceQuotes(allEvidence, "budget")} emptyText="No budget language detected." />
      <SignalCard title="Timing" quotes={evidenceQuotes(allEvidence, "timeline")} emptyText="No explicit timeline detected." />
      <SignalCard title="Executive owner" quotes={executiveOwners} emptyText="No executive-level owner named." />
      <SignalCard title="Operational / technical owner" quotes={operationalOwners} emptyText="No operational/technical owner named." />
      <SignalCard title="Quantified impact" quotes={evidenceQuotes(allEvidence, "impact")} emptyText="No quantified impact detected." />
      <SignalCard title="Renewal event" quotes={evidenceQuotes(allEvidence, "renewal")} emptyText="No renewal event detected." />
      <SignalCard title="Evaluation / pilot request" quotes={evidenceQuotes(allEvidence, "evaluation")} emptyText="No active evaluation language detected." />
      <SignalCard title="Next-step / success criteria" quotes={evidenceQuotes(allEvidence, "next_step")} emptyText="No concrete next step detected." />
    </div>
  );
}
