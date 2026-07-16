import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SecureNetworkingTriageResult, TranscriptChunk } from "@/lib/signal-agent/types";
import { isInterrogative } from "@/lib/signal-agent/speechAct";
import { isObjectionOrSkepticism } from "@/lib/qualification/nextStepPolarity";
import type { WorkshopPlan, WorkshopScenario } from "@/lib/decision-packet/types";

/**
 * Deterministic extraction of the customer's REQUESTED workshop structure —
 * candidate scenarios (with the data sources named inside each), the data
 * sources to include, required participants, data constraints, timing, and
 * whether procurement is needed yet. Config-driven; additive; no company/
 * product/transcript literals. This captures what the customer asked for (in
 * their own words) — complementary to the SE-facing agenda in meetingBrief.ts.
 */

type WorkshopConfig = {
  scenario_cues: string[];
  data_source_terms: string[];
  participant_request_cues: string[];
  participant_role_terms: string[];
  data_constraint_cues: string[];
  timing_cues: string[];
  procurement_not_required_cues: string[];
};

let cached: WorkshopConfig | null = null;

export function clearWorkshopPlanCache(): void {
  cached = null;
}

function loadConfig(): WorkshopConfig {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "workshop_plan_signals.json");
  cached = JSON.parse(readFileSync(filePath, "utf8")) as WorkshopConfig;
  return cached;
}

function idFor(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

function termsPresent(textLower: string, terms: string[]): string[] {
  return terms.filter((t) => textLower.includes(t.toLowerCase()));
}

function titleCase(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

export function buildWorkshopPlan(result: SecureNetworkingTriageResult, chunks: TranscriptChunk[]): WorkshopPlan {
  const cfg = loadConfig();

  // "requested" comes from the (objection-cleaned) next-step signals.
  const nextSteps = result.generic_diagnostics?.signals.next_steps ?? [];
  const requestedCategories = new Set(["working_session", "workshop", "pilot", "proof_of_value"]);
  const requested = nextSteps.some((s) => requestedCategories.has(s.category));
  const scenarioMentioningStep = nextSteps.find((s) => /scenario/i.test(s.text));
  const format = !requested
    ? null
    : scenarioMentioningStep
      ? "Scenario-based working session"
      : nextSteps.some((s) => s.category === "working_session")
        ? "Working session"
        : nextSteps.some((s) => s.category === "proof_of_value")
          ? "Proof of value"
          : "Workshop";

  const candidateScenarios: WorkshopScenario[] = [];
  const scenarioSeen = new Set<string>();
  const dataSources = new Set<string>();
  const requiredParticipants = new Set<string>();
  const dataConstraints = new Set<string>();
  let timing: string | null = null;
  let procurementNeeded: boolean | null = null;

  for (const chunk of chunks) {
    const text = chunk.text.trim();
    const lower = text.toLowerCase();
    if (isInterrogative(text)) continue; // A seller's question is not a request.

    // Data sources named anywhere in the customer's dialogue.
    for (const term of termsPresent(lower, cfg.data_source_terms)) dataSources.add(term);

    // Candidate scenarios — a sentence that proposes/describes a scenario and
    // is not itself an objection. Each carries the data sources named inside.
    if (!isObjectionOrSkepticism(text) && cfg.scenario_cues.some((c) => lower.includes(c.toLowerCase()))) {
      const key = lower.slice(0, 80);
      if (!scenarioSeen.has(key)) {
        scenarioSeen.add(key);
        candidateScenarios.push({
          scenario_id: idFor("ws", text),
          statement: text,
          speaker: chunk.speaker,
          data_sources: termsPresent(lower, cfg.data_source_terms),
          evidence_ids: [idFor("ev", text)]
        });
      }
    }

    // Required participants — role terms in a participation-request context.
    if (cfg.participant_request_cues.some((c) => lower.includes(c.toLowerCase()))) {
      for (const role of termsPresent(lower, cfg.participant_role_terms)) requiredParticipants.add(role);
    }

    // Data constraints (synthetic/representative data, sovereignty, access).
    for (const term of termsPresent(lower, cfg.data_constraint_cues)) dataConstraints.add(term);

    // Timing — first customer statement that carries a timing cue.
    if (!timing && cfg.timing_cues.some((c) => lower.includes(c.toLowerCase()))) timing = text;

    // Procurement gating.
    if (cfg.procurement_not_required_cues.some((c) => lower.includes(c.toLowerCase()))) procurementNeeded = false;
  }

  return {
    requested,
    format,
    candidate_scenarios: candidateScenarios.slice(0, 5),
    data_sources: Array.from(dataSources).map(titleCase).slice(0, 10),
    required_participants: Array.from(requiredParticipants).map(titleCase).slice(0, 8),
    data_constraints: Array.from(dataConstraints).map(titleCase).slice(0, 6),
    timing,
    procurement_needed: procurementNeeded
  };
}
