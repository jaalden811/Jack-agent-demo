import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Detects an EXPLICIT customer signal that justifies an immediate internal
 * sales-leader / executive-sponsor coordination step: the customer asked for
 * executive-to-executive engagement, or the decision is blocked at leadership.
 *
 * This is deliberately narrow (config/executive_coordination_signals.json). It
 * exists so that an internal-executive step is created ONLY on a real trigger —
 * NOT because authority is distributed, a committee exists, a board target was
 * mentioned, the economic buyer is unknown, or an executive attended. Those are
 * qualification facts that produce a conditional funding-gate note, never an
 * immediate internal-executive task.
 */

type ExecSignalsConfig = { exec_meeting_requested: string[]; exec_alignment_blocked: string[] };
type Compiled = { meeting: RegExp[]; blocked: RegExp[] };

let cached: Compiled | null = null;

export function clearExecutiveCoordinationCache(): void {
  cached = null;
}

function loadConfig(): Compiled {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "executive_coordination_signals.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as ExecSignalsConfig;
  cached = {
    meeting: (raw.exec_meeting_requested ?? []).map((p) => new RegExp(p, "i")),
    blocked: (raw.exec_alignment_blocked ?? []).map((p) => new RegExp(p, "i"))
  };
  return cached;
}

export type ExecutiveCoordinationTrigger = { code: "EXEC_MEETING_REQUESTED" | "EXEC_ALIGNMENT_BLOCKED"; description: string; evidence: string } | null;

/** Returns the strongest explicit executive-coordination trigger found in the
 * customer's sentences, else null. A requested exec meeting outranks a block. */
export function detectExecutiveCoordinationTrigger(customerSentences: string[]): ExecutiveCoordinationTrigger {
  const { meeting, blocked } = loadConfig();
  const clip = (t: string) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);
  for (const raw of customerSentences) {
    const text = (raw ?? "").trim();
    if (text && meeting.some((re) => re.test(text))) {
      return { code: "EXEC_MEETING_REQUESTED", description: "The customer explicitly requested executive-to-executive engagement.", evidence: clip(text) };
    }
  }
  for (const raw of customerSentences) {
    const text = (raw ?? "").trim();
    if (text && blocked.some((re) => re.test(text))) {
      return { code: "EXEC_ALIGNMENT_BLOCKED", description: "The decision is blocked at leadership level and needs internal senior help.", evidence: clip(text) };
    }
  }
  return null;
}
