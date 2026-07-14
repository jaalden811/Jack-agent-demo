import type { SecureNetworkingTriageResult, StakeholderRecord } from "@/lib/signal-agent/types";

const DECISION_AUTHORITY_TYPES = new Set(["executive"]);
const TECHNICAL_OPERATOR_TYPES = new Set(["technical", "infrastructure", "application", "cloud_platform", "reliability", "security_architecture", "enterprise_architecture", "itsm"]);
const FINANCE_PROCUREMENT_TYPES = new Set(["finance_vendor_management"]);

function StakeholderRow({ stakeholder }: { stakeholder: StakeholderRecord }) {
  return (
    <div className="signal-row" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <strong>{stakeholder.name ?? stakeholder.function_or_role}</strong>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {stakeholder.ownership_type.replace(/_/g, " ")} · confidence {Math.round(stakeholder.confidence * 100)}%
        </span>
      </div>
      {stakeholder.name && <p className="muted" style={{ margin: "2px 0", fontSize: "0.85rem" }}>{stakeholder.function_or_role}</p>}
      <p style={{ margin: "4px 0", fontSize: "0.85rem" }}>&ldquo;{stakeholder.evidence}&rdquo;</p>
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        {stakeholder.location ? `Location: ${stakeholder.location} · ` : ""}Why it matters: {stakeholder.why_it_matters}
      </p>
    </div>
  );
}

export function StakeholdersTab({ result }: { result: SecureNetworkingTriageResult }) {
  const { stakeholder_analysis: analysis } = result;
  const allStakeholders = [...analysis.named_stakeholders, ...analysis.functional_owners];
  const decisionAuthority = allStakeholders.filter((s) => DECISION_AUTHORITY_TYPES.has(s.ownership_type));
  const technicalOperators = allStakeholders.filter((s) => TECHNICAL_OPERATOR_TYPES.has(s.ownership_type));
  const financeProcurement = allStakeholders.filter((s) => FINANCE_PROCUREMENT_TYPES.has(s.ownership_type));

  return (
    <div className="tab-content">
      <div className="detail-grid">
        <div>
          <span className="muted">Call participants</span>
          <p>
            <strong>{analysis.participants.length}</strong> total ({analysis.participants.filter((p) => p.classification === "customer").length} customer,{" "}
            {analysis.participants.filter((p) => p.classification === "vendor").length} vendor)
          </p>
        </div>
        <div>
          <span className="muted">Named stakeholders</span>
          <p>
            <strong>{analysis.named_stakeholders.length}</strong>
          </p>
        </div>
        <div>
          <span className="muted">Inferred functional owners</span>
          <p>
            <strong>{analysis.functional_owners.length}</strong>
          </p>
        </div>
      </div>

      <h3>Call participants</h3>
      <table className="evidence-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Organization</th>
            <th>Classification</th>
            <th>Turns</th>
          </tr>
        </thead>
        <tbody>
          {analysis.participants.map((participant) => (
            <tr key={participant.name}>
              <td>{participant.name}</td>
              <td>{participant.title ?? "—"}</td>
              <td>{participant.organization ?? "—"}</td>
              <td>{participant.classification}</td>
              <td>{participant.turnCount}</td>
            </tr>
          ))}
          {analysis.participants.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No structured participants detected in this transcript.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Named stakeholders</h3>
      {analysis.named_stakeholders.length === 0 ? (
        <p className="muted">No individually named, titled customer stakeholders were detected in this transcript.</p>
      ) : (
        analysis.named_stakeholders.map((stakeholder, index) => <StakeholderRow key={`named-${index}`} stakeholder={stakeholder} />)
      )}

      <h3>Inferred functional owners</h3>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        A function that appears responsible from the transcript&apos;s own language, without a definitively named individual — never a
        fabricated person.
      </p>
      {analysis.functional_owners.length === 0 ? (
        <p className="muted">No unattributed functional-owner language was detected.</p>
      ) : (
        analysis.functional_owners.map((owner, index) => <StakeholderRow key={`functional-${index}`} stakeholder={owner} />)
      )}

      <h3>Decision authority</h3>
      {decisionAuthority.length === 0 ? <p className="muted">No executive-level decision authority was explicitly identified.</p> : decisionAuthority.map((s, i) => <StakeholderRow key={`da-${i}`} stakeholder={s} />)}

      <h3>Technical operators</h3>
      {technicalOperators.length === 0 ? <p className="muted">No technical operators were identified.</p> : technicalOperators.map((s, i) => <StakeholderRow key={`tech-${i}`} stakeholder={s} />)}

      <h3>Finance / procurement involvement</h3>
      {financeProcurement.length === 0 ? (
        <p className="muted">No finance or vendor-management involvement was identified.</p>
      ) : (
        financeProcurement.map((s, i) => <StakeholderRow key={`fin-${i}`} stakeholder={s} />)
      )}
    </div>
  );
}
