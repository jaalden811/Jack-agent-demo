import { NextResponse } from "next/server";
import { recordActionFeedback, readActionFeedback, VALID_FEEDBACK_RESPONSES } from "@/lib/handoff/feedbackStore";
import type { ActionFeedback } from "@/lib/handoff/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Bound the free-text fields so a client can never persist an unbounded
// or unexpected payload (input validation at the trust boundary).
const MAX_FIELD = 500;

function clampString(value: unknown, max = MAX_FIELD): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = clampString(body.run_id, 64);
  const actionId = clampString(body.action_id, 64);
  const actor = clampString(body.actor, 120) ?? "unknown";
  const response = body.response;

  if (!runId || !actionId) {
    return NextResponse.json({ error: "run_id and action_id are required" }, { status: 400 });
  }
  if (typeof response !== "string" || !VALID_FEEDBACK_RESPONSES.includes(response as ActionFeedback["response"])) {
    return NextResponse.json({ error: `response must be one of: ${VALID_FEEDBACK_RESPONSES.join(", ")}` }, { status: 400 });
  }

  const feedback: ActionFeedback = {
    action_id: actionId,
    run_id: runId,
    actor,
    response: response as ActionFeedback["response"],
    reason: clampString(body.reason),
    timestamp: new Date().toISOString(),
    resulting_action: clampString(body.resulting_action)
  };

  const result = await recordActionFeedback(feedback);
  if (!result.persisted) {
    return NextResponse.json({ error: "Could not persist feedback", detail: result.warning }, { status: 500 });
  }
  return NextResponse.json({ ok: true, feedback });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id query parameter is required" }, { status: 400 });
  const feedback = await readActionFeedback(runId);
  return NextResponse.json({ run_id: runId, feedback });
}
