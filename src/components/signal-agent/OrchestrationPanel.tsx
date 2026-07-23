import type { WebexAutomationRunResult } from "@/lib/webex/types";
import type { ActionStep } from "@/lib/orchestration/types";
import { OutcomeLedgerControl } from "@/components/signal-agent/OutcomeLedgerControl";

/**
 * ActionCase panel (signal-to-action-orchestration-v1) — renders the governed
 * internal action plan: the recommended human decision, the dependency-aware
 * action graph (do-now vs blocked vs conditional/later), capability-aware owner
 * resolution, the customer-engagement plan, and the append-only outcome ledger.
 * Read-only display of `result.orchestration`; the human decision itself is
 * captured by the Action Center controls. Purely additive.
 */

const DECISION_TONE: Record<string, string> = { PURSUE: "success", NEED_MORE_INFORMATION: "warning", NOT_NOW: "muted", PASS: "danger" };
const TIMING_BADGE: Record<string, string> = {
  immediate: "Do now",
  before_customer_meeting: "Before customer meeting",
  after_validation: "After validation",
  at_funding_gate: "Later — funding gate",
  if_blocked: "Only if blocked"
};
const REQUIREMENT_TONE: Record<string, string> = { required: "info", recommended: "info", conditional: "muted" };

function StepRow({ step, blocked }: { step: ActionStep; blocked: boolean }) {
  return (
    <li>
      <span className={`chip chip-${blocked ? "muted" : REQUIREMENT_TONE[step.requirement] ?? "info"}`}>{TIMING_BADGE[step.timing] ?? step.timing}</span>{" "}
      <span className="chip chip-muted">{step.lane}</span>{" "}
      <strong>{step.title}</strong>
      {step.customerFacing && <span className="chip chip-info"> customer-facing</span>}
      <div className="muted">{step.description}</div>
      {step.expectedArtifact && <div className="muted">Artifact: {step.expectedArtifact}</div>}
      {step.dependencyStepIds.length > 0 && <div className="muted">Blocked until: {step.dependencyStepIds.join(", ")} complete</div>}
    </li>
  );
}

