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
