import { readFileSync } from "node:fs";
import path from "node:path";
import { getCircuitConfig } from "@/lib/circuit/config";

/**
 * Versioned Circuit master-prompt loader (Phase 5). Loads the canonical
 * master context from signal-agent-poc/prompts/ and exposes its version so
 * every Circuit call and diagnostics can report which prompt was used. The
 * file content is the source of truth; this module only resolves + caches
 * it. Nothing company/transcript-specific is embedded here.
 */

const MASTER_PROMPT_RELATIVE_PATH = "signal-agent-poc/prompts/circuit_signal_to_action_master.md";

let cached: { version: string; text: string } | null = null;

export function clearMasterPromptCache(): void {
  cached = null;
}

export function loadCircuitMasterPrompt(): { version: string; text: string } {
  const version = getCircuitConfig().promptVersion;
  if (cached && cached.version === version) return cached;
  const text = readFileSync(path.join(process.cwd(), MASTER_PROMPT_RELATIVE_PATH), "utf8");
  cached = { version, text };
  return cached;
}

export function getMasterPromptVersion(): string {
  return getCircuitConfig().promptVersion;
}

// ─── Orchestration engine prompt (signal-to-action-orchestration-v1) ─────────
const ORCHESTRATION_PROMPT_RELATIVE_PATH = "signal-agent-poc/prompts/circuit_signal_to_action_orchestration.md";
const ORCHESTRATION_PROMPT_VERSION = "signal-to-action-orchestration-v1";
let orchestrationCached: { version: string; text: string } | null = null;

export function clearOrchestrationPromptCache(): void {
  orchestrationCached = null;
}

/** Loads the ActionCase orchestration master prompt. Its version is pinned to
 * the contract version (signal-to-action-orchestration-v1) — independent of the
 * A–D master prompt version — so a Circuit orchestration call always reports the
 * exact contract it targets. */
export function loadOrchestrationPrompt(): { version: string; text: string } {
  if (orchestrationCached) return orchestrationCached;
  const text = readFileSync(path.join(process.cwd(), ORCHESTRATION_PROMPT_RELATIVE_PATH), "utf8");
  orchestrationCached = { version: ORCHESTRATION_PROMPT_VERSION, text };
  return orchestrationCached;
}