export function OrchestrationPanel({ result }: { result: WebexAutomationRunResult }) {
  const ac = result.orchestration ?? null;
  if (!ac) return null;

  const blocked = new Set(ac.action_graph.blocked_step_ids);
  const ready = ac.action_graph.steps.filter((s) => ac.action_graph.next_ready_step_ids.includes(s.id));
  const later = ac.action_graph.steps.filter((s) => s.requirement === "conditional" && !ac.action_graph.next_ready_step_ids.includes(s.id));
  const customerStep = ac.action_graph.steps.find((s) => s.customerFacing);

  return (
    <section className="panel action-center">
      <div className="action-center-head">
        <span className="action-eyebrow">ActionCase · {ac.mode.toLowerCase()}</span>
        <div className="action-badges">
          <span className={`chip chip-${DECISION_TONE[ac.action_case.recommended_decision] ?? "muted"}`}>{ac.action_case.recommended_decision.replace(/_/g, " ")}</span>
          <span className="chip chip-warning">requires human approval</span>
          <span className="chip chip-muted">{ac.novelty_and_duplication.duplicate_status.replace(/_/g, " ")}</span>
        </div>
      </div>

      <p className="action-summary">{ac.action_case.decision_reason}</p>

      {/* Governed decision effects — what each human choice does to THIS case. */}
      <div className="action-block">
        <span className="meta-label">If the portfolio owner chooses</span>
        <ul className="action-list">
          <li><strong>Pursue</strong> — activate the ActionCase, assign the work, start timing; deliver only after approval.</li>
          <li><strong>Need more information</strong> — create only bounded discovery{ac.human_decision_effects.need_more_information.required_evidence.length > 0 ? `: ${ac.human_decision_effects.need_more_information.required_evidence.slice(0, 3).join("; ")}` : ""}.</li>
          <li><strong>Not now</strong> — preserve the case; suppress unchanged signals until {ac.human_decision_effects.not_now.reevaluation_condition ?? "a material change"}.</li>
          <li><strong>Pass</strong> — preserve the disqualifying evidence and block the same rejected motion from reopening.</li>
        </ul>
      </div>

      {/* Owner resolution — capability-aware, deterministic. */}
      <div className="action-block">
        <span className="meta-label">Owner resolution</span>
        <ul className="action-list">
          <li>
            <span className={`chip chip-${ac.owner_resolution.primary_owner.status === "SELECTED" ? "success" : "muted"}`}>{ac.owner_resolution.primary_owner.status}</span>{" "}
            <strong>Owner</strong> — {ac.owner_resolution.primary_owner.person_id ?? ac.owner_resolution.primary_owner.required_role} ({ac.owner_resolution.primary_owner.lane})
            {ac.owner_resolution.primary_owner.selection_reasons.length > 0 && <div className="muted">{ac.owner_resolution.primary_owner.selection_reasons.join("; ")}</div>}
          </li>
          {ac.owner_resolution.collaborators.map((c, i) => (
            <li key={i}>
              <span className={`chip chip-${c.status === "SELECTED" ? "success" : "muted"}`}>{c.status}</span>{" "}
              <strong>Collaborator</strong> — {c.person_id ?? c.required_role} ({c.lane})
            </li>
          ))}
          {ac.owner_resolution.unfilled_roles.map((u, i) => (
            <li key={`u${i}`}>
              <span className="chip chip-muted">role only</span> <strong>{u.required_role}</strong> — {u.reason}
            </li>
          ))}
        </ul>
      </div>

      {/* Dependency-aware action graph. */}
      {ready.length > 0 && (
        <div className="action-block">
          <span className="meta-label">Do now (ready)</span>
          <ul className="action-list">
            {ready.map((s) => (
              <StepRow key={s.id} step={s} blocked={false} />
            ))}
          </ul>
        </div>
      )}
      {customerStep && (
        <div className="action-block">
          <span className="meta-label">Customer step {blocked.has(customerStep.id) ? "(blocked until internal prep completes)" : "(ready)"}</span>
          <ul className="action-list">
            <StepRow step={customerStep} blocked={blocked.has(customerStep.id)} />
          </ul>
        </div>
      )}
      {later.length > 0 && (
        <div className="action-block internal-plan-later">
          <span className="meta-label">Later — only if triggered</span>
          <ul className="action-list">
            {later.map((s) => (
              <StepRow key={s.id} step={s} blocked />
            ))}
          </ul>
        </div>
      )}

      {/* Customer engagement — customer-side stakeholders (never internal owners). */}
      {ac.customer_engagement_plan.stakeholders.length > 0 && (
        <div className="action-block">
          <span className="meta-label">Customer engagement</span>
          <ul className="action-list">
            {ac.customer_engagement_plan.stakeholders.map((s, i) => (
              <li key={i}>
                <span className="chip chip-muted">Customer</span> <strong>{s.person_or_role}</strong> — {s.buying_role} ({s.stance})
                {s.engagement_objective && <div className="muted">{s.engagement_objective}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outcome ledger — append-only; causation never claimed. */}
      <details className="section-group">
        <summary>Outcome tracking (causation not established){ac.outcome_ledger.existing_event_count > 0 ? ` · ${ac.outcome_ledger.existing_event_count} observed` : ""}</summary>
        <OutcomeLedgerControl
          runId={ac.run_id}
          actionCaseId={ac.action_case.opportunity_thread_id}
          existingEvents={ac.outcome_ledger.existing_events}
          nextMeasurements={ac.outcome_ledger.next_measurements}
          outcomeSummary={ac.outcome_ledger.outcome_summary}
        />
      </details>
    </section>
  );
}
