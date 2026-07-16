"use client";

import { useState } from "react";
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
  const [showEvidence, setShowEvidence] = useState(false);
  const p = result.personalization;
  if (!p) return null;

  const teaser = p.opportunity_teaser;
  const rel = p.personal_relevance;
  const nba = result.next_best_action;
  const publicCount = (result.public_signals ?? []).length;
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

      <div className="personalized-primary">
        <p><span className="muted">Why you:</span> {teaser.why_you}</p>
        <p><span className="muted">Why now:</span> {teaser.why_now}</p>
        <p><span className="muted">Do next:</span> <strong>{teaser.recommended_action}</strong></p>
        <p><span className="muted">Expected output:</span> {teaser.expected_output}</p>
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

        <details>
          <summary>Why now</summary>
          <ul className="compact-list">
            {(nba?.why_now ?? []).map((w, i) => <li key={i}>{w}</li>)}
            {(nba?.recommended_timing || nba?.due_basis) && <li className="muted">Timing: {nba?.recommended_timing ?? "—"} (basis: {nba?.due_basis ?? "none"})</li>}
          </ul>
        </details>

        <details>
          <summary>What to do next</summary>
          <ul className="compact-list">
            <li><strong>Owner:</strong> {nba?.primary_owner || "—"} ({nba?.owner_lane || "—"})</li>
            <li><strong>Action:</strong> {nba?.summary}</li>
            {(nba?.success_criteria ?? []).map((s, i) => <li key={i}>Success: {s}</li>)}
          </ul>
        </details>

        <details>
          <summary>Full qualification (MEDDPICC)</summary>
          <ul className="compact-list">
            {Object.entries(result.meddpicc ?? {}).map(([k, v]) => (
              <li key={k}><strong>{k.replace(/_/g, " ")}:</strong> {(v as { status: string }).status}</li>
            ))}
          </ul>
        </details>

        <details>
          <summary>Public research ({publicCount})</summary>
          <p className="muted" style={{ fontSize: "0.85rem" }}>Top public signals and sources are in the Sources &amp; enrichment tab; only signals that change the action surface here.</p>
        </details>

        <details onToggle={(e) => setShowEvidence((e.target as HTMLDetailsElement).open)}>
          <summary>Evidence &amp; scoring</summary>
          {showEvidence && (
            <ul className="compact-list">
              <li className="muted">Deterministic scores, audit, and the raw transcript are unchanged and available in the tabs below.</li>
            </ul>
          )}
        </details>
      </div>
    </section>
  );
}
