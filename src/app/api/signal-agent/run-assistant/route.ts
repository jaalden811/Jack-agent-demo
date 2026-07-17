import { NextResponse } from "next/server";
import { z } from "zod";
import { answerRunQuestion } from "@/lib/run-assistant/assistantService";
import { synthesizeAssistantAnswer } from "@/lib/run-assistant/assistantSynthesis";
import { recordExchange, readExchanges } from "@/lib/run-assistant/assistantStore";
import { runAssistantResearch } from "@/lib/run-assistant/assistantResearch";
import type { RunAssistantContext } from "@/lib/run-assistant/types";
import { recordProductEvent } from "@/lib/analytics/analyticsStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const evidenceItemSchema = z.object({
  evidence_id: z.string().min(1),
  source_type: z.enum(["transcript", "public", "account_context", "user_profile"]),
  text: z.string()
});

const contextSchema = z.object({
  run_id: z.string().min(1),
  account: z.string().nullable().default(null),
  transcript_text: z.string().default(""),
  evidence_items: z.array(evidenceItemSchema).max(500).default([]),
  next_action_summary: z.string().nullable().default(null),
  open_questions: z.array(z.string()).default([]),
  do_not_reask: z.array(z.string()).default([]),
  personal_relevance_summary: z.string().nullable().default(null),
  goal_alignment_summary: z.string().nullable().default(null)
});

const bodySchema = z.object({
  run_id: z.string().min(1).max(64),
  question: z.string().min(2).max(500),
  research: z.boolean().optional().default(false),
  run_context: contextSchema
});

/** Ask a grounded question about a specific run. The assistant answers ONLY
 * from the provided run evidence; it never invents facts or mutates the run. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { run_id, question, research, run_context } = parsed.data;
  if (run_context.run_id !== run_id) {
    return NextResponse.json({ error: "run_context.run_id must match run_id" }, { status: 400 });
  }

  const ctx = run_context as RunAssistantContext;
  let answer = answerRunQuestion(question, ctx, { research });

  // Only an EXPLICIT research request triggers live SerpAPI — via the SAME
  // objective-aware controller (budget + caches). New sources are APPENDED to
  // the answer's evidence; original run evidence is never overwritten.
  if (research) {
    const rr = await runAssistantResearch({ question, account: ctx.account });
    const newEvidence = rr.rows.map((r) => ({ evidence_id: r.source_id || r.canonical_url, source_type: "public" as const, label: r.title.slice(0, 80) }));
    answer = { ...answer, evidence: [...answer.evidence, ...newEvidence], research_used: rr.executedCount > 0 || rr.rows.length > 0 };
    await recordProductEvent({ type: "public_research_requested", run_id, metadata: { executed: rr.executedCount } });
  }

  // Circuit rewrites the grounded answer into clearer prose using ONLY the
  // retrieved evidence (never adds facts); deterministic answer is the fallback.
  answer = await synthesizeAssistantAnswer(question, ctx, answer);

  const exchange = await recordExchange(run_id, question, answer);
  await recordProductEvent({ type: "assistant_question_asked", run_id, metadata: { research } });
  return NextResponse.json({ exchange }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id query parameter is required" }, { status: 400 });
  return NextResponse.json({ exchanges: await readExchanges(runId) }, { headers: { "Cache-Control": "no-store" } });
}
