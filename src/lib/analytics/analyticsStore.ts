import { mkdir, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { AnalyticsSummary, ProductEvent, ProductEventType } from "@/lib/analytics/types";

/** Append-only local product-event store (LOCAL_DATA_DIR JSONL) + summary
 * aggregation. Best-effort; never blocks a run. No enterprise analytics API. */

function eventsPath(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "product-events.jsonl");
}

export async function recordProductEvent(input: { type: ProductEventType; run_id?: string | null; account?: string | null; profile_id?: string | null; metadata?: Record<string, unknown> }): Promise<void> {
  const event: ProductEvent = {
    event_id: randomUUID(),
    type: input.type,
    timestamp: new Date().toISOString(),
    run_id: input.run_id ?? null,
    account: input.account ?? null,
    profile_id: input.profile_id ?? null,
    metadata: input.metadata ?? {}
  };
  try {
    await mkdir(path.dirname(eventsPath()), { recursive: true });
    await appendFile(eventsPath(), `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

export async function readProductEvents(): Promise<ProductEvent[]> {
  try {
    const text = await readFile(eventsPath(), "utf8");
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as ProductEvent);
  } catch {
    return [];
  }
}

function topCounts(values: string[], limit = 5): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function summarizeEvents(events: ProductEvent[]): AnalyticsSummary {
  const count = (t: ProductEventType) => events.filter((e) => e.type === t).length;
  const pursue = count("pursue_selected");
  const need = count("need_more_information_selected");
  const notNow = count("not_now_selected");
  const pass = count("pass_selected");
  const decisions = pursue + need + notNow + pass;
  const accepted = count("action_accepted");
  const completed = count("action_completed");
  const alertsGenerated = count("alert_generated");

  const relevanceValues = events
    .filter((e) => e.type === "alert_generated" && typeof e.metadata.personal_relevance === "number")
    .map((e) => e.metadata.personal_relevance as number);
  const suppressionReasons = events.filter((e) => e.type === "alert_suppressed").flatMap((e) => (Array.isArray(e.metadata.reason_codes) ? (e.metadata.reason_codes as string[]) : []));
  const objectives = events.filter((e) => e.type === "alert_generated").flatMap((e) => (Array.isArray(e.metadata.objective_ids) ? (e.metadata.objective_ids as string[]) : []));

  return {
    total_events: events.length,
    alerts_generated: alertsGenerated,
    alerts_suppressed: count("alert_suppressed"),
    pursue_rate: decisions > 0 ? Math.round((pursue / decisions) * 100) / 100 : 0,
    action_acceptance: alertsGenerated > 0 ? Math.round((accepted / alertsGenerated) * 100) / 100 : 0,
    action_completion: accepted > 0 ? Math.round((completed / accepted) * 100) / 100 : 0,
    assistant_questions: count("assistant_question_asked"),
    public_research_requests: count("public_research_requested"),
    avg_personal_relevance: relevanceValues.length > 0 ? Math.round(relevanceValues.reduce((a, b) => a + b, 0) / relevanceValues.length) : null,
    top_suppression_reasons: topCounts(suppressionReasons),
    top_seller_objectives: topCounts(objectives).map((r) => ({ objective_id: r.reason, count: r.count }))
  };
}
