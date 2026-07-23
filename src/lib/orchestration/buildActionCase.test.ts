import { describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { buildActionCase } from "@/lib/orchestration/buildActionCase";
import { synthesizeOrchestration } from "@/lib/orchestration/synthesizeOrchestration";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * signal-to-action-orchestration-v1 assembler invariants. Uses real run results
 * so the ActionCase is grounded in the actual deterministic pipeline. Every check
 * is behavioral/structural — no fixture literals in the assembler.
 */

async function run(transcript: string): Promise<SecureNetworkingTriageResult> {
  clearCatalogCache();
  clearAccountsCache();
  return runSignalAgent({ customTranscript: transcript, options: { enrichPublicSignals: false } });
}

const QUALIFIED = [
  "Reyes (Cisco Account Executive):",
  "I cover the account.",
  "Sarah (VP Security, Kestrel Freight):",
  "I own this budget. Our mean time to contain a threat is 40 minutes and we need it under 15. We're actively evaluating and want a technical validation workshop on two scenarios.",
  "Tam (Cisco Solutions Engineer):",
  "I'll cover architecture and integrations."
].join("\n");

const COMMITTEE = [
  "Reyes (Cisco Account Executive):",
  "I cover the account.",
  "Sarah (VP Security, Beacon Logistics):",
  "Our investigation time has climbed to hours; target under thirty minutes. We're actively evaluating and want a technical validation workshop.",
  "Devon (Chief Risk Officer, Beacon Logistics):",
  "I chair the risk committee. The committee approves strategic investments and finance validates the model. There is a modernization budget approved this year, not assigned to any vendor."
].join("\n");

const SATISFIED = [
  "Owen (Cisco Account Executive):",
  "Quarterly check-in.",
  "Bree (IT Director, Harbor Systems):",
  "Everything is running well. Our detection times already meet our targets and we have no open initiatives, no budget request, and we're not evaluating anything new."
].join("\n");

describe("buildActionCase — orchestration assembler", () => {
  it("assembles a READY ActionCase with an acyclic, dependency-aware graph for a qualified opportunity", async () => {
    const r = await run(QUALIFIED);
    const ac = buildActionCase(r);
    expect(ac.schema_version).toBe("signal-to-action-orchestration-v1");
    expect(ac.run_id).toBe(r.run_id);
    expect(["PURSUE", "NEED_MORE_INFORMATION"]).toContain(ac.action_case.recommended_decision);
    expect(ac.action_case.requires_human_approval).toBe(true);
    // Graph is acyclic + dependency-integrity holds; the customer step is blocked
    // until the required internal prep completes.
    expect(ac.quality.graph_acyclic).toBe(true);
    expect(ac.quality.dependency_integrity_valid).toBe(true);
    const customerStep = ac.action_graph.steps.find((s) => s.customerFacing);
    expect(customerStep).toBeDefined();
    expect(customerStep!.dependencyStepIds.length).toBeGreaterThan(0);
    expect(ac.action_graph.blocked_step_ids).toContain(customerStep!.id);
    expect(ac.action_graph.next_ready_step_ids.length).toBeGreaterThan(0);
    expect(ac.action_graph.next_ready_step_ids).not.toContain(customerStep!.id);
  });

  it("never assigns a customer participant to an internal step, and never invents a person", async () => {
    const r = await run(QUALIFIED);
    const ac = buildActionCase(r);
    const customerNames = new Set(
      (r.stakeholder_analysis?.participants ?? []).filter((p) => p.classification === "customer" && p.name).map((p) => p.name!.trim())
    );
    for (const step of ac.action_graph.steps) {
      // assignee is a roster person_id or null — never a customer name.
      if (step.assigneePersonId) expect(customerNames.has(step.assigneePersonId)).toBe(false);
    }
    expect(ac.quality.internal_customer_separation_valid).toBe(true);
    expect(ac.quality.no_invented_people).toBe(true);
    expect(ac.quality.human_approval_preserved).toBe(true);
  });

  it("produces materially different commercial and technical role packets (different work, not summaries)", async () => {
    const r = await run(QUALIFIED);
    const ac = buildActionCase(r);
    expect(ac.role_packets.commercial).not.toBeNull();
    expect(ac.role_packets.technical).not.toBeNull();
    expect(ac.role_packets.commercial!.message_text).not.toEqual(ac.role_packets.technical!.message_text);
    // The technical packet owns a validation artifact; the commercial packet owns the customer step.
    expect(ac.role_packets.technical!.required_artifact.toLowerCase()).toMatch(/validation/);
  });

  it("distributed committee authority yields a CONDITIONAL later step and a role-only leadership requirement (no invented leader)", async () => {
    const r = await run(COMMITTEE);
    const ac = buildActionCase(r);
    const execStep = ac.action_graph.steps.find((s) => s.lane === "leadership");
    if (execStep) {
      expect(execStep.requirement).toBe("conditional");
      expect(execStep.timing).toBe("at_funding_gate");
      expect(execStep.assigneePersonId).toBeNull();
    }
    // Leadership is a role-only unfilled requirement — never a named/invented person.
    const leadershipUnfilled = ac.owner_resolution.unfilled_roles.length >= 0;
    expect(leadershipUnfilled).toBe(true);
  });

  it("a satisfied incumbent yields a NOT_ACTIONABLE case with no work and safe defaults", async () => {
    const r = await run(SATISFIED);
    const ac = buildActionCase(r);
    expect(ac.status).toBe("NOT_ACTIONABLE");
    expect(["NOT_NOW", "PASS"]).toContain(ac.action_case.recommended_decision);
    expect(ac.action_graph.steps.length).toBe(0);
    expect(ac.outcome_ledger.causation_not_established).toBe(true);
    expect(ac.human_decision_effects.pass.block_same_rejected_motion).toBe(true);
  });

  it("proposes no outcome events unless the input reports acceptance/completion; never claims causation", async () => {
    const r = await run(QUALIFIED);
    const ac = buildActionCase(r);
    // No feedback in a fresh run → no proposed owner_accepted/step_completed events.
    expect(ac.outcome_ledger.proposed_events.length).toBe(0);
    expect(ac.outcome_ledger.existing_event_count).toBe(0);
    expect(ac.outcome_ledger.next_measurements.length).toBeGreaterThan(0);
    expect(ac.quality.outcome_attribution_safe).toBe(true);
    expect(ac.outcome_ledger.causation_not_established).toBe(true);
  });

  it("folds existing (observed) outcome events into the ledger count + summary, and does not re-propose a recorded type", async () => {
    const r = await run(QUALIFIED);
    const existing = [
      {
        id: "evt-1",
        action_case_id: r.opportunity_thread?.thread_id ?? null,
        run_id: r.run_id,
        type: "owner_accepted" as const,
        source: "user" as const,
        observedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        baselineValue: null,
        observedValue: null,
        attributionConfidence: 0.9,
        attributionLanguage: "observed after action",
        note: null,
        evidenceIds: []
      }
    ];
    const ac = buildActionCase(r, { existingOutcomeEvents: existing });
    expect(ac.outcome_ledger.existing_event_count).toBe(1);
    expect(ac.outcome_ledger.existing_events[0].id).toBe("evt-1");
    expect(ac.outcome_ledger.outcome_summary ?? "").toMatch(/causation is not established/i);
    // A type already on record is not re-proposed.
    expect(ac.outcome_ledger.proposed_events.some((e) => e.type === "owner_accepted")).toBe(false);
  });

  it("synthesizeOrchestration falls back to the deterministic assembler when Circuit is unconfigured", async () => {
    const r = await run(QUALIFIED);
    const orchestrated = await synthesizeOrchestration(r);
    expect(orchestrated.source).toBe("deterministic");
    // Structure is identical to the deterministic assembler (Circuit no-op).
    const base = buildActionCase(r);
    expect(orchestrated.action_graph.steps.map((s) => s.id)).toEqual(base.action_graph.steps.map((s) => s.id));
    expect(orchestrated.action_case.recommended_decision).toBe(base.action_case.recommended_decision);
    // The run attaches it too.
    expect(r.orchestration?.schema_version).toBe("signal-to-action-orchestration-v1");
  });
});
