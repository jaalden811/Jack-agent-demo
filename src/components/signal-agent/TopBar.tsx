import type { WebexStatus } from "@/lib/webex/types";
import type { OutlookStatus } from "@/lib/outlook/types";
import type { SignalAgentStatus } from "@/lib/signal-agent/types";

function StatusPill({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const cls = ok === null ? "topbar-pill pending" : ok ? "topbar-pill ok" : "topbar-pill off";
  return (
    <span className={cls} title={detail}>
      {label}
    </span>
  );
}

/** AI is "Action required" only when a key is configured but at least
 * one capability (embeddings or synthesis) is broken — a genuine
 * problem to fix. An unconfigured key is not an error; the app
 * degrades gracefully to deterministic matching. */
function aiReady(agentStatus: SignalAgentStatus | null): boolean | null {
  if (!agentStatus) return null;
  if (!agentStatus.openai.configured) return true;
  return agentStatus.openai.embeddings.usable || agentStatus.openai.synthesis.usable;
}

export function TopBar({
  status,
  outlookStatus,
  agentStatus,
  loading,
  onToggleSettings
}: {
  status: WebexStatus | null;
  outlookStatus: OutlookStatus | null;
  agentStatus: SignalAgentStatus | null;
  loading: boolean;
  onToggleSettings: () => void;
}) {
  const aiOk = aiReady(agentStatus);
  return (
    <header className="topbar">
      <div>
        <h1>Turn every important customer conversation into coordinated action.</h1>
        <p className="muted">
          Detect meaningful buying signals, gather account context, identify the correct internal owner, recommend the next step, deliver the action, and preserve the evidence — the Signal-to-Action spine for the Peachtree Select pilot.
        </p>
      </div>
      <div className="topbar-status">
        <StatusPill label={loading ? "Running…" : "Idle"} ok={loading ? null : true} />
        <StatusPill
          label={`Webex: ${status?.connected ? "Connected" : "Action required"}`}
          ok={status ? status.connected : null}
          detail={status?.last_error_message ?? undefined}
        />
        <StatusPill
          label={`Outlook: ${outlookStatus?.connected ? "Connected" : "Action required"}`}
          ok={outlookStatus ? outlookStatus.connected : null}
          detail={outlookStatus?.last_error_message ?? undefined}
        />
        <StatusPill
          label={`AI: ${aiOk ? "Ready" : "Action required"}`}
          ok={aiOk}
          detail={agentStatus ? `Embeddings: ${agentStatus.openai.embeddings.message} · Synthesis: ${agentStatus.openai.synthesis.message}` : undefined}
        />
        <StatusPill label={`Auto-send: ${status?.auto_send_enabled ? "On" : "Off"}`} ok={status ? status.auto_send_enabled : null} />
        <StatusPill label={`Autopilot: ${status?.autopilot_enabled ? "On" : "Off"}`} ok={status ? status.autopilot_enabled : null} />
        <button type="button" className="button secondary" onClick={onToggleSettings}>
          Setup
        </button>
      </div>
    </header>
  );
}
