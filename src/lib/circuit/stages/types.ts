import type { ZodType } from "zod";

/**
 * Shared Circuit stage infrastructure (Phase 1). Every stage (A-D) runs
 * through ONE runner using the ONE Circuit client + token manager + the
 * versioned master prompt, a strict Zod schema, a single repair attempt,
 * and a deterministic fallback. Circuit never controls score arithmetic,
 * routing, evidence identity, or account truth — the runner enforces that
 * by validating output against the supplied evidence and rejecting
 * anything invented.
 */

export type StageName = "A" | "B" | "C" | "D";

/** Safe trace metadata — never a token, App Key, credential-bearing
 * request, raw transcript, or provider headers. */
export type StageTrace = {
  stage: StageName;
  attempted: boolean;
  succeeded: boolean;
  model_configured: string | null;
  model_returned: string | null;
  duration_ms: number;
  request_id: string | null;
  schema_version: string;
  repair_attempted: boolean;
  fallback_used: boolean;
  safe_error_code: string | null;
};

export type StageResult<T> = { output: T; trace: StageTrace };

/** A stage definition: its schema, how to build the stage-specific prompt,
 * optional extra validators (evidence IDs / URLs / people), and the
 * deterministic fallback that must always produce a valid output. */
export type StageDefinition<TInput, TOutput> = {
  stage: StageName;
  schema: ZodType<TOutput>;
  /** Builds the stage-specific user prompt (task + JSON-serialized input).
   * The master prompt is supplied separately as the system context. */
  buildPrompt: (input: TInput) => string;
  /** Extra semantic validation beyond the schema (returns error strings;
   * empty = valid). Used to reject invented evidence IDs / URLs / people
   * and any change to supplied numeric scores. */
  validate?: (output: TOutput, input: TInput) => string[];
  /** Always produces a valid output deterministically — used when Circuit
   * is unavailable, returns malformed output, or fails validation twice. */
  deterministicFallback: (input: TInput) => TOutput;
};
