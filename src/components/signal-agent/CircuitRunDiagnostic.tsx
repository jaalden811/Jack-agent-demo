import type { SecureNetworkingTriageResult, CircuitStageDiagnostic } from "@/lib/signal-agent/types";

/**
 * Compact, additive run-level Circuit diagnostic — makes a silent
 * deterministic fallback impossible to miss. Renders ONLY safe metadata
 * from result.circuit_run (never a token, secret, key, or URL).
 */

function StatusPill({ label, tone, title }: { label: string; tone: "ok" | "warn" | "pending"; title?: string }) {
  return (
    <span className={`topbar-pill ${tone}`} title={title}>
      {label}
    </span>
  );
}

function stageTone(status: CircuitStageDiagnostic["status"]): "ok" | "warn" | "pending" {
  if (status === "ok") return "ok";
  if (status === "fail") return "warn";
  return "pending"; // fallback | skipped
}

const STAGE_LABELS: Array<{ key: "stage_a" | "stage_b" | "stage_c" | "stage_d"; label: string }> = [
  { key: "stage_a", label: "A · transcript/evidence" },
  { key: "stage_b", label: "B · public evidence" },
  { key: "stage_c", label: "C · qualification/action" },
  { key: "stage_d", label: "D · messages" }
];

export function CircuitRunDiagnostic({ result }: { result: SecureNetworkingTriageResult }) {
  const cr = result.circuit_run;
  const mode = result.analysis_mode;
  const modeTone = mode === "circuit" ? "ok" : mode === "circuit_partial" ? "pending" : "warn";
  const boolTone = (v: boolean | null): "ok" | "warn" | "pending" => (v === true ? "ok" : v === false ? "warn" : "pending");
  const boolLabel = (v: boolean | null): string => (v === true ? "yes" : v === false ? "no" : "n/a");

  return (
    <section className="panel" aria-label="Circuit run diagnostic">
      <div className="summary-headline" style={{ marginBottom: 8 }}>
        <strong style={{ marginRight: 8 }}>Circuit run</strong>
        <StatusPill label={`analysis: ${mode === "circuit" ? "circuit" : mode === "circuit_partial" ? "circuit (partial)" : "deterministic fallback"}`} tone={modeTone} title="Which interpretation layer produced the canonical fields" />
        <StatusPill label={`messages: ${result.message_source === "circuit_stage_d" ? "Stage D" : "deterministic"}`} tone={result.message_source === "circuit_stage_d" ? "ok" : "pending"} title="Origin of the final recipient messages" />
      </div>
      {result.message_source_reason ? (
        <p className="muted" style={{ margin: "2px 0 6px", fontSize: "0.8rem" }}>{result.message_source_reason}</p>
      ) : null}

      <div className="summary-headline" style={{ gap: 6, flexWrap: "wrap" }}>
        <StatusPill label={`configured: ${boolLabel(cr.configured)}`} tone={boolTone(cr.configured)} title="Token creds + inference endpoint + App Key present" />
        <StatusPill label={`contract: ${boolLabel(cr.contract_confirmed)}`} tone={boolTone(cr.contract_confirmed)} title="Wire contract confirmed (gates live calls)" />
        <StatusPill label={`auth: ${boolLabel(cr.authenticated)}`} tone={boolTone(cr.authenticated)} title="A Circuit access token was obtained this run" />
        <StatusPill label={`inference: ${boolLabel(cr.inference)}`} tone={boolTone(cr.inference)} title="At least one inference call succeeded this run" />
        {cr.required ? <StatusPill label="required" tone="pending" title="CIRCUIT_REQUIRED=true for this run" /> : null}
      </div>

      <ul className="compact-list" style={{ marginTop: 10 }}>
        {STAGE_LABELS.map(({ key, label }) => {
          const s = cr.stages[key];
          // Stage D's "canonical" status is whether its message is actually the
          // delivered one (the delivery quality gate) — not merely that Circuit
          // produced a draft — so provenance can't contradict message_source.
          const promotedText = key === "stage_d" ? (result.message_source === "circuit_stage_d" ? " · used as final message" : s.status === "ok" ? " · draft produced (not used — see message source)" : "") : s.promoted ? " · promoted to canonical" : "";
          return (
            <li key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusPill label={`Stage ${label}`} tone={stageTone(s.status)} />
              <span className="muted">
                {s.status}
                {promotedText}
                {s.safe_error_code ? ` · ${s.safe_error_code}` : ""}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="summary-headline" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {cr.repair_attempted ? <StatusPill label="repair attempted" tone="pending" /> : null}
        {cr.fallback_used ? <StatusPill label="fallback used" tone="warn" title="At least one stage fell back to deterministic output" /> : null}
        {cr.safe_error_code ? <StatusPill label={`error: ${cr.safe_error_code}`} tone="warn" /> : null}
      </div>

      {cr.required_failure ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Circuit was required but did not fully run: failed at <strong>{cr.required_failure.stage}</strong> ({cr.required_failure.code}). The result uses deterministic fallback for the affected stage — this is a real failure, not a silent fallback.
        </p>
      ) : null}

      {cr.missing_config.length > 0 ? (
        <p className="muted" style={{ marginTop: 6 }}>
          Set these environment variables in your local env file, then restart the dev server: <strong>{cr.missing_config.join(", ")}</strong>. Values are never shown here.
        </p>
      ) : null}
    </section>
  );
}
