import type { SignalAgentStatus } from "@/lib/signal-agent/types";

function StatusPill({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const cls = ok === null ? "topbar-pill pending" : ok ? "topbar-pill ok" : "topbar-pill off";
  return (
    <span className={cls} title={detail}>
      {label}
    </span>
  );
}

export function TopBar({
  status,
  loading,
  onToggleSettings
}: {
  status: SignalAgentStatus | null;
  loading: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>Signal-to-Solution Triage</h1>
        <p className="muted">Secure Networking opportunity detection using transcript evidence, Cisco portfolio taxonomy, and configured AI services.</p>
      </div>
      <div className="topbar-status">
        <StatusPill label={loading ? "Running…" : "Idle"} ok={loading ? null : true} />
        <StatusPill
          label={status ? `OpenAI: ${status.openai.configured ? "configured" : "not configured"}` : "OpenAI: checking…"}
          ok={status ? status.openai.configured : null}
          detail={status?.openai.message}
        />
        <StatusPill
          label={status ? `Search: ${status.search.configured ? "configured" : "not configured"}` : "Search: checking…"}
          ok={status ? status.search.configured : null}
          detail={status?.search.message}
        />
        <StatusPill
          label={status ? `Taxonomy v${status.taxonomy.version}` : "Taxonomy: checking…"}
          ok={status ? status.taxonomy.loaded : null}
        />
        <button type="button" className="button secondary" onClick={onToggleSettings}>
          Settings
        </button>
      </div>
    </header>
  );
}
