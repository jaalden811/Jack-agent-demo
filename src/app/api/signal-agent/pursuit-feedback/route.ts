import { NextResponse } from "next/server";
import { recordPursuitFeedback, readPursuitFeedback } from "@/lib/opportunity-feedback/feedbackStore";
import { VALID_PURSUIT_DECISIONS, type PursuitDecision } from "@/lib/opportunity-feedback/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FIELD = 500;

function clampString(value: unknown, max = MAX_FIELD): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Persist a pursuit decision (Pursue / Need more info / Not now / Pass). */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = clampString(body.run_id, 64);
  const account = clampString(body.account, 120) ?? "unknown";
  const motion = clampString(body.opportunity_motion_id, 120) ?? "unknown";
  const decision = body.decision;

  if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });
  if (typeof decision !== "string" || !VALID_PURSUIT_DECISIONS.includes(decision as PursuitDecision)) {
    return NextResponse.json({ error: `decision must be one of: ${VALID_PURSUIT_DECISIONS.join(", ")}` }, { status: 400 });
  }

  const result = await recordPursuitFeedback({
    run_id: runId,
    account,
    opportunity_motion_id: motion,
    profile_id: clampString(body.profile_id, 120),
    decision: decision as PursuitDecision,
    reason_code: clampString(body.reason_code, 120),
    free_text: clampString(body.free_text),
    next_review_at: clampString(body.next_review_at, 40)
  });

  if (!result.persisted) return NextResponse.json({ error: "Could not persist feedback", detail: result.warning }, { status: 500 });
  return NextResponse.json({ ok: true, feedback: result.feedback }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id query parameter is required" }, { status: 400 });
  return NextResponse.json({ feedback: await readPursuitFeedback(runId) }, { headers: { "Cache-Control": "no-store" } });
}
