import { readFileSync } from "node:fs";
import path from "node:path";

interface SatisfactionConfig {
  satisfaction_cues: string[];
  no_motion_cues: string[];
  negation_of_satisfaction: string[];
}

interface CompiledConfig {
  satisfaction: RegExp[];
  noMotion: RegExp[];
  negations: string[];
}

let cached: CompiledConfig | null = null;

export function clearSatisfactionCache(): void {
  cached = null;
}

function loadConfig(): CompiledConfig {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "satisfaction_signals.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as SatisfactionConfig;
  cached = {
    satisfaction: (raw.satisfaction_cues ?? []).map((p) => new RegExp(p, "i")),
    noMotion: (raw.no_motion_cues ?? []).map((p) => new RegExp(p, "i")),
    negations: (raw.negation_of_satisfaction ?? []).map((n) => n.toLowerCase())
  };
  return cached;
}

export interface SatisfiedIncumbent {
  satisfied: boolean;
  satisfaction_evidence: string[];
  no_motion_evidence: string[];
}

/**
 * Detects a "satisfied incumbent": the customer states the current solution
 * MEETS its targets (metrics inside thresholds / no gap that justifies change)
 * AND that there is no active buying motion (no requisition/RFP/project, not
 * comparing products, not starting a modernization). Both classes of signal
 * must be present, so a genuinely painful opportunity with a scope constraint
 * ("keep the incumbent alongside it") is never suppressed. A healthy, positive
 * metric (a healthy availability figure "within all thresholds") must not be read as
 * pain and drive a pursuit — this is what prevents chasing satisfied accounts.
 */
export function detectSatisfiedIncumbent(customerSentences: string[]): SatisfiedIncumbent {
  const { satisfaction, noMotion, negations } = loadConfig();
  const satisfactionEvidence: string[] = [];
  const noMotionEvidence: string[] = [];
  const clip = (t: string) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);
  for (const raw of customerSentences) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (negations.some((n) => lower.includes(n))) continue;
    if (satisfaction.some((re) => re.test(text))) satisfactionEvidence.push(clip(text));
    if (noMotion.some((re) => re.test(text))) noMotionEvidence.push(clip(text));
  }
  return {
    satisfied: satisfactionEvidence.length > 0 && noMotionEvidence.length > 0,
    satisfaction_evidence: satisfactionEvidence.slice(0, 3),
    no_motion_evidence: noMotionEvidence.slice(0, 3)
  };
}
