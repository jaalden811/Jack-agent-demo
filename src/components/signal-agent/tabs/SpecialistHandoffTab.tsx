"use client";

import { useState } from "react";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import type { SpecialistHandoffPacket } from "@/lib/handoff/types";

/**
 * Specialist Handoff view (Section 8/15): the pre-meeting sync brief for
 * Bella (commercial) and Jack (technical). Everything is rendered from the
 * assembled handoff packet so a specialist can act without reopening the
 * transcript.
 */

function HandoffView({ packet }: { packet: SpecialistHandoffPacket }) {
  return (
    <div className="handoff-view">
      <div className="handoff-brief">
        <span className="meta-label">90-second brief</span>
        <p>{packet.ninety_second_brief}</p>
      </div>

      <div className="handoff-columns">
        <div className="handoff-col">
          <h4>Customer already told us — do not re-ask</h4>
          {packet.questions_already_answered.length === 0 ? (
            <p className="muted">No answered topics indexed.</p>
          ) : (
            <ul className="handoff-list">
              {packet.questions_already_answered.slice(0, 10).map((a, i) => (
                <li key={i}>
                  <strong>{a.topic}</strong>
                  <span className={`chip chip-${a.answer_status === "complete" ? "success" : a.answer_status === "conflicting" ? "danger" : "warning"}`}>{a.answer_status}</span>
                  <div className="handoff-answer">{a.answer}</div>
                  {a.follow_up_allowed && <div className="handoff-followup">Clarify: {a.follow_up_allowed}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="handoff-col">
          <h4>Still need to learn</h4>
          {packet.remaining_questions.length === 0 ? (
            <p className="muted">No blocking gaps — ready to run.</p>
          ) : (
            <ul className="handoff-list">
              {packet.remaining_questions.map((q, i) => (
                <li key={i}>
                  <span className={`chip chip-${q.blocking ? "danger" : "info"}`}>{q.blocking ? "blocking" : q.priority}</span>
                  <div>{q.question}</div>
                  <div className="handoff-known">Known: {q.what_is_already_known}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {packet.sensitive_or_declined_questions.length > 0 && (
        <div className="handoff-block handoff-declined">
          <h4>Customer declined / sensitive — do not re-raise</h4>
          <ul className="handoff-list">
            {packet.sensitive_or_declined_questions.map((d, i) => (
              <li key={i}>{d.what_was_declined}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="handoff-columns">
        <div className="handoff-col">
          <h4>Current environment</h4>
          <ul className="handoff-list">{(packet.current_environment.length ? packet.current_environment : ["Not yet captured"]).map((e, i) => <li key={i}>{e}</li>)}</ul>
          <h4>Explicit objections / rejected options</h4>
          <ul className="handoff-list">{(packet.explicitly_rejected_options.length ? packet.explicitly_rejected_options : ["None recorded"]).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
        <div className="handoff-col">
          <h4>Stakeholders</h4>
          <ul className="handoff-list">
            {packet.stakeholder_map.slice(0, 6).map((s, i) => (
              <li key={i}>
                <strong>{s.name ?? s.role}</strong> — {s.role} <span className="chip chip-muted">{s.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {packet.meeting_or_workshop_plan && (
        <div className="handoff-block">
          <h4>Meeting packet — {packet.meeting_or_workshop_plan.title}</h4>
          <p className="muted">{packet.meeting_or_workshop_plan.objective}</p>
          <ul className="handoff-list">
            {packet.meeting_or_workshop_plan.agenda.map((a, i) => (
              <li key={i}>
                <span className="tabular">{a.minutes}m</span> — {a.topic} → <em>{a.desired_output}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {packet.public_context.length > 0 && (
        <div className="handoff-block">
          <h4>Public context (changes the action)</h4>
          <ul className="handoff-list">
            {packet.public_context.map((p, i) => (
              <li key={i}>
                {p.public_fact} — <em>{p.handoff_implication}</em> <span className="muted">({p.limitation})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SpecialistHandoffTab({ result }: { result: WebexAutomationRunResult }) {
  const [lane, setLane] = useState<"sales" | "technical">("technical");
  const packet = lane === "sales" ? result.specialist_handoffs?.sales : result.specialist_handoffs?.technical;

  if (!packet) return <p className="muted">No handoff packet available for this run.</p>;

  const di = result.deal_intelligence;

  return (
    <div className="specialist-handoff">
      {di && (
        <div className="handoff-brief" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="meta-label">Deal intelligence</span>
          <p style={{ margin: "4px 0" }}>{di.headline}</p>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            <strong>Shape:</strong> {di.deal_shape.label}
            {di.power_map.find((p) => p.role_id === "business_champion") ? (
              <>
                {" · "}
                <strong>Champion:</strong> {di.power_map.find((p) => p.role_id === "business_champion")!.name}
              </>
            ) : null}
            {di.risks[0] ? (
              <>
                {" · "}
                <strong>Top landmine:</strong> {di.risks[0].label}
              </>
            ) : null}
          </p>
        </div>
      )}
      <div className="handoff-lane-toggle" role="tablist">
        <button type="button" className={`button ${lane === "technical" ? "" : "secondary"}`} onClick={() => setLane("technical")}>
          Jack — Technical
        </button>
        <button type="button" className={`button ${lane === "sales" ? "" : "secondary"}`} onClick={() => setLane("sales")}>
          Bella — Commercial
        </button>
        <span className={`chip chip-${packet.readiness_status === "ready" ? "success" : packet.readiness_status === "blocked" ? "danger" : "warning"}`}>
          Ready for customer meeting: {packet.readiness_status.replace(/_/g, " ")} ({packet.readiness_score})
        </span>
      </div>
      <HandoffView packet={packet} />
    </div>
  );
}
