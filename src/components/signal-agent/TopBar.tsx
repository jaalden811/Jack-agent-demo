import type { WebexStatus } from "@/lib/webex/types";
import type { OutlookStatus } from "@/lib/outlook/types";

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
  outlookStatus,
  loading,
  onToggleSettings
}: {
  status: WebexStatus | null;
  outlookStatus: OutlookStatus | null;
  loading: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>Signal-to-Solution Triage</h1>
        <p className="muted">Secure Networking opportunity detection with automatic Webex + Outlook routing for the Peachtree Select pilot.</p>
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
        <StatusPill label={`Auto-send: ${status?.auto_send_enabled ? "On" : "Off"}`} ok={status ? status.auto_send_enabled : null} />
        <StatusPill label={`Autopilot: ${status?.autopilot_enabled ? "On" : "Off"}`} ok={status ? status.autopilot_enabled : null} />
        <button type="button" className="button secondary" onClick={onToggleSettings}>
          Setup
        </button>
      </div>
    </header>
  );
}
