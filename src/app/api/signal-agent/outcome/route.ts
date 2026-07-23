import { NextResponse } from "next/server";
import { appendOutcomeEvent, readOutcomeEvents, OUTCOME_EVENT_TYPES, OUTCOME_SOURCES } from "@/lib/orchestration/outcomeStore";
import type { OutcomeEventType, OutcomeSource } from "@/lib/orchestration/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Records an append-only, human/system-observed OutcomeEvent for an ActionCase.
 * Never claims causation — the store rejects causal attribution text. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = clampString(body.run_id, 64);
  if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });
  const type = body.type;
  if (typeof type !== "string" || !OUTCOME_EVENT_TYPES.includes(type as OutcomeEventType)) {
    return NextResponse.json({ error: `type must be one of: ${OUTCOME_EVENT_TYPES.join(", ")}` }, { status: 400 });
  }
  const source = (typeof body.source === "string" && OUTCOME_SOURCES.includes(body.source as OutcomeSource) ? body.source : "user") as OutcomeSource;

  const result = await appendOutcomeEvent({
    run_id: runId,
    action_case_id: clampString(body.action_case_id, 128),
    type: type as OutcomeEventType,
    source,
    observedAt: clampString(body.observed_at, 40),
    baselineValue: typeof body.baseline_value === "number" || typeof body.baseline_value === "string" ? body.baseline_value : null,
    observedValue: typeof body.observed_value === "number" || typeof body.observed_value === "string" ? body.observed_value : null,
    attributionConfidence: typeof body.attribution_confidence === "number" ? body.attribution_confidence : null,
    attributionLanguage: clampString(body.attribution_language, 60),
    note: clampString(body.note, 500),
    evidenceIds: Array.isArray(body.evidence_ids) ? (body.evidence_ids as unknown[]).filter((e): e is string => typeof e === "string").slice(0, 12) : []
  });
  if (!result.persisted) {
    return NextResponse.json({ error: result.error ?? "Could not persist outcome event", detail: result.warning }, { status: result.error ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, event: result.event });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  const actionCaseId = url.searchParams.get("action_case_id");
  if (!runId && !actionCaseId) return NextResponse.json({ error: "run_id or action_case_id query parameter is required" }, { status: 400 });
  const events = await readOutcomeEvents({ run_id: runId, action_case_id: actionCaseId });
  return NextResponse.json({ run_id: runId, action_case_id: actionCaseId, events, existing_event_count: events.length });
}
