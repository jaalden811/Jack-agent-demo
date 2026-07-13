"use client";

import { useState } from "react";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import type { ChannelDeliveryResult, WebexLane } from "@/lib/webex/types";

function channelLabel(channel: "webex" | "email"): string {
  return channel === "webex" ? "Webex" : "Email";
}

function statusText(result: ChannelDeliveryResult | undefined, channel: "webex" | "email"): string {
  if (!result) return "Not applicable";
  if (result.delivered) return channel === "email" ? "Accepted" : "Sent";
  if (result.attempted) return "Failed";
  return result.error?.toLowerCase().includes("preview") ? "Not sent (preview only)" : "Not sent";
}

function statusClass(result: ChannelDeliveryResult | undefined): string {
  if (!result) return "muted";
  if (result.delivered) return "provider-yes";
  if (result.attempted) return "provider-no";
  return "muted";
}

function LaneRow({
  lane,
  laneLabel,
  recipientName,
  recipientEmail,
  delivery,
  onRetry,
  retrying
}: {
  lane: WebexLane;
  laneLabel: string;
  recipientName: string;
  recipientEmail: string | null;
  delivery: ChannelDeliveryResult[];
  onRetry: () => void;
  retrying: boolean;
}) {
  const webex = delivery.find((item) => item.lane === lane && item.channel === "webex");
  const email = delivery.find((item) => item.lane === lane && item.channel === "email");
  const hasFailure = [webex, email].some((item) => item && item.attempted && !item.delivered);

  return (
    <div className="delivery-row">
      <div className="delivery-row-header">
        <strong>
          {laneLabel} — {recipientName}
        </strong>
        <span className="muted">{recipientEmail ?? "No recipient configured"}</span>
      </div>
      <div className="delivery-channels">
        <div className="delivery-channel">
          <span className="muted">{channelLabel("webex")}</span>
          <span className={statusClass(webex)}>{statusText(webex, "webex")}</span>
          {webex?.sent_at && <span className="muted small">{webex.sent_at}</span>}
          {webex?.error && !webex.delivered && <span className="muted small">{webex.error}</span>}
        </div>
        <div className="delivery-channel">
          <span className="muted">{channelLabel("email")}</span>
          <span className={statusClass(email)}>{statusText(email, "email")}</span>
          {email?.sent_at && <span className="muted small">{email.sent_at}</span>}
          {email?.error && !email.delivered && <span className="muted small">{email.error}</span>}
        </div>
      </div>
      {hasFailure && (
        <div className="actions">
          <button type="button" className="button secondary" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry failed delivery"}
          </button>
        </div>
      )}
    </div>
  );
}

export function DeliveryResultCard({
  result,
  onResultUpdate
}: {
  result: WebexAutomationRunResult;
  onResultUpdate: (result: WebexAutomationRunResult) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const { peachtree } = result;

  async function retry() {
    setRetrying(true);
    try {
      const response = await fetch("/api/webex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, webexSource: result.webex_source })
      });
      const data = await response.json();
      if (response.ok) {
        onResultUpdate({ ...result, peachtree: data.peachtree });
      }
    } finally {
      setRetrying(false);
    }
  }

  const salesDecision = peachtree.routing.find((item) => item.lane === "sales");
  const technicalDecision = peachtree.routing.find((item) => item.lane === "technical");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Delivery</h2>
          <p className="muted">{peachtree.auto_send_enabled ? "Auto-sent immediately after this analysis." : "Preview only — auto-send is currently off."}</p>
        </div>
      </div>

      {peachtree.routing.length === 0 ? (
        <div className="warning slim">NOISE (or nothing detected) — no sales or technical action was routed for this transcript.</div>
      ) : (
        <>
          {salesDecision ? (
            <LaneRow
              lane="sales"
              laneLabel="Sales"
              recipientName={salesDecision.recipient_name}
              recipientEmail={salesDecision.recipient_email}
              delivery={peachtree.delivery}
              onRetry={retry}
              retrying={retrying}
            />
          ) : (
            <div className="delivery-row">
              <strong>Sales</strong> <span className="muted">Not applicable — no sales signal detected.</span>
            </div>
          )}
          {technicalDecision ? (
            <LaneRow
              lane="technical"
              laneLabel="Technical"
              recipientName={technicalDecision.recipient_name}
              recipientEmail={technicalDecision.recipient_email}
              delivery={peachtree.delivery}
              onRetry={retry}
              retrying={retrying}
            />
          ) : (
            <div className="delivery-row">
              <strong>Technical</strong> <span className="muted">Not applicable — no technical signal detected.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
