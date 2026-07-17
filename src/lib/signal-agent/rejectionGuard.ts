import { readFileSync } from "node:fs";
import path from "node:path";

interface RejectionConfig {
  hard_rejection_patterns: string[];
  negation_of_rejection: string[];
}

interface CompiledConfig {
  patterns: RegExp[];
  negations: string[];
}

let cached: CompiledConfig | null = null;

export function clearRejectionCache(): void {
  cached = null;
}

function loadConfig(): CompiledConfig {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "rejection_signals.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as RejectionConfig;
  cached = {
    patterns: (raw.hard_rejection_patterns ?? []).map((p) => new RegExp(p, "i")),
    negations: (raw.negation_of_rejection ?? []).map((n) => n.toLowerCase())
  };
  return cached;
}

export interface HardRejection {
  rejected: boolean;
  count: number;
  evidence: string[];
}

/**
 * Detects an explicit CUSTOMER rejection of the vendor's proposed motion/scope/
 * opportunity. This is the "trap" guard: when the customer says the vendor's play
 * is out of scope / not an opportunity / cancelled / to be removed, pursuit must
 * be suppressed regardless of how much latent pain or criteria the call contains.
 *
 * It is deliberately conservative — it fires on strong, generic rejection shapes
 * (see config/rejection_signals.json), not on scope CONSTRAINTS ("no rip-and-
 * replace", "keep the incumbent"), which describe a bounded-but-real opportunity.
 */
export function detectHardRejection(customerSentences: string[]): HardRejection {
  const { patterns, negations } = loadConfig();
  const evidence: string[] = [];
  for (const raw of customerSentences) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (negations.some((n) => lower.includes(n))) continue;
    if (patterns.some((re) => re.test(text))) {
      evidence.push(text.length > 160 ? `${text.slice(0, 157)}...` : text);
    }
  }
  return { rejected: evidence.length > 0, count: evidence.length, evidence: evidence.slice(0, 4) };
}
