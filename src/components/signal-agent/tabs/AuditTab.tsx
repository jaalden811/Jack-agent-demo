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
          <p>Deterministic engine</p>
        </div>
        <div>
          <span className="muted">Provider status</span>
          <p>
            Circuit: {status?.ai_provider.configured ? (status?.ai_provider.operational ? "operational" : "configured") : "not configured"} · Search: {status?.search.configured ? "configured" : "not configured"}
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

      <h3>Transcript parser diagnostics</h3>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        A parser regression can silently drop most of a transcript before it ever reaches scoring — these counts make that visible immediately instead of producing a confident wrong result.
      </p>
      <div className="detail-grid">
        <div>
          <span className="muted">Raw characters / lines</span>
          <p>
            {result.transcript_diagnostics.raw_characters.toLocaleString()} chars / {result.transcript_diagnostics.raw_lines.toLocaleString()} lines
          </p>
        </div>
        <div>
          <span className="muted">Speaker headers detected</span>
          <p>{result.transcript_diagnostics.speaker_headers_detected}</p>
        </div>
        <div>
          <span className="muted">Turns parsed</span>
          <p>{result.transcript_diagnostics.turns_parsed}</p>
        </div>
        <div>
          <span className="muted">Sentences parsed</span>
          <p>{result.transcript_diagnostics.sentences_parsed}</p>
        </div>
        <div>
          <span className="muted">Participants</span>
          <p>{result.transcript_diagnostics.participants.join(", ") || "None detected"}</p>
        </div>
        <div>
          <span className="muted">Rejected header candidates</span>
          <p>{result.transcript_diagnostics.rejected_header_candidates.join(", ") || "None"}</p>
        </div>
      </div>
      {result.transcript_diagnostics.raw_characters > 5000 && result.transcript_diagnostics.sentences_parsed < 20 && (
        <div className="warning slim">
          parser_warning: a transcript this long should have parsed far more than {result.transcript_diagnostics.sentences_parsed} sentence(s) — this looks like a parser
          regression, not a short transcript.
        </div>
      )}

      <RawJsonPanel title="Score trace (full result JSON)" data={result} />
    </div>
  );
}
