import type { CatalogResponse } from "@/lib/signal-agent/types";

export function UseCaseCard({ catalog }: { catalog: CatalogResponse | null }) {
  return (
    <section className="panel">
      <h2>Use case</h2>
      <p className="use-case-title">Secure Networking Deal Signal Triage</p>
      <p className="muted">
        Ingests a customer meeting transcript, identifies network/security/observability pain, maps it to the Cisco/Splunk portfolio,
        evaluates buying intent, recommends the right specialist team, and produces an evidence-backed internal next action.
      </p>
      <div className="reference-file-row">
        <span className="muted">Active reference files:</span>
        <code>{catalog?.source_path ?? "signal-agent-poc/config/cisco_painpoint_solution_map.json"}</code>
        <code>signal-agent-poc/docs/cisco_portfolio_painpoint_mapping_report.md</code>
      </div>
    </section>
  );
}
