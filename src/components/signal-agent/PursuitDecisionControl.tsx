"use client";

import { useState } from "react";
import type { PursuitDecision } from "@/lib/opportunity-feedback/types";

/**
 * Four-way pursuit intent capture (Pursue / Need more information / Not now /
 * Pass). Persists to /api/signal-agent/pursuit-feedback. "Need more
 * information" and "Not now" carry different product signals than a Yes/No,
 * so all four are distinct. No CRM call is ever made.
 */

const OPTIONS: Array<{ decision: PursuitDecision; label: string; tone: string }> = [
  { decision: "pursue", label: "Pursue", tone: "primary" },
  { decision: "need_more_information", label: "Need more information", tone: "secondary" },
  { decision: "not_now", label: "Not now", tone: "secondary" },
  { decision: "pass", label: "Pass", tone: "secondary" }
];

export function PursuitDecisionControl({
  runId,
  account,
  motionId,
  profileId,
  onDecision
}: {
  runId: string;
  account: string;
  motionId: string;
  profileId: string | null;
  onDecision?: (decision: PursuitDecision) => void;
}) {
  const [recorded, setRecorded] = useState<PursuitDecision | null>(null);
  const [busy, setBusy] = useState<PursuitDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: PursuitDecision) {
    setBusy(decision);
    setError(null);
    try {
      const body: Record<string, unknown> = { run_id: runId, account, opportunity_motion_id: motionId, profile_id: profileId, decision };
      if (decision === "not_now") {
        const reviewDate = window.prompt("Suppress until (YYYY-MM-DD)? Leave blank to skip.");
        if (reviewDate && reviewDate.trim()) body.next_review_at = new Date(reviewDate.trim()).toISOString();
      }
      if (decision === "pass") {
        const reason = window.prompt("Optional reason for passing?");
        if (reason && reason.trim()) body.reason_code = reason.trim().slice(0, 120);
      }
      const res = await fetch("/api/signal-agent/pursuit-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Could not record decision");
      }
      setRecorded(decision);
      onDecision?.(decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pursuit-control">
      <div className="chip-row" role="group" aria-label="Do you intend to pursue this opportunity?">
        {OPTIONS.map((o) => (
          <button
            key={o.decision}
            type="button"
            className={`button ${o.tone} ${recorded === o.decision ? "is-selected" : ""}`}
            aria-pressed={recorded === o.decision}
            disabled={busy !== null}
            onClick={() => submit(o.decision)}
          >
            {busy === o.decision ? "Saving…" : o.label}
          </button>
        ))}
      </div>
      {recorded && (
        <p className="muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
          Recorded: {OPTIONS.find((o) => o.decision === recorded)?.label}. {recorded === "pursue" ? "Next Best Action marked accepted — no CRM record was created." : recorded === "need_more_information" ? "Open the assistant or request more research." : "This unchanged opportunity will be suppressed accordingly."}
        </p>
      )}
      {error && <p className="chip-danger" style={{ marginTop: 6, fontSize: "0.8rem" }}>{error}</p>}
    </div>
  );
}
