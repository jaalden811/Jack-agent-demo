"use client";

import { useEffect, useState } from "react";
import type { WebexStatus } from "@/lib/webex/types";

type WebhookStatus = {
  registered: boolean;
  webhookId: string | null;
  targetUrl: string | null;
  lastEventAt: string | null;
  lastEventTranscriptId: string | null;
};

type RoutingConfigResponse = {
  path: string;
  config: {
    metadata: { team: string; version: string; purpose: string };
    recipients: {
      sales: { name: string; assignment_label: string };
      technical: { name: string; assignment_label: string };
    };
  };
};

export function WebexIntegrationPanel({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<WebexStatus | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfigResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function loadAll() {
    fetch("/api/webex/status")
      .then((r) => r.json())
      .then(setStatus)
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
  }, [refreshToken]);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } finally {
      setBusy(null);
      loadAll();
    }
  }

  async function testConnection() {
    const response = await fetch("/api/webex/status");
    const data: WebexStatus = await response.json();
    setMessage(data.connected ? `Connected as ${data.connected_user.name ?? data.connected_user.email ?? "unknown"}.` : "Not connected.");
  }

  async function disconnect() {
    await fetch("/api/webex/oauth/disconnect", { method: "POST" });
    setMessage("Disconnected.");
  }

  async function sendTestMessage(lane: "sales" | "technical") {
    const response = await fetch("/api/webex/test-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane })
    });
    const data = await response.json();
    setMessage(data.delivered ? `Test message sent to ${data.recipient_email}.` : `Could not send test message: ${data.error}`);
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

  async function reloadRoutingConfig() {
    const response = await fetch("/api/webex/routing-config", { method: "POST" });
    const data = await response.json();
    setMessage(data.reloaded ? `Routing config reloaded (v${data.config.metadata.version}).` : `Could not reload: ${data.error}`);
  }

  const autopilotDisabledReason = status?.autopilot_unavailable_reason;
  const salesFirstName = routingConfig?.config.recipients.sales.name.split(" ")[0] ?? "sales owner";
  const technicalFirstName = routingConfig?.config.recipients.technical.name.split(" ")[0] ?? "technical owner";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Integrations &amp; routing</h2>
          <p className="muted">Webex transcript access, agent delivery identity, pilot routing, and autopilot — all in one place.</p>
        </div>
      </div>

      {message && <div className="warning slim">{message}</div>}

      <div className="webex-subsection">
        <h3>Webex transcript access</h3>
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
            <span className="muted">Granted scopes</span>
            <strong>{status?.granted_scopes.length ? status.granted_scopes.join(", ") : "—"}</strong>
          </div>
          <div>
            <span className="muted">Token refresh status</span>
            <strong>{status?.token_refresh_health ?? "—"}</strong>
          </div>
        </div>
        <div className="actions">
          <a className="button secondary" href="/api/webex/oauth/start">
            {status?.connected ? "Reconnect" : "Connect Webex"}
          </a>
          <button type="button" className="button secondary" onClick={() => runAction("test", testConnection)} disabled={busy === "test"}>
            Test connection
          </button>
          {status?.connected && (
            <button type="button" className="button secondary" onClick={() => runAction("disconnect", disconnect)} disabled={busy === "disconnect"}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="webex-subsection">
        <h3>Webex agent delivery</h3>
        <div className="summary-grid">
          <div>
            <span className="muted">Bot</span>
            <strong className={status?.bot_configured ? "provider-yes" : "provider-no"}>{status?.bot_configured ? "Configured" : "Not configured"}</strong>
          </div>
          <div>
            <span className="muted">Sales recipient</span>
            <strong className={status?.sales_recipient_configured ? "provider-yes" : "provider-no"}>{status?.sales_recipient_configured ? "Configured" : "Not configured"}</strong>
          </div>
          <div>
            <span className="muted">Technical recipient</span>
            <strong className={status?.technical_recipient_configured ? "provider-yes" : "provider-no"}>{status?.technical_recipient_configured ? "Configured" : "Not configured"}</strong>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => runAction("test-sales", () => sendTestMessage("sales"))} disabled={busy === "test-sales" || !status?.bot_configured}>
            Send test message to {salesFirstName}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => runAction("test-technical", () => sendTestMessage("technical"))}
            disabled={busy === "test-technical" || !status?.bot_configured}
          >
            Send test message to {technicalFirstName}
          </button>
        </div>
      </div>

      <div className="webex-subsection">
        <h3>Pilot routing</h3>
        <div className="summary-grid">
          <div>
            <span className="muted">{routingConfig?.config.recipients.sales.assignment_label ?? "Sales / Commercial owner"}</span>
            <strong>{routingConfig?.config.recipients.sales.name ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">{routingConfig?.config.recipients.technical.assignment_label ?? "Technical / Specialist owner"}</span>
            <strong>{routingConfig?.config.recipients.technical.name ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">Routing config file</span>
            <strong>{routingConfig ? `v${routingConfig.config.metadata.version}` : "—"}</strong>
          </div>
        </div>
        {routingConfig && (
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            <code>{routingConfig.path}</code>
          </p>
        )}
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => runAction("reload-routing", reloadRoutingConfig)} disabled={busy === "reload-routing"}>
            Reload routing config
          </button>
        </div>
      </div>

      <div className="webex-subsection">
        <h3>Autopilot</h3>
        <div className="summary-grid">
          <div>
            <span className="muted">Status</span>
            <strong className={status?.autopilot_enabled ? "provider-yes" : "provider-no"}>{status?.autopilot_enabled ? "Enabled" : "Disabled"}</strong>
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
            <span className="muted">Last webhook received</span>
            <strong>{webhookStatus?.lastEventAt ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">Last transcript processed</span>
            <strong>{status?.last_transcript_processed?.transcript_id ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">Last sales / technical message</span>
            <strong>
              {status?.last_messages_sent.length
                ? status.last_messages_sent.map((item) => `${item.lane}:${item.recipient_email}`).join(", ")
                : "—"}
            </strong>
          </div>
        </div>

        {autopilotDisabledReason && <div className="warning slim">{autopilotDisabledReason}</div>}

        <div className="actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => runAction("register-webhook", registerWebhook)}
            disabled={busy === "register-webhook" || Boolean(autopilotDisabledReason)}
          >
            Register webhook
          </button>
          {webhookStatus?.registered && (
            <button type="button" className="button secondary" onClick={() => runAction("unregister-webhook", unregisterWebhook)} disabled={busy === "unregister-webhook"}>
              Remove webhook
            </button>
          )}
          {!status?.autopilot_enabled ? (
            <button
              type="button"
              onClick={() => runAction("enable-autopilot", () => setAutopilot(true))}
              disabled={busy === "enable-autopilot" || Boolean(autopilotDisabledReason)}
            >
              Enable autopilot
            </button>
          ) : (
            <button type="button" className="button secondary" onClick={() => runAction("disable-autopilot", () => setAutopilot(false))} disabled={busy === "disable-autopilot"}>
              Disable autopilot
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
