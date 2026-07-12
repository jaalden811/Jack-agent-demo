import type { SecureNetworkingTriageResult, SignalAgentStatus } from "@/lib/signal-agent/types";
import { RawJsonPanel } from "@/components/signal-agent/RawJsonPanel";

export function AuditTab({ result, status }: { result: SecureNetworkingTriageResult; status: SignalAgentStatus | null }) {
  return (
    <div className="tab-content">
      <div className="detail-grid">
        <div>
          <span className="muted">Reference file version</span>
          <p>
            {result.reference_pack.taxonomy_version} (as of {result.reference_pack.taxonomy_as_of ?? "unknown"})
          </p>
        </div>
        <div>
          <span className="muted">Semantic mode</span>
          <p>{result.providers.semantic_mode === "openai_embeddings" ? "OpenAI embeddings" : "Deterministic fallback"}</p>
        </div>
        <div>
          <span className="muted">Provider status</span>
          <p>
            OpenAI: {status?.openai.configured ? "configured" : "not configured"} · Search: {status?.search.configured ? "configured" : "not configured"}
          </p>
        </div>
        <div>
          <span className="muted">Timestamp</span>
          <p>{result.timestamp}</p>
        </div>
        <div>
          <span className="muted">Taxonomy entries evaluated</span>
          <p>{result.reference_pack.category_count} categories scored; top {result.matches.length} returned as matches.</p>
        </div>
        <div>
          <span className="muted">Selected labels</span>
          <p>{result.matches.map((match) => `${match.pain_category} (${match.relationship})`).join("; ")}</p>
        </div>
        <div>
          <span className="muted">Log status</span>
          <p>
            {result.audit.logged ? "Logged" : "Not logged"} to <code>{result.audit.path}</code>
            {result.audit.warning ? ` — ${result.audit.warning}` : ""}
          </p>
        </div>
      </div>

      <RawJsonPanel title="Score trace (full result JSON)" data={result} />
    </div>
  );
}
