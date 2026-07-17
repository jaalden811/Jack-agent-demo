"use client";

import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { PursuitDecisionControl } from "@/components/signal-agent/PursuitDecisionControl";

/**
 * Primary, personalized opportunity surface. Answers, in the first viewport:
 * what is the opportunity, why it matters to me, why now, what to do, and
 * what happens if I pursue it. Everything else is progressively disclosed via
 * native <details> (collapsed by default, keyboard-accessible). Renders only
 * safe, structured personalization output — never raw transcript/score dumps.
 */

function bandTone(band: string): "ok" | "warn" | "pending" {
  return band === "high" ? "ok" : band === "medium" ? "pending" : "warn";
}

export function PersonalizedOpportunityCard({ result }: { result: SecureNetworkingTriageResult }) {
  const p = result.personalization;
  if (!p) return null;

  const teaser = p.opportunity_teaser;
  const rel = p.personal_relevance;
  const notify = p.notification_decision;

  return (
    <section className="panel personalized-card" aria-label="Personalized opportunity">
      <div className="summary-headline" style={{ flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: "1.05rem" }}>{teaser.headline}</strong>
        <span className="topbar-pill pending" title="Deterministic signal (unchanged by personalization)">{teaser.signal_label}</span>
        <span className={`topbar-pill ${bandTone(rel.band)}`} title="How relevant this is to you, given your goals (never changes the opportunity score)">
          Relevance: {rel.band === "unavailable" ? "n/a" : `${rel.band} (${rel.score})`}
        </span>
        <span className="topbar-pill pending" title="Notification decision">alert: {notify.decision.replace(/_/g, " ")}</span>
      </div>

      {/* Personalization only — the "why is this on my desk" framing. The
          concrete next action (what/owner/timing/success + accept controls)
          lives in the single Action Center block below, never duplicated here. */}
      <div className="personalized-primary">
        <p><span className="muted">Why you:</span> {teaser.why_you}</p>
        {teaser.goal_alignment && <p className="chip chip-info" style={{ display: "inline-block" }}>{teaser.goal_alignment}</p>}
        {teaser.goal_impact && <p><span className="muted">Goal impact:</span> {teaser.goal_impact}</p>}
        {teaser.limitation && <p className="muted" style={{ fontSize: "0.8rem" }}>{teaser.limitation}</p>}
      </div>

      <PursuitDecisionControl
        runId={result.run_id}
        account={teaser.account}
        motionId={result.matches[0]?.entry_id ?? result.executive_summary.primary_opportunity ?? "unknown"}
        profileId={p.profile_id}
      />

      <div className="personalized-details">
        <details>
          <summary>Why this matters to you</summary>
          <ul className="compact-list">
            {[...rel.factors].sort((a, b) => b.contribution - a.contribution).slice(0, 6).map((f) => (
              <li key={f.dimension}>
                <strong>{f.dimension.replace(/_/g, " ")}</strong> ({Math.round(f.score * 100)}%) — {f.reason}
              </li>
            ))}
            {rel.penalties_applied.length > 0 && <li className="muted">Penalties: {rel.penalties_applied.join(", ").replace(/_/g, " ")}</li>}
          </ul>
        </details>
      </div>
    </section>
  );
}
