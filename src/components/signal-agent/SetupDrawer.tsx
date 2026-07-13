"use client";

import { useEffect, useState } from "react";
import type { SignalAgentStatus } from "@/lib/signal-agent/types";
import type { WebexStatus } from "@/lib/webex/types";
import type { OutlookStatus } from "@/lib/outlook/types";
import { Modal } from "@/components/signal-agent/Modal";

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

type SetupStep = "webex" | "outlook" | "routing" | "automation" | "providers";

const STEP_LABELS: Record<SetupStep, string> = {
  webex: "1. Webex",
  outlook: "2. Outlook",
  routing: "3. Routing",
  automation: "4. Automation",
  providers: "AI providers"
};

export function SetupDrawer({
  onClose,
  status,
  agentStatus,
  onRefresh
}: {
  onClose: () => void;
  status: WebexStatus | null;
  agentStatus: SignalAgentStatus | null;
  onRefresh: () => void;
}) {
  const [step, setStep] = useState<SetupStep>("webex");
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfigResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function loadAll() {
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

  async function sendTestMessage(lane: "sales" | "technical") {
    const response = await fetch("/api/webex/test-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane })
    });
    const data = await response.json();
    setMessage(data.delivered ? `Webex test message sent to ${data.recipient_email} (sender: ${data.sender_mode}).` : `Could not send test message: ${data.error}`);
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
              <strong style={{ wordBreak: "break-all" }}>{status?.redirect_uri ?? "—"}</strong>
            </div>
            <div>
              <span className="muted">Granted scopes</span>
              <strong>{status?.granted_scopes.length ? status.granted_scopes.join(", ") : "—"}</strong>
            </div>
            <div>
              <span className="muted">Delivery sender mode</span>
              <strong>{status?.webex_delivery.sender_mode ?? "—"}</strong>
            </div>
          </div>

          {status?.last_error_code && (
            <div className="warning slim">
              <strong>{status.last_error_code}:</strong> {status.last_error_message}
            </div>
          )}
          {!status?.configured && <div className="warning slim">WEBEX_CLIENT_ID / WEBEX_CLIENT_SECRET are not configured on the server.</div>}

          <div className="actions">
            <a className="button secondary" href="/api/webex/oauth/start">
              {status?.connected ? "Reconnect" : "Connect"}
            </a>
            {status?.connected && (
              <button type="button" className="button secondary" onClick={() => runAction("disconnect-webex", disconnectWebex)} disabled={busy === "disconnect-webex"}>
                Disconnect
              </button>
            )}
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
              <strong>OpenAI</strong>
              <div className="provider-line">
                <span>Configured:</span>
                <span className={agentStatus?.openai.configured ? "provider-yes" : "provider-no"}>{agentStatus?.openai.configured ? "Yes" : "No"}</span>
              </div>
              <span className="muted">{agentStatus?.openai.message}</span>
            </div>
            <div className="provider-check">
              <strong>Search</strong>
              <div className="provider-line">
                <span>Configured:</span>
                <span className={agentStatus?.search.configured ? "provider-yes" : "provider-no"}>{agentStatus?.search.configured ? "Yes" : "No"}</span>
              </div>
              <span className="muted">{agentStatus?.search.message}</span>
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
    </Modal>
  );
}
