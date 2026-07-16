import { mkdir, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { AssistantAnswer, AssistantExchange } from "@/lib/run-assistant/types";

/** Append-only run-assistant exchange persistence (LOCAL_DATA_DIR JSONL). */

function assistantDir(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "run-assistant");
}

function assistantPath(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(assistantDir(), `${safe}.jsonl`);
}

export async function recordExchange(runId: string, question: string, answer: AssistantAnswer): Promise<AssistantExchange> {
  const exchange: AssistantExchange = { exchange_id: randomUUID(), run_id: runId, question, answer, timestamp: new Date().toISOString() };
  try {
    await mkdir(assistantDir(), { recursive: true });
    await appendFile(assistantPath(runId), `${JSON.stringify(exchange)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
  return exchange;
}

export async function readExchanges(runId: string): Promise<AssistantExchange[]> {
  try {
    const text = await readFile(assistantPath(runId), "utf8");
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as AssistantExchange);
  } catch {
    return [];
  }
}
