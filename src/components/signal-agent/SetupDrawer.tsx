"use client";

import { useEffect, useState } from "react";
import type { SignalAgentStatus } from "@/lib/signal-agent/types";
import type { WebexDiagnostics, WebexScopeTestResult, WebexStatus } from "@/lib/webex/types";
import type { OutlookStatus } from "@/lib/outlook/types";
import { Modal } from "@/components/signal-agent/Modal";
import { SellerProfileWizard } from "@/components/signal-agent/SellerProfileWizard";
import { AnalyticsView } from "@/components/signal-agent/AnalyticsView";
import { WebexSpacePicker } from "@/components/signal-agent/WebexSpacePicker";

type RoutingConfigResponse = {
  path: string;
  config: {
    metadata: { team: string; version: string; purpose: string };
    recipients: {
      sales: { name: string; email: string; assignment_label: string };
      technical: { name: string; email: string; assignment_label: string };
    };
  };
};

type WebhookStatus = {
  registered: boolean;
  webhookId: string | null;
  targetUrl: string | null;
  lastEventAt: string | null;
  lastEventTranscriptId: string | null;
};

type SetupStep = "webex" | "outlook" | "routing" | "automation" | "providers" | "profile" | "analytics";

const STEP_LABELS: Record<SetupStep, string> = {
  webex: "1. Webex",
  outlook: "2. Outlook",
  routing: "3. Routing",
  automation: "4. Automation",
  providers: "AI providers",
  profile: "Seller profile",
  analytics: "Analytics"
};

function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard
    .writeText(value)
    .then(() => true)
    .catch(() => false);
}

function ScopeTestRow({
  test,
  onRun,
  busyId
}: {
  test: WebexScopeTestResult;
  onRun: (testId: string) => void;
  busyId: string | null;
}) {
  const statusLabel = test.status === "success" ? "Succeeded" : test.status === "failed" ? "Failed" : "Not run yet";
  const statusClass = test.status === "success" ? "provider-yes" : test.status === "failed" ? "provider-no" : "muted";
  return (
    <div className="scope-test-row">
      <div>
        <strong>{test.label}</strong>
        <div className="muted" style={{ fontSize: "0.78rem" }}>
          {test.scopes.join(" ")}
        </div>
      </div>
      <div className="scope-test-status">
        <span className={statusClass}>{statusLabel}</span>
        {test.status === "failed" && test.error_code && (
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {test.error_code}: {test.error_message}
          </span>
        )}
      </div>
      <button type="button" className="button secondary" onClick={() => onRun(test.test_id)} disabled={busyId === test.test_id}>
        {busyId === test.test_id ? "Opening…" : `Test ${test.test_id}`}
      </button>
    </div>
  );
}

export function SetupDrawer({
  onClose,
  status,
  agentStatus,
  onRefresh,
  initialStep = "webex"
}: {
  onClose: () => void;
  status: WebexStatus | null;
  agentStatus: SignalAgentStatus | null;
  onRefresh: () => void;
  initialStep?: SetupStep;
}) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [diagnostics, setDiagnostics] = useState<WebexDiagnostics | null>(null);
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfigResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function loadAll() {
    fetch("/api/webex/diagnostics")
      .then((r) => r.json())
      .then(setDiagnostics)
      .catch(() => undefined);
    fetch("/api/outlook/status")
      .then((r) => r.json())
      .then(setOutlookStatus)
      .catch(() => undefined);
    fetch("/api/webex/webhooks/status")
      .then((r) => r.json())
      .then(setWebhookStatus)
      .catch(() => undefined);
    fetch("/api/webex/routing-config")
      .then((r) => r.json())
      .then(setRoutingConfig)
      .catch(() => undefined);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } finally {
      setBusy(null);
      loadAll();
      onRefresh();
    }
  }

  async function disconnectWebex() {
    await fetch("/api/webex/oauth/disconnect", { method: "POST" });
    setMessage("Webex disconnected.");
  }

  async function resetWebexOAuthState() {
    await fetch("/api/webex/oauth/reset", { method: "POST" });
    setMessage("Cleared the pending Webex OAuth state and last error. Try Connect again.");
  }

  async function sendTestMessage(lane: "sales" | "technical") {
    const response = await fetch("/api/webex/test-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane })
    });
    const data = await response.json();
    setMessage(data.delivered ? `Webex test message sent to ${data.recipient_email} (sender: ${data.sender_mode}).` : `Could not send test message: ${data.error}`);
  }

  async function testBasicConnection() {
    setBusy("minimal-scope");
    setMessage(null);
    try {
      const response = await fetch("/api/webex/diagnostics/minimal-scope", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not start the basic connection test.");
        return;
      }
      window.location.href = data.authorize_url;
    } finally {
      setBusy(null);
    }
  }

  async function runScopeTest(testId: string) {
    setBusy(testId);
    setMessage(null);
    try {
      const response = await fetch("/api/webex/diagnostics/scope-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testId })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not start the scope test.");
        return;
      }
      window.location.href = data.authorize_url;
    } finally {
      setBusy(null);
    }
  }

  async function disconnectOutlook() {
    await fetch("/api/outlook/oauth/disconnect", { method: "POST" });
    setMessage("Outlook disconnected.");
  }

  async function sendTestEmail(lane: "sales" | "technical") {
    const response = await fetch("/api/outlook/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane })
    });
    const data = await response.json();
    setMessage(data.accepted ? `Test email accepted for ${data.recipient_email}.` : `Could not send test email: ${data.error ?? "Unknown error"}`);
  }

  async function reloadRoutingConfig() {
    const response = await fetch("/api/webex/routing-config", { method: "POST" });
    const data = await response.json();
    setMessage(data.reloaded ? `Routing config reloaded (v${data.config.metadata.version}).` : `Could not reload: ${data.error}`);
  }

  async function registerWebhook() {
    const response = await fetch("/api/webex/webhooks/register", { method: "POST" });
    const data = await response.json();
    setMessage(data.registered ? `Webhook registered (${data.alreadyRegistered ? "already existed" : "new"}).` : `Could not register webhook: ${data.error}`);
  }

  async function unregisterWebhook() {
    await fetch("/api/webex/webhooks/register", { method: "DELETE" });
    setMessage("Webhook removed.");
  }

  async function setAutopilot(enabled: boolean) {
    const response = await fetch("/api/webex/autopilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    setMessage(response.ok ? `Autopilot ${enabled ? "enabled" : "disabled"}.` : `Could not update autopilot: ${data.error}`);
  }

  async function setAutoSend(enabled: boolean) {
    const response = await fetch("/api/webex/auto-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    setMessage(response.ok ? `Auto-send after analysis ${enabled ? "enabled" : "disabled"}.` : `Could not update auto-send: ${data.error}`);
  }

  async function testCircuit() {
    setBusy("test-circuit");
    try {
      const auth = await fetch("/api/circuit/test-auth", { method: "POST" }).then((r) => r.json()).catch(() => null);
      const inference = await fetch("/api/circuit/test-inference", { method: "POST" }).then((r) => r.json()).catch(() => null);
      onRefresh();
      const parts: string[] = [];
      if (auth) parts.push(`authentication ${auth.ok ? "ok" : auth.error_code ?? "failed"}`);
      if (inference) parts.push(`inference ${inference.ok ? "ok" : inference.error_code ?? "failed"}`);
      setMessage(parts.length > 0 ? `Circuit tested — ${parts.join(", ")}.` : "Circuit re-tested — see the result below.");
    } catch {
      setMessage("Circuit test could not run.");
    } finally {
      setBusy(null);
    }
  }

  function testSearch() {
    setBusy("test-search");
    onRefresh();
    setMessage("Search re-tested — see the result below.");
    setBusy(null);
  }

  const configChecklist = [
    { key: "WEBEX_CLIENT_ID", configured: diagnostics?.client_id_configured ?? false },
    { key: "WEBEX_CLIENT_SECRET", configured: diagnostics?.client_secret_configured ?? false },
    { key: "WEBEX_REDIRECT_URI", configured: Boolean(diagnostics?.redirect_uri) },
    { key: "WEBEX_SCOPES", configured: Boolean(diagnostics && diagnostics.requested_scopes.length > 0) }
  ];

  return (
    <Modal title="Setup" onClose={onClose}>
      <div className="setup-tabs">
        {(Object.keys(STEP_LABELS) as SetupStep[]).map((key) => (
          <button key={key} type="button" className={`button secondary setup-tab ${step === key ? "active" : ""}`} onClick={() => setStep(key)}>
            {STEP_LABELS[key]}
          </button>
        ))}
      </div>

      {message && <div className="warning slim">{message}</div>}

      {step === "webex" && (
        <div className="setup-step">
          <div className="summary-grid">
            <div>
              <span className="muted">Status</span>
              <strong className={status?.connected ? "provider-yes" : "provider-no"}>{status?.connected ? "Connected" : "Not connected"}</strong>
            </div>
            <div>
              <span className="muted">Connected identity</span>
              <strong>{status?.connected_user.name ?? status?.connected_user.email ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Redirect URI</span>
              <strong style={{ wordBreak: "break-all" }}>{diagnostics?.redirect_uri ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Granted scopes</span>
              <strong>{diagnostics?.granted_scopes.length ? diagnostics.granted_scopes.join(", ") : "—"}</strong>
            </div>
            <div>
              <span className="muted">Delivery sender mode</span>
              <strong>{status?.webex_delivery.sender_mode ?? "—"}</strong>
            </div>
          </div>

          {diagnostics?.last_error_code && (
            <div className="warning slim">
              <strong>{diagnostics.last_error_code}:</strong> {diagnostics.last_error_message}
              {diagnostics.last_error_code === "invalid_scope" && (
                <p style={{ margin: "6px 0 0" }}>
                  Webex rejected the requested scope set. Use the diagnostic scope tests below to identify the first failing scope.
                  {diagnostics.last_failed_scope_set.length > 0 && (
                    <>
                      {" "}
                      Scope set attempted: <code>{diagnostics.last_failed_scope_set.join(" ")}</code>
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          {!diagnostics?.configured && <div className="warning slim">WEBEX_CLIENT_ID / WEBEX_CLIENT_SECRET are not configured on the server.</div>}

          <h3>Capabilities</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Core OAuth (identity, outbound messaging, meeting schedules) and transcript access are separate, independently-granted
            capabilities — a rejected transcript scope never blocks the rest of the connection.
          </p>
          <ul className="compact-list capability-list">
            <li>
              Core OAuth: <span className={status?.capabilities.core_oauth ? "provider-yes" : "provider-no"}>{status?.capabilities.core_oauth ? "Connected" : "Not connected"}</span>
            </li>
            <li>
              Identity (spark:people_read): <span className={status?.capabilities.identity ? "provider-yes" : "provider-no"}>{status?.capabilities.identity ? "Granted" : "Not granted"}</span>
            </li>
            <li>
              Messaging (spark:messages_write): <span className={status?.capabilities.messaging ? "provider-yes" : "provider-no"}>{status?.capabilities.messaging ? "Granted" : "Not granted"}</span>
            </li>
            <li>
              Meeting schedules (meeting:schedules_read): <span className={status?.capabilities.meeting_schedules ? "provider-yes" : "provider-no"}>{status?.capabilities.meeting_schedules ? "Granted" : "Not granted"}</span>
            </li>
            <li>
              Meeting transcripts (meeting:transcripts_read, optional):{" "}
              <span className={status?.capabilities.meeting_transcripts ? "provider-yes" : "provider-no"}>{status?.capabilities.meeting_transcripts ? "Granted" : "Not granted"}</span>
            </li>
            <li>
              Public webhook URL: <span className={status?.webhook_target ? "provider-yes" : "provider-no"}>{status?.webhook_target ?? "Not set"}</span>
            </li>
            <li>
              Webhook registration: <span className={status?.webhook_registered ? "provider-yes" : "provider-no"}>{status?.webhook_registered ? "Registered" : "Not registered"}</span>
            </li>
            <li>
              Manual transcript import:{" "}
              <span className={status?.capabilities.manual_transcript_import_available ? "provider-yes" : "provider-no"}>
                {status?.capabilities.manual_transcript_import_available ? "Available" : "Not available"}
              </span>
            </li>
            <li>
              Transcript autopilot: <span className={status?.autopilot_enabled ? "provider-yes" : "provider-no"}>{status?.autopilot_enabled ? "Enabled" : "Disabled"}</span>
            </li>
            <li>
              Outbound delivery: <span className={status?.capabilities.outbound_delivery_available ? "provider-yes" : "provider-no"}>{status?.capabilities.outbound_delivery_available ? "Available" : "Not available"}</span>
            </li>
          </ul>

          <div className="actions">
            <a className="button secondary" href="/api/webex/oauth/start">
              {status?.connected ? "Reconnect" : "Connect Webex"}
            </a>
            <a className="button secondary" href="/api/webex/oauth/enable-transcripts">
              {status?.capabilities.meeting_transcripts ? "Re-authorize transcript access" : "Enable transcript access"}
            </a>
            <button type="button" className="button secondary" onClick={() => (window.location.href = "/api/webex/oauth/start")}>
              Retry connection
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => copyToClipboard((diagnostics?.requested_scopes ?? []).join(" ")).then((ok) => setMessage(ok ? "Copied requested scopes." : "Could not copy to clipboard."))}
            >
              Copy requested scopes
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => copyToClipboard(diagnostics?.redirect_uri ?? "").then((ok) => setMessage(ok ? "Copied redirect URI." : "Could not copy to clipboard."))}
            >
              Copy redirect URI
            </button>
            <button type="button" className="button secondary" onClick={() => runAction("reset-oauth", resetWebexOAuthState)} disabled={busy === "reset-oauth"}>
              Reset Webex OAuth state
            </button>
            {status?.connected && (
              <button type="button" className="button secondary" onClick={() => runAction("disconnect-webex", disconnectWebex)} disabled={busy === "disconnect-webex"}>
                Disconnect
              </button>
            )}
          </div>

          <h3>Requested scopes</h3>
          <ul className="compact-list">
            {(diagnostics?.requested_scopes ?? []).map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
            {diagnostics && diagnostics.requested_scopes.length === 0 && <li className="muted">No scopes configured.</li>}
          </ul>

          <h3>Diagnose: basic connection</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Proves Client ID, redirect URI, state handling, and the OAuth callback work — independent of any meeting/message scope. This is a
            diagnostic-only round trip; it never replaces your configured production scope set.
          </p>
          <div className="actions">
            <button type="button" onClick={testBasicConnection} disabled={busy === "minimal-scope"}>
              {busy === "minimal-scope" ? "Opening…" : "Test basic Webex connection"}
            </button>
          </div>
          {diagnostics?.scope_tests.find((t) => t.test_id === "identity" && t.status === "success") && (
            <div className="warning slim" style={{ background: "var(--ok-bg, #e8f7ee)" }}>
              Core OAuth works. If the full connection still fails with invalid_scope, the failure is caused by one of the additional requested
              scopes below.
            </div>
          )}

          <h3>Diagnose: which scope is failing</h3>
          <div className="scope-test-list">
            {(diagnostics?.scope_tests ?? []).map((test) => (
              <ScopeTestRow key={test.test_id} test={test} onRun={runScopeTest} busyId={busy} />
            ))}
          </div>

          <h3>Server configuration</h3>
          <ul className="compact-list">
            {configChecklist.map((item) => (
              <li key={item.key}>
                <code>{item.key}</code>: <span className={item.configured ? "provider-yes" : "provider-no"}>{item.configured ? "configured" : "missing"}</span>
              </li>
            ))}
          </ul>

          <h3>Webex portal checklist</h3>
          <ul className="compact-list">
            <li>Redirect URI must exactly match {diagnostics?.redirect_uri ?? "the value above"} on the Webex Integration.</li>
            <li>Every requested scope above must be individually selected/enabled on the Webex Integration.</li>
            <li>Save/update the Webex Integration after changing scopes — Webex does not apply changes until saved.</li>
          </ul>

          <h3>Webex agent delivery</h3>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => runAction("test-sales", () => sendTestMessage("sales"))}
              disabled={busy === "test-sales" || status?.webex_delivery.sender_mode === "unavailable"}
            >
              Test Webex DM (Sales)
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => runAction("test-technical", () => sendTestMessage("technical"))}
              disabled={busy === "test-technical" || status?.webex_delivery.sender_mode === "unavailable"}
            >
              Test Webex DM (Technical)
            </button>
          </div>
        </div>
      )}

      {step === "outlook" && (
        <div className="setup-step">
          <div className="summary-grid">
            <div>
              <span className="muted">Status</span>
              <strong className={outlookStatus?.connected ? "provider-yes" : "provider-no"}>{outlookStatus?.connected ? "Connected" : "Not connected"}</strong>
            </div>
            <div>
              <span className="muted">Connected identity</span>
              <strong>{outlookStatus?.connected_user.name ?? outlookStatus?.connected_user.email ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Redirect URI</span>
              <strong style={{ wordBreak: "break-all" }}>{outlookStatus?.redirect_uri ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Mail.Send</span>
              <strong className={outlookStatus?.mail_send_available ? "provider-yes" : "provider-no"}>{outlookStatus?.mail_send_available ? "Available" : "Not available"}</strong>
            </div>
          </div>

          {outlookStatus?.last_error_code && (
            <div className="warning slim">
              <strong>{outlookStatus.last_error_code}:</strong> {outlookStatus.last_error_message}
            </div>
          )}
          {!outlookStatus?.configured && <div className="warning slim">MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not configured on the server.</div>}

          <div className="actions">
            <a className="button secondary" href="/api/outlook/oauth/start">
              {outlookStatus?.connected ? "Reconnect" : "Connect"}
            </a>
            {outlookStatus?.connected && (
              <button type="button" className="button secondary" onClick={() => runAction("disconnect-outlook", disconnectOutlook)} disabled={busy === "disconnect-outlook"}>
                Disconnect
              </button>
            )}
            <button type="button" className="button secondary" onClick={() => runAction("test-email-sales", () => sendTestEmail("sales"))} disabled={busy === "test-email-sales" || !outlookStatus?.connected}>
              Test email (Sales)
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => runAction("test-email-technical", () => sendTestEmail("technical"))}
              disabled={busy === "test-email-technical" || !outlookStatus?.connected}
            >
              Test email (Technical)
            </button>
          </div>
        </div>
      )}

      {step === "routing" && (
        <div className="setup-step">
          <div className="summary-grid">
            <div>
              <span className="muted">{routingConfig?.config.recipients.sales.assignment_label ?? "Sales / Commercial owner"}</span>
              <strong>
                {routingConfig?.config.recipients.sales.name ?? "—"} ({routingConfig?.config.recipients.sales.email ?? "—"})
              </strong>
            </div>
            <div>
              <span className="muted">{routingConfig?.config.recipients.technical.assignment_label ?? "Technical / Specialist owner"}</span>
              <strong>
                {routingConfig?.config.recipients.technical.name ?? "—"} ({routingConfig?.config.recipients.technical.email ?? "—"})
              </strong>
            </div>
            <div>
              <span className="muted">Source</span>
              <strong>{routingConfig ? `v${routingConfig.config.metadata.version}` : "—"}</strong>
            </div>
          </div>
          {routingConfig && (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              <code>{routingConfig.path}</code>
            </p>
          )}

          <h4 style={{ margin: "16px 0 4px" }}>Webex delivery spaces</h4>
          <WebexSpacePicker />

          <div className="actions">
            <button type="button" className="button secondary" onClick={() => runAction("reload-routing", reloadRoutingConfig)} disabled={busy === "reload-routing"}>
              Reload routing
            </button>
          </div>
        </div>
      )}

      {step === "automation" && (
        <div className="setup-step">
          <div className="summary-grid">
            <div>
              <span className="muted">Auto-send after analysis</span>
              <strong className={status?.auto_send_enabled ? "provider-yes" : "provider-no"}>{status?.auto_send_enabled ? "On" : "Off"}</strong>
            </div>
            <div>
              <span className="muted">Webex transcript autopilot</span>
              <strong className={status?.autopilot_enabled ? "provider-yes" : "provider-no"}>{status?.autopilot_enabled ? "On" : "Off"}</strong>
            </div>
            <div>
              <span className="muted">Public webhook URL</span>
              <strong>{webhookStatus?.targetUrl ?? "Not set"}</strong>
            </div>
            <div>
              <span className="muted">Webhook registered</span>
              <strong className={webhookStatus?.registered ? "provider-yes" : "provider-no"}>{webhookStatus?.registered ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span className="muted">Last transcript</span>
              <strong>{status?.last_transcript_processed?.transcript_id ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Last delivery</span>
              <strong>
                {status?.last_messages_sent.length ? status.last_messages_sent.map((item) => `${item.lane}:${item.recipient_email}`).join(", ") : "—"}
              </strong>
            </div>
          </div>

          {status?.autopilot_unavailable_reason && <div className="warning slim">{status.autopilot_unavailable_reason}</div>}

          <div className="actions">
            {!status?.auto_send_enabled ? (
              <button type="button" onClick={() => runAction("enable-auto-send", () => setAutoSend(true))} disabled={busy === "enable-auto-send"}>
                Enable auto-send
              </button>
            ) : (
              <button type="button" className="button secondary" onClick={() => runAction("disable-auto-send", () => setAutoSend(false))} disabled={busy === "disable-auto-send"}>
                Disable auto-send
              </button>
            )}
            {!status?.autopilot_enabled ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => runAction("enable-autopilot", () => setAutopilot(true))}
                disabled={busy === "enable-autopilot" || Boolean(status?.autopilot_unavailable_reason)}
              >
                Enable autopilot
              </button>
            ) : (
              <button type="button" className="button secondary" onClick={() => runAction("disable-autopilot", () => setAutopilot(false))} disabled={busy === "disable-autopilot"}>
                Disable autopilot
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => runAction("register-webhook", registerWebhook)}
              disabled={busy === "register-webhook" || Boolean(status?.autopilot_unavailable_reason)}
            >
              Register webhook
            </button>
            {webhookStatus?.registered && (
              <button type="button" className="button secondary" onClick={() => runAction("unregister-webhook", unregisterWebhook)} disabled={busy === "unregister-webhook"}>
                Remove webhook
              </button>
            )}
          </div>
        </div>
      )}

      {step === "providers" && (
        <div className="setup-step">
          <div className="provider-grid">
            <div className="provider-check">
              <strong>AI provider (Circuit)</strong>
              <div className="provider-line">
                <span>Credentials configured:</span>
                <span className={agentStatus?.ai_provider.configured ? "provider-yes" : "provider-no"}>{agentStatus?.ai_provider.configured ? "Yes" : "No"}</span>
              </div>
              <div className="provider-line">
                <span>Inference contract confirmed:</span>
                <span className={agentStatus?.ai_provider.contract_confirmed ? "provider-yes" : "provider-no"}>{agentStatus?.ai_provider.contract_confirmed ? "Yes" : "No"}</span>
              </div>
              <div className="provider-line">
                <span>Model:</span>
                <span>{agentStatus?.ai_provider.model ?? "—"}</span>
              </div>
              <div className="provider-line">
                <span>Operational:</span>
                <span className={agentStatus?.ai_provider.operational ? "provider-yes" : "provider-no"}>{agentStatus?.ai_provider.operational ? "Yes" : "No"}</span>
              </div>
              <div className="provider-line">
                <span>Provider state:</span>
                <span className={agentStatus?.ai_provider.operational ? "provider-yes" : "provider-no"}>{agentStatus?.ai_provider.state ?? "—"}</span>
              </div>
              <div className="provider-line" style={{ fontSize: "0.78rem" }}>
                <span className="muted">Status:</span>
                <span className="muted">{agentStatus?.ai_provider.message ?? "—"}</span>
              </div>
              {agentStatus?.ai_provider.missing_config && agentStatus.ai_provider.missing_config.length > 0 && (
                <div className="provider-line" style={{ fontSize: "0.78rem" }}>
                  <span className="muted">Missing env vars:</span>
                  <span className="provider-no" style={{ textAlign: "right" }}>{agentStatus.ai_provider.missing_config.join(", ")}</span>
                </div>
              )}
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>
                Circuit is an optional enhancement; semantic retrieval and the full analysis are deterministic and remain authoritative without it.
              </p>
              <div className="actions">
                <button type="button" className="button secondary" onClick={testCircuit} disabled={busy === "test-circuit"}>
                  {busy === "test-circuit" ? "Testing…" : "Test Circuit (auth + inference)"}
                </button>
              </div>
            </div>
            <div className="provider-check">
              <strong>Search</strong>
              <div className="provider-line">
                <span>Configured:</span>
                <span className={agentStatus?.search.configured ? "provider-yes" : "provider-no"}>{agentStatus?.search.configured ? "Yes" : "No"}</span>
              </div>
              <div className="provider-line">
                <span>Provider:</span>
                <span>{agentStatus?.search.provider ?? "—"}</span>
              </div>
              <div className="provider-line">
                <span>Last result:</span>
                <span>{agentStatus?.search.message ?? "—"}</span>
              </div>
              <div className="actions">
                <button type="button" className="button secondary" onClick={testSearch} disabled={busy === "test-search"}>
                  {busy === "test-search" ? "Testing…" : "Test Search"}
                </button>
              </div>
            </div>
            <div className="provider-check">
              <strong>Firecrawl</strong>
              <div className="provider-line">
                <span>Configured:</span>
                <span className={agentStatus?.firecrawl.configured ? "provider-yes" : "provider-no"}>{agentStatus?.firecrawl.configured ? "Yes" : "No"}</span>
              </div>
              <span className="muted">{agentStatus?.firecrawl.message}</span>
            </div>
            <div className="provider-check">
              <strong>Contact enrichment</strong>
              <div className="provider-line">
                <span>Configured:</span>
                <span className={agentStatus?.contact_enrichment.configured ? "provider-yes" : "provider-no"}>{agentStatus?.contact_enrichment.configured ? "Yes" : "No"}</span>
              </div>
              <span className="muted">{agentStatus?.contact_enrichment.message}</span>
            </div>
          </div>
        </div>
      )}

      {step === "profile" && (
        <SellerProfileWizard onSaved={() => setMessage("Seller profile saved. Personalization and alert relevance are now active.")} />
      )}

      {step === "analytics" && <AnalyticsView />}
    </Modal>
  );
}
